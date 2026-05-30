import assert from "node:assert/strict";
import test from "node:test";
import { ConfigError, loadConfig } from "../src/config.mjs";

const baseEnv = Object.freeze({
  PELIAS_BASE_URL: "https://pelias.example.test",
});

const enabledEstateEnv = Object.freeze({
  ...baseEnv,
  ESTATE_LOOKUP_ENABLED: "true",
  ESTATE_POSTGIS_HOST: "postgis.example.invalid",
  ESTATE_POSTGIS_PORT: "5432",
  ESTATE_POSTGIS_DATABASE: "geocoding-finland",
  ESTATE_POSTGIS_USER: "avoin_map_geocoding",
  ESTATE_POSTGIS_PASSWORD: "replace-with-estate-postgis-password",
  ESTATE_POSTGIS_SSL: "false",
  ESTATE_POSTGIS_CONNECT_TIMEOUT_MS: "2000",
  ESTATE_POSTGIS_QUERY_TIMEOUT_MS: "5000",
  ESTATE_POSTGIS_POOL_MAX: "5",
});

function assertConfigVariable(env, variable) {
  assert.throws(
    () => loadConfig(env),
    (error) => error instanceof ConfigError && error.variable === variable,
  );
}

test("disabled estate lookup does not require PostGIS values", () => {
  const config = loadConfig({
    ...baseEnv,
    ESTATE_LOOKUP_ENABLED: "false",
    ESTATE_POSTGIS_PORT: "not-used-when-disabled",
  });

  assert.equal(config.estateLookup.enabled, false);
  assert.equal(config.estateLookup.postgis, null);
});

test("enabled estate lookup parses required PostGIS values", () => {
  const config = loadConfig(enabledEstateEnv);

  assert.equal(config.estateLookup.enabled, true);
  assert.equal(config.estateLookup.expectedDatabase, "geocoding-finland");
  assert.equal(config.estateLookup.lookupDataset, "nls_cadastral_estates");
  assert.equal(config.estateLookup.postgis.host, "postgis.example.invalid");
  assert.equal(config.estateLookup.postgis.port, 5432);
  assert.equal(config.estateLookup.postgis.database, "geocoding-finland");
  assert.equal(config.estateLookup.postgis.user, "avoin_map_geocoding");
  assert.equal(config.estateLookup.postgis.ssl, false);
  assert.equal(config.estateLookup.postgis.connectTimeoutMs, 2000);
  assert.equal(config.estateLookup.postgis.queryTimeoutMs, 5000);
  assert.equal(config.estateLookup.postgis.poolMax, 5);
});

test("enabled estate lookup requires every critical PostGIS variable", () => {
  for (const variable of [
    "ESTATE_POSTGIS_HOST",
    "ESTATE_POSTGIS_PORT",
    "ESTATE_POSTGIS_DATABASE",
    "ESTATE_POSTGIS_USER",
    "ESTATE_POSTGIS_PASSWORD",
    "ESTATE_POSTGIS_SSL",
    "ESTATE_POSTGIS_CONNECT_TIMEOUT_MS",
    "ESTATE_POSTGIS_QUERY_TIMEOUT_MS",
    "ESTATE_POSTGIS_POOL_MAX",
  ]) {
    const env = { ...enabledEstateEnv };
    delete env[variable];
    assertConfigVariable(env, variable);
  }
});

test("estate lookup rejects invalid booleans, numeric bounds, and database name", () => {
  assertConfigVariable({ ...baseEnv, ESTATE_LOOKUP_ENABLED: "sometimes" }, "ESTATE_LOOKUP_ENABLED");
  assertConfigVariable({ ...enabledEstateEnv, ESTATE_POSTGIS_SSL: "sometimes" }, "ESTATE_POSTGIS_SSL");
  assertConfigVariable({ ...enabledEstateEnv, ESTATE_POSTGIS_PORT: "0" }, "ESTATE_POSTGIS_PORT");
  assertConfigVariable({ ...enabledEstateEnv, ESTATE_POSTGIS_CONNECT_TIMEOUT_MS: "0" }, "ESTATE_POSTGIS_CONNECT_TIMEOUT_MS");
  assertConfigVariable({ ...enabledEstateEnv, ESTATE_POSTGIS_QUERY_TIMEOUT_MS: "nope" }, "ESTATE_POSTGIS_QUERY_TIMEOUT_MS");
  assertConfigVariable({ ...enabledEstateEnv, ESTATE_POSTGIS_POOL_MAX: "0" }, "ESTATE_POSTGIS_POOL_MAX");
  assertConfigVariable(
    { ...enabledEstateEnv, ESTATE_POSTGIS_DATABASE: "postgres" },
    "ESTATE_POSTGIS_DATABASE",
  );
});

test("Pelias base URL validation remains active", () => {
  assertConfigVariable({}, "PELIAS_BASE_URL");
  assertConfigVariable({ PELIAS_BASE_URL: "ftp://pelias.example.test" }, "PELIAS_BASE_URL");
});
