import pg from "pg";

const { Pool } = pg;

const REQUIRED_TABLES = Object.freeze([
  "source_metadata",
  "cadastral_parcels",
  "cadastral_estates",
]);

const READINESS_ENV_SQL = `
  SELECT
    current_database() AS database_name,
    EXISTS (
      SELECT 1
      FROM pg_extension
      WHERE extname = 'postgis'
    ) AS postgis_available,
    COALESCE(
      array_agg(table_name ORDER BY table_name)
        FILTER (WHERE table_name = ANY($1::text[])),
      ARRAY[]::text[]
    ) AS estate_tables
  FROM information_schema.tables
  WHERE table_schema = 'estate'
    AND table_name = ANY($1::text[])
`;

const POSTGIS_VERSION_SQL = "SELECT postgis_full_version() AS postgis_full_version";

const LATEST_METADATA_COUNTS_SQL = `
  SELECT parcel_row_count, estate_row_count
  FROM estate.source_metadata
  ORDER BY id DESC
  LIMIT 1
`;

const DIRECT_TABLE_COUNTS_SQL = `
  SELECT
    (SELECT count(*)::bigint FROM estate.cadastral_parcels) AS parcel_row_count,
    (SELECT count(*)::bigint FROM estate.cadastral_estates) AS estate_row_count
`;

const FULL_ESTATE_LOOKUP_SQL = `
  WITH candidate AS (
    SELECT
      e.estate_id_compact,
      e.estate_id_normalized,
      COALESCE(e.estate_id_display, e.estate_id_normalized) AS estate_id_display,
      e.municipality_code,
      e.part_count,
      COALESCE(e.source_freshness_at, m.registry_state_date::timestamptz, m.retrieved_at) AS source_freshness_at,
      e.loaded_at,
      e.geom
    FROM estate.cadastral_estates e
    LEFT JOIN estate.source_metadata m
      ON m.id = e.source_metadata_id
    WHERE e.estate_id_compact = $1
       OR e.estate_id_normalized = $2
    ORDER BY e.estate_id_compact
    LIMIT 1
  ),
  shaped AS (
    SELECT
      estate_id_compact,
      estate_id_normalized,
      estate_id_display,
      municipality_code,
      part_count,
      source_freshness_at,
      loaded_at,
      ST_Transform(geom, 4326) AS geom_4326
    FROM candidate
  )
  SELECT
    estate_id_compact,
    estate_id_normalized,
    estate_id_display,
    municipality_code,
    part_count,
    NULL::integer AS part_number,
    ST_AsGeoJSON(geom_4326, 6)::json AS geometry,
    json_build_array(
      ST_XMin(Box2D(geom_4326)),
      ST_YMin(Box2D(geom_4326)),
      ST_XMax(Box2D(geom_4326)),
      ST_YMax(Box2D(geom_4326))
    ) AS bbox,
    source_freshness_at,
    loaded_at
  FROM shaped
`;

const PART_LOOKUP_SQL = `
  WITH candidate AS (
    SELECT
      p.estate_id_compact,
      p.estate_id_normalized,
      COALESCE(p.estate_id_display, p.estate_id_normalized) AS estate_id_display,
      p.municipality_code,
      p.part_count,
      p.part_number,
      COALESCE(m.registry_state_date::timestamptz, m.retrieved_at) AS source_freshness_at,
      p.loaded_at,
      p.geom
    FROM estate.cadastral_parcels p
    LEFT JOIN estate.source_metadata m
      ON m.id = p.source_metadata_id
    WHERE (p.estate_id_compact = $1
       OR p.estate_id_normalized = $2)
      AND p.part_number = $3
    ORDER BY p.estate_id_compact, p.part_number
    LIMIT 1
  ),
  shaped AS (
    SELECT
      estate_id_compact,
      estate_id_normalized,
      estate_id_display,
      municipality_code,
      part_count,
      part_number,
      source_freshness_at,
      loaded_at,
      ST_Transform(geom, 4326) AS geom_4326
    FROM candidate
  )
  SELECT
    estate_id_compact,
    estate_id_normalized,
    estate_id_display,
    municipality_code,
    part_count,
    part_number,
    ST_AsGeoJSON(geom_4326, 6)::json AS geometry,
    json_build_array(
      ST_XMin(Box2D(geom_4326)),
      ST_YMin(Box2D(geom_4326)),
      ST_XMax(Box2D(geom_4326)),
      ST_YMax(Box2D(geom_4326))
    ) AS bbox,
    source_freshness_at,
    loaded_at
  FROM shaped
`;

export class EstateLookupUnavailableError extends Error {
  constructor(code = "estate_lookup_unavailable", options = {}) {
    super("Estate lookup dependency is unavailable", options);
    this.name = "EstateLookupUnavailableError";
    this.code = code;
  }
}

export class EstateLookupTimeoutError extends Error {
  constructor(options = {}) {
    super("Estate lookup timed out", options);
    this.name = "EstateLookupTimeoutError";
    this.code = "estate_lookup_timeout";
  }
}

function isTimeoutError(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  return error?.code === "57014" || /timeout|timed out/i.test(message);
}

function mapDatabaseError(error) {
  if (error instanceof EstateLookupUnavailableError || error instanceof EstateLookupTimeoutError) {
    return error;
  }
  if (isTimeoutError(error)) {
    return new EstateLookupTimeoutError({ cause: error });
  }
  if (error?.code === "42P01" || error?.code === "3F000") {
    return new EstateLookupUnavailableError("estate_schema_missing", { cause: error });
  }
  if (error?.code === "42883") {
    return new EstateLookupUnavailableError("estate_postgis_unavailable", { cause: error });
  }
  return new EstateLookupUnavailableError("estate_database_unreachable", { cause: error });
}

function isPositiveCount(value) {
  if (typeof value === "bigint") {
    return value > 0n;
  }

  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function hasCompleteCounts(row) {
  return row?.parcel_row_count != null && row?.estate_row_count != null;
}

function normalizeDate(value) {
  if (value == null || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function normalizeGeometry(value) {
  let geometry;
  try {
    geometry = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new EstateLookupUnavailableError("estate_result_invalid");
  }

  if (!geometry || typeof geometry !== "object" || typeof geometry.type !== "string") {
    throw new EstateLookupUnavailableError("estate_result_invalid");
  }

  const { crs: _crs, ...geojsonGeometry } = geometry;
  return geojsonGeometry;
}

function normalizeBbox(value) {
  let bbox;
  try {
    bbox = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }

  if (!Array.isArray(bbox) || bbox.length !== 4) {
    return null;
  }

  const numbers = bbox.map((item) => Number(item));
  return numbers.every((item) => Number.isFinite(item)) ? numbers : null;
}

function requiredString(row, name) {
  const value = row?.[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new EstateLookupUnavailableError("estate_result_invalid");
  }
  return value;
}

function requiredPositiveInteger(row, name) {
  const value = Number(row?.[name]);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new EstateLookupUnavailableError("estate_result_invalid");
  }
  return value;
}

function normalizeLookupRow(row, { partLookup }) {
  const item = {
    estateIdCompact: requiredString(row, "estate_id_compact"),
    estateIdNormalized: requiredString(row, "estate_id_normalized"),
    estateIdDisplay: requiredString(row, "estate_id_display"),
    municipalityCode: requiredString(row, "municipality_code"),
    partCount: requiredPositiveInteger(row, "part_count"),
    geometry: normalizeGeometry(row.geometry),
    bbox: normalizeBbox(row.bbox),
    sourceFreshnessAt: normalizeDate(row.source_freshness_at),
    loadedAt: normalizeDate(row.loaded_at),
    partLookup,
  };

  if (partLookup) {
    item.partNumber = requiredPositiveInteger(row, "part_number");
  }

  return item;
}

class DisabledEstateLookup {
  enabled = false;

  async checkReady() {
    return { status: "disabled", reason: "not_configured" };
  }

  async lookup() {
    throw new EstateLookupUnavailableError("estate_lookup_disabled");
  }

  async close() {}
}

class PostgisEstateLookup {
  enabled = true;

  constructor(config, { pool, PoolClass = Pool } = {}) {
    this.config = config;
    this.providedPool = pool ?? null;
    this.pool = pool ?? null;
    this.PoolClass = PoolClass;
  }

  getPool() {
    if (!this.pool) {
      const postgis = this.config.postgis;
      this.pool = new this.PoolClass({
        host: postgis.host,
        port: postgis.port,
        database: postgis.database,
        user: postgis.user,
        password: postgis.password,
        ssl: postgis.ssl,
        max: postgis.poolMax,
        connectionTimeoutMillis: postgis.connectTimeoutMs,
        query_timeout: postgis.queryTimeoutMs,
        statement_timeout: postgis.queryTimeoutMs,
      });
    }

    return this.pool;
  }

  async query(text, values = []) {
    try {
      return await this.getPool().query({ text, values });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async checkReady() {
    const envResult = await this.query(READINESS_ENV_SQL, [REQUIRED_TABLES]);
    const envRow = envResult.rows?.[0];

    if (!envRow || envRow.database_name !== this.config.expectedDatabase) {
      throw new EstateLookupUnavailableError("estate_database_mismatch");
    }

    if (!envRow.postgis_available) {
      throw new EstateLookupUnavailableError("estate_postgis_unavailable");
    }

    const tables = new Set(Array.isArray(envRow.estate_tables) ? envRow.estate_tables : []);
    if (REQUIRED_TABLES.some((table) => !tables.has(table))) {
      throw new EstateLookupUnavailableError("estate_schema_missing");
    }

    await this.query(POSTGIS_VERSION_SQL);

    const metadataResult = await this.query(LATEST_METADATA_COUNTS_SQL);
    const metadataRow = metadataResult.rows?.[0] ?? null;
    if (hasCompleteCounts(metadataRow)) {
      if (isPositiveCount(metadataRow.parcel_row_count) && isPositiveCount(metadataRow.estate_row_count)) {
        return { status: "ok" };
      }
      throw new EstateLookupUnavailableError("estate_data_unavailable");
    }

    const directCountsResult = await this.query(DIRECT_TABLE_COUNTS_SQL);
    const directCountsRow = directCountsResult.rows?.[0] ?? null;
    if (
      isPositiveCount(directCountsRow?.parcel_row_count) &&
      isPositiveCount(directCountsRow?.estate_row_count)
    ) {
      return { status: "ok" };
    }

    throw new EstateLookupUnavailableError("estate_data_unavailable");
  }

  async lookup(classification) {
    await this.checkReady();

    const values =
      classification.partNumber === null
        ? [classification.compactEstateId, classification.normalizedEstateId]
        : [classification.compactEstateId, classification.normalizedEstateId, classification.partNumber];
    const result = await this.query(
      classification.partNumber === null ? FULL_ESTATE_LOOKUP_SQL : PART_LOOKUP_SQL,
      values,
    );
    const row = result.rows?.[0] ?? null;

    if (!row) {
      return { status: "not_found" };
    }

    return {
      status: "found",
      item: normalizeLookupRow(row, { partLookup: classification.partNumber !== null }),
      lookupDataset: this.config.lookupDataset,
    };
  }

  async close() {
    if (this.pool && this.pool !== this.providedPool && typeof this.pool.end === "function") {
      await this.pool.end();
    }
  }
}

export function createEstatePostgisLookup(config, options = {}) {
  if (!config?.enabled) {
    return new DisabledEstateLookup();
  }

  return new PostgisEstateLookup(config, options);
}
