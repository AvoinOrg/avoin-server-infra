import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { EstateLookupTimeoutError, EstateLookupUnavailableError } from "../src/estate-postgis.mjs";
import { createServer } from "../src/server.mjs";

function configForPelias(peliasBaseUrl, overrides = {}) {
  return {
    peliasBaseUrl,
    requestTimeoutMs: 250,
    resultLimitDefault: 5,
    resultLimitMax: 10,
    defaultCountrycodes: "fi",
    defaultBbox: [19, 59, 32, 71],
    corsOrigins: { wildcard: true, origins: [] },
    ...overrides,
  };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function withFakePelias(handler, callback) {
  const calls = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    calls.push({
      url: new URL(req.url, "http://pelias.test"),
      headers: req.headers,
    });
    handler(req, res);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  const baseUrl = await listen(server);
  try {
    await callback({ baseUrl, calls });
  } finally {
    for (const socket of sockets) {
      socket.destroy();
    }
    await close(server);
  }
}

async function withGeocodingServer(config, callback, options = {}) {
  const server = createServer({ config, ...options });
  const baseUrl = await listen(server);
  try {
    await callback(baseUrl);
  } finally {
    await close(server);
  }
}

function fakeEstateLookup({ enabled = true, readyError = null, lookupResult = null, lookupError = null } = {}) {
  const calls = {
    ready: 0,
    lookup: [],
    close: 0,
  };
  const adapter = {
    enabled,
    async checkReady() {
      calls.ready += 1;
      if (readyError) {
        throw readyError;
      }
      return { status: "ok" };
    },
    async lookup(classification) {
      calls.lookup.push(classification);
      if (lookupError) {
        throw lookupError;
      }
      return lookupResult ?? { status: "not_found" };
    },
    async close() {
      calls.close += 1;
    },
  };

  return { adapter, calls };
}

function estateLookupResult(overrides = {}) {
  return {
    status: "found",
    lookupDataset: "nls_cadastral_estates",
    item: {
      estateIdCompact: "17440100030006",
      estateIdNormalized: "174-401-3-6",
      estateIdDisplay: "174-401-3-6",
      municipalityCode: "174",
      partCount: 2,
      geometry: {
        type: "MultiPolygon",
        coordinates: [[[[24, 60], [24.1, 60], [24.1, 60.1], [24, 60.1], [24, 60]]]],
      },
      bbox: [24, 60, 24.1, 60.1],
      sourceFreshnessAt: "2026-01-01T00:00:00.000Z",
      loadedAt: "2026-01-02T00:00:00.000Z",
      partLookup: false,
      ...overrides,
    },
  };
}

test("healthz is independent of Pelias", async () => {
  await withGeocodingServer(configForPelias("http://127.0.0.1:9"), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
  });
});

test("readyz reports Pelias readiness and disabled estate lookup", async () => {
  await withFakePelias((req, res) => {
    if (req.url === "/v1") {
      jsonResponse(res, 200, { status: "ok" });
      return;
    }
    jsonResponse(res, 404, {});
  }, async ({ baseUrl: peliasBaseUrl }) => {
    await withGeocodingServer(configForPelias(peliasBaseUrl), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/readyz`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.dependencies.pelias.status, "ok");
      assert.equal(body.dependencies.estate.status, "disabled");
    });
  });
});

test("readyz reports enabled estate lookup readiness", async () => {
  await withFakePelias((req, res) => {
    if (req.url === "/v1") {
      jsonResponse(res, 200, { status: "ok" });
      return;
    }
    jsonResponse(res, 404, {});
  }, async ({ baseUrl: peliasBaseUrl }) => {
    const estate = fakeEstateLookup();
    await withGeocodingServer(
      configForPelias(peliasBaseUrl),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/readyz`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.status, "ok");
        assert.equal(body.dependencies.pelias.status, "ok");
        assert.equal(body.dependencies.estate.status, "ok");
        assert.equal(estate.calls.ready, 1);
      },
      { estateLookup: estate.adapter },
    );
  });
});

test("readyz returns 503 when enabled estate lookup is unavailable", async () => {
  await withFakePelias((req, res) => {
    if (req.url === "/v1") {
      jsonResponse(res, 200, { status: "ok" });
      return;
    }
    jsonResponse(res, 404, {});
  }, async ({ baseUrl: peliasBaseUrl }) => {
    const estate = fakeEstateLookup({
      readyError: new EstateLookupUnavailableError("estate_data_unavailable"),
    });
    await withGeocodingServer(
      configForPelias(peliasBaseUrl),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/readyz`);
        const body = await response.json();

        assert.equal(response.status, 503);
        assert.equal(body.status, "unavailable");
        assert.equal(body.dependencies.pelias.status, "ok");
        assert.equal(body.dependencies.estate.status, "unavailable");
        assert.equal(body.dependencies.estate.code, "estate_data_unavailable");
      },
      { estateLookup: estate.adapter },
    );
  });
});

test("readyz returns 503 when Pelias is unavailable", async () => {
  await withGeocodingServer(configForPelias("http://127.0.0.1:9"), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/readyz`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.status, "unavailable");
    assert.equal(body.dependencies.pelias.status, "unavailable");
  });
});

test("non-estate search dispatches to Pelias and normalizes FeatureCollection", async () => {
  await withFakePelias((req, res) => {
    const url = new URL(req.url, "http://pelias.test");
    assert.equal(url.pathname, "/v1/search");
    jsonResponse(res, 200, {
      type: "FeatureCollection",
      bbox: [24, 60, 25, 61],
      geocoding: { version: "0.2" },
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [24.9384, 60.1699] },
          bbox: [24.9, 60.1, 25, 60.2],
          properties: {
            id: "helsinki",
            label: "Helsinki, Finland",
            source: "openstreetmap",
            layer: "locality",
          },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [25, 61] },
          properties: { id: "extra" },
        },
      ],
    });
  }, async ({ baseUrl: peliasBaseUrl, calls }) => {
    const estate = fakeEstateLookup();
    await withGeocodingServer(configForPelias(peliasBaseUrl), async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/v1/search?text=Helsinki&limit=1&bbox=20,60,25,62&focus.point.lat=61&focus.point.lon=24&sources=openstreetmap&layers=locality`,
        { headers: { "Accept-Language": "fi" } },
      );
      const body = await response.json();
      const peliasUrl = calls[0].url;

      assert.equal(response.status, 200);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].headers["accept-language"], "fi");
      assert.equal(peliasUrl.searchParams.get("text"), "Helsinki");
      assert.equal(peliasUrl.searchParams.get("size"), "1");
      assert.equal(peliasUrl.searchParams.get("boundary.country"), "fi");
      assert.equal(peliasUrl.searchParams.get("boundary.rect.min_lon"), "20");
      assert.equal(peliasUrl.searchParams.get("focus.point.lat"), "61");
      assert.equal(peliasUrl.searchParams.get("sources"), "openstreetmap");
      assert.equal(peliasUrl.searchParams.get("layers"), "locality");
      assert.equal(body.type, "FeatureCollection");
      assert.equal(body.features.length, 1);
      assert.equal(body.features[0].properties.label, "Helsinki, Finland");
      assert.equal(body.features[0].properties.avoin.query_type, "address");
      assert.deepEqual(body.bbox, [24, 60, 25, 61]);
      assert.deepEqual(body.geocoding, { version: "0.2" });
      assert.equal(estate.calls.lookup.length, 0);
    }, { estateLookup: estate.adapter });
  });
});

test("lang query parameter takes precedence over Accept-Language", async () => {
  await withFakePelias((req, res) => {
    jsonResponse(res, 200, {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: null, properties: {} }],
    });
  }, async ({ baseUrl: peliasBaseUrl, calls }) => {
    await withGeocodingServer(configForPelias(peliasBaseUrl), async (baseUrl) => {
      await fetch(`${baseUrl}/v1/search?text=Helsinki&lang=fi-FI`, {
        headers: { "Accept-Language": "en" },
      });

      assert.equal(calls[0].headers["accept-language"], "fi-FI");
      assert.equal(calls[0].url.searchParams.get("lang"), "fi-FI");
    });
  });
});

test("estate-shaped searches return disabled response without calling Pelias", async () => {
  await withFakePelias((_req, res) => {
    jsonResponse(res, 500, { error: "should not be called" });
  }, async ({ baseUrl: peliasBaseUrl, calls }) => {
    await withGeocodingServer(configForPelias(peliasBaseUrl), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/search?text=92-58-552-21%20%232`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(calls.length, 0);
      assert.equal(body.type, "FeatureCollection");
      assert.deepEqual(body.features, []);
      assert.equal(body.avoin.query_type, "estate_id");
      assert.equal(body.avoin.estate_lookup.enabled, false);
      assert.equal(body.avoin.normalized_estate_id, "092-58-552-21");
      assert.equal(body.avoin.part_number, 2);
    });
  });
});

test("enabled estate search returns found GeoJSON without calling Pelias", async () => {
  await withFakePelias((_req, res) => {
    jsonResponse(res, 500, { error: "should not be called" });
  }, async ({ baseUrl: peliasBaseUrl, calls }) => {
    const estate = fakeEstateLookup({ lookupResult: estateLookupResult() });
    await withGeocodingServer(
      configForPelias(peliasBaseUrl),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/search?text=174-401-3-6`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(calls.length, 0);
        assert.equal(estate.calls.lookup.length, 1);
        assert.equal(body.type, "FeatureCollection");
        assert.equal(body.features.length, 1);
        assert.deepEqual(body.bbox, [24, 60, 24.1, 60.1]);
        assert.equal(body.avoin.query_type, "estate_id");
        assert.equal(body.avoin.estate_lookup.enabled, true);
        assert.equal(body.avoin.estate_lookup.status, "found");
        assert.equal(body.avoin.normalized_estate_id, "174-401-3-6");
        assert.equal(body.features[0].geometry.type, "MultiPolygon");
        assert.equal(body.features[0].geometry.crs, undefined);
        assert.equal(body.features[0].properties.estate_id_compact, "17440100030006");
        assert.equal(body.features[0].properties.part_count, 2);
        assert.equal(body.features[0].properties.avoin.query_type, "estate_id");
        assert.equal(body.features[0].properties.avoin.lookup_dataset, "nls_cadastral_estates");
      },
      { estateLookup: estate.adapter },
    );
  });
});

test("enabled part estate search marks part metadata", async () => {
  await withFakePelias((_req, res) => {
    jsonResponse(res, 500, { error: "should not be called" });
  }, async ({ baseUrl: peliasBaseUrl, calls }) => {
    const estate = fakeEstateLookup({
      lookupResult: estateLookupResult({ partLookup: true, partNumber: 2 }),
    });
    await withGeocodingServer(
      configForPelias(peliasBaseUrl),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/search?text=174-401-3-6%20%232`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(calls.length, 0);
        assert.equal(body.avoin.part_number, 2);
        assert.equal(body.features[0].properties.part_number, 2);
        assert.equal(body.features[0].properties.part_lookup, true);
      },
      { estateLookup: estate.adapter },
    );
  });
});

test("enabled estate search reports healthy not found without calling Pelias", async () => {
  await withFakePelias((_req, res) => {
    jsonResponse(res, 500, { error: "should not be called" });
  }, async ({ baseUrl: peliasBaseUrl, calls }) => {
    const estate = fakeEstateLookup({ lookupResult: { status: "not_found" } });
    await withGeocodingServer(
      configForPelias(peliasBaseUrl),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/search?text=174-401-3-6%20%237`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(calls.length, 0);
        assert.deepEqual(body.features, []);
        assert.equal(body.avoin.estate_lookup.status, "not_found");
        assert.equal(body.avoin.part_number, 7);
      },
      { estateLookup: estate.adapter },
    );
  });
});

test("enabled estate search maps unavailable and timeout failures", async () => {
  await withFakePelias((_req, res) => {
    jsonResponse(res, 500, { error: "should not be called" });
  }, async ({ baseUrl: peliasBaseUrl, calls }) => {
    const unavailable = fakeEstateLookup({
      lookupError: new EstateLookupUnavailableError("estate_schema_missing"),
    });
    await withGeocodingServer(
      configForPelias(peliasBaseUrl),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/search?text=174-401-3-6`);
        const body = await response.json();

        assert.equal(response.status, 503);
        assert.equal(body.avoin.error.code, "estate_lookup_unavailable");
        assert.equal(body.avoin.estate_lookup.status, "unavailable");
      },
      { estateLookup: unavailable.adapter },
    );

    const timedOut = fakeEstateLookup({ lookupError: new EstateLookupTimeoutError() });
    await withGeocodingServer(
      configForPelias(peliasBaseUrl),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/search?text=174-401-3-6`);
        const body = await response.json();

        assert.equal(response.status, 504);
        assert.equal(body.avoin.error.code, "estate_lookup_timeout");
        assert.equal(body.avoin.estate_lookup.status, "timeout");
      },
      { estateLookup: timedOut.adapter },
    );

    assert.equal(calls.length, 0);
  });
});

test("invalid Pelias response maps to 502 FeatureCollection error", async () => {
  await withFakePelias((_req, res) => {
    jsonResponse(res, 200, { type: "FeatureCollection", features: {} });
  }, async ({ baseUrl: peliasBaseUrl }) => {
    await withGeocodingServer(configForPelias(peliasBaseUrl), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/search?text=Helsinki`);
      const body = await response.json();

      assert.equal(response.status, 502);
      assert.equal(body.type, "FeatureCollection");
      assert.equal(body.avoin.error.code, "invalid_upstream_response");
    });
  });
});

test("Pelias timeout maps to 504 FeatureCollection error", async () => {
  await withFakePelias((_req, res) => {
    setTimeout(() => jsonResponse(res, 200, { type: "FeatureCollection", features: [] }), 100);
  }, async ({ baseUrl: peliasBaseUrl }) => {
    await withGeocodingServer(
      configForPelias(peliasBaseUrl, { requestTimeoutMs: 20 }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/search?text=Helsinki`);
        const body = await response.json();

        assert.equal(response.status, 504);
        assert.equal(body.avoin.error.code, "upstream_timeout");
      },
    );
  });
});

test("Pelias stalled response body maps to 504 FeatureCollection error", async () => {
  await withFakePelias((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"type":"FeatureCollection","features":[');
  }, async ({ baseUrl: peliasBaseUrl }) => {
    await withGeocodingServer(
      configForPelias(peliasBaseUrl, { requestTimeoutMs: 20 }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/v1/search?text=Helsinki`);
        const body = await response.json();

        assert.equal(response.status, 504);
        assert.equal(body.avoin.error.code, "upstream_timeout");
      },
    );
  });
});

test("CORS supports wildcard preflight and configured-origin responses", async () => {
  await withGeocodingServer(configForPelias("http://127.0.0.1:9"), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/search?text=Helsinki`, {
      method: "OPTIONS",
      headers: { Origin: "https://map.example.com" },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("access-control-allow-methods"), "GET,HEAD,OPTIONS");
  });

  await withGeocodingServer(
    configForPelias("http://127.0.0.1:9", {
      corsOrigins: { wildcard: false, origins: ["https://map.example.com"] },
    }),
    async (baseUrl) => {
      const allowed = await fetch(`${baseUrl}/healthz`, {
        headers: { Origin: "https://map.example.com" },
      });
      const denied = await fetch(`${baseUrl}/healthz`, {
        headers: { Origin: "https://other.example.com" },
      });

      assert.equal(allowed.headers.get("access-control-allow-origin"), "https://map.example.com");
      assert.equal(denied.headers.get("access-control-allow-origin"), null);
    },
  );
});
