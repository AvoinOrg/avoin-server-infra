# Avoin Map geocoding

This folder runs the Avoin Map geocoding front service under the secondary
Traefik proxy. The service is stateless in F002.2:

- `GET /v1/search?text=<query>` is the canonical search endpoint.
- Human-written address and place queries are forwarded to Pelias.
- Finnish estate-ID-shaped queries are recognized locally and return an empty
  typed response with `avoin.estate_lookup.enabled=false` until F004 connects
  real estate data.
- `GET /healthz` is liveness only and does not check Pelias.
- `GET /readyz` checks that Pelias is reachable for address/place geocoding.

The optional `/v1/autocomplete` and Nominatim-like `/search?format=json&q=...`
facades are not implemented in this baseline. F005 owns the Avoin Map client
migration plan and any compatibility bridge.

## Layout

- `docker-compose.yml` defines the public API container and Traefik labels.
- `.env.template` lists placeholder deployment variables only.
- `Dockerfile` builds the dependency-free Node 22 runtime image.
- `src/` contains request parsing, estate-ID classification, Pelias dispatch,
  GeoJSON normalization, CORS, and health routes.
- `test/` contains mocked-upstream tests; it does not call a real Pelias
  deployment.

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

Do not add PostGIS, estate database, NLS/MML, Ryhti, or credential variables in
this baseline service. F004 owns the future estate-data adapter.

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

The tests use a local fake Pelias server and never need real `.env` values.
