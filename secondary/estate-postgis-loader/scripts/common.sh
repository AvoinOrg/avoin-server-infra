#!/bin/sh
set -eu

required_var() {
  name="$1"
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "Missing required environment variable: $name" >&2
    exit 2
  fi
}

require_target_database() {
  required_var POSTGIS_DB
  required_var ESTATE_LOADER_CONFIRM_DB

  if [ "$POSTGIS_DB" != "geocoding-finland" ] \
    || [ "$ESTATE_LOADER_CONFIRM_DB" != "geocoding-finland" ]; then
    echo "Refusing to run: POSTGIS_DB and ESTATE_LOADER_CONFIRM_DB must both equal geocoding-finland." >&2
    exit 2
  fi
}

require_database_env() {
  required_var POSTGIS_HOST
  required_var POSTGIS_PORT
  required_var POSTGIS_ADMIN_DB
  required_var POSTGIS_USER
  required_var POSTGIS_PASSWORD
  required_var PGCONNECT_TIMEOUT
  require_target_database

  export PGHOST="$POSTGIS_HOST"
  export PGPORT="$POSTGIS_PORT"
  export PGUSER="$POSTGIS_USER"
  export PGPASSWORD="$POSTGIS_PASSWORD"
  export PGCONNECT_TIMEOUT
}

require_source_env() {
  required_var SOURCE_FILE
  required_var SOURCE_PARCEL_LAYER
  required_var SOURCE_ESTATE_ID_FIELD
  required_var SOURCE_FORMAT
  required_var SOURCE_CRS
}

require_metadata_env() {
  required_var SOURCE_PROVIDER
  required_var SOURCE_DATASET_NAME
  required_var SOURCE_PRODUCT_URL
  required_var SOURCE_LICENSE
  required_var SOURCE_ATTRIBUTION
  required_var SOURCE_ACQUISITION_METHOD
}

psql_admin() {
  PGDATABASE="$POSTGIS_ADMIN_DB" psql -X -v ON_ERROR_STOP=1 -P pager=off "$@"
}

psql_target() {
  PGDATABASE="$POSTGIS_DB" psql -X -v ON_ERROR_STOP=1 -P pager=off "$@"
}

source_filename() {
  basename "$SOURCE_FILE"
}

source_size_bytes() {
  wc -c < "$SOURCE_FILE" | tr -d ' '
}

source_sha256() {
  sha256sum "$SOURCE_FILE" | awk '{print $1}'
}
