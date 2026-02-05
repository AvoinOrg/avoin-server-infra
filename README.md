# Avoin server infra

This repository contains the Docker Compose stacks, reverse-proxy configuration, and related templates used to run the Avoin server.

## Repository layout

- `main/` — **important / core services** (auth, storage, logging, primary proxy config).
- `secondary/` — **less critical services** (apps that can be down without taking the platform down).
- `random-services/` — a **“bring-your-own-service” proxy**: this repo only provides the proxy; other repos you deploy on the server can join the same proxy network and be published via labels.
- `helper-scripts/` — reserved for helper scripts (currently empty).

Each service lives in its own folder and is intended to be started/stopped independently with Docker Compose.

## Reverse proxy, labels, and networking

All stacks assume a shared external Docker network named `proxy-net`:

```bash
docker network create proxy-net
```

Every top-level group (`main/`, `secondary/`, `random-services/`) has a `proxy/` stack that runs **Traefik** and binds the host’s `80`/`443` ports (and `8090` for the dashboard). Services that should be reachable from the internet attach to `proxy-net`.

### “Label-based” routing (secondary + random-services)

`secondary/proxy` and `random-services/proxy` run Traefik with the **Docker provider** enabled and `exposedByDefault=false`, meaning containers are only published when explicitly labeled.

Typical service labels look like:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.<name>.rule=Host(`${DOMAIN}`)"
  - "traefik.http.routers.<name>.entrypoints=websecure"
  - "traefik.http.routers.<name>.tls.certresolver=myresolver"
  - "traefik.http.services.<name>.loadbalancer.server.port=<container-port>"
```

Services in `secondary/*` follow this pattern (Directus/Umami/Tolgee). The `random-services/` proxy is meant for containers from *other* repos: as long as they join `proxy-net` and set Traefik labels, they can be served by this proxy.

### “File-based” routing (main)

`main/proxy` runs Traefik using a **file provider** (`main/proxy/dynamic_conf.yml`) rather than Docker labels. Routes are defined in `dynamic_conf.yml` and point to upstream URLs provided via `main/proxy/.env` (copied from `main/proxy/.env.template`).

This is why most `main/*` services do **not** have Traefik labels: they’re routed by `dynamic_conf.yml` instead.

## Health/restarts (“autoheal”)

Most services use Docker’s restart policies (`restart: unless-stopped` / `restart: always`) and several include `healthcheck`s. There is currently **no dedicated “autoheal” container** in this repository; “unhealthy” containers won’t be restarted automatically unless they exit.

## Services by directory

### `main/` (core)

- `main/proxy/` — Traefik (primary ingress). Uses `dynamic_conf.yml` to route:
  - auth (Zitadel) via `AUTH_DOMAIN`/`AUTH_URL`
  - Loki via `LOKI_DOMAIN`/`LOKI_URL` (with basic-auth middleware)
  - storage via `STORAGE_DOMAIN`/`STORAGE_URL`
  - path routes like `/data` (S3-style backing store via `DATA_URL`)
  - optional/legacy routes (commented) live in `dynamic_conf.yml`
- `main/auth/` — Zitadel + Postgres + a small Node “actionserver” for Zitadel Actions. Attaches to `proxy-net` so `main/proxy` can reach it.
- `main/storage/` — Supabase Storage API + Postgres metadata DB + `imgproxy` for transformations. Attaches to `proxy-net` so `main/proxy` can reach it.
- `main/log-stack/` — Loki + Grafana (Promtail config included; Promtail service currently commented). Attaches to `proxy-net`.

### `secondary/` (non-core)

- `secondary/proxy/` — Traefik (Docker provider + labels). Intended ingress for the `secondary/*` services.
- `secondary/directus/` — Directus + Postgres. Exposed via Traefik labels on `proxy-net`.
- `secondary/umami/` — Umami analytics + Postgres. Exposed via Traefik labels on `proxy-net` (optional `oauth2-proxy` is included but commented out).
- `secondary/tolgee/` — Tolgee localization platform. Exposed via Traefik labels on `proxy-net`.

### `random-services/`

- `random-services/proxy/` — Traefik (Docker provider + labels). Used to expose services from other repos you deploy on the server (join `proxy-net` + add labels).

## Running a stack (quickstart)

1. Pick **one** proxy to run on a host (`main/proxy`, `secondary/proxy`, or `random-services/proxy`).
   - They all bind `80/443/8090` and use `container_name: traefik`, so you generally **cannot run multiple proxies on the same Docker host** without changing ports/names.
2. Create `proxy-net` if it doesn’t exist: `docker network create proxy-net`.
3. In the target folder, copy templates and configure:
   - `cp .env.template .env`
   - Some stacks also have additional templates (e.g. `main/storage/.storage.env.template` → `main/storage/.storage.env`).
4. Start the proxy, then start the service:
   - `cd <group>/proxy && docker compose up -d`
   - `cd <group>/<service> && docker compose up -d`

Notes:
- Traefik dashboard is exposed on `:8090` and is configured with `--api.insecure=true` in these stacks; restrict access with firewall rules or adjust Traefik config before exposing it publicly.
- `main/log-stack/setup.sh` prepares filesystem permissions for Loki/Grafana volumes (uses `sudo`).

## Adding or changing services

When adding/removing a service directory or changing proxy/routing conventions:

- Update this root `README.md` (service list + how it’s exposed).
- Keep `.env.template` files accurate and avoid committing `.env` secrets (the repo ignores `**/*.env`).
- For label-based exposure, ensure the service:
  - joins `proxy-net`
  - sets `traefik.enable=true` and the router/service labels
  - exposes the correct internal port via `traefik.http.services.<name>.loadbalancer.server.port`

