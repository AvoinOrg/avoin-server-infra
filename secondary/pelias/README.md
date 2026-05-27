# Pelias

This folder runs a Pelias geocoding stack under the secondary-services Traefik
proxy. The default runtime services are Elasticsearch, libpostal, and the
Pelias API. OpenStreetMap download/import jobs and schema/config helpers are
available through Compose profiles and do not start during normal API
deployment.

Useful upstream references:

- Pelias overview: <https://pelias.github.io/pelias/>
- Pelias Docker project: <https://github.com/pelias/docker>
- Pelias API service: <https://github.com/pelias/api>
- Pelias OpenStreetMap importer: <https://github.com/pelias/openstreetmap>
- Pelias schema tooling: <https://github.com/pelias/schema>
- Geofabrik Finland extract: <https://download.geofabrik.de/europe/finland.html>

## Layout

- `docker-compose.yml` defines the runtime services, profiled schema/config
  tools, and profiled OpenStreetMap download/import jobs.
- `.env.template` lists placeholder deployment variables.
- `pelias.json.template` is the tracked source config.
- `scripts/render-pelias-config.mjs` renders the generated Pelias config from
  environment values.
- `.gitignore` keeps generated Pelias data out of the repository if paths are
  pointed inside this folder.

The generated `pelias.json` is written to `PELIAS_CONFIG_PATH`, which defaults
to `/srv/pelias/config/pelias.json`. API, schema, config-check, and OSM import
containers all mount that same generated file as `/code/pelias.json`.

## Important Variables

Copy the template and provide real deployment values through `.env` or the
deployment platform's environment configuration:

```bash
cp .env.template .env
```

Key variables:

- `DATA_PATH` is the host path for persistent and generated Pelias data.
  Elasticsearch data is stored under `${DATA_PATH}/elasticsearch`.
- `PELIAS_CONFIG_DIR` and `PELIAS_CONFIG_PATH` control the generated config
  location. Keep `PELIAS_CONFIG_PATH` inside `PELIAS_CONFIG_DIR`.
- `PELIAS_DOMAIN` is the public host routed by `secondary/proxy`.
- `TRAEFIK_CERTRESOLVER` must match the resolver configured in the secondary
  Traefik proxy.
- `PELIAS_*_IMAGE_TAG` values are intentionally configurable. Upstream Pelias
  examples commonly use `master` for non-Elasticsearch images, but production
  operators should pin tags or digests when they need reproducible rollouts.
- `ELASTICSEARCH_JAVA_OPTS` controls the Elasticsearch heap size.
- `OSM_PBF_URL` and `OSM_PBF_FILENAME` select the OSM extract. The default is
  Geofabrik's public Finland latest PBF. If you use the Pelias downloader, the
  filename must match the URL basename.
- `OSM_DATA_PATH` is the host path mounted for downloaded or manually staged
  `.osm.pbf` files.
- `OSM_LEVELDB_PATH` is the host path mounted for OpenStreetMap importer
  temporary LevelDB/cache data.
- `OSM_ADMIN_LOOKUP_ENABLED=false` is the default because this stack does not
  yet provide Who's on First/admin lookup data. Enabling it is out of scope
  until that support is added.
- `OSM_IMPORT_VENUES` and `OSM_REMOVE_DISUSED_VENUES` control OSM venue import
  behavior in the generated Pelias config.

Use absolute paths in the template. Compose does not recursively expand values
inside `.env`, so do not set `OSM_DATA_PATH=${DATA_PATH}/openstreetmap`.

## Routing

Create the shared Traefik network before deployment if it does not already
exist:

```bash
docker network create proxy-net
```

Only the API joins `proxy-net` and receives Traefik labels. Elasticsearch,
libpostal, config helpers, schema helpers, and OSM import jobs stay on the
private `pelias-net` network.

For Dokploy-style deployment, deploy from this folder, configure environment
values in the deployment settings, and ensure the secondary Traefik proxy and
`proxy-net` are already present. Do not commit the generated `.env` file.

## Validate

Run static Compose validation with placeholder values:

```bash
docker compose --env-file .env.template config
docker compose --env-file .env.template --profile tools --profile import config
```

Render and parse a non-secret test config locally:

```bash
tmpdir="$(mktemp -d)"
PELIAS_CONFIG_TEMPLATE="$PWD/pelias.json.template" \
PELIAS_CONFIG_DIR="$tmpdir/config" \
PELIAS_CONFIG_OUTPUT="$tmpdir/config/pelias.json" \
OSM_PBF_URL="https://download.geofabrik.de/europe/finland-latest.osm.pbf" \
OSM_PBF_FILENAME="finland-latest.osm.pbf" \
OSM_DATA_PATH="$tmpdir/openstreetmap" \
OSM_LEVELDB_PATH="$tmpdir/openstreetmap-leveldb" \
OSM_ADMIN_LOOKUP_ENABLED=false \
OSM_IMPORT_VENUES=true \
OSM_REMOVE_DISUSED_VENUES=true \
node scripts/render-pelias-config.mjs
node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" \
  "$tmpdir/config/pelias.json"
rm -rf "$tmpdir"
```

After rendering the real deployment config, you can also ask the Pelias API
image to load and print it:

```bash
docker compose --profile tools run --rm config-check
```

## First OSM Import

1. Create and edit `.env`:

   ```bash
   cp .env.template .env
   ```

2. Choose the OSM extract. The default is:

   ```text
   OSM_PBF_URL=https://download.geofabrik.de/europe/finland-latest.osm.pbf
   OSM_PBF_FILENAME=finland-latest.osm.pbf
   ```

   For a smaller test run, choose a smaller public `.osm.pbf` extract and set
   both values so the filename matches the URL basename.

3. Prepare the host directories. With the template defaults:

   ```bash
   mkdir -p /srv/pelias/config /srv/pelias/openstreetmap \
     /srv/pelias/openstreetmap-leveldb /srv/pelias/elasticsearch
   ```

   If you changed any path variables in `.env`, create those directories
   instead.

4. Render the generated Pelias config:

   ```bash
   docker compose --profile tools run --rm config-render
   ```

5. Start Elasticsearch and libpostal:

   ```bash
   docker compose up -d elasticsearch libpostal
   ```

6. Create the Pelias Elasticsearch index mapping:

   ```bash
   docker compose --profile tools run --rm schema
   ```

7. Download the configured PBF:

   ```bash
   docker compose --profile import run --rm osm-download
   ```

   To stage a file manually instead, copy it to:

   ```text
   ${OSM_DATA_PATH}/${OSM_PBF_FILENAME}
   ```

   Then skip `osm-download`.

8. Run the OSM import:

   ```bash
   docker compose --profile import run --rm osm-import
   ```

9. Start the API:

   ```bash
   docker compose up -d api
   ```

10. Verify service health and data:

    ```bash
    docker compose exec api wget -q -O - "http://localhost:4000/v1"
    docker compose exec api wget -q -O - \
      "http://localhost:4000/v1/search?text=Helsinki"
    docker compose exec elasticsearch \
      curl -fsS "http://localhost:9200/pelias/_count?pretty"
    ```

The OSM-only import will not have the same admin hierarchy or result quality as
a full Pelias build with Who's on First, OpenAddresses, interpolation,
placeholder, and PIP services.

## Refresh Or Rebuild

For a clean refresh, use a destructive rebuild flow unless you have a tested
incremental process for the specific data change:

```bash
docker compose stop api
docker compose --profile tools run --rm config-render
docker compose up -d elasticsearch libpostal
docker compose --profile import run --rm osm-download
docker compose --profile tools run --rm schema-drop-index
docker compose --profile tools run --rm schema
docker compose --profile import run --rm osm-import
docker compose up -d api
```

Drop and recreate the index when changing mappings, index settings, synonyms,
or when you need a clean import. This removes the current `pelias` index and all
documents inside it.

## Operational Notes

- Full regional imports are resource intensive. The Finland extract is a large
  public dataset and import runtime depends on host CPU, memory, disk, and
  Elasticsearch heap sizing.
- The OSM importer stores downloaded PBFs under `OSM_DATA_PATH` and temporary
  LevelDB/cache data under `OSM_LEVELDB_PATH`; both must remain outside git.
- `PELIAS_CONFIG_PATH` is generated data and must remain outside git.
- Finnish custom dataset integration is intentionally deferred to
  `F001.3-pelias-finnish-data-extensibility`.
