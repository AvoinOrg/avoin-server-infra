#!/bin/sh
set -eu

. "$(dirname "$0")/common.sh"

require_database_env
require_source_env
require_metadata_env

if [ ! -f "$SOURCE_FILE" ]; then
  echo "Source file is missing inside the container: $SOURCE_FILE" >&2
  exit 3
fi

command -v ogr2ogr >/dev/null 2>&1 || {
  echo "ogr2ogr is not available in the tools image." >&2
  exit 4
}

command -v psql >/dev/null 2>&1 || {
  echo "psql is not available in the tools image." >&2
  exit 4
}

SOURCE_FILENAME="${SOURCE_FILENAME:-$(source_filename)}"
SOURCE_FILE_SIZE_BYTES="${SOURCE_FILE_SIZE_BYTES:-$(source_size_bytes)}"
SOURCE_SHA256="${SOURCE_SHA256:-$(source_sha256)}"
SOURCE_RETRIEVED_AT="${SOURCE_RETRIEVED_AT:-$(date -u '+%Y-%m-%dT%H:%M:%SZ')}"
SOURCE_ESTATE_DISPLAY_FIELD="${SOURCE_ESTATE_DISPLAY_FIELD:-}"
SOURCE_FEATURE_ID_FIELD="${SOURCE_FEATURE_ID_FIELD:-}"
SOURCE_JOB_ID="${SOURCE_JOB_ID:-}"
NLS_DELIVERY_OR_ORDER_TIME="${NLS_DELIVERY_OR_ORDER_TIME:-}"
SOURCE_REGISTRY_STATE_DATE="${SOURCE_REGISTRY_STATE_DATE:-}"
SOURCE_REGISTRY_STATE_CURRENT="${SOURCE_REGISTRY_STATE_CURRENT:-}"

database_name="$(psql_target -Atc "select current_database();")"
if [ "$database_name" != "geocoding-finland" ]; then
  echo "Refusing to import into unexpected database: $database_name" >&2
  exit 2
fi

psql_target -f sql/001_schema.sql

echo "Loading configured source layer into estate_staging.raw_parcels."
PGDATABASE="$POSTGIS_DB" ogr2ogr \
  -f PostgreSQL "PG:dbname=${POSTGIS_DB}" \
  "$SOURCE_FILE" "$SOURCE_PARCEL_LAYER" \
  -overwrite \
  -nln estate_staging.raw_parcels \
  -lco GEOMETRY_NAME=geom \
  -lco FID=fid \
  -lco LAUNDER=NO \
  -nlt PROMOTE_TO_MULTI \
  -t_srs EPSG:3067

echo "Raw staging rows:"
psql_target -Atc "select count(*) from estate_staging.raw_parcels;"

echo "Transforming source rows into estate contract tables."
psql_target \
  -v SOURCE_LAYER="$SOURCE_PARCEL_LAYER" \
  -v SOURCE_ESTATE_ID_FIELD="$SOURCE_ESTATE_ID_FIELD" \
  -v SOURCE_ESTATE_DISPLAY_FIELD="$SOURCE_ESTATE_DISPLAY_FIELD" \
  -v SOURCE_FEATURE_ID_FIELD="$SOURCE_FEATURE_ID_FIELD" \
  -v SOURCE_PROVIDER="$SOURCE_PROVIDER" \
  -v SOURCE_DATASET_NAME="$SOURCE_DATASET_NAME" \
  -v SOURCE_PRODUCT_URL="$SOURCE_PRODUCT_URL" \
  -v SOURCE_LICENSE="$SOURCE_LICENSE" \
  -v SOURCE_ATTRIBUTION="$SOURCE_ATTRIBUTION" \
  -v SOURCE_ACQUISITION_METHOD="$SOURCE_ACQUISITION_METHOD" \
  -v SOURCE_RETRIEVED_AT="$SOURCE_RETRIEVED_AT" \
  -v NLS_DELIVERY_OR_ORDER_TIME="$NLS_DELIVERY_OR_ORDER_TIME" \
  -v SOURCE_REGISTRY_STATE_DATE="$SOURCE_REGISTRY_STATE_DATE" \
  -v SOURCE_REGISTRY_STATE_CURRENT="$SOURCE_REGISTRY_STATE_CURRENT" \
  -v SOURCE_FORMAT="$SOURCE_FORMAT" \
  -v SOURCE_CRS="$SOURCE_CRS" \
  -v SOURCE_FILENAME="$SOURCE_FILENAME" \
  -v SOURCE_JOB_ID="$SOURCE_JOB_ID" \
  -v SOURCE_SHA256="$SOURCE_SHA256" \
  -v SOURCE_FILE_SIZE_BYTES="$SOURCE_FILE_SIZE_BYTES" \
  -f sql/002_transform.sql

echo "Creating indexes and analyzing estate tables."
psql_target -f sql/003_indexes.sql

echo "Import complete. Run verify-estates for sanitized verification output."
