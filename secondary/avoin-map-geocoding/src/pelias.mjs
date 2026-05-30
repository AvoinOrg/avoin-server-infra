import { InvalidUpstreamResponseError, normalizePeliasFeatureCollection } from "./geojson.mjs";

export class UpstreamTimeoutError extends Error {
  constructor(message = "Pelias request timed out") {
    super(message);
    this.name = "UpstreamTimeoutError";
    this.code = "upstream_timeout";
  }
}

export class UpstreamHttpError extends Error {
  constructor(status) {
    super("Pelias returned an upstream error");
    this.name = "UpstreamHttpError";
    this.code = "upstream_error";
    this.upstreamStatus = status;
  }
}

export class UpstreamNetworkError extends Error {
  constructor() {
    super("Pelias could not be reached");
    this.name = "UpstreamNetworkError";
    this.code = "upstream_unreachable";
  }
}

function endpointUrl(config, endpoint) {
  return new URL(`${config.peliasBaseUrl}/v1/${endpoint}`);
}

export function buildPeliasUrl(config, parsedRequest, endpoint = "search") {
  const url = endpointUrl(config, endpoint);
  url.searchParams.set("text", parsedRequest.text);
  url.searchParams.set("size", String(parsedRequest.size));

  if (parsedRequest.countrycodes) {
    url.searchParams.set("boundary.country", parsedRequest.countrycodes);
  }

  if (parsedRequest.bbox) {
    const [west, south, east, north] = parsedRequest.bbox;
    url.searchParams.set("boundary.rect.min_lon", String(west));
    url.searchParams.set("boundary.rect.min_lat", String(south));
    url.searchParams.set("boundary.rect.max_lon", String(east));
    url.searchParams.set("boundary.rect.max_lat", String(north));
  }

  if (parsedRequest.focus) {
    url.searchParams.set("focus.point.lat", String(parsedRequest.focus.lat));
    url.searchParams.set("focus.point.lon", String(parsedRequest.focus.lon));
  }

  if (parsedRequest.sources) {
    url.searchParams.set("sources", parsedRequest.sources);
  }

  if (parsedRequest.layers) {
    url.searchParams.set("layers", parsedRequest.layers);
  }

  if (parsedRequest.lang) {
    url.searchParams.set("lang", parsedRequest.lang);
  }

  return url;
}

async function runWithTimeout(config, operation) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    return await operation(controller.signal);
  } catch (error) {
    if (error instanceof UpstreamHttpError || error instanceof InvalidUpstreamResponseError) {
      throw error;
    }
    if (error?.name === "AbortError") {
      throw new UpstreamTimeoutError();
    }
    throw new UpstreamNetworkError();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithTimeout(url, config, { headers = {}, fetchImpl = globalThis.fetch } = {}) {
  return runWithTimeout(config, async (signal) => {
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      signal,
    });

    if (!response.ok) {
      throw new UpstreamHttpError(response.status);
    }

    return response;
  });
}

export async function fetchPeliasFeatureCollection(parsedRequest, config, options = {}) {
  const url = buildPeliasUrl(config, parsedRequest, options.endpoint ?? "search");
  const headers = { Accept: "application/json" };

  if (parsedRequest.effectiveLanguage) {
    headers["Accept-Language"] = parsedRequest.effectiveLanguage;
  }

  return runWithTimeout(config, async (signal) => {
    const response = await (options.fetchImpl ?? globalThis.fetch)(url, {
      method: "GET",
      headers,
      signal,
    });

    if (!response.ok) {
      throw new UpstreamHttpError(response.status);
    }

    let body;
    try {
      body = await response.json();
    } catch (error) {
      if (error?.name === "AbortError") {
        throw error;
      }
      throw new InvalidUpstreamResponseError();
    }

    return normalizePeliasFeatureCollection(body, {
      limit: parsedRequest.size,
      queryType: "address",
    });
  });
}

export async function checkPeliasReady(config, options = {}) {
  const url = new URL(`${config.peliasBaseUrl}/v1`);
  await fetchWithTimeout(url, config, {
    headers: { Accept: "application/json" },
    fetchImpl: options.fetchImpl,
  });
  return true;
}
