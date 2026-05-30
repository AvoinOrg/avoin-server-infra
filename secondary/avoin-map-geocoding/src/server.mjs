import http from "node:http";
import { loadConfig, ConfigError } from "./config.mjs";
import { classifyEstateIdQuery, disabledEstateFeatureCollection } from "./estate-id.mjs";
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

function readinessBody(status, peliasStatus, details = {}) {
  const pelias = { status: peliasStatus };
  if (details.code) {
    pelias.code = details.code;
  }
  if (details.upstreamStatus) {
    pelias.upstream_status = details.upstreamStatus;
  }

  return {
    status,
    dependencies: {
      pelias,
      estate: {
        status: "disabled",
        reason: "not_configured",
      },
    },
  };
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

export function createServer({ config, fetchImpl = globalThis.fetch } = {}) {
  if (!config) {
    throw new ConfigError("config is required", "config");
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
      try {
        await checkPeliasReady(config, { fetchImpl });
        writeJson(req, res, config, 200, readinessBody("ok", "ok"));
      } catch (error) {
        writeJson(
          req,
          res,
          config,
          503,
          readinessBody("unavailable", "unavailable", {
            code: error.code || "upstream_unreachable",
            upstreamStatus: error.upstreamStatus,
          }),
        );
      }
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
        writeJson(req, res, config, 200, disabledEstateFeatureCollection(classification));
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

  return http.createServer((req, res) => {
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
