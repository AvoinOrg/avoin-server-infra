# Finnish Estate Data Source And Import Contract

This document started as the F003.1 handoff for loading Finnish estate-ID
lookup data into sandbox PostGIS in F003.2. It is intentionally a source
decision and data contract only: it does not download cadastral data, create or
mutate PostGIS databases, publish GeoServer layers, or contain deployment
secrets. The F004 runtime adapter in this service consumes the loaded
`estate.*` tables when explicitly configured.

The `secondary/avoin-map-geocoding/` service remains stateless from the
application container's point of view. Do not add NLS/MML, Ryhti, source-data,
or secret-bearing loader credentials to its runtime environment. Optional F004
PostGIS lookup credentials belong only in ignored `.env` values or deployment
secrets.

## Source Decision

Use the National Land Survey of Finland / Maanmittauslaitos cadastral vector
product:

- English name: `Cadastral index map (vector)`
- Finnish name: `Kiinteistörekisterikartta (vektori)`
- Provider/responsible party: National Land Survey of Finland / Maanmittauslaitos
- Product page: <https://www.maanmittauslaitos.fi/en/maps-and-spatial-data/datasets-and-interfaces/product-descriptions/cadastral-index-map-vector>
- Finnish product page: <https://www.maanmittauslaitos.fi/kartat-ja-paikkatieto/aineistot-ja-rajapinnat/tuotekuvaukset/kiinteistorekisterikartta-vektori>

This is the selected source because it is the authoritative cadastral map
vector product for real-property/register-unit location data in Finland. The
product covers all Finland and includes register-unit boundaries, boundary
markers, parcels (`palstat`), property identifiers (`kiinteistötunnukset`), and
unseparated parcels (`määräalat`).

Do not use these alternatives for F003/F004 estate lookup:

- Raster cadastral index map: property identifiers may appear visually, but it
  is not a structured geodata source for exact estate-ID lookup.
- Pelias CSV import: it is suitable for natural-language address and place
  search, not exact structured estate-ID geometry lookup.
- NLS place-name products and Syke Ryhti address/building datasets: they remain
  useful for other geocoding work, but they do not provide cadastral estate
  boundary polygons keyed by estate ID.

Quality caveat: cadastral index map boundaries may contain spatial
inaccuracies where all boundary markers do not have exact coordinates. The data
is suitable for lookup and display, but it is not a legal boundary
determination source.

## Access, License, And Freshness

Official references checked for this contract on 2026-05-30:

- NLS MapSite: <https://www.maanmittauslaitos.fi/en/e-services/mapsite>
- MapSite related download services: <https://www.maanmittauslaitos.fi/asioi-verkossa/karttapaikka/liittyvat-palvelut>
- NLS File Download Service / OGC API Processes: <https://www.maanmittauslaitos.fi/paikkatiedon-tiedostopalvelu>
- File Download Service technical description: <https://www.maanmittauslaitos.fi/paikkatiedon-tiedostopalvelu/tekninen-kuvaus>
- Open cadastral OGC API Features, API-key variant: <https://www.maanmittauslaitos.fi/kiinteistotietojen-kyselypalvelu-ogc-api/avoimet-tuotteet-api-avain>
- Open cadastral OGC API Features, contract variant: <https://www.maanmittauslaitos.fi/kiinteistotietojen-kyselypalvelu-ogc-api/avoimet-tuotteet>
- API key instructions: <https://www.maanmittauslaitos.fi/rajapinnat/api-avaimen-ohje>
- NLS open-data license: <https://www.maanmittauslaitos.fi/avoindata-lisenssi-cc40>
- NLS open API terms: <https://www.maanmittauslaitos.fi/kartat-ja-paikkatieto/asiantuntevalle-kayttajalle/maanmittauslaitoksen-avoimen-rajapinnan>

License and attribution:

- License: Creative Commons Attribution 4.0 International, as applied by the
  NLS open-data terms.
- Attribution must include the licensor name, the dataset name, and the time
  when NLS delivered or the operator acquired the dataset.
- Store the exact attribution string used by the loader in
  `estate.source_metadata.attribution`.

Coverage, CRS, and formats:

- Geographic coverage: all Finland.
- Product CRS/reference system: ETRS89 / TM35FIN, EPSG:3067.
- OGC API Features responses are GeoJSON. The default response CRS is CRS84
  WGS84 longitude/latitude unless the request asks for another supported CRS;
  request EPSG:3067 for probes that must match the storage CRS.
- Distribution channels: MapSite download UI, File Download Service / OGC API
  Processes, open cadastral OGC API Features for probes and small queries, and
  the directory UI where an operator has separate directory credentials.
- Preferred F003.2 acquisition: whole-Finland GeoPackage/GPKG from MapSite or
  File Download Service when available.
- Fallback acquisition: municipality, BBOX, or polygon-delimited GPKG; use
  GeoJSON/GML only if the whole-country GPKG path is unavailable or the final
  source package proves those formats are more reliable.
- Relevant File Download Service process identifiers documented by NLS include
  `kiinteistorekisterikartta_vektori_koko_suomi`,
  `kiinteistorekisterikartta_vektori_kunta`,
  `kiinteistorekisterikartta_vektori_bbox`,
  `kiinteistorekisterikartta_vektori_polygon`, and
  `kiinteistorekisterikartta_vektori_karttalehti`. Request EPSG:3067 output
  for scoped downloads when the process accepts an output CRS parameter.

Access constraints:

- The data is open/free under NLS open-data terms.
- The NLS open APIs, including File Download Service and open OGC API Features,
  require an API key. Keep the key in a local operator environment variable or
  deployment secret store, never in tracked files or role reports.
- Prefer HTTP Basic authentication for scripted API use so the key is not
  embedded in URLs or logs.
- The contract-based OGC API Features variant uses a separate agreement and
  credentials. It is not required unless the API-key variant or file download
  path cannot satisfy the loader.
- NLS open API terms say the open interfaces are not intended for high-volume
  or capacity-critical services. F003.2 should use file download for the full
  import and reserve OGC API Features for validation probes.

Update cadence:

- Interface services: cadastral register changes are updated nightly.
- MapSite/File Download GeoJSON and GeoPackage products: updated nightly.
- MapSite/File Download SHP and GML products: updated Tuesday, Wednesday, and
  Sunday.

Expected volume:

- Exact whole-country GPKG file size and feature/row counts were not measured
  in F003.1 because this runtime has no non-secret NLS API key, MapSite order
  result, or downloaded package.
- F003.2 must measure and record the final file size, SHA-256 checksum, raw
  feature count, imported parcel row count, and distinct estate count before
  considering the load verified.
- Suggested non-secret probes once access exists:

  ```sh
  export NLS_API_KEY="<read from the operator secret channel>"

  curl -fsSI -u "$NLS_API_KEY:" \
    "https://avoin-paikkatieto.maanmittauslaitos.fi/kiinteisto-avoin/simple-features/v3/collections/PalstanSijaintitiedot/items?limit=1&crs=http://www.opengis.net/def/crs/EPSG/0/3067"

  ogrinfo -so /path/to/kiinteistorekisterikartta.gpkg PalstanSijaintitiedot
  du -h /path/to/kiinteistorekisterikartta.gpkg
  sha256sum /path/to/kiinteistorekisterikartta.gpkg
  ```

## Source Product And Layers

F003.2 must import only the cadastral data needed for the current estate-ID
parser and lookup contract.

Required source product/collection:

- Parcel geometry carrying property identifiers:
  `PalstanSijaintitiedot` in OGC API Features, or the equivalent layer in the
  downloaded GPKG package.
- Required identifier attributes, after confirming the final source layer:
  the compact 14-digit estate ID, exposed in OGC examples as
  `kiinteistotunnus`, and the display/hyphenated form when present, exposed in
  OGC examples as `kiinteistotunnuksenEsitysmuoto`.

Optional source product/collection:

- Identifier point or label-location data:
  `KiinteistotunnuksenSijaintitiedot`, or the equivalent downloaded GPKG
  layer, may be used for `label_point` when it can be joined safely by estate
  ID.

Excluded for the first load:

- `MaaraalanOsanSijaintitiedot` and other unseparated parcel identifiers unless
  F003.2 proves they fit the current estate-ID parser and lookup semantics.
- `PalstanLaajatSijaintitiedot`, `ProjisoidunPalstan*`, 3D register-unit
  products, cadastral boundary lines, and boundary markers unless they are
  needed only as intermediate validation data.

The exact downloaded GPKG layer names may differ from the OGC collection names.
F003.2 must confirm the layer list with `ogrinfo` and record any mapping in its
loader runbook/report before import.

## Target PostGIS Contract

Target database:

- Database name: `geocoding-finland`
- SQL identifier note: quote the hyphenated database name in `CREATE DATABASE`
  statements, for example `CREATE DATABASE "geocoding-finland";`.
- Connection settings should treat `geocoding-finland` as a database-name
  value, not as a SQL identifier.

Target schema and tables:

- Schema: `estate`
- Metadata table: `estate.source_metadata`
- Per-source-feature/parcel table: `estate.cadastral_parcels`
- Aggregated lookup table: `estate.cadastral_estates`

Minimum table contract:

### `estate.source_metadata`

| Column | Required type/shape | Notes |
| --- | --- | --- |
| `id` | integer/bigint primary key | Loader-generated metadata row id. |
| `provider` | text not null | `National Land Survey of Finland / Maanmittauslaitos`. |
| `dataset_name` | text not null | `Kiinteistörekisterikartta (vektori) / Cadastral index map (vector)`. |
| `product_url` | text not null | Official NLS product URL. |
| `license` | text not null | `CC BY 4.0` / NLS open-data attribution terms. |
| `attribution` | text not null | Exact attribution string used by applications. |
| `acquisition_method` | text not null | For example `mapsite-gpkg`, `ogc-processes-gpkg`, or `ogc-features-probe`. |
| `retrieved_at` | timestamptz not null | When the operator/loader retrieved the source package. |
| `nls_delivery_or_order_time` | text or timestamptz | NLS delivery/order timestamp used for attribution. |
| `registry_state_date` | date | `rekisteritilannepvm` when obtained. |
| `registry_state_current` | boolean | `rekisteritilanneAjantasalla` when obtained. |
| `source_format` | text not null | `GPKG`, `GeoJSON`, `GML`, etc. |
| `source_crs` | text not null | Expected `EPSG:3067`. |
| `source_filename` | text | Source package filename when file-based. |
| `source_job_id` | text | File Download Service job id when applicable. |
| `source_sha256` | text | SHA-256 of the downloaded source file when file-based. |
| `raw_feature_count` | bigint | Raw source feature count before filtering. |
| `parcel_row_count` | bigint | Imported parcel row count. |
| `estate_row_count` | bigint | Distinct estate count in the aggregate table. |
| `notes` | text | Unknowns, exclusions, invalid-geometry counts, or loader caveats. |

### `estate.cadastral_parcels`

| Column | Required type/shape | Notes |
| --- | --- | --- |
| `parcel_id` | bigserial or stable generated primary key | Internal row id. |
| `source_metadata_id` | foreign key to `estate.source_metadata(id)` | Source package metadata. |
| `source_layer` | text not null | Source layer/collection name. |
| `source_feature_id` | text | Stable source feature id/FID when available. |
| `estate_id_compact` | text not null | Exactly 14 digits. |
| `estate_id_normalized` | text not null | Hyphenated normalized id, e.g. `010-42-1-1`. |
| `estate_id_display` | text | Source display id when present. |
| `municipality_code` | text not null | 3 digits. |
| `register_unit_code` | text not null | Source register-unit part, normalized without leading zeroes. |
| `block_code` | text not null | Source block/group part, normalized without leading zeroes. |
| `parcel_code` | text not null | Source parcel part, normalized without leading zeroes. |
| `part_number` | integer not null | Deterministic 1-based parcel number within the estate. |
| `part_count` | integer not null | Total parcel rows for the estate. |
| `source_properties` | jsonb not null | Original non-geometry source attributes needed for audit/debugging. |
| `geom` | `geometry(MultiPolygon, 3067)` not null | Source polygon normalized to MultiPolygon in EPSG:3067. |
| `label_point` | `geometry(Point, 3067)` | Source label point or deterministic representative point. |
| `loaded_at` | timestamptz not null | Loader timestamp. |

### `estate.cadastral_estates`

| Column | Required type/shape | Notes |
| --- | --- | --- |
| `estate_id_compact` | text primary key or unique not null | Exactly 14 digits. |
| `estate_id_normalized` | text unique not null | Hyphenated normalized id. |
| `estate_id_display` | text | Preferred display id from source or normalized id. |
| `municipality_code` | text not null | 3 digits. |
| `register_unit_code` | text not null | Normalized register-unit part. |
| `block_code` | text not null | Normalized block/group part. |
| `parcel_code` | text not null | Normalized parcel part. |
| `part_count` | integer not null | Number of parcel rows represented. |
| `source_metadata_id` | foreign key to `estate.source_metadata(id)` | Metadata for the current load. |
| `geom` | `geometry(MultiPolygon, 3067)` not null | Collected/unioned estate geometry. |
| `label_point` | `geometry(Point, 3067)` not null | Label source or representative point. |
| `source_freshness_at` | timestamptz or date | Source state/delivery timestamp used by F004. |
| `loaded_at` | timestamptz not null | Loader timestamp. |

F003.2 may use staging/raw tables during import, but those tables are loader
implementation details. The public contract for F004 is the three `estate.*`
tables above.

## Estate ID Normalization

The contract must remain compatible with
[`src/estate-id.mjs`](src/estate-id.mjs). Do not expand accepted query syntax in
F003.1 or F003.2.

Compact source id:

- `estate_id_compact` must be a text value matching `^[0-9]{14}$`.
- Split the compact id as `MMM RRR BBBB PPPP`, where:
  - `municipality_code`: first 3 digits.
  - register-unit part: next 3 digits.
  - block/group part: next 4 digits.
  - parcel part: final 4 digits.

Normalized id:

- `municipality_code` is left-padded to 3 digits.
- The register-unit, block/group, and parcel parts have leading zeroes stripped.
- Empty stripped parts become `0`.
- Join the four parts with hyphens, e.g. compact `01004200010001` becomes
  `010-42-1-1`.

Hyphenated ids:

- The existing service accepts `municipality-register-block-parcel` with 1 to
  3 municipality digits, 1 to 4 digits in the other input parts, and an optional
  trailing `#part` selector.
- For compact generation, register-unit values longer than 3 digits are
  rejected by the existing parser; F003.2 must not import rows whose normalized
  register-unit part cannot round-trip to the 14-digit compact contract.

Multi-parcel estates:

- `part_number` and `part_count` are derived from
  `estate.cadastral_parcels`, grouped by `estate_id_compact`.
- Ordering must be stable across repeated imports. Use source feature id/FID
  when present; otherwise use a deterministic hash of normalized geometry and
  source properties.
- Future F004 `#part` lookups must be able to request a repeatable part number.

Recommended validation checks:

```sql
select count(*) as bad_compact_ids
from estate.cadastral_parcels
where estate_id_compact !~ '^[0-9]{14}$';

select count(*) as bad_normalized_ids
from estate.cadastral_parcels
where estate_id_normalized !~ '^[0-9]{3}-[0-9]+-[0-9]+-[0-9]+$';
```

## Geometry Contract

Storage CRS and geometry:

- Store source and target geometries in EPSG:3067.
- Normalize every polygon source geometry to MultiPolygon.
- `estate.cadastral_parcels.geom` must be
  `geometry(MultiPolygon, 3067)`.
- `estate.cadastral_estates.geom` must be
  `geometry(MultiPolygon, 3067)`.
- Use `ST_Multi(...)` after polygon extraction/validation so Polygon input does
  not leak into the public tables.

Aggregate geometry:

- Aggregate parcels by `estate_id_compact` using a deterministic PostGIS
  operation such as `ST_UnaryUnion(ST_Collect(geom))`, or a safer equivalent if
  F003.2 finds invalid geometries that require repair first.
- If `ST_MakeValid` is required, record pre-repair invalid counts and the repair
  method in `estate.source_metadata.notes`.

Label points:

- Prefer source identifier-location points from `KiinteistotunnuksenSijaintitiedot`
  when they can be joined unambiguously by estate ID.
- Otherwise generate a deterministic point in EPSG:3067 with
  `ST_PointOnSurface(geom)` or a documented representative-point method.
- `estate.cadastral_estates.label_point` must be non-null after load.

F004 is responsible for response-shape work:

- Transforming EPSG:3067 geometries to GeoJSON CRS84 longitude/latitude.
- Returning bboxes in `[west, south, east, north]` order.
- Deciding how much parcel geometry to return for full-estate versus `#part`
  responses.

## Index Contract

Create indexes after bulk import where possible. Required indexes:

```sql
create unique index cadastral_estates_compact_uidx
  on estate.cadastral_estates (estate_id_compact);

create unique index cadastral_estates_normalized_uidx
  on estate.cadastral_estates (estate_id_normalized);

create index cadastral_estates_municipality_idx
  on estate.cadastral_estates (municipality_code);

create index cadastral_estates_compact_prefix_idx
  on estate.cadastral_estates (estate_id_compact text_pattern_ops);

create index cadastral_estates_normalized_prefix_idx
  on estate.cadastral_estates (estate_id_normalized text_pattern_ops);

create index cadastral_parcels_estate_part_idx
  on estate.cadastral_parcels (estate_id_compact, part_number);

create index cadastral_parcels_geom_gix
  on estate.cadastral_parcels using gist (geom);

create index cadastral_estates_geom_gix
  on estate.cadastral_estates using gist (geom);
```

Optional indexes:

- `estate.cadastral_parcels (municipality_code)` if municipal verification or
  partial reloads need it.
- `estate.cadastral_parcels (source_metadata_id)` and
  `estate.cadastral_estates (source_metadata_id)` if multiple loads are kept
  during validation.
- Expression/check indexes only when they simplify F003.2 verification or F004
  query plans.

## F003.2 Loader Outline

F003.2 should implement or document these steps without committing source data
or credentials:

1. Obtain the NLS source package through MapSite or File Download Service.
2. Store raw downloads and generated intermediate files outside the tracked
   repository, or under an ignored data path selected by F003.2.
3. Record retrieval time, NLS delivery/order time, source filename/job id,
   source format, CRS, and SHA-256 checksum.
4. Confirm source layer names and attributes with `ogrinfo`.
5. Create database `"geocoding-finland"` if it does not exist and install
   PostGIS.
6. Create the `estate` schema and target tables.
7. Load parcel source features, normalize IDs and geometry, and preserve source
   attributes in `source_properties`.
8. Derive `part_number` and `part_count`.
9. Build `estate.cadastral_estates` by grouping parcels by compact estate ID.
10. Create required indexes and run `ANALYZE`.
11. Run the verification checklist below and write the measured results in the
    F003.2 report/runbook.

## Verification Checklist

Run verification against the sandbox database only in F003.2, using credentials
from the operator secret channel. Do not paste credential values into docs,
reports, or command transcripts.

Database and extension:

```sql
select current_database();
select postgis_full_version();
```

Expected database result is `geocoding-finland`. PostGIS must be installed.

Schema and tables:

```sql
select table_schema, table_name
from information_schema.tables
where table_schema = 'estate'
order by table_name;
```

Counts:

```sql
select raw_feature_count, parcel_row_count, estate_row_count
from estate.source_metadata
order by id desc
limit 1;

select count(*) as parcel_rows from estate.cadastral_parcels;
select count(*) as estate_rows from estate.cadastral_estates;
select count(distinct estate_id_compact) as distinct_estates
from estate.cadastral_parcels;
```

IDs and required fields:

```sql
select count(*) as bad_compact_ids
from estate.cadastral_estates
where estate_id_compact !~ '^[0-9]{14}$';

select count(*) as bad_normalized_ids
from estate.cadastral_estates
where estate_id_normalized !~ '^[0-9]{3}-[0-9]+-[0-9]+-[0-9]+$';

select count(*) as missing_required_values
from estate.cadastral_parcels
where estate_id_compact is null
   or estate_id_normalized is null
   or municipality_code is null
   or register_unit_code is null
   or block_code is null
   or parcel_code is null
   or geom is null;
```

Geometry:

```sql
select st_srid(geom) as srid, count(*)
from estate.cadastral_parcels
group by st_srid(geom);

select geometrytype(geom) as geom_type, count(*)
from estate.cadastral_parcels
group by geometrytype(geom);

select count(*) as invalid_parcel_geometries
from estate.cadastral_parcels
where not st_isvalid(geom);

select count(*) as missing_estate_label_points
from estate.cadastral_estates
where label_point is null;
```

Indexes:

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'estate'
  and tablename in ('cadastral_parcels', 'cadastral_estates')
order by tablename, indexname;
```

Metadata completeness:

```sql
select provider, dataset_name, license, attribution, acquisition_method,
       retrieved_at, nls_delivery_or_order_time, source_format, source_crs,
       source_sha256, raw_feature_count, parcel_row_count, estate_row_count
from estate.source_metadata
order by id desc
limit 1;
```

Public sample lookup:

```sql
select estate_id_compact, estate_id_normalized, part_count,
       st_srid(geom) as geom_srid
from estate.cadastral_estates
where estate_id_compact = '17440100030006'
   or estate_id_normalized = '174-401-3-6';
```

The sample ID appears in NLS OGC API examples. It is acceptable for this sample
query to return zero rows if the current source package no longer contains that
estate; if so, F003.2 must record at least one other public/non-sensitive sample
lookup from the downloaded data.

## F003.2 Blockers And Uncertainties

F003.2 must resolve these before or during the load:

- NLS API key or MapSite download/order access is not available in this F003.1
  runtime.
- Sandbox PostGIS database credentials and network access are not available in
  this repository and must come from the existing operator secret channel.
- Exact whole-country GPKG size, raw feature count, imported parcel row count,
  and distinct estate count are not measured yet.
- Exact downloaded GPKG layer names and source attribute names must be
  confirmed after download.
- Registry state metadata such as `rekisteritilannepvm` and
  `rekisteritilanneAjantasalla` may be visible in OGC API Features metadata but
  may not be included in the file download package.
- Whole-country import may need disk/runtime planning, GDAL/OGR version checks,
  staged raw tables, batch indexes, `ST_Subdivide`, and vacuum/analyze tuning.
- Unseparated parcels and projected/3D cadastral features are intentionally
  excluded until a later feature proves the parser and API semantics for them.

## Deferred Work

- F003.2 owns the sandbox PostGIS load and measured verification results.
- F004 owns the optional runtime adapter that connects
  `secondary/avoin-map-geocoding/` to the loaded estate data and transforms
  EPSG:3067 geometries into API response GeoJSON.
- GeoServer layer publication, vector tiles, and public map styling are out of
  scope for this contract.
