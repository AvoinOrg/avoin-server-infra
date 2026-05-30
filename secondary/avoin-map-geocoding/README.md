# Avoin Map geocoding

This folder runs the Avoin Map geocoding front service under the secondary
Traefik proxy. The service stays stateless from the application container's
point of view:

- `GET /v1/search?text=<query>` is the canonical search endpoint.
- Human-written address and place queries are forwarded to Pelias.
- Finnish estate-ID-shaped queries are recognized locally and are never sent to
  Pelias.
- With `ESTATE_LOOKUP_ENABLED=false`, estate-ID-shaped queries return an empty
  typed response with `avoin.estate_lookup.enabled=false`.
- With `ESTATE_LOOKUP_ENABLED=true`, estate-ID-shaped queries use the optional
  F004 PostGIS adapter against the F003 `estate.*` tables in
  `geocoding-finland`.
- `GET /healthz` is liveness only and does not check Pelias.
- `GET /readyz` checks Pelias and reports estate lookup as `disabled`, `ok`, or
  `unavailable`.

The optional `/v1/autocomplete` and Nominatim-like `/search?format=json&q=...`
facades are not implemented in this baseline. F005 owns the Avoin Map client
migration plan and any compatibility bridge.

## Layout

- `docker-compose.yml` defines the public API container and Traefik labels.
- `.env.template` lists placeholder deployment variables only.
- `ESTATE-DATA-CONTRACT.md` documents the selected Finnish estate-ID source
  and the PostGIS import contract for the F003/F004 estate-data work.
- `Dockerfile` builds the Node 22 runtime image with deterministic npm
  dependencies from `package-lock.json`.
- `src/` contains request parsing, estate-ID classification, Pelias dispatch,
  PostGIS estate lookup, GeoJSON normalization, CORS, and health routes.
- `test/` contains mocked-upstream and fake PostGIS tests; it does not call a
  real Pelias or PostGIS deployment.

## Important variables

Copy the template and provide deployment values through `.env` or the
deployment platform's environment configuration:

```bash
cp .env.template .env
```

Key variables:

- `GEOCODING_DOMAIN` is the public host routed by `secondary/proxy`.
- `TRAEFIK_CERTRESOLVER` must match the resolver configured in the secondary
  Traefik proxy.
- `GEOCODING_PORT` is the internal HTTP port.
- `PELIAS_BASE_URL` points at the Pelias API base URL. Use the public Pelias
  URL or an operator-managed stable internal alias; do not hardcode another
  Compose stack's generic service name.
- `GEOCODING_REQUEST_TIMEOUT_MS` bounds Pelias calls.
- `GEOCODING_RESULT_LIMIT_DEFAULT` and `GEOCODING_RESULT_LIMIT_MAX` control
  default and maximum result counts.
- `GEOCODING_DEFAULT_COUNTRYCODES` maps to Pelias `boundary.country` when the
  request omits `countrycodes`.
- `GEOCODING_DEFAULT_BBOX` maps to Pelias boundary rectangle parameters when
  the request omits `bbox` and Pelias-compatible `boundary.rect.*` values.
- `GEOCODING_CORS_ORIGINS=*` emits wildcard CORS for unauthenticated browser
  GET/OPTIONS requests. Use comma-separated origins to restrict browser access.

Optional estate lookup variables:

- `ESTATE_LOOKUP_ENABLED=false` keeps estate lookup disabled and requires no
  PostGIS credentials at startup.
- `ESTATE_POSTGIS_HOST=postgis.example.invalid` is a placeholder PostGIS host.
- `ESTATE_POSTGIS_PORT=5432` is the PostGIS port.
- `ESTATE_POSTGIS_DATABASE=geocoding-finland` is required and intentionally
  fixed to the F003 sandbox database name.
- `ESTATE_POSTGIS_USER=avoin_map_geocoding` is the read-only application user
  placeholder.
- `ESTATE_POSTGIS_PASSWORD=replace-with-estate-postgis-password` must be
  replaced only in ignored `.env` files or deployment secrets.
- `ESTATE_POSTGIS_SSL=false` enables or disables TLS for the PostGIS client.
- `ESTATE_POSTGIS_CONNECT_TIMEOUT_MS=2000` bounds connection attempts.
- `ESTATE_POSTGIS_QUERY_TIMEOUT_MS=5000` bounds readiness and lookup queries.
- `ESTATE_POSTGIS_POOL_MAX=5` caps the PostgreSQL connection pool size.

When `ESTATE_LOOKUP_ENABLED=true`, missing or invalid estate variables fail
startup with a `ConfigError` that names the variable. Do not use connection
URLs in docs or reports; keep host, port, user, and password values in the
operator secret channel.

## Estate lookup

See [ESTATE-DATA-CONTRACT.md](ESTATE-DATA-CONTRACT.md) for the selected NLS/MML
`Kiinteistörekisterikartta (vektori)` source and the target PostGIS schema. The
adapter expects these loaded tables:

- `estate.source_metadata`
- `estate.cadastral_parcels`
- `estate.cadastral_estates`

Before enabling this against the sandbox,
`secondary/estate-postgis-loader/LOAD-REPORT.md` must record an operator-run,
sanitized successful load with non-zero parcel and estate row counts. If that
report is still blocked, leave `ESTATE_LOOKUP_ENABLED=false`.

Readiness behavior:

- disabled: `/readyz` returns `200` when Pelias is ready and reports
  `dependencies.estate.status="disabled"` with reason `not_configured`;
- ready: `/readyz` returns `200` when Pelias is ready and the estate adapter can
  connect to `geocoding-finland`, verify PostGIS, find the three `estate.*`
  tables, and see non-zero loaded rows;
- unavailable: `/readyz` returns `503` when estate lookup is enabled but the
  database, schema, PostGIS extension, or loaded data is not usable.

Estate search behavior:

- disabled lookup returns `200` with an empty FeatureCollection and
  `avoin.estate_lookup.enabled=false`;
- found full-estate or `#part` lookup returns `200` with one GeoJSON Feature,
  longitude/latitude geometry, an optional bbox, estate ID properties, and
  `properties.avoin.lookup_dataset="nls_cadastral_estates"`;
- healthy absent IDs return `200` with an empty FeatureCollection and
  `avoin.estate_lookup.status="not_found"`;
- unavailable dependencies return `503` with
  `avoin.error.code="estate_lookup_unavailable"`;
- query timeouts return `504` with
  `avoin.error.code="estate_lookup_timeout"`.

## Routing

Create the shared Traefik network before deployment if it does not already
exist:

```bash
docker network create proxy-net
```

The `api` service joins `proxy-net` and is exposed through labels:

- `traefik.enable=true`
- `traefik.docker.network=proxy-net`
- a `Host(...)` rule using `GEOCODING_DOMAIN` on `websecure`
- `${TRAEFIK_CERTRESOLVER}` for TLS certificates
- the load balancer target port is `${GEOCODING_PORT}`

The Docker healthcheck uses `/healthz`, not `/readyz`, so a Pelias outage does
not restart the front service.

## Validate

Run checks with placeholder values only:

```bash
npm test
docker compose --env-file .env.template config
docker build .
```

The tests use a local fake Pelias server and fake PostGIS pools; they never
need real `.env` values. Do not run Compose expansion with a real ignored
`.env` present because it can print secret values.
