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
  (`Paikannimet, yksinkertaistettu`) as GeoJSON.
- Use `placenames` (`Paikannimet`) only when a key-backed sample proves that
  its parallel-name structure is needed for search aliases or language-quality
  improvements.

This is the right first source because `Paikannimet, yksinkertaistettu`
represents each place name without the nested parallel-name complexity of full
`Paikannimet`, while still carrying the checked spelling, language, named-place
identifier, place type, municipality/region context, status, scale relevance,
and point location needed for initial Pelias CSV rows.

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
export NLS_API_KEY="<provided through an ignored secret channel>"
curl -fsS -u "${NLS_API_KEY}:" \
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
- The OGC service also supports GML responses and CRS parameters such as
  `bbox-crs` and `crs`.
- The product metadata reference system is ETRS89 / TM35FIN (EPSG:3067), but
  default OGC GeoJSON responses are WGS84 lon-lat. Final Pelias CSV must always
  use WGS84 decimal `lat` and `lon`.
- If a future downloader requests `crs=http://www.opengis.net/def/crs/EPSG/0/3067`,
  it must transform coordinates back to WGS84 before writing Pelias CSV.

No `NLS_API_KEY` was added to `.env.template` in this feature. There is no
tracked downloader or transformer consuming it yet; examples use a local shell
variable only.

## Probe Result

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
sample was downloaded and no proof-of-transform CSV was generated in this pass.
The non-secret input needed to complete the sample probe is an NLS API key made
available only as `NLS_API_KEY` in the operator shell, ignored `.env`, or the
deployment platform's secret mechanism.

When a key is available, run the bounded probe outside the repo:

```bash
set +x
probe="$(mktemp -d /tmp/f007-nimisto-probe.XXXXXX)"
mkdir -p \
  "$probe/source/nls/paikannimet" \
  "$probe/derived/pelias-csv" \
  "$probe/work"

base="https://avoin-paikkatieto.maanmittauslaitos.fi/geographic-names/features/v1"
sample="$probe/source/nls/paikannimet/placenames_simple-helsinki.geojson"

curl -fsS -u "${NLS_API_KEY}:" \
  -H "Accept: application/geo+json" \
  "$base/collections/placenames_simple/items?bbox=24.92,60.16,24.97,60.19&limit=20" \
  -o "$sample"

gml_sample="$probe/source/nls/paikannimet/placenames_simple-helsinki.gml"
curl -fsS -u "${NLS_API_KEY}:" \
  -H "Accept: application/gml+xml" \
  "$base/collections/placenames_simple/items.gml?bbox=24.92,60.16,24.97,60.19&limit=20" \
  -o "$gml_sample"
```

If the Helsinki bbox returns zero features, use another small Finnish bbox or
an official property-filter example such as `municipality=837` with a spelling
prefix. Do not fetch all pages or whole-country GML during a probe.

Record only sanitized facts:

```bash
wc -c "$sample"
jq -r '.type, (.features | length)' "$sample"
jq '.links // []' "$sample"
jq '.features[0] | {id, geometry, properties}' "$sample"
jq '[.features[].properties | keys] | add | unique' "$sample"
```

The key-backed probe must confirm:

- HTTP status, content type, byte size, feature count, and pagination links.
- Collection id, feature ids, geometry type, and coordinate order.
- Default CRS84 lon-lat behavior and the effect of requesting EPSG:3067.
- Field names for spelling, language, place/name identifiers, place type,
  municipality, region, status, scale relevance, and location.
- Whether `placenames_simple` carries enough data for the first import, or
  whether full `placenames` should be used to preserve parallel-name aliases.

## Field And CRS Notes

Public NLS documentation says the geographic names products are based on the
NLS Place Name Register. Place names can be Finnish, Swedish, Northern Sami,
Inari Sami, or Skolt Sami. Named places and place names have persistent
identifiers.

Fields to preserve from `placenames_simple` when present:

- `placeNameId`
- `placeId`
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
- `placeLocation`
- `municipality`
- `subRegion`
- `region`
- `scaleRelevance`
- source URI / permanent URI fields, if present
- source create/update timestamps, if present

Use the GeoJSON coordinate array as `[lon, lat]` only when the response uses
the default CRS84 / WGS84 geometry. If the response includes EPSG:3067
coordinates, treat them as projected coordinates and transform them before
writing CSV.

Do not write raw EPSG:3067 easting/northing values into Pelias `lon` and `lat`.

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
  columns where the source provides corresponding names. Use the ISO 639-1
  style code `se` for Northern Sami, and ISO 639-3 codes `smn` and `sms` for
  Inari Sami and Skolt Sami because no ISO 639-1 codes exist for them.
- `name_json` or `name_json_$lang`: emit only when sample evidence shows
  aliases should be preserved as arrays, especially if the full `placenames`
  product is selected later.
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
2. Create a temporary key-backed OGC probe outside the repo and record
   sanitized field/CRS evidence.
3. Choose `placenames_simple` unless the probe shows full `placenames` is
   needed for aliases or parallel-name relationships.
4. Implement a downloader that pages bounded OGC API Features responses into
   `${PELIAS_FINNISH_DATA_PATH}/source/nls/paikannimet/`, using Basic auth and
   an ignored secret source for `NLS_API_KEY`.
5. Implement a transformer that converts raw OGC GeoJSON/GML to
   `${PELIAS_CSV_DATA_PATH}/paikannimet.csv`, validates required columns,
   validates WGS84 ranges, and validates all `addendum_json_nls` objects.
6. Run a small CSV import on a non-production index before a full Finland
   import.
7. Plan dedupe/ranking against OSM before exposing NLS records broadly.
8. Run the full custom CSV import and API restart only as an operator action.

## Cleanup And Secret Hygiene

- Keep `NLS_API_KEY` in the shell, ignored `.env`, or deployment secrets only.
- Use `set +x` before exporting or using API keys.
- Prefer `curl -u "${NLS_API_KEY}:"` over `api-key=` URLs.
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

- Actual sample inspection is blocked until an NLS API key is supplied through
  a non-tracked channel.
- `placenames_simple` is the documented first source, but a key-backed probe
  still needs to verify whether full `placenames` is needed for alias quality.
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
