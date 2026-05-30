\set ON_ERROR_STOP on

BEGIN;

TRUNCATE TABLE estate.cadastral_parcels, estate.cadastral_estates RESTART IDENTITY;

DROP TABLE IF EXISTS estate_staging.rejected_parcels;

WITH params AS (
  SELECT
    :'SOURCE_PROVIDER'::text AS provider,
    :'SOURCE_DATASET_NAME'::text AS dataset_name,
    :'SOURCE_PRODUCT_URL'::text AS product_url,
    :'SOURCE_LICENSE'::text AS license,
    :'SOURCE_ATTRIBUTION'::text AS attribution,
    :'SOURCE_ACQUISITION_METHOD'::text AS acquisition_method,
    COALESCE(NULLIF(:'SOURCE_RETRIEVED_AT', '')::timestamptz, now()) AS retrieved_at,
    NULLIF(:'NLS_DELIVERY_OR_ORDER_TIME', '')::text AS nls_delivery_or_order_time,
    NULLIF(:'SOURCE_REGISTRY_STATE_DATE', '')::date AS registry_state_date,
    NULLIF(:'SOURCE_REGISTRY_STATE_CURRENT', '')::boolean AS registry_state_current,
    :'SOURCE_FORMAT'::text AS source_format,
    :'SOURCE_CRS'::text AS source_crs,
    NULLIF(:'SOURCE_FILENAME', '')::text AS source_filename,
    NULLIF(:'SOURCE_JOB_ID', '')::text AS source_job_id,
    NULLIF(:'SOURCE_SHA256', '')::text AS source_sha256,
    NULLIF(:'SOURCE_FILE_SIZE_BYTES', '')::bigint AS source_file_size_bytes
),
raw_counts AS (
  SELECT count(*)::bigint AS raw_feature_count
  FROM estate_staging.raw_parcels
),
inserted AS (
  INSERT INTO estate.source_metadata (
    provider,
    dataset_name,
    product_url,
    license,
    attribution,
    acquisition_method,
    retrieved_at,
    nls_delivery_or_order_time,
    registry_state_date,
    registry_state_current,
    source_format,
    source_crs,
    source_filename,
    source_job_id,
    source_sha256,
    source_file_size_bytes,
    raw_feature_count,
    notes
  )
  SELECT
    p.provider,
    p.dataset_name,
    p.product_url,
    p.license,
    p.attribution,
    p.acquisition_method,
    p.retrieved_at,
    p.nls_delivery_or_order_time,
    p.registry_state_date,
    p.registry_state_current,
    p.source_format,
    p.source_crs,
    p.source_filename,
    p.source_job_id,
    p.source_sha256,
    p.source_file_size_bytes,
    r.raw_feature_count,
    'Import excludes unseparated parcels, projected parcels, 3D cadastral products, boundary lines, and boundary markers.'
  FROM params p
  CROSS JOIN raw_counts r
  RETURNING id
)
SELECT id AS metadata_id
FROM inserted
\gset

CREATE TEMP TABLE estate_loader_raw ON COMMIT DROP AS
SELECT
  COALESCE(
    NULLIF(to_jsonb(r) ->> :'SOURCE_FEATURE_ID_FIELD', ''),
    NULLIF(to_jsonb(r) ->> 'fid', ''),
    NULLIF(to_jsonb(r) ->> 'ogc_fid', '')
  ) AS source_feature_id,
  regexp_replace(
    COALESCE(
      to_jsonb(r) ->> :'SOURCE_ESTATE_ID_FIELD',
      to_jsonb(r) ->> :'SOURCE_ESTATE_DISPLAY_FIELD',
      ''
    ),
    '[^0-9]',
    '',
    'g'
  ) AS estate_id_compact,
  NULLIF(to_jsonb(r) ->> :'SOURCE_ESTATE_DISPLAY_FIELD', '') AS estate_id_display,
  to_jsonb(r) - 'geom' AS source_properties,
  CASE
    WHEN ST_SRID(r.geom) = 3067 THEN ST_Force2D(r.geom)
    WHEN ST_SRID(r.geom) = 0 THEN ST_SetSRID(ST_Force2D(r.geom), 3067)
    ELSE ST_Transform(ST_Force2D(r.geom), 3067)
  END AS source_geom
FROM estate_staging.raw_parcels r;

CREATE TEMP TABLE estate_loader_prepared ON COMMIT DROP AS
SELECT
  source_feature_id,
  estate_id_compact,
  estate_id_display,
  source_properties,
  ST_Multi(
    ST_CollectionExtract(
      ST_MakeValid(source_geom),
      3
    )
  )::geometry(MultiPolygon, 3067) AS geom,
  ST_IsValid(source_geom) AS source_geom_was_valid
FROM estate_loader_raw;

CREATE TABLE estate_staging.rejected_parcels AS
SELECT
  source_feature_id,
  estate_id_compact,
  CASE
    WHEN estate_id_compact !~ '^[0-9]{14}$' THEN 'invalid_compact_estate_id'
    WHEN ST_IsEmpty(geom) THEN 'empty_polygon_after_repair'
    ELSE 'unknown'
  END AS rejection_reason,
  source_properties
FROM estate_loader_prepared
WHERE estate_id_compact !~ '^[0-9]{14}$'
   OR ST_IsEmpty(geom);

WITH valid_rows AS (
  SELECT
    source_feature_id,
    estate_id_compact,
    estate_id_display,
    substring(estate_id_compact from 1 for 3) AS municipality_code,
    COALESCE(NULLIF(ltrim(substring(estate_id_compact from 4 for 3), '0'), ''), '0') AS register_unit_code,
    COALESCE(NULLIF(ltrim(substring(estate_id_compact from 7 for 4), '0'), ''), '0') AS block_code,
    COALESCE(NULLIF(ltrim(substring(estate_id_compact from 11 for 4), '0'), ''), '0') AS parcel_code,
    source_properties,
    geom,
    md5(
      estate_id_compact
      || '|'
      || encode(ST_AsEWKB(geom), 'hex')
      || '|'
      || source_properties::text
    ) AS stable_order_key
  FROM estate_loader_prepared
  WHERE estate_id_compact ~ '^[0-9]{14}$'
    AND NOT ST_IsEmpty(geom)
),
numbered AS (
  SELECT
    *,
    municipality_code
      || '-'
      || register_unit_code
      || '-'
      || block_code
      || '-'
      || parcel_code AS estate_id_normalized,
    row_number() OVER (
      PARTITION BY estate_id_compact
      ORDER BY source_feature_id NULLS LAST, stable_order_key
    )::integer AS part_number,
    count(*) OVER (PARTITION BY estate_id_compact)::integer AS part_count
  FROM valid_rows
)
INSERT INTO estate.cadastral_parcels (
  source_metadata_id,
  source_layer,
  source_feature_id,
  estate_id_compact,
  estate_id_normalized,
  estate_id_display,
  municipality_code,
  register_unit_code,
  block_code,
  parcel_code,
  part_number,
  part_count,
  source_properties,
  geom,
  label_point
)
SELECT
  :metadata_id::bigint,
  :'SOURCE_LAYER',
  source_feature_id,
  estate_id_compact,
  estate_id_normalized,
  estate_id_display,
  municipality_code,
  register_unit_code,
  block_code,
  parcel_code,
  part_number,
  part_count,
  source_properties,
  geom,
  ST_PointOnSurface(geom)::geometry(Point, 3067)
FROM numbered;

WITH grouped AS (
  SELECT
    p.estate_id_compact,
    min(p.estate_id_normalized) AS estate_id_normalized,
    (array_agg(p.estate_id_display ORDER BY p.part_number)
      FILTER (WHERE p.estate_id_display IS NOT NULL))[1] AS estate_id_display,
    min(p.municipality_code) AS municipality_code,
    min(p.register_unit_code) AS register_unit_code,
    min(p.block_code) AS block_code,
    min(p.parcel_code) AS parcel_code,
    count(*)::integer AS part_count,
    p.source_metadata_id,
    ST_Multi(
      ST_CollectionExtract(
        ST_UnaryUnion(ST_Collect(p.geom)),
        3
      )
    )::geometry(MultiPolygon, 3067) AS geom
  FROM estate.cadastral_parcels p
  WHERE p.source_metadata_id = :metadata_id::bigint
  GROUP BY p.estate_id_compact, p.source_metadata_id
)
INSERT INTO estate.cadastral_estates (
  estate_id_compact,
  estate_id_normalized,
  estate_id_display,
  municipality_code,
  register_unit_code,
  block_code,
  parcel_code,
  part_count,
  source_metadata_id,
  geom,
  label_point,
  source_freshness_at
)
SELECT
  g.estate_id_compact,
  g.estate_id_normalized,
  COALESCE(g.estate_id_display, g.estate_id_normalized),
  g.municipality_code,
  g.register_unit_code,
  g.block_code,
  g.parcel_code,
  g.part_count,
  g.source_metadata_id,
  g.geom,
  ST_PointOnSurface(g.geom)::geometry(Point, 3067),
  COALESCE(m.registry_state_date::timestamptz, m.retrieved_at)
FROM grouped g
JOIN estate.source_metadata m
  ON m.id = g.source_metadata_id;

WITH stats AS (
  SELECT
    (SELECT count(*)::bigint FROM estate_staging.raw_parcels) AS raw_feature_count,
    (SELECT count(*)::bigint FROM estate_loader_prepared WHERE estate_id_compact !~ '^[0-9]{14}$') AS invalid_compact_ids,
    (SELECT count(*)::bigint FROM estate_loader_prepared WHERE NOT source_geom_was_valid) AS invalid_geometries_before_repair,
    (SELECT count(*)::bigint FROM estate_loader_prepared WHERE ST_IsEmpty(geom)) AS empty_geometries_after_repair,
    (SELECT count(*)::bigint FROM estate.cadastral_parcels WHERE source_metadata_id = :metadata_id::bigint) AS parcel_row_count,
    (SELECT count(*)::bigint FROM estate.cadastral_estates WHERE source_metadata_id = :metadata_id::bigint) AS estate_row_count
)
UPDATE estate.source_metadata m
SET
  raw_feature_count = s.raw_feature_count,
  parcel_row_count = s.parcel_row_count,
  estate_row_count = s.estate_row_count,
  notes = concat_ws(
    '; ',
    NULLIF(m.notes, ''),
    'source layer: ' || :'SOURCE_LAYER',
    'estate id field: ' || :'SOURCE_ESTATE_ID_FIELD',
    'display id field: ' || COALESCE(NULLIF(:'SOURCE_ESTATE_DISPLAY_FIELD', ''), 'not configured'),
    'source feature id field: ' || COALESCE(NULLIF(:'SOURCE_FEATURE_ID_FIELD', ''), 'fid/ogc_fid fallback'),
    'invalid compact IDs excluded: ' || s.invalid_compact_ids,
    'invalid geometries before repair: ' || s.invalid_geometries_before_repair,
    'empty geometries after repair excluded: ' || s.empty_geometries_after_repair,
    'geometry repair: ST_Force2D, ST_SetSRID/ST_Transform to EPSG:3067, ST_MakeValid, ST_CollectionExtract polygon, ST_Multi',
    'label points: ST_PointOnSurface representative points'
  )
FROM stats s
WHERE m.id = :metadata_id::bigint;

COMMIT;
