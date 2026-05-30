import assert from "node:assert/strict";
import test from "node:test";
import { classifyEstateIdQuery } from "../src/estate-id.mjs";
import {
  createEstatePostgisLookup,
  EstateLookupTimeoutError,
  EstateLookupUnavailableError,
} from "../src/estate-postgis.mjs";

const config = Object.freeze({
  enabled: true,
  expectedDatabase: "geocoding-finland",
  lookupDataset: "nls_cadastral_estates",
  postgis: Object.freeze({
    host: "postgis.example.invalid",
    port: 5432,
    database: "geocoding-finland",
    user: "avoin_map_geocoding",
    password: "replace-with-estate-postgis-password",
    ssl: false,
    connectTimeoutMs: 2000,
    queryTimeoutMs: 5000,
    poolMax: 5,
  }),
});

const readyEnvRows = [
  {
    database_name: "geocoding-finland",
    postgis_available: true,
    estate_tables: ["cadastral_estates", "cadastral_parcels", "source_metadata"],
  },
];

const readyMetadataRows = [{ parcel_row_count: "10", estate_row_count: "4" }];

function fakePool(responses) {
  const calls = [];
  return {
    calls,
    async query(query) {
      calls.push(query);
      const response = responses.shift();
      if (response instanceof Error) {
        throw response;
      }
      if (typeof response === "function") {
        return response(query);
      }
      return { rows: response ?? [] };
    },
    async end() {},
  };
}

function lookupWithResponses(responses) {
  const pool = fakePool(responses);
  return {
    lookup: createEstatePostgisLookup(config, { pool }),
    pool,
  };
}

function readyResponses(extraResponses = []) {
  return [readyEnvRows, [{ postgis_full_version: "POSTGIS" }], readyMetadataRows, ...extraResponses];
}

function lookupRow(overrides = {}) {
  return {
    estate_id_compact: "17440100030006",
    estate_id_normalized: "174-401-3-6",
    estate_id_display: "174-401-3-6",
    municipality_code: "174",
    part_count: 2,
    part_number: null,
    geometry: {
      type: "MultiPolygon",
      coordinates: [[[[24, 60], [24.1, 60], [24.1, 60.1], [24, 60.1], [24, 60]]]],
    },
    bbox: [24, 60, 24.1, 60.1],
    source_freshness_at: new Date("2026-01-01T00:00:00.000Z"),
    loaded_at: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

test("readiness passes with PostGIS, required tables, and non-zero metadata counts", async () => {
  const { lookup, pool } = lookupWithResponses(readyResponses());

  assert.deepEqual(await lookup.checkReady(), { status: "ok" });
  assert.equal(pool.calls.length, 3);
});

test("readiness falls back to direct table counts when metadata is incomplete", async () => {
  const { lookup } = lookupWithResponses([
    readyEnvRows,
    [{ postgis_full_version: "POSTGIS" }],
    [{ parcel_row_count: null, estate_row_count: null }],
    [{ parcel_row_count: "10", estate_row_count: "4" }],
  ]);

  assert.deepEqual(await lookup.checkReady(), { status: "ok" });
});

test("readiness reports missing schema and unavailable data with stable codes", async () => {
  const missingSchema = lookupWithResponses([
    [
      {
        database_name: "geocoding-finland",
        postgis_available: true,
        estate_tables: ["source_metadata"],
      },
    ],
  ]).lookup;

  await assert.rejects(
    () => missingSchema.checkReady(),
    (error) => error instanceof EstateLookupUnavailableError && error.code === "estate_schema_missing",
  );

  const emptyData = lookupWithResponses([
    readyEnvRows,
    [{ postgis_full_version: "POSTGIS" }],
    [{ parcel_row_count: "0", estate_row_count: "0" }],
  ]).lookup;

  await assert.rejects(
    () => emptyData.checkReady(),
    (error) => error instanceof EstateLookupUnavailableError && error.code === "estate_data_unavailable",
  );
});

test("readiness maps database and query timeouts to stable errors", async () => {
  const connectionError = new Error("connect failed");
  connectionError.code = "ECONNREFUSED";
  const unreachable = lookupWithResponses([connectionError]).lookup;

  await assert.rejects(
    () => unreachable.checkReady(),
    (error) => error instanceof EstateLookupUnavailableError && error.code === "estate_database_unreachable",
  );

  const timeoutError = new Error("canceling statement due to statement timeout");
  timeoutError.code = "57014";
  const timedOut = lookupWithResponses([readyEnvRows, timeoutError]).lookup;

  await assert.rejects(
    () => timedOut.checkReady(),
    (error) => error instanceof EstateLookupTimeoutError && error.code === "estate_lookup_timeout",
  );
});

test("full estate lookup returns normalized result and passes IDs as SQL parameters", async () => {
  const { lookup, pool } = lookupWithResponses([...readyResponses(), [lookupRow()]]);
  const result = await lookup.lookup(classifyEstateIdQuery("174-401-3-6"));
  const lookupCall = pool.calls.at(-1);

  assert.equal(result.status, "found");
  assert.equal(result.lookupDataset, "nls_cadastral_estates");
  assert.equal(result.item.estateIdCompact, "17440100030006");
  assert.equal(result.item.estateIdNormalized, "174-401-3-6");
  assert.equal(result.item.partLookup, false);
  assert.deepEqual(result.item.bbox, [24, 60, 24.1, 60.1]);
  assert.equal(result.item.sourceFreshnessAt, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(lookupCall.values, ["17440100030006", "174-401-3-6"]);
  assert.match(lookupCall.text, /estate\.cadastral_estates/);
  assert.equal(lookupCall.text.includes("17440100030006"), false);
});

test("part lookup queries parcels by part number", async () => {
  const { lookup, pool } = lookupWithResponses([
    ...readyResponses(),
    [lookupRow({ part_number: 2 })],
  ]);
  const result = await lookup.lookup(classifyEstateIdQuery("174-401-3-6 #2"));
  const lookupCall = pool.calls.at(-1);

  assert.equal(result.status, "found");
  assert.equal(result.item.partLookup, true);
  assert.equal(result.item.partNumber, 2);
  assert.deepEqual(lookupCall.values, ["17440100030006", "174-401-3-6", 2]);
  assert.match(lookupCall.text, /estate\.cadastral_parcels/);
});

test("healthy lookup reports absent estates and missing requested parts as not found", async () => {
  const full = lookupWithResponses([...readyResponses(), []]).lookup;
  const part = lookupWithResponses([...readyResponses(), []]).lookup;

  assert.deepEqual(await full.lookup(classifyEstateIdQuery("174-401-3-6")), { status: "not_found" });
  assert.deepEqual(await part.lookup(classifyEstateIdQuery("174-401-3-6 #7")), { status: "not_found" });
});
