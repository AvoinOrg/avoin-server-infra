# Agent notes (keep docs in sync)

This repo is mostly Docker Compose + Traefik configuration for the Avoin server. Changes here tend to be operationally sensitive.

## Documentation maintenance (required)

When you make changes that affect structure or deployed services, **update both**:

- `README.md` (root service map + how to run/expose things)
- `AGENTS.md` (these working rules, if they need to evolve)

Triggers that require updating docs:

- adding/removing/renaming any folder under `main/`, `secondary/`, or `random-services/`
- adding a new service (new compose stack) or deleting an old one
- changing which proxy is responsible for routing a service
- changing Traefik conventions (labels vs file provider, entrypoints, cert resolver, networks)
- adding/removing important env vars in `.env.template` / `*.env.template`

## Repo conventions

- Prefer editing `*.env.template`; do not commit secrets in `.env` (repo ignores `**/*.env`).
- Use the shared external Docker network `proxy-net` for anything that needs to be routed via Traefik.
- In `secondary/` and `random-services/`, public exposure is done via **Traefik labels** with `traefik.enable=true` (Traefik runs with `exposedByDefault=false`).
- In `main/`, routing is primarily defined in `main/proxy/dynamic_conf.yml` (file provider), not by container labels.
- For Pelias, keep downloaded source data, Elasticsearch indexes, prepared placeholder/interpolation databases, and other generated geocoding artifacts under configured ignored data paths, never in tracked repo files.
- For Finnish estate/PostGIS work, keep NLS/MML cadastral downloads, GeoPackages, extracted files, staging data, database dumps, generated SQL output, and secret-bearing verification transcripts under configured ignored data paths, never in tracked repo files. Tracked verification reports must be sanitized and must not include credentials, private hosts, private ports, API keys, or copied secret values.
- The Avoin Map geocoding front service lives in `secondary/avoin-map-geocoding/`. Keep it stateless from the application container's point of view: address/place queries go to Pelias through `PELIAS_BASE_URL`, and exact estate-ID lookup may use the optional F004 PostGIS adapter only when configured through ignored `.env` values or deployment secrets. Do not commit real PostGIS credentials, source data, generated geodata, loader transcripts, or secret-bearing verification output.
- The Plane stack lives in `secondary/plane/`. Keep it routed through Plane's internal `proxy` service on `proxy-net`; real generated Plane secrets, first-run instance admin credentials, SMTP settings, and Zitadel OIDC client secrets belong in Dokploy or Plane `/god-mode`, never in tracked files.

## Compose hygiene

When adding new stacks:

- Include a `docker-compose.yml` (or `.yaml`) and an `.env.template`.
- Add reasonable `restart:` policy and `healthcheck:` where it helps.
- Keep persistent data paths configurable via env (`DATA_PATH`, `*_DATA_DIR`, etc.).
- Avoid `container_name` unless there’s a strong reason (it makes running multiple stacks on one host harder).
