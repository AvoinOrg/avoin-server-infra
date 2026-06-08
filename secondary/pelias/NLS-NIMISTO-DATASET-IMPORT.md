# NLS Nimistö Dataset Import Plan

This runbook records the source decision and current probe status for importing
National Land Survey of Finland (NLS/Maanmittauslaitos) `Nimistö` place-name
data into the `secondary/pelias/` stack through the existing Pelias CSV import
path.

Generated data stays outside git. Do not commit downloaded GeoJSON, GML,
generated CSV, generated `pelias.json`, Elasticsearch data, or verification
transcripts containing API keys or deployment-specific values.

## Source Decision

Use NLS `Nimistö` place-name products for Pelias named-place search records.

Recommended first production input:

- OGC API Features collection `placenames_simple`
  (`Paikannimet, yksinkertaistettu`) as GeoJSON for the first flat Pelias CSV
  transform.
- Use full `placenames` (`Paikannimet`) when the transformer intentionally
  builds grouped alias/language arrays from `parallelName`, or when search
  quality work proves those relationships are needed in the first import.

This remains the right first source after the 2026-06-08 key-backed probe:
`Paikannimet, yksinkertaistettu` returns one feature per place-name row without
the nested `parallelName` arrays of full `Paikannimet`, while still carrying
the checked spelling, language, named-place identifier, place type,
municipality/region context, status, scale relevance, and point location needed
for initial Pelias CSV rows. The sample also showed repeated `placeId` values
across Finnish/Swedish rows, so a future transformer can still group rows by
`placeId` when it wants language columns.

Do not use `Karttanimet` as the primary search dataset. NLS documents map names
as cartographic label products selected for map scales and map text placement;
the same place can appear more than once as map labels. That is useful for map
rendering, not as the clean primary source for geocoder records.

The relevant official OGC collection ids are:

```text
places              Paikat
placenames          Paikannimet
placenames_simple   Paikannimet, yksinkertaistettu
mapnames            Karttanimet
```

The open OGC endpoint is:

```text
https://avoin-paikkatieto.maanmittauslaitos.fi/geographic-names/features/v1/
```

## Access, License, And Updates

The open OGC API requires a user-specific NLS API key. Keep it outside tracked
files and use HTTP Basic authentication with the API key as the username and an
empty password:

```bash
set +x
umask 077
export NLS_API_KEY="<provided through an ignored secret channel>"

probe="$(mktemp -d /tmp/nls-nimisto-probe.XXXXXX)"
curl_cfg="$probe/curl-basic.conf"
printf 'user = "%s:"\n' "$NLS_API_KEY" > "$curl_cfg"
chmod 600 "$curl_cfg"

curl -fsS --config "$curl_cfg" \
  "https://avoin-paikkatieto.maanmittauslaitos.fi/geographic-names/features/v1/collections"
```

Prefer Basic authentication over `api-key=` query parameters. URLs are easier
to leak into logs, shell history, browser history, and reports. If a tool only
supports the query parameter form, keep the full URL out of tracked files and
redact it from transcripts.

The agreement-based NLS interface uses separate credentials and is out of scope
for this stack-local planning pass.

Licensing and attribution:

- NLS identifies Geographic names as open data under CC BY 4.0.
- Operator-facing attribution must mention the National Land Survey of Finland,
  the dataset name, and the delivery/update time, for example:

  ```text
  Contains data from the National Land Survey of Finland Geographic names
  dataset, delivered <YYYY-MM-DD>.
  ```

Update cadence:

- The NLS product page says the product is updated nightly.
- The OGC API dataset is documented as updating once per day; the service page
  also describes the service data as continuously updated.
- Whole-country GML file products in MapSite are documented as updating three
  times per year, in January, May, and September.

Formats and CRS:

- OGC API Features is the preferred first downloader path because bounded
  GeoJSON requests support `bbox`, `limit`, property filters, pagination, and
  default WGS84 lon-lat / CRS84 geometries.
- The F008 key-backed probe verified GeoJSON item responses. NLS public docs
  describe GML support, but the small live item checks did not establish a
  working GML item-response URL; keep the first implementation on GeoJSON.
- The OGC service supports CRS parameters such as `bbox-crs` and `crs`.
- The product metadata reference system is ETRS89 / TM35FIN (EPSG:3067), but
  default OGC GeoJSON responses are WGS84 lon-lat. Final Pelias CSV must always
  use WGS84 decimal `lat` and `lon`.
- If a future downloader requests `crs=http://www.opengis.net/def/crs/EPSG/0/3067`,
  it must transform coordinates back to WGS84 before writing Pelias CSV.

No `NLS_API_KEY` was added to `.env.template` in this feature. There is no
tracked downloader or transformer consuming it yet; examples use a local shell
variable only.

## Key-Backed Probe Result

Observed on 2026-06-08 for bbox `24.92,60.16,24.97,60.19` around Helsinki.
The API key was read only from the ignored external NLS secret note and used
with HTTP Basic authentication as the username and an empty password. No
`api-key=` URL was used.

Metadata requests:

- `GET /collections`: HTTP `200`, `application/json`, about 8.4 KB. The service
  returned four collection ids: `places`, `placenames`, `placenames_simple`,
  and `mapnames`.
- `GET /collections/placenames_simple`: HTTP `200`, `application/json`, about
  2.0 KB. The collection id is `placenames_simple`, title `PlaceNameSimple`,
  storage CRS is EPSG:3067, and the advertised CRS list includes CRS84,
  EPSG:4326, EPSG:3067, EPSG:3857, and multiple Finnish projected CRS values.
- `GET /collections/placenames`: HTTP `200`, `application/json`, about 2.0 KB.
  The collection id is `placenames`, title `PlaceName`, with the same relevant
  CRS behavior.
- The collection metadata advertised GeoJSON item links plus schema/queryables
  links for both sampled collections.

`placenames_simple` GeoJSON sample:

- Request shape:

  ```text
  /collections/placenames_simple/items?bbox=24.92,60.16,24.97,60.19&limit=20
  ```

- Response: HTTP `200`, `application/geo+json`, about 18 KB.
- Top-level response: GeoJSON `FeatureCollection`.
- Count fields: `numberReturned=20`; `numberMatched` was not present.
- Pagination: `links` contained `rel=self` and `rel=next`; a `limit=1` request
  against the same bbox also returned `rel=next`, so the future downloader must
  follow `next` links until no `next` remains.
- Geometry: all sampled features were `Point`.
- Default coordinate behavior: coordinate arrays were `[lon, lat]` in CRS84 /
  WGS84. The sampled coordinate ranges were roughly lon `24.924..24.969` and
  lat `60.160..60.188`, matching the request bbox and valid Pelias WGS84
  ranges.
- Language shape: 11 sampled rows had `language=fin`, 9 had `language=swe`.
  The sample had 11 distinct `placeId` values; 9 place ids appeared twice,
  showing that `placenames_simple` can carry parallel Finnish/Swedish names as
  separate flat rows even though it omits the nested `parallelName` relation.

Actual `placenames_simple` property keys present in the sample:

```text
gslsMapSheet
language
languageDominance
languageOfficiality
municipality
placeCreationTime
placeDeletionTime
placeElevation
placeId
placeModificationTime
placeNameCreationTime
placeNameDeletionTime
placeNameId
placeNameModificationTime
placeNameSource
placeNameStatus
placeNameVersionId
placeType
placeTypeCategory
placeTypeDescription
placeTypeGroup
placeTypeSubgroup
placeVersionId
region
rescueGridSquare
scaleRelevance
spelling
subregion
tm35MapSheet
```

CRS behavior:

- The default GeoJSON response is suitable for Pelias coordinate extraction:
  use `geometry.coordinates[0]` as `lon` and `geometry.coordinates[1]` as
  `lat`.
- A bounded request with
  `crs=http://www.opengis.net/def/crs/EPSG/0/3067` returned HTTP `200` and
  `application/geo+json`, but the point coordinate range changed to projected
  EPSG:3067 easting/northing values around `387322,6672517`. Those values must
  never be written directly to Pelias `lon`/`lat`.

Full `placenames` comparison:

- The same bbox and `limit=20` returned HTTP `200`, `application/geo+json`,
  about 25 KB, GeoJSON `FeatureCollection`, `numberReturned=20`, and a
  `rel=next` pagination link.
- Geometry and default CRS behavior matched `placenames_simple`.
- The sample property keys matched `placenames_simple` plus `parallelName`.
- Every sampled feature had a `parallelName` array with one to three objects;
  22 nested parallel-name objects appeared across the 20 sampled features.
  Nested object keys were `placeNameId`, `placeNameVersionId`, `spelling`,
  `language`, `languageOfficiality`, `languageDominance`, `placeNameSource`,
  `placeNameStatus`, `placeNameCreationTime`, `placeNameModificationTime`, and
  `placeNameDeletionTime`.

Source recommendation after F008:

- Use `placenames_simple` for the first implementation that writes one
  Pelias CSV row per NLS `placeNameId`, with `source=nls`, conservative
  `layer=venue`, and original NLS metadata in `addendum_json_nls`.
- If the first transformer also groups names by `placeId`, it can build
  `name_fi`, `name_sv`, and later Sami language columns from
  `placenames_simple` rows. The small Helsinki sample did not include Sami
  languages, so whole-country language coverage still needs validation during
  production import.
- Use full `placenames` when implementing alias-preserving `name_json` /
  `name_json_$lang` output or when the nested `parallelName` relationship is
  needed to choose primary versus alternate spellings. That is useful, but it
  is extra transform complexity and not required for the first flat CSV import.

GML note:

- A cheap live item negotiation check using `Accept: application/gml+xml` and
  an `.gml` item path returned HTTP `406` with a small JSON error body.
- `f=gml` and `f=application/gml+xml` query attempts still returned
  `application/geo+json`.
- F008 therefore verified GeoJSON only. Do not base the first downloader on
  GML unless a later feature establishes the exact NLS item-response syntax.

Temporary proof-of-transform:

- A proof CSV was generated only under `/tmp/f008-nimisto-probe.*` and removed
  after the probe.
- The proof wrote 5 rows with:

  ```text
  id,source,layer,name,lat,lon,addendum_json_nls
  ```

- Validation passed: `id`, `name`, `lat`, and `lon` were non-empty;
  `source=nls`; `layer=venue`; `lat`/`lon` were numeric WGS84 ranges from
  default GeoJSON `[lon, lat]`; and each `addendum_json_nls` value parsed as
  JSON containing original NLS ids, classification/status/language metadata,
  source collection, and CRS note.

All downloaded bodies, headers, metrics, and the generated proof CSV were kept
outside the repository and cleaned up after recording these sanitized facts.

## Historical Keyless Probe

Observed on 2026-05-30:

- No `NLS_API_KEY` was available in the Codex environment.
- `secondary/pelias/.env` was absent, so no ignored stack-local environment
  file was read.
- Keyless metadata and item requests were rejected as expected:

  ```bash
  curl -sSI \
    "https://avoin-paikkatieto.maanmittauslaitos.fi/geographic-names/features/v1/collections"

  curl -sSI \
    "https://avoin-paikkatieto.maanmittauslaitos.fi/geographic-names/features/v1/collections/placenames/items?limit=1"
  ```

  Both returned HTTP `401 Unauthorized` with:

  ```text
  WWW-Authenticate: Basic realm="API-key required to access"
  Content-Length: 0
  ```

Because the official OGC endpoint rejects keyless requests, no GeoJSON or GML
sample was downloaded and no proof-of-transform CSV was generated in F007.
F008 closed that blocker with the key-backed results above.

To rerun a bounded smoke probe, keep every body and header outside the repo and
prefer a private curl config so the key is not expanded into process arguments:

```bash
set +x
umask 077
probe="$(mktemp -d /tmp/f008-nimisto-probe.XXXXXX)"
mkdir -p "$probe/source" "$probe/work" "$probe/derived"

base="https://avoin-paikkatieto.maanmittauslaitos.fi/geographic-names/features/v1"
curl_cfg="$probe/curl-basic.conf"
printf 'user = "%s:"\n' "$NLS_API_KEY" > "$curl_cfg"
chmod 600 "$curl_cfg"

sample="$probe/source/placenames_simple-helsinki.geojson"
curl -fsS --config "$curl_cfg" \
  -H "Accept: application/geo+json" \
  "$base/collections/placenames_simple/items?bbox=24.92,60.16,24.97,60.19&limit=20" \
  -o "$sample"
```

If the Helsinki bbox returns zero features, use another small Finnish bbox or
an official property-filter example such as `municipality=837` with a spelling
prefix. Do not fetch all pages or whole-country GML during a probe.

Record only sanitized facts:

```bash
wc -c "$sample"
jq -r '.type, (.features | length)' "$sample"
jq '[.links[]? | {rel, type, title_present: (.title != null), href_present: (.href != null)}]' "$sample"
jq '[.features[].properties | keys] | add | unique' "$sample"
jq '[.features[].geometry.type] | unique' "$sample"
```

Each rerun should confirm:

- HTTP status, content type, byte size, feature count, and pagination links.
- Collection id, feature ids, geometry type, and coordinate order.
- Default CRS84 lon-lat behavior and the effect of requesting EPSG:3067.
- Field names for spelling, language, place/name identifiers, place type,
  municipality, region, status, scale relevance, and location.
- Whether the observed `placenames_simple` and `placenames` field shapes still
  match the F008 recommendation.

## Field And CRS Notes

Public NLS documentation says the geographic names products are based on the
NLS Place Name Register. Place names can be Finnish, Swedish, Northern Sami,
Inari Sami, or Skolt Sami. Named places and place names have persistent
identifiers.

Fields to preserve from `placenames_simple` when present:

- `feature.id`
- `placeNameId`
- `placeNameVersionId`
- `placeId`
- `placeVersionId`
- `spelling`
- `language`
- `languageOfficiality`
- `languageDominance`
- `placeNameSource`
- `placeNameStatus`
- `placeType`
- `placeTypeCategory`
- `placeTypeGroup`
- `placeTypeSubgroup`
- `placeTypeDescription`
- `placeElevation`
- `municipality`
- `subregion`
- `region`
- `scaleRelevance`
- `gslsMapSheet`
- `tm35MapSheet`
- `rescueGridSquare`
- source create/update/delete timestamps, if present

Use the GeoJSON coordinate array as `[lon, lat]` only when the response uses
the default CRS84 / WGS84 geometry. If the response includes EPSG:3067
coordinates, treat them as projected coordinates and transform them before
writing CSV.

Do not write raw EPSG:3067 easting/northing values into Pelias `lon` and `lat`.

The F008 sample did not include source URI or permanent URI properties. Add
them to `addendum_json_nls` only if a future response or product version
actually provides them.

## Pelias CSV Transform Plan

Use the existing stack path convention:

```text
${PELIAS_FINNISH_DATA_PATH}/
  source/nls/paikannimet/
  work/
  derived/pelias-csv/
```

The future downloader should stage raw provider files under:

```text
${PELIAS_FINNISH_DATA_PATH}/source/nls/paikannimet/
```

The future transformer should write any temporary normalized files under:

```text
${PELIAS_FINNISH_DATA_PATH}/work/
```

The final Pelias-ready CSV belongs under:

```text
${PELIAS_CSV_DATA_PATH}/paikannimet.csv
```

Minimum CSV columns:

```text
id,source,layer,name,lat,lon
```

Recommended first NLS CSV shape:

```text
id,source,layer,name,lat,lon,name_fi,name_sv,name_se,name_smn,name_sms,addendum_json_nls
```

Column rules:

- `id`: stable NLS `placeNameId` if it is unique per output row. Prefix only if
  the sample shows collisions across products.
- `source`: `nls`.
- `layer`: `venue` for the first pass. Later `placeType` mapping can promote
  selected records to administrative or other layers only after search-quality
  testing and admin hierarchy handling.
- `name`: checked spelling in the row's primary language. Prefer the language
  dominance / officiality fields when choosing between names for the same
  place in a later grouped transform.
- `lat` and `lon`: WGS84 decimal coordinates. For default GeoJSON, read
  `[lon, lat]` from `geometry.coordinates`.
- `name_fi`, `name_sv`, `name_se`, `name_smn`, `name_sms`: write language
  columns where the source provides corresponding names. In the simple-source
  path, group rows by `placeId` when generating these columns. Use the ISO
  639-1 style code `se` for Northern Sami, and ISO 639-3 codes `smn` and
  `sms` for Inari Sami and Skolt Sami because no ISO 639-1 codes exist for
  them.
- `name_json` or `name_json_$lang`: emit only when sample evidence shows
  aliases should be preserved as arrays. Full `placenames` exposes
  `parallelName` arrays for this, while `placenames_simple` is enough for a
  flat first import.
- `parent_json`: omit initially unless municipality and region codes can be
  mapped cleanly to supported Pelias parent fields with valid `id` and `name`
  values. Do not stuff raw unmapped codes into `parent_json`.
- `addendum_json_nls`: JSON object containing original NLS identifiers,
  classification, status, language metadata, scale relevance, source URI,
  update time, and source collection.

The profiled `csv-import` service already reads CSV files from
`PELIAS_CSV_DATA_PATH`. After a future transformer writes `paikannimet.csv`,
operators can select it with:

```dotenv
PELIAS_CSV_IMPORT_FILES=paikannimet.csv
```

Then run the existing custom-data flow from `secondary/pelias/`:

```bash
docker compose --profile tools run --rm config-render
docker compose --profile custom-data run --rm csv-import
docker compose up -d api
```

Do not point `PELIAS_CSV_DOWNLOAD_URLS` at NLS GeoJSON, GML, Atom feeds, `.gz`
files, or provider-native JSON. That variable is only for ready, uncompressed
Pelias-format CSV.

## Future Production Import Flow

1. Refresh NLS source docs and service messages.
2. Rerun a tiny key-backed OGC smoke probe outside the repo if the service
   version or source recommendation may have changed.
3. Use `placenames_simple` for the first flat CSV. Switch to, or additionally
   sample, full `placenames` only when the transformer will consume
   `parallelName` arrays for aliases/language grouping.
4. Implement a downloader that pages bounded OGC API Features responses into
   `${PELIAS_FINNISH_DATA_PATH}/source/nls/paikannimet/`, using Basic auth and
   an ignored secret source for `NLS_API_KEY`.
5. Implement a transformer that converts raw OGC GeoJSON to
   `${PELIAS_CSV_DATA_PATH}/paikannimet.csv`, validates required columns,
   validates WGS84 ranges, and validates all `addendum_json_nls` objects.
6. Run a small CSV import on a non-production index before a full Finland
   import.
7. Plan dedupe/ranking against OSM before exposing NLS records broadly.
8. Run the full custom CSV import and API restart only as an operator action.

## Cleanup And Secret Hygiene

- Keep `NLS_API_KEY` in the shell, ignored `.env`, or deployment secrets only.
- Use `set +x` before exporting or using API keys.
- Prefer a private curl config, or `curl -u "${NLS_API_KEY}:"` for quick local
  checks, over `api-key=` URLs.
- Do not commit downloaded `.geojson`, `.gml`, `.csv`, generated configs,
  loader logs, or transcripts.
- Remove temporary probe directories after recording sanitized facts:

  ```bash
  rm -rf "$probe"
  unset NLS_API_KEY
  ```

- If an operator points `PELIAS_FINNISH_DATA_PATH` inside `secondary/pelias/`,
  `.gitignore` already ignores `/finnish-custom/` and common raw/generated
  geospatial artifacts.

## Risks And Deferred Work

- The F008 probe covered one small Helsinki bbox. Whole-country field
  distributions, especially Sami-language coverage and uncommon place types,
  still need validation during production import.
- `placenames_simple` is sufficient for the first flat CSV import, but full
  `placenames` should be used or re-sampled when implementing alias arrays from
  `parallelName`.
- GML item response syntax was not verified by F008; the first downloader
  should stay on GeoJSON.
- Whole-country GML files are official snapshots, but they are not a small
  probe path because one file contains all Finland and the update cadence is
  lower than the OGC API.
- Layer mapping is intentionally conservative. `layer=venue` avoids premature
  administrative hierarchy assumptions, but cities, municipalities, islands,
  water bodies, terrain features, and transport places may need later mapping.
- OSM/NLS duplicate handling, ranking, and label quality are out of scope.
- Production downloader code, full Finland download, full raw-to-CSV
  transformer implementation, destructive Pelias rebuilds, `csv-import` runs,
  and live `/v1/search` tuning are deferred to later features or operator
  actions.

## Public References

- NLS Nimistö OGC API Features:
  <https://www.maanmittauslaitos.fi/nimiston-kyselypalvelu-ogc-api>
- NLS Nimistö OGC API Features technical description:
  <https://www.maanmittauslaitos.fi/nimiston-kyselypalvelu-ogc-api/tekninen-kuvaus>
- NLS Geographic names product description:
  <https://www.maanmittauslaitos.fi/en/maps-and-spatial-data/datasets-and-interfaces/product-descriptions/geographic-names>
- NLS API key instructions:
  <https://www.maanmittauslaitos.fi/en/rajapinnat/api-avaimen-ohje>
- NLS open data file updating service interface:
  <https://www.maanmittauslaitos.fi/en/e-services/open-data-file-download-service/open-data-file-updating-service-interface>
- Nimistön tietokortit field overview:
  <https://www.maanmittauslaitos.fi/asioi-verkossa/nimiston-tietokortit>
- Pelias CSV importer:
  <https://github.com/pelias/csv-importer>
