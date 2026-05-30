\set ON_ERROR_STOP on
\pset pager off

\echo '== Database And PostGIS =='
SELECT current_database() AS database_name;
SELECT postgis_full_version() AS postgis_full_version;

\echo '== Estate Tables =='
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'estate'
ORDER BY table_name;

\echo '== Latest Source Metadata Counts =='
SELECT
  source_filename,
  source_file_size_bytes,
  source_sha256,
  raw_feature_count,
  parcel_row_count,
  estate_row_count
FROM estate.source_metadata
ORDER BY id DESC
LIMIT 1;

\echo '== Public Table Counts =='
SELECT count(*) AS parcel_rows
FROM estate.cadastral_parcels;

SELECT count(*) AS estate_rows
FROM estate.cadastral_estates;

SELECT count(distinct estate_id_compact) AS distinct_estates
FROM estate.cadastral_parcels;

\echo '== ID And Required Field Validation =='
SELECT count(*) AS bad_compact_ids
FROM estate.cadastral_estates
WHERE estate_id_compact !~ '^[0-9]{14}$';

SELECT count(*) AS bad_normalized_ids
FROM estate.cadastral_estates
WHERE estate_id_normalized !~ '^[0-9]{3}-[0-9]+-[0-9]+-[0-9]+$';

SELECT count(*) AS missing_required_values
FROM estate.cadastral_parcels
WHERE estate_id_compact IS NULL
   OR estate_id_normalized IS NULL
   OR municipality_code IS NULL
   OR register_unit_code IS NULL
   OR block_code IS NULL
   OR parcel_code IS NULL
   OR source_properties IS NULL
   OR geom IS NULL;

\echo '== Geometry Validation =='
SELECT ST_SRID(geom) AS srid, count(*)
FROM estate.cadastral_parcels
GROUP BY ST_SRID(geom)
ORDER BY srid;

SELECT GeometryType(geom) AS geom_type, count(*)
FROM estate.cadastral_parcels
GROUP BY GeometryType(geom)
ORDER BY geom_type;

SELECT count(*) AS invalid_parcel_geometries
FROM estate.cadastral_parcels
WHERE NOT ST_IsValid(geom);

SELECT ST_SRID(geom) AS srid, count(*)
FROM estate.cadastral_estates
GROUP BY ST_SRID(geom)
ORDER BY srid;

SELECT GeometryType(geom) AS geom_type, count(*)
FROM estate.cadastral_estates
GROUP BY GeometryType(geom)
ORDER BY geom_type;

SELECT count(*) AS invalid_estate_geometries
FROM estate.cadastral_estates
WHERE NOT ST_IsValid(geom);

SELECT count(*) AS missing_estate_label_points
FROM estate.cadastral_estates
WHERE label_point IS NULL;

\echo '== Required Indexes =='
WITH required(indexname) AS (
  VALUES
    ('cadastral_estates_compact_uidx'),
    ('cadastral_estates_normalized_uidx'),
    ('cadastral_estates_municipality_idx'),
    ('cadastral_estates_compact_prefix_idx'),
    ('cadastral_estates_normalized_prefix_idx'),
    ('cadastral_parcels_estate_part_idx'),
    ('cadastral_parcels_geom_gix'),
    ('cadastral_estates_geom_gix')
),
present AS (
  SELECT indexname
  FROM pg_indexes
  WHERE schemaname = 'estate'
    AND tablename IN ('cadastral_parcels', 'cadastral_estates')
)
SELECT required.indexname, present.indexname IS NOT NULL AS exists
FROM required
LEFT JOIN present USING (indexname)
ORDER BY required.indexname;

\echo '== Metadata Completeness =='
SELECT
  provider,
  dataset_name,
  license,
  attribution,
  acquisition_method,
  retrieved_at,
  nls_delivery_or_order_time,
  registry_state_date,
  registry_state_current,
  source_format,
  source_crs,
  source_filename,
  source_job_id,
  source_sha256,
  source_file_size_bytes,
  raw_feature_count,
  parcel_row_count,
  estate_row_count,
  notes
FROM estate.source_metadata
ORDER BY id DESC
LIMIT 1;

WITH latest AS (
  SELECT *
  FROM estate.source_metadata
  ORDER BY id DESC
  LIMIT 1
)
SELECT
  count(*) FILTER (
    WHERE provider IS NULL
       OR dataset_name IS NULL
       OR license IS NULL
       OR attribution IS NULL
       OR acquisition_method IS NULL
       OR retrieved_at IS NULL
       OR source_format IS NULL
       OR source_crs IS NULL
       OR raw_feature_count IS NULL
       OR parcel_row_count IS NULL
       OR estate_row_count IS NULL
  ) AS incomplete_latest_metadata_rows
FROM latest;

\echo '== F003.1 Sample Lookup =='
SELECT
  estate_id_compact,
  estate_id_normalized,
  part_count,
  ST_SRID(geom) AS geom_srid,
  GeometryType(geom) AS geom_type,
  ST_AsText(ST_Envelope(geom)) AS bbox_wkt
FROM estate.cadastral_estates
WHERE estate_id_compact = '17440100030006'
   OR estate_id_normalized = '174-401-3-6';

\echo '== Fallback Sample Lookup If F003.1 Sample Is Absent =='
SELECT
  estate_id_compact,
  estate_id_normalized,
  part_count,
  ST_SRID(geom) AS geom_srid,
  GeometryType(geom) AS geom_type,
  ST_AsText(ST_Envelope(geom)) AS bbox_wkt
FROM estate.cadastral_estates
ORDER BY estate_id_compact
LIMIT 1;
