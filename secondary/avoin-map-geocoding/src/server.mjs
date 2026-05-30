import http from "node:http";
import { loadConfig, ConfigError } from "./config.mjs";
import {
  classifyEstateIdQuery,
  disabledEstateFeatureCollection,
  estateLookupErrorFeatureCollection,
  foundEstateFeatureCollection,
  notFoundEstateFeatureCollection,
} from "./estate-id.mjs";
import {
  createEstatePostgisLookup,
  EstateLookupTimeoutError,
  EstateLookupUnavailableError,
} from "./estate-postgis.mjs";
import { errorFeatureCollection } from "./geojson.mjs";
import { InvalidUpstreamResponseError } from "./geojson.mjs";
import {
  checkPeliasReady,
  fetchPeliasFeatureCollection,
  UpstreamHttpError,
  UpstreamNetworkError,
  UpstreamTimeoutError,
} from "./pelias.mjs";
import { parseSearchRequest, RequestValidationError } from "./request.mjs";

const SERVICE_NAME = "avoin-map-geocoding";
const ALLOWED_METHODS = "GET,HEAD,OPTIONS";
const ALLOWED_HEADERS = "Accept-Language,Content-Type";

function normalizeHeaders(headers) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(",") : value ?? "";
  }
  return normalized;
}

function corsHeaders(config, req) {
  const headers = {
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
  };

  const origin = req.headers.origin;
  if (config.corsOrigins.wildcard) {
    headers["Access-Control-Allow-Origin"] = "*";
    return headers;
  }

  headers.Vary = "Origin";
  if (origin && config.corsOrigins.origins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function writeJson(req, res, config, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...corsHeaders(config, req),
    ...extraHeaders,
  };

  res.writeHead(status, headers);
  if (req.method !== "HEAD") {
    res.end(payload);
  } else {
    res.end();
  }
}

function writeNoContent(req, res, config) {
  res.writeHead(204, corsHeaders(config, req));
  res.end();
}

function writeMethodNotAllowed(req, res, config) {
  writeJson(
    req,
    res,
    config,
    405,
    {
      error: {
        code: "method_not_allowed",
        message: "Only GET, HEAD, and OPTIONS are supported",
      },
    },
    { Allow: ALLOWED_METHODS },
  );
}

function validationErrorBody(error) {
  return {
    error: {
      code: error.code,
      message: error.message,
    },
  };
}

function peliasReadiness(peliasStatus, details = {}) {
  const pelias = { status: peliasStatus };
  if (details.code) {
    pelias.code = details.code;
  }
  if (details.upstreamStatus) {
    pelias.upstream_status = details.upstreamStatus;
  }
  return pelias;
}

function readinessBody(status, pelias, estate) {
  return {
    status,
    dependencies: {
      pelias,
      estate,
    },
  };
}

function disabledEstateReadiness() {
  return {
    status: "disabled",
    reason: "not_configured",
  };
}

function estateErrorCode(error) {
  if (error instanceof EstateLookupUnavailableError || error instanceof EstateLookupTimeoutError) {
    return error.code;
  }

  return "estate_lookup_unavailable";
}

function upstreamErrorResponse(error) {
  if (error instanceof UpstreamTimeoutError) {
    return {
      status: 504,
      body: errorFeatureCollection("upstream_timeout", "Pelias request timed out", 504),
    };
  }

  if (error instanceof InvalidUpstreamResponseError) {
    return {
      status: 502,
      body: errorFeatureCollection("invalid_upstream_response", "Pelias returned an invalid response", 502),
    };
  }

  if (error instanceof UpstreamHttpError) {
    return {
      status: 502,
      body: errorFeatureCollection("upstream_error", "Pelias returned an upstream error", 502),
    };
  }

  if (error instanceof UpstreamNetworkError) {
    return {
      status: 502,
      body: errorFeatureCollection("upstream_unreachable", "Pelias could not be reached", 502),
    };
  }

  return {
    status: 500,
    body: errorFeatureCollection("internal_error", "Internal server error", 500),
  };
}

export function createServer({
  config,
  fetchImpl = globalThis.fetch,
  estateLookup: injectedEstateLookup,
} = {}) {
  if (!config) {
    throw new ConfigError("config is required", "config");
  }

  const estateLookup =
    injectedEstateLookup ?? createEstatePostgisLookup(config.estateLookup ?? { enabled: false });

  async function checkReadiness() {
    let serviceStatus = "ok";
    let httpStatus = 200;
    let pelias;
    let estate;

    try {
      await checkPeliasReady(config, { fetchImpl });
      pelias = peliasReadiness("ok");
    } catch (error) {
      serviceStatus = "unavailable";
      httpStatus = 503;
      pelias = peliasReadiness("unavailable", {
        code: error.code || "upstream_unreachable",
        upstreamStatus: error.upstreamStatus,
      });
    }

    if (!estateLookup.enabled) {
      estate = disabledEstateReadiness();
    } else {
      try {
        await estateLookup.checkReady();
        estate = { status: "ok" };
      } catch (error) {
        serviceStatus = "unavailable";
        httpStatus = 503;
        estate = {
          status: "unavailable",
          code: estateErrorCode(error),
        };
      }
    }

    return {
      status: httpStatus,
      body: readinessBody(serviceStatus, pelias, estate),
    };
  }

  async function handleEstateSearch(req, res, classification) {
    if (!estateLookup.enabled) {
      writeJson(req, res, config, 200, disabledEstateFeatureCollection(classification));
      return;
    }

    try {
      const result = await estateLookup.lookup(classification);
      if (result.status === "found") {
        writeJson(req, res, config, 200, foundEstateFeatureCollection(classification, result));
        return;
      }

      writeJson(req, res, config, 200, notFoundEstateFeatureCollection(classification));
    } catch (error) {
      if (error instanceof EstateLookupTimeoutError) {
        writeJson(
          req,
          res,
          config,
          504,
          estateLookupErrorFeatureCollection(
            classification,
            "estate_lookup_timeout",
            "Estate lookup timed out",
            504,
          ),
        );
        return;
      }

      if (error instanceof EstateLookupUnavailableError) {
        writeJson(
          req,
          res,
          config,
          503,
          estateLookupErrorFeatureCollection(
            classification,
            "estate_lookup_unavailable",
            "Estate lookup dependency is unavailable",
            503,
          ),
        );
        return;
      }

      writeJson(
        req,
        res,
        config,
        500,
        estateLookupErrorFeatureCollection(classification, "internal_error", "Internal server error", 500),
      );
    }
  }

  async function handleRequest(req, res) {
    if (req.method === "OPTIONS") {
      writeNoContent(req, res, config);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      writeMethodNotAllowed(req, res, config);
      return;
    }

    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/healthz") {
      writeJson(req, res, config, 200, {
        status: "ok",
        service: SERVICE_NAME,
      });
      return;
    }

    if (url.pathname === "/readyz") {
      const readiness = await checkReadiness();
      writeJson(req, res, config, readiness.status, readiness.body);
      return;
    }

    if (url.pathname === "/v1/search") {
      let parsedRequest;
      try {
        parsedRequest = parseSearchRequest(url.searchParams, normalizeHeaders(req.headers), config);
      } catch (error) {
        if (error instanceof RequestValidationError) {
          writeJson(req, res, config, error.status, validationErrorBody(error));
          return;
        }
        throw error;
      }

      const classification = classifyEstateIdQuery(parsedRequest.text);
      if (classification.isEstateId) {
        await handleEstateSearch(req, res, classification);
        return;
      }

      try {
        const collection = await fetchPeliasFeatureCollection(parsedRequest, config, { fetchImpl });
        writeJson(req, res, config, 200, collection);
      } catch (error) {
        const response = upstreamErrorResponse(error);
        writeJson(req, res, config, response.status, response.body);
      }
      return;
    }

    writeJson(req, res, config, 404, {
      error: {
        code: "not_found",
        message: "Route not found",
      },
    });
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      if (res.headersSent) {
        res.destroy(error);
        return;
      }

      writeJson(req, res, config, 500, {
        error: {
          code: "internal_error",
          message: "Internal server error",
        },
      });
    });
  });

  server.on("close", () => {
    Promise.resolve(estateLookup.close?.()).catch(() => {});
  });

  return server;
}

function start() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`${SERVICE_NAME}: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const server = createServer({ config });
  server.listen(config.port, "0.0.0.0", () => {
    console.log(`${SERVICE_NAME}: listening on port ${config.port}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}
