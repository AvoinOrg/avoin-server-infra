# Finnish Custom Data Extension

This stack has an extension point for later Finnish official data imports on
top of the OSM baseline. It does not download NLS or Ryhti data, transform raw
provider formats, or run a full custom import yet. Operators stage source data
under `PELIAS_FINNISH_DATA_PATH`, future transform code writes Pelias-ready CSV
under `PELIAS_CSV_DATA_PATH`, and the profile-gated `csv-import` job imports
those derived CSV files.

## Source Roles

- NLS/Maanmittauslaitos `Nimistö` place-name products, especially
  `Paikannimet` and `Paikannimet, yksinkertaistettu`, are the intended source
  for named-place search records and alternate-language names.
- Syke Ryhti completed-building address data is the intended source for
  official address strings and address identifiers.
- Ryhti completed-building records are the first coordinate source to evaluate
  for Ryhti address records. If building point coverage is insufficient, a
  later transformer can use an approved geometry supplement such as NLS
  Topographic Database / INSPIRE building geometry. This feature does not add a
  building-polygon pipeline.

Use `source=nls` for NLS place-name CSV rows and `source=ryhti` for
Ryhti-derived rows. Use `layer=address` for Ryhti address points. Use
`layer=venue` for NLS named places unless a later transformer maps a
particular `placeType` to a better Pelias layer.

For the NLS-specific source decision, API-key-safe probe commands, key-backed
probe result, and Pelias CSV transform plan, see
[NLS-NIMISTO-DATASET-IMPORT.md](NLS-NIMISTO-DATASET-IMPORT.md).

## Public References

- NLS Geographic names product description:
  <https://www.maanmittauslaitos.fi/en/maps-and-spatial-data/datasets-and-interfaces/product-descriptions/geographic-names>
- NLS `Nimistö` OGC API Features technical description:
  <https://www.maanmittauslaitos.fi/nimiston-kyselypalvelu-ogc-api/tekninen-kuvaus>
- NLS `Nimistö` import plan for this stack:
  [NLS-NIMISTO-DATASET-IMPORT.md](NLS-NIMISTO-DATASET-IMPORT.md)
- NLS `Paikannimet` attributes:
  <https://www.maanmittauslaitos.fi/sites/maanmittauslaitos.fi/files/attachments/2024/11/Nimisto_OAPIF_Luokat_ja_attribuutit_Paikannimet_1.pdf>
- NLS `Paikannimet, yksinkertaistettu` attributes:
  <https://www.maanmittauslaitos.fi/sites/maanmittauslaitos.fi/files/attachments/2024/11/Nimisto_OAPIF_Luokat_ja_attribuutit_PaikannimetYksinkertaistettu_2.pdf>
- Ryhti services for data consumers:
  <https://ryhti.syke.fi/palvelut/palvelut-tiedon-hyodyntajille/>
- Syke metadata for Ryhti building addresses:
  <https://ckan.ymparisto.fi/dataset/%7BDBD610F4-3392-44CD-B601-BAE8FA547A57%7D>
- Ryhti building/address spatial-interface content:
  <https://geoportal.ymparisto.fi/meta/julkinen/dokumentit/Ryhti_rakennustiedot.pdf>
- NLS Topographic Database GeoPackage notes:
  <https://www.maanmittauslaitos.fi/en/geopackage>
- Pelias CSV importer:
  <https://github.com/pelias/csv-importer>
- Pelias API custom sources/layers:
  <https://github.com/pelias/api>

## Source Notes

NLS place-name products contain checked place names, language codes, place
types, and point locations for all of Finland. The product description
separates place-name products from cartographic map-name products; use the
place-name products for search data because a place and its names appear once
there, while map names can repeat across map products or scales. The NLS
product page lists ETRS89 / TM35FIN (EPSG:3067) for the product, while the OGC
API Features page says GeoJSON defaults to WGS84 lon-lat (CRS84). Final Pelias
CSV must always use WGS84 decimal `lat` and `lon`.

NLS documents daily updates for the OGC API dataset and three yearly GML file
product updates in January, May, and September. The product is NLS open data
under CC BY 4.0 attribution terms. The open OGC API requires an API key, but
this stack intentionally has no NLS API-key variable until a downloader exists.
Use the NLS runbook before adding a downloader or transformer so API keys,
probe downloads, and derived CSV stay in ignored paths.

Ryhti data packages for completed buildings and their addresses are available
as CSV and JSON files compressed with `.gz`; the Ryhti service page says the
whole-country packages update weekly on Sundays. The Syke metadata page lists
the address data as vector data, gives Syke Ryhti as the attribution source,
and applies Creative Commons Attribution 4.0 to open data. It also documents
quality/currency limitations and says the building, property, and apartment
data must not be used for person-related decision-making except as separately
explained in the metadata. This Pelias extension is only for search/geocoding
convenience.

Ryhti address records expose `building_key` but no independent point geometry
in the documented address field list. Future transform work must join address
records to building/location records, or to an approved geometry supplement,
before writing Pelias `lat` and `lon`.

## Fields To Preserve

For NLS name records, preserve at least these source fields in
`addendum_json_nls`:

- `placeNameId`
- `placeId`
- `spelling`
- `language`
- `placeType`
- `placeLocation`
- `municipality`
- `region`
- `scaleRelevance`
- `placeNameStatus`

For Ryhti address records, preserve at least these source fields in
`addendum_json_ryhti`:

- `building_key`
- `id`
- `address_name_fin`
- `address_name_swe`
- `number_part_of_address_number`
- `number_part_of_address_number2`
- `subdivision_letter_of_address_number`
- `subdivision_letter_of_address_number2`
- `postal_code`
- `postal_office_fin`
- `postal_office_swe`
- `address_fin`
- `address_swe`
- `location_srid`
- `modified_timestamp_utc`

For Ryhti building/location context, preserve the join key and these fields
when available:

- `building_key`
- `permanent_building_identifier`
- `point_location_srid`
- `point_location_geometry_data`
- `municipality_number`

## Staging Layout

Keep raw and generated data outside tracked repo files. With the template
defaults:

```text
/srv/pelias/finnish-custom/
  source/
    nls/paikannimet/
    ryhti/buildings/
    ryhti/addresses/
  derived/
    pelias-csv/
  work/
```

The same layout can be used under another absolute `PELIAS_FINNISH_DATA_PATH`.
If an operator points it inside `secondary/pelias/`, `.gitignore` ignores
`/finnish-custom/` and common raw/generated geospatial artifacts.

## Pelias CSV Target

Derived files in `${PELIAS_CSV_DATA_PATH}` should be ready for Pelias
`csv-importer`; raw NLS/Ryhti `.gz`, GML, GeoJSON, or provider-native JSON do
not belong in `PELIAS_CSV_IMPORT_FILES`.

Name records should include at least:

```text
id,source,layer,name,lat,lon
```

Use `name_fi`, `name_sv`, or other `name_$lang` columns when useful. Put NLS
identifier and classification metadata in `addendum_json_nls`.

Address records should include at least:

```text
id,source,layer,name,lat,lon,street,housenumber,postcode
```

For Ryhti addresses, write `layer=address`, derive `street` from
`address_name_fin` or `address_name_swe`, derive `housenumber` from the number
and subdivision fields, and preserve original address/building metadata in
`addendum_json_ryhti`.

`PELIAS_CSV_IMPORT_FILES` is a comma-separated list of filenames inside
`${PELIAS_CSV_DATA_PATH}`, for example:

```dotenv
PELIAS_CSV_IMPORT_FILES=paikannimet.csv,addresses.csv
```

Blank means the generated config renders `imports.csv.files=[]`, and the CSV
importer imports all `.csv` files in the configured data path. If
`PELIAS_CSV_DOWNLOAD_URLS` is set, each URL must point to ready,
uncompressed Pelias-format CSV. The Pelias CSV downloader does not consume raw
provider `.gz`, GML, GeoJSON, or JSON files.

## Operator Flow

1. Stage raw official data under `${PELIAS_FINNISH_DATA_PATH}/source/...`.
2. Run a future transformer outside this repo-local stack. Its output should
   be Pelias-ready CSV under `${PELIAS_CSV_DATA_PATH}`, typically
   `paikannimet.csv` and `addresses.csv`.
3. Set `PELIAS_CSV_IMPORT_FILES` if importing only named files.
4. Re-render the generated config:

   ```bash
   docker compose --profile tools run --rm config-render
   ```

5. Ensure Elasticsearch is running and the Pelias index mapping exists.
6. Run the custom-data import only after derived CSV files exist:

   ```bash
   docker compose --profile custom-data run --rm csv-import
   ```

7. Restart the API so auto-discovered sources/layers include the imported CSV
   records:

   ```bash
   docker compose up -d api
   ```

## Deferred Work

- Downloaders for NLS or Ryhti source data.
- Raw-source-to-Pelias-CSV transformation code.
- CRS conversion and address-to-building coordinate resolution.
- Dedupe/ranking between OSM, NLS names, and Ryhti addresses.
- Full Finland CSV import, OSM rebuild, and live search-quality verification.
