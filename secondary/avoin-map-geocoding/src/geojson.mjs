export class InvalidUpstreamResponseError extends Error {
  constructor(message = "Pelias returned an invalid response") {
    super(message);
    this.name = "InvalidUpstreamResponseError";
    this.code = "invalid_upstream_response";
  }
}

export function emptyFeatureCollection(avoin = {}) {
  const collection = {
    type: "FeatureCollection",
    features: [],
  };

  if (Object.keys(avoin).length > 0) {
    collection.avoin = avoin;
  }

  return collection;
}

export function errorFeatureCollection(code, message, status) {
  return emptyFeatureCollection({
    error: {
      code,
      message,
      status,
    },
  });
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeFeature(feature, queryType) {
  if (!feature || typeof feature !== "object" || feature.type !== "Feature") {
    throw new InvalidUpstreamResponseError("Pelias feature is not a GeoJSON Feature");
  }

  const normalized = cloneJson(feature);
  const properties =
    normalized.properties && typeof normalized.properties === "object" ? normalized.properties : {};
  const avoin = properties.avoin && typeof properties.avoin === "object" ? properties.avoin : {};

  normalized.properties = {
    ...properties,
    avoin: {
      ...avoin,
      query_type: queryType,
    },
  };

  return normalized;
}

export function normalizePeliasFeatureCollection(body, { limit, queryType = "address" }) {
  if (!body || typeof body !== "object" || body.type !== "FeatureCollection" || !Array.isArray(body.features)) {
    throw new InvalidUpstreamResponseError();
  }

  const normalized = {
    type: "FeatureCollection",
    features: body.features.slice(0, limit).map((feature) => normalizeFeature(feature, queryType)),
  };

  if (Array.isArray(body.bbox)) {
    normalized.bbox = cloneJson(body.bbox);
  }
  if (body.geocoding && typeof body.geocoding === "object") {
    normalized.geocoding = cloneJson(body.geocoding);
  }

  return normalized;
}
