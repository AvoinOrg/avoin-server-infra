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

## Compose hygiene

When adding new stacks:

- Include a `docker-compose.yml` (or `.yaml`) and an `.env.template`.
- Add reasonable `restart:` policy and `healthcheck:` where it helps.
- Keep persistent data paths configurable via env (`DATA_PATH`, `*_DATA_DIR`, etc.).
- Avoid `container_name` unless there’s a strong reason (it makes running multiple stacks on one host harder).

