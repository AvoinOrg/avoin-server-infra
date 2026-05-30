# Estate PostGIS Loader Report

Status: blocked

Live import has not been run in this coding pass.

## Blockers

- Missing operator-staged NLS/MML `Kiinteistörekisterikartta (vektori)`
  GeoPackage at the configured source path.
- Missing sandbox PostGIS credentials in a feature-local ignored `.env` or
  provided process environment.

The external operational docs mount was available, and the secret-free GIS
runbook was reviewed for the approved access pattern. Secret files were not
read and no live sandbox connection was attempted.

## Prepared Loader Path

After staging the source file and providing sandbox credentials through an
ignored `.env` or secret-channel environment, run:

```bash
cd secondary/estate-postgis-loader
docker compose --profile tools run --rm inspect-source
docker compose --profile tools run --rm prepare-database
docker compose --profile tools run --rm import-estates
docker compose --profile tools run --rm verify-estates
```

If the database must be created by a DBA, the required database name is:

```sql
CREATE DATABASE "geocoding-finland";
\connect "geocoding-finland"
CREATE EXTENSION IF NOT EXISTS postgis;
```

## Verification Results

Not run against sandbox because the source package and database credentials
were unavailable.

Expected verification after import:

- connection/database check returns `geocoding-finland`;
- PostGIS version query succeeds;
- `estate.source_metadata`, `estate.cadastral_parcels`, and
  `estate.cadastral_estates` exist;
- source filename, source size, and SHA-256 are recorded;
- source layer and field mapping are recorded;
- raw feature, parcel row, and estate row counts are non-zero;
- compact and normalized ID validation counts are zero in public tables;
- parcel and estate geometry SRID is only 3067;
- parcel and estate geometry type is only `MULTIPOLYGON`;
- invalid geometry count is zero after repair or documented;
- missing aggregate label-point count is zero;
- required index checks all return present;
- metadata completeness check returns zero incomplete rows;
- the F003.1 sample lookup is recorded, or one fallback public sample is
  recorded if that sample is absent from the current source package.

## Source Mapping

Pending live `ogrinfo` confirmation. Defaults configured from F003.1:

- parcel layer: `PalstanSijaintitiedot`;
- compact ID field: `kiinteistotunnus`;
- display ID field: `kiinteistotunnuksenEsitysmuoto`;
- source feature ID field: `fid`.

## Notes

The loader uses representative `ST_PointOnSurface` label points. It does not
join the optional NLS identifier point layer in this pass because no source
package was available to prove a safe one-to-one join.
