# Pelias

This folder is a deployment scaffold for a Pelias geocoding stack under the
secondary-services Traefik proxy. It starts the Pelias API, Elasticsearch, and
libpostal service, but it does not download or import geocoding datasets.

Useful upstream references:

- Pelias overview: <https://pelias.github.io/pelias/>
- Pelias Docker project: <https://github.com/pelias/docker>
- Pelias API service: <https://github.com/pelias/api>

## Layout

- `docker-compose.yml` defines the runtime services and the profiled schema tool.
- `.env.template` lists placeholder deployment variables.
- `pelias.json` is the shared Pelias runtime configuration mounted read-only.
- `.gitignore` keeps generated Pelias data out of the repository if `DATA_PATH`
  is pointed inside this folder.

## Deployment Notes

Create the shared Traefik network before deployment if it does not already
exist:

```bash
docker network create proxy-net
```

Copy the template and provide real deployment values through `.env` or the
deployment platform's environment configuration:

```bash
cp .env.template .env
```

Important variables:

- `DATA_PATH` is the host path for persistent and generated Pelias data.
  Elasticsearch data is stored under `${DATA_PATH}/elasticsearch`.
- `PELIAS_DOMAIN` is the public host routed by `secondary/proxy`.
- `TRAEFIK_CERTRESOLVER` must match the resolver configured in the secondary
  Traefik proxy.
- `PELIAS_*_IMAGE_TAG` values are intentionally configurable. Upstream Pelias
  examples commonly use `master` for non-Elasticsearch images, but production
  operators should pin tags or digests when they need reproducible rollouts.
- `ELASTICSEARCH_JAVA_OPTS` controls the Elasticsearch heap size.

The API is exposed by Traefik labels on `proxy-net` using the `websecure`
entrypoint. Elasticsearch and libpostal stay on the private `pelias-net`
network.

For Dokploy-style deployment, deploy from this folder, configure the environment
values in the deployment settings, and ensure the secondary Traefik proxy and
`proxy-net` are already present. Do not commit the generated `.env` file.

## Validate

Run static Compose validation with placeholder values:

```bash
docker compose --env-file .env.template config
docker compose --env-file .env.template --profile tools config
```

## Start

After creating `.env` with real values:

```bash
docker compose up -d elasticsearch libpostal api
```

The scaffold healthchecks only verify service readiness:

- Elasticsearch uses the local cluster health endpoint.
- Pelias API uses the lightweight `/v1` route.
- libpostal uses the `/parse` endpoint with a test address.

Successful startup does not mean geocoding results exist. The Elasticsearch
index is empty until import work is added and run.

## Schema Tool

The `schema` service is available behind the `tools` profile for later import
work:

```bash
docker compose --profile tools run --rm schema
```

This creates the Pelias Elasticsearch index mapping using `pelias.json`. It does
not download or import source data.

## Deferred Work

`F001.2-pelias-osm-import-flow` should add the OpenStreetMap download/import
mechanism and operator runbook on top of this layout.

`F001.3-pelias-finnish-data-extensibility` should add Finnish custom-data
templates and documentation without placing generated datasets or indexes in
git.
