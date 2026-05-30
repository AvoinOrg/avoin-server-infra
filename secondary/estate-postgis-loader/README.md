# Estate PostGIS Loader

This folder contains operator-only tooling for loading Finnish estate-ID data
into the sandbox PostGIS database `geocoding-finland`. It is not a public
service: it has no Traefik labels, exposes no ports, and does not join
`proxy-net`.

The loader follows the F003.1 contract in
`secondary/avoin-map-geocoding/ESTATE-DATA-CONTRACT.md`:

- source product: NLS/MML `Kiinteistörekisterikartta (vektori)` /
  `Cadastral index map (vector)`;
- preferred source package: operator-staged whole-Finland GeoPackage;
- parcel layer: `PalstanSijaintitiedot` or the confirmed equivalent layer in
  the downloaded package;
- target database: `geocoding-finland`;
- target schema: `estate`;
- public tables: `estate.source_metadata`, `estate.cadastral_parcels`, and
  `estate.cadastral_estates`;
- geometry: `MultiPolygon` in EPSG:3067 with representative `label_point`
  values;
- estate IDs: compact 14-digit IDs plus normalized `MMM-R-B-P` IDs.

## Files

- `docker-compose.yml` defines profile-gated one-shot tools only.
- `.env.template` contains placeholder values. Real `.env` files are ignored.
- `Dockerfile.tools` builds a GDAL/OGR image with `psql` for import work.
- `scripts/inspect-source.sh` prints source layer metadata, size, and SHA-256.
- `scripts/prepare-database.sh` creates or prepares `geocoding-finland`,
  installs/verifies PostGIS, and creates schemas/tables.
- `scripts/import-estates.sh` loads the source layer into staging, transforms
  rows into the public contract, creates indexes, and runs `ANALYZE`.
- `scripts/verify-estates.sh` runs sanitized verification SQL and writes the
  output under `${ESTATE_DATA_PATH}/reports`.
- `LOAD-REPORT.md` records the current live-load status or blocker.

## Prerequisites

You need operator-provided inputs before a live import can run:

- a local ignored `.env` or equivalent secret-channel environment values for
  the sandbox PostGIS connection;
- permission to create `"geocoding-finland"` or a DBA-created database with
  PostGIS available;
- an NLS/MML cadastral vector GeoPackage staged below `${ESTATE_DATA_PATH}`;
- enough disk, memory, and runtime for the whole-country import.

Keep API keys, PostGIS passwords, private hosts, private ports, downloaded
GeoPackages, extracted files, dumps, generated reports, and command transcripts
that include operational details out of git.

## Configure

Validate the stack with placeholders only:

```bash
docker compose --env-file .env.template config
docker compose --env-file .env.template --profile tools config
```

For a real run, copy the template and fill values from the operator secret
channel:

```bash
cp .env.template .env
```

Do not run `docker compose config` with the real `.env`; Compose can print
expanded secret values.

Prepare the data directory selected by `ESTATE_DATA_PATH` and place the source
GeoPackage under `source/`:

```bash
mkdir -p /srv/estate-postgis-loader/source /srv/estate-postgis-loader/reports
```

The default container path expects:

```text
/data/source/kiinteistorekisterikartta.gpkg
```

If the downloaded package uses a different filename, update `SOURCE_FILE`.

## Inspect Source

Confirm the layer and field names before importing:

```bash
docker compose --profile tools run --rm inspect-source
```

The defaults are based on the F003.1 contract:

```dotenv
SOURCE_PARCEL_LAYER=PalstanSijaintitiedot
SOURCE_ESTATE_ID_FIELD=kiinteistotunnus
SOURCE_ESTATE_DISPLAY_FIELD=kiinteistotunnuksenEsitysmuoto
SOURCE_FEATURE_ID_FIELD=fid
```

If `ogrinfo` shows different names in the downloaded GeoPackage, update the
local `.env` and record the mapping in `LOAD-REPORT.md`.

## Prepare Database

Run the database preparation step:

```bash
docker compose --profile tools run --rm prepare-database
```

The script refuses to run unless both of these values are exactly
`geocoding-finland`:

```dotenv
POSTGIS_DB=geocoding-finland
ESTATE_LOADER_CONFIRM_DB=geocoding-finland
```

If the loader user lacks database or extension privileges, ask a DBA to run the
minimal action with secret-free SQL like:

```sql
CREATE DATABASE "geocoding-finland";
\connect "geocoding-finland"
CREATE EXTENSION IF NOT EXISTS postgis;
```

Then rerun `prepare-database`.

## Import

After source inspection and database preparation:

```bash
docker compose --profile tools run --rm import-estates
```

The import does the following:

- loads the configured parcel layer into `estate_staging.raw_parcels`;
- records source filename, file size, SHA-256, acquisition metadata, and raw
  feature count in `estate.source_metadata`;
- filters invalid compact IDs out of public tables into
  `estate_staging.rejected_parcels`;
- normalizes IDs as `MMM-R-B-P`;
- converts geometries to EPSG:3067 `MultiPolygon`;
- repairs geometries with `ST_MakeValid` and records repair counts in
  metadata notes;
- derives deterministic `part_number` / `part_count` values;
- uses `ST_PointOnSurface` representative label points;
- aggregates parcels into `estate.cadastral_estates`;
- creates the required lookup, prefix, municipality, part, and GiST indexes;
- runs `ANALYZE`.

The current implementation does not join the optional
`KiinteistotunnuksenSijaintitiedot` label-point layer. It uses deterministic
representative points until a later scoped change proves a safe one-to-one
source point join.

## Verify

Run:

```bash
docker compose --profile tools run --rm verify-estates
```

The verification SQL prints only database name, PostGIS version, table
existence, metadata/file checksum values, row counts, ID validation counts,
SRID/type counts, invalid geometry counts, missing label-point counts, required
index presence, metadata completeness, the F003.1 public sample lookup
(`17440100030006` / `174-401-3-6`), and one fallback sample from loaded public
data.

The default output path is:

```text
${ESTATE_DATA_PATH}/reports/estate-verification.txt
```

Do not paste raw output into tracked files if it includes private operational
details. Summarize sanitized results in `LOAD-REPORT.md`.

## Blocker Handling

Use these categories in `LOAD-REPORT.md` when a live load cannot complete:

- missing operator-staged NLS/MML GeoPackage;
- missing sandbox PostGIS credentials;
- sandbox network unreachable;
- missing `createdb` privilege;
- missing PostGIS extension privilege;
- source layer or source field names differ from the defaults;
- insufficient disk, memory, or runtime;
- image build or pull failure.

For each blocker, record the exact missing prerequisite and the next command an
operator should run after fixing it. Do not record credentials, private hosts,
private ports, API keys, or full private host paths.
