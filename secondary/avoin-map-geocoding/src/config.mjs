export class ConfigError extends Error {
  constructor(message, variable) {
    super(message);
    this.name = "ConfigError";
    this.code = "invalid_config";
    this.variable = variable;
  }
}

const DEFAULTS = Object.freeze({
  port: 8080,
  requestTimeoutMs: 5000,
  resultLimitDefault: 5,
  resultLimitMax: 10,
  defaultCountrycodes: "fi",
  defaultBbox: "19,59,32,71",
  corsOrigins: "*",
});

function requiredString(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`${name} is required`, name);
  }
  return value.trim();
}

function parseInteger(env, name, defaultValue, { min, max }) {
  const rawValue = env[name];
  const value = rawValue == null || rawValue === "" ? String(defaultValue) : String(rawValue).trim();

  if (!/^\d+$/.test(value)) {
    throw new ConfigError(`${name} must be an integer`, name);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigError(`${name} must be between ${min} and ${max}`, name);
  }

  return parsed;
}

function parsePeliasBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError("PELIAS_BASE_URL must be a valid URL", "PELIAS_BASE_URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError("PELIAS_BASE_URL must use http or https", "PELIAS_BASE_URL");
  }

  return value.replace(/\/+$/, "");
}

export function parseBbox(value, variable = "GEOCODING_DEFAULT_BBOX") {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 4) {
    throw new ConfigError(`${variable} must contain west,south,east,north`, variable);
  }

  const numbers = parts.map((part) => Number(part));
  if (numbers.some((number) => !Number.isFinite(number))) {
    throw new ConfigError(`${variable} must contain numeric coordinates`, variable);
  }

  const [west, south, east, north] = numbers;
  if (west < -180 || west > 180 || east < -180 || east > 180) {
    throw new ConfigError(`${variable} longitude values must be between -180 and 180`, variable);
  }
  if (south < -90 || south > 90 || north < -90 || north > 90) {
    throw new ConfigError(`${variable} latitude values must be between -90 and 90`, variable);
  }
  if (west >= east || south >= north) {
    throw new ConfigError(`${variable} must be ordered west,south,east,north`, variable);
  }

  return numbers;
}

export function normalizeCountrycodes(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }

  const codes = value
    .split(",")
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);

  if (codes.length === 0 || codes.some((code) => !/^[a-z]{2,3}$/.test(code))) {
    throw new ConfigError("countrycodes must be comma-separated ISO country codes", "countrycodes");
  }

  return codes.join(",");
}

function parseCorsOrigins(value) {
  const raw = typeof value === "string" && value.trim() !== "" ? value.trim() : DEFAULTS.corsOrigins;
  if (raw === "*") {
    return { wildcard: true, origins: [] };
  }

  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return { wildcard: false, origins: [] };
  }

  return { wildcard: false, origins };
}

export function loadConfig(env = process.env) {
  const resultLimitMax = parseInteger(env, "GEOCODING_RESULT_LIMIT_MAX", DEFAULTS.resultLimitMax, {
    min: 1,
    max: 100,
  });
  const resultLimitDefault = parseInteger(
    env,
    "GEOCODING_RESULT_LIMIT_DEFAULT",
    Math.min(DEFAULTS.resultLimitDefault, resultLimitMax),
    { min: 1, max: resultLimitMax },
  );

  return Object.freeze({
    port: parseInteger(env, "GEOCODING_PORT", DEFAULTS.port, { min: 1, max: 65535 }),
    peliasBaseUrl: parsePeliasBaseUrl(requiredString(env, "PELIAS_BASE_URL")),
    requestTimeoutMs: parseInteger(env, "GEOCODING_REQUEST_TIMEOUT_MS", DEFAULTS.requestTimeoutMs, {
      min: 1,
      max: 60000,
    }),
    resultLimitDefault,
    resultLimitMax,
    defaultCountrycodes: normalizeCountrycodes(
      env.GEOCODING_DEFAULT_COUNTRYCODES ?? DEFAULTS.defaultCountrycodes,
    ),
    defaultBbox: parseBbox(env.GEOCODING_DEFAULT_BBOX ?? DEFAULTS.defaultBbox),
    corsOrigins: parseCorsOrigins(env.GEOCODING_CORS_ORIGINS ?? DEFAULTS.corsOrigins),
  });
}
