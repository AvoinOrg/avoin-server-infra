#!/bin/sh
set -eu

. "$(dirname "$0")/common.sh"

require_source_env

if [ ! -f "$SOURCE_FILE" ]; then
  echo "Source file is missing inside the container: $SOURCE_FILE" >&2
  echo "Stage the NLS/MML GeoPackage below ESTATE_DATA_PATH/source and update SOURCE_FILE if needed." >&2
  exit 3
fi

echo "Source filename: $(source_filename)"
echo "Source size bytes: $(source_size_bytes)"
echo "Source SHA-256: $(source_sha256)"
echo
echo "Available layers:"
ogrinfo -ro -so "$SOURCE_FILE"
echo
echo "Configured parcel layer summary:"
ogrinfo -ro -so "$SOURCE_FILE" "$SOURCE_PARCEL_LAYER"
