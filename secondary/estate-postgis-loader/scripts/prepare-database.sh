#!/bin/sh
set -eu

. "$(dirname "$0")/common.sh"

require_database_env

echo "Checking maintenance database connection; connection details are suppressed."
psql_admin -Atc "select 'ok';" >/dev/null

echo "Ensuring target database exists: geocoding-finland"
psql_admin <<'SQL'
SELECT format('CREATE DATABASE %I', 'geocoding-finland')
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_database
  WHERE datname = 'geocoding-finland'
)\gexec
SQL

echo "Installing/verifying PostGIS and estate schema in geocoding-finland."
psql_target -f sql/001_schema.sql

echo "Database check:"
psql_target -Atc "select current_database();"
echo "PostGIS check:"
psql_target -Atc "select postgis_full_version();"
