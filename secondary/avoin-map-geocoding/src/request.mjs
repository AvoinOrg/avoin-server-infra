import { ConfigError, normalizeCountrycodes } from "./config.mjs";

export class RequestValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RequestValidationError";
    this.code = code;
    this.status = 400;
  }
}

function firstValue(searchParams, name) {
  const values = searchParams.getAll(name);
  if (values.length === 0) {
    return null;
  }

  return values[0];
}

function trimOrNull(value) {
  if (value == null) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function parseQueryText(searchParams) {
  const text = trimOrNull(firstValue(searchParams, "text"));
  const q = trimOrNull(firstValue(searchParams, "q"));

  if (text && q && text !== q) {
    throw new RequestValidationError("invalid_query", "text and q must not contain different values");
  }

  const resolved = text || q;
  if (!resolved) {
    throw new RequestValidationError("invalid_query", "text query parameter is required");
  }

  return resolved;
}

function parseLimitValue(raw, name) {
  if (raw == null || String(raw).trim() === "") {
    return null;
  }

  const value = String(raw).trim();
  if (!/^\d+$/.test(value)) {
    throw new RequestValidationError("invalid_limit", `${name} must be a positive integer`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new RequestValidationError("invalid_limit", `${name} must be a positive integer`);
  }

  return parsed;
}

function parseResultLimit(searchParams, config) {
  const size = parseLimitValue(firstValue(searchParams, "size"), "size");
  const limit = parseLimitValue(firstValue(searchParams, "limit"), "limit");

  if (size !== null && limit !== null && size !== limit) {
    throw new RequestValidationError("invalid_limit", "size and limit must not contain different values");
  }

  return Math.min(size ?? limit ?? config.resultLimitDefault, config.resultLimitMax);
}

function parseNumber(value, name) {
  if (value == null || String(value).trim() === "") {
    throw new RequestValidationError("invalid_bbox", `${name} must be numeric`);
  }

  const parsed = Number(String(value).trim());
  if (!Number.isFinite(parsed)) {
    throw new RequestValidationError("invalid_bbox", `${name} must be numeric`);
  }

  return parsed;
}

function validateBbox([west, south, east, north]) {
  if (west < -180 || west > 180 || east < -180 || east > 180) {
    throw new RequestValidationError("invalid_bbox", "bbox longitude values must be between -180 and 180");
  }
  if (south < -90 || south > 90 || north < -90 || north > 90) {
    throw new RequestValidationError("invalid_bbox", "bbox latitude values must be between -90 and 90");
  }
  if (west >= east || south >= north) {
    throw new RequestValidationError("invalid_bbox", "bbox must be ordered west,south,east,north");
  }
}

function parseBboxParam(searchParams) {
  const rawBbox = trimOrNull(firstValue(searchParams, "bbox"));
  if (!rawBbox) {
    return null;
  }

  const parts = rawBbox.split(",").map((part) => part.trim());
  if (parts.length !== 4) {
    throw new RequestValidationError("invalid_bbox", "bbox must contain west,south,east,north");
  }

  const bbox = parts.map((part, index) => parseNumber(part, `bbox[${index}]`));
  validateBbox(bbox);
  return bbox;
}

function parsePeliasRect(searchParams) {
  const names = [
    "boundary.rect.min_lon",
    "boundary.rect.min_lat",
    "boundary.rect.max_lon",
    "boundary.rect.max_lat",
  ];
  const values = names.map((name) => firstValue(searchParams, name));
  const present = values.map((value) => trimOrNull(value) !== null);

  if (!present.some(Boolean)) {
    return null;
  }
  if (!present.every(Boolean)) {
    throw new RequestValidationError("invalid_bbox", "all boundary.rect parameters are required together");
  }

  const bbox = values.map((value, index) => parseNumber(value, names[index]));
  validateBbox(bbox);
  return bbox;
}

function parseBoundary(searchParams, config) {
  const bbox = parseBboxParam(searchParams);
  const peliasRect = parsePeliasRect(searchParams);

  if (bbox && peliasRect) {
    throw new RequestValidationError("invalid_bbox", "use either bbox or boundary.rect parameters, not both");
  }

  return {
    bbox: bbox ?? peliasRect ?? config.defaultBbox ?? null,
    bboxSource: bbox ? "bbox" : peliasRect ? "boundary.rect" : config.defaultBbox ? "default" : null,
  };
}

function parseFocus(searchParams) {
  const rawLat = trimOrNull(firstValue(searchParams, "focus.point.lat"));
  const rawLon = trimOrNull(firstValue(searchParams, "focus.point.lon"));

  if (!rawLat && !rawLon) {
    return null;
  }
  if (!rawLat || !rawLon) {
    throw new RequestValidationError("invalid_focus", "focus.point.lat and focus.point.lon are required together");
  }

  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new RequestValidationError("invalid_focus", "focus.point.lat must be between -90 and 90");
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new RequestValidationError("invalid_focus", "focus.point.lon must be between -180 and 180");
  }

  return { lat, lon };
}

function parseOptionalList(searchParams, name) {
  const value = trimOrNull(firstValue(searchParams, name));
  if (!value) {
    return "";
  }

  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part))) {
    throw new RequestValidationError("invalid_filter", `${name} must be a comma-separated value list`);
  }

  return parts.join(",");
}

function parseLanguage(searchParams) {
  const lang = trimOrNull(firstValue(searchParams, "lang"));
  if (!lang) {
    return null;
  }

  if (!/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(lang)) {
    throw new RequestValidationError("invalid_language", "lang must be a valid language tag");
  }

  return lang;
}

function parseCountrycodes(searchParams, config) {
  const raw = firstValue(searchParams, "countrycodes");
  const value = raw == null ? config.defaultCountrycodes : raw;

  try {
    return normalizeCountrycodes(value);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw new RequestValidationError("invalid_countrycodes", error.message);
    }
    throw error;
  }
}

export function parseSearchRequest(searchParams, headers, config) {
  const text = parseQueryText(searchParams);
  const size = parseResultLimit(searchParams, config);
  const boundary = parseBoundary(searchParams, config);
  const lang = parseLanguage(searchParams);
  const acceptLanguage = headers["accept-language"] || headers["Accept-Language"] || "";
  const effectiveLanguage = lang || trimOrNull(acceptLanguage) || null;

  return {
    text,
    size,
    countrycodes: parseCountrycodes(searchParams, config),
    bbox: boundary.bbox,
    bboxSource: boundary.bboxSource,
    focus: parseFocus(searchParams),
    sources: parseOptionalList(searchParams, "sources"),
    layers: parseOptionalList(searchParams, "layers"),
    lang,
    effectiveLanguage,
  };
}
