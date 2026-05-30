#!/bin/sh
set -eu

. "$(dirname "$0")/common.sh"

require_database_env

if [ -n "${VERIFY_OUTPUT_PATH:-}" ]; then
  mkdir -p "$(dirname "$VERIFY_OUTPUT_PATH")"
  psql_target -f sql/004_verify.sql | tee "$VERIFY_OUTPUT_PATH"
else
  psql_target -f sql/004_verify.sql
fi
