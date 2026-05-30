# OpenStreetMap Dataset Import Plan

This runbook records the source decision and probe evidence for importing
OpenStreetMap data into the `secondary/pelias/` stack.

Generated data stays outside git. Do not commit `.osm.pbf` files, generated
`pelias.json`, Elasticsearch data, OSM LevelDB/cache data, or verification
transcripts with deployment-specific values.

## Source Decision

Use Geofabrik's Finland PBF extract for production:

- Source page: <https://download.geofabrik.de/europe/finland.html>
- Default PBF: <https://download.geofabrik.de/europe/finland-latest.osm.pbf>
- Checksum sidecar:
  <https://download.geofabrik.de/europe/finland-latest.osm.pbf.md5>

This source is the right production default because it is public, regional to
the intended Finland deployment, available as `.osm.pbf`, updated daily, has an
MD5 sidecar, and already matches the stack's `OSM_PBF_URL` /
`OSM_PBF_FILENAME` model. Pelias' OpenStreetMap importer accepts valid PBF
extracts, downloads configured `imports.openstreetmap.download[*].sourceURL`
values into `imports.openstreetmap.datapath`, and imports
`imports.openstreetmap.import[*].filename` from that path.

Observed on 2026-05-30 and expected to change as `latest` moves:

- The Finland page listed `finland-latest.osm.pbf` as about 689 MB, containing
  OSM data through `2026-05-29T20:21:10Z`.
- The same page said no subregions are defined for Finland, so there is no
  smaller Geofabrik Finland subregion PBF for a safe probe.
- `HEAD -L` on the latest PBF resolved to
  `https://download.geofabrik.de/europe/finland-260529.osm.pbf`.
- The final response was HTTP 200 with `Content-Length: 723380916`,
  `Content-Type: application/octet-stream`, and
  `Last-Modified: Fri, 29 May 2026 23:31:54 GMT`.
- The latest and timestamped MD5 sidecars both reported
  `ef81423b12e0268962e1961a5316383c` for the respective filename.

Before a production run, refresh the page, HEAD response, and checksum. For a
reproducible and resumable production import, prefer pinning the timestamped
Geofabrik URL from the redirect and set `OSM_PBF_FILENAME` to the timestamped
basename, for example:

```env
OSM_PBF_URL=https://download.geofabrik.de/europe/finland-260529.osm.pbf
OSM_PBF_FILENAME=finland-260529.osm.pbf
```

Using `finland-latest.osm.pbf` is convenient, but it is a moving target.

## Probe Result

Because Geofabrik does not publish Finland subregions, the safe Finnish-content
probe used BBBike's Helsinki PBF:

- Probe page: <https://download3.bbbike.org/osm/bbbike/Helsinki/>
- Probe PBF:
  <https://download3.bbbike.org/osm/bbbike/Helsinki/Helsinki.osm.pbf>
- Checksum page:
  <https://download3.bbbike.org/osm/bbbike/Helsinki/CHECKSUM.txt>

BBBike is not the production source. It is useful here because it provides a
small Finnish-area `.osm.pbf` that exercises Pelias' PBF import path without a
full Finland download. Do not infer production document counts, runtime, or
quality from this probe.

Observed on 2026-05-30:

- `HEAD` returned HTTP 200 with `Content-Type: application/x-pbf`,
  `Content-Length: 62580036`, and
  `Last-Modified: Sat, 23 May 2026 19:28:05 GMT`.
- The downloaded file was `Helsinki.osm.pbf`, 62,580,036 bytes.
- `md5sum` matched the public checksum
  `984e0c6023a0fdd9604dc8abc8c1bde9`.
- `file` identified it as `OpenStreetMap Protocolbuffer Binary Format`.
- `osmium fileinfo -e` reported:
  - format: PBF;
  - header bounding box: `(24.588,60.113,25.242,60.353)`;
  - data bounding box: `(10.8604819,53.9414183,29.6462529,60.6409048)`;
  - generator: `https://download.BBBike.org`;
  - timestamp: `2026-05-23T00:00:00Z`;
  - data timestamps: first `2007-01-09T21:30:53Z`, last
    `2026-05-22T21:09:19Z`;
  - object counts: 4,517,492 nodes, 693,964 ways, 10,355 relations;
  - ordered by type and ID: yes.

The stack renderer was validated with:

```env
OSM_PBF_URL=https://download3.bbbike.org/osm/bbbike/Helsinki/Helsinki.osm.pbf
OSM_PBF_FILENAME=Helsinki.osm.pbf
OSM_ADMIN_LOOKUP_ENABLED=false
```

The rendered `pelias.json` parsed successfully and contained the expected
`imports.openstreetmap.download[0].sourceURL`,
`imports.openstreetmap.import[0].filename`, `datapath`, `leveldbpath`,
`importVenues`, `removeDisusedVenues`, and disabled admin lookup values. Static
Compose validation with a non-secret temporary env also passed for the default
runtime services and the `tools` plus `import` profiles.

The live Compose jobs could not be completed in this Codex environment because
Docker bind mounts did not expose the repo or `/tmp` stack files inside the
container. `config-render` failed with:

```text
Error: Cannot find module '/work/scripts/render-pelias-config.mjs'
```

The same failure occurred from a copied `/tmp` stack. Treat this as a local
Docker environment blocker, not as evidence of a stack defect. The direct
download, checksum, PBF inspection, renderer validation, and static Compose
checks completed.

If the Helsinki probe is unavailable, use Geofabrik Monaco only as a
flow-level fallback:

- <https://download.geofabrik.de/europe/monaco.html>
- <https://download.geofabrik.de/europe/monaco-latest.osm.pbf>

Observed on 2026-05-30, `monaco-latest.osm.pbf` resolved to
`monaco-260529.osm.pbf`, returned HTTP 200 with `Content-Length: 680012`, and
had MD5 `85e0fe3d5f51d21613294017c55c824f`. That fallback validates a tiny
Geofabrik/Pelias PBF flow but not Finnish content.

## Production Import Order

Run production imports from `secondary/pelias/`. Use an ignored `.env` or the
deployment platform's secret/environment mechanism. Do not paste secret values
into commands, logs, or reports.

1. Choose and verify the source.

   ```bash
   curl -fsSIL -L https://download.geofabrik.de/europe/finland-latest.osm.pbf
   curl -fsSL https://download.geofabrik.de/europe/finland-latest.osm.pbf.md5
   ```

   Keep the default `latest` values for convenience, or pin the timestamped URL
   from the redirect and update `OSM_PBF_FILENAME` to match the URL basename.
   The renderer intentionally rejects mismatched values because the Pelias
   downloader stores the URL basename.

2. Prepare host directories. With the template defaults:

   ```bash
   mkdir -p /srv/pelias/config \
     /srv/pelias/openstreetmap \
     /srv/pelias/openstreetmap-leveldb \
     /srv/pelias/elasticsearch \
     /srv/pelias/finnish-custom/derived/pelias-csv
   ```

   If `.env` uses different absolute paths, create those paths instead.

3. Render the shared Pelias config.

   ```bash
   docker compose --profile tools run --rm config-render
   ```

4. Start the private runtime dependencies.

   ```bash
   docker compose up -d elasticsearch libpostal
   ```

5. Create the Elasticsearch index mapping.

   ```bash
   docker compose --profile tools run --rm schema
   ```

6. Download the configured PBF through the Pelias importer job.

   ```bash
   docker compose --profile import run --rm osm-download
   ```

   To stage the file manually instead, download it to:

   ```text
   ${OSM_DATA_PATH}/${OSM_PBF_FILENAME}
   ```

   Then verify the checksum and skip `osm-download`.

7. Run the OSM import.

   ```bash
   docker compose --profile import run --rm osm-import
   ```

8. Verify the imported index before exposing or restarting API traffic.

   ```bash
   docker compose exec elasticsearch \
     curl -fsS "http://localhost:9200/pelias/_count?pretty"
   ```

9. Start or restart the API when the index is ready.

   ```bash
   docker compose up -d api
   docker compose exec api wget -q -O - "http://localhost:4000/v1"
   docker compose exec api wget -q -O - \
     "http://localhost:4000/v1/search?text=Helsinki"
   ```

## Refresh Or Rebuild

Use a destructive rebuild unless an incremental update path has been tested for
the exact data change.

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

`schema-drop-index` removes the current `pelias` index and all documents in it.
Use it only when a destructive rebuild is intended.

## Paths And Resources

Important paths:

- `DATA_PATH`: root for persistent/generated stack data.
- `${DATA_PATH}/elasticsearch`: Elasticsearch index data.
- `PELIAS_CONFIG_DIR` and `PELIAS_CONFIG_PATH`: generated Pelias config.
- `OSM_DATA_PATH`: downloaded or manually staged PBF files.
- `OSM_LEVELDB_PATH`: OpenStreetMap importer LevelDB/cache data.
- `PELIAS_FINNISH_DATA_PATH`: raw Finnish custom sources, transform work, and
  derived CSV output for later features.
- `PELIAS_CSV_DATA_PATH`: ready Pelias CSV output for the profiled CSV importer.

Plan resources conservatively for Finland:

- Source PBF: currently about 0.7 GB.
- OSM LevelDB/cache and Elasticsearch index: potentially many times the PBF
  size. Start with at least 50 GB free for a Finland-only first run, and more
  if retaining old data, logs, manual downloads, or later custom/admin data.
- Memory: keep `OSM_ADMIN_LOOKUP_ENABLED=false` for this stack until
  Who's on First/admin data support is added. Upstream Pelias notes admin lookup
  can require several GB of memory by itself. For Elasticsearch, increase
  `ELASTICSEARCH_JAVA_OPTS` from the 1 GB template default if production
  imports show heap pressure; a host with 8-16 GB RAM gives more room for
  Elasticsearch, importer, and libpostal together.
- Runtime: measure on the deployment host. The Helsinki probe is not a useful
  predictor for full Finland runtime.

## Cleanup

After a successful import:

- Keep `${DATA_PATH}/elasticsearch` and `PELIAS_CONFIG_PATH`; they are runtime
  state.
- Keep the exact PBF and checksum if reproducible reimports or post-failure
  investigation matter.
- Remove old PBFs in `OSM_DATA_PATH` only after confirming the new index is
  healthy and the checksum/source metadata are recorded.
- `OSM_LEVELDB_PATH` can be cleared after the import is complete if no import
  job is running and the cache is not needed for debugging.
- Temporary probe roots under `/tmp/f006-osm-probe.*` can be deleted after
  recording sanitized facts.

## Rollback

The safest rollback is to preserve the previous data root or Elasticsearch
snapshot before a destructive rebuild.

- Before dropping the index, stop API traffic if serving stale or partial
  results is worse than downtime.
- Preserve the previous `${DATA_PATH}` or take an Elasticsearch snapshot before
  running `schema-drop-index`.
- If the new import fails before the destructive step, restart the API against
  the existing index.
- If the rebuild fails after dropping the index, restore the preserved data or
  snapshot, or rerun `schema` and `osm-import` from the verified PBF.
- A zero-downtime blue/green index swap is out of scope for this stack.

## Quality Limitations

This is an OSM-only Pelias flow. It does not yet include Who's on First,
OpenAddresses, address interpolation, Placeholder, PIP, or Finnish official
datasets such as NLS `Nimisto` and Ryhti address/building data. Expect weaker
admin hierarchy, address completeness, and local naming quality than a full
Pelias build with those datasets.
