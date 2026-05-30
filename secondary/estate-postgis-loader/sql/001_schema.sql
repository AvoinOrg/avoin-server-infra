\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS estate;
CREATE SCHEMA IF NOT EXISTS estate_staging;

CREATE TABLE IF NOT EXISTS estate.source_metadata (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  dataset_name text NOT NULL,
  product_url text NOT NULL,
  license text NOT NULL,
  attribution text NOT NULL,
  acquisition_method text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  nls_delivery_or_order_time text,
  registry_state_date date,
  registry_state_current boolean,
  source_format text NOT NULL,
  source_crs text NOT NULL,
  source_filename text,
  source_job_id text,
  source_sha256 text,
  source_file_size_bytes bigint,
  raw_feature_count bigint,
  parcel_row_count bigint,
  estate_row_count bigint,
  notes text,
  loaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS estate.cadastral_parcels (
  parcel_id bigserial PRIMARY KEY,
  source_metadata_id bigint NOT NULL REFERENCES estate.source_metadata(id),
  source_layer text NOT NULL,
  source_feature_id text,
  estate_id_compact text NOT NULL,
  estate_id_normalized text NOT NULL,
  estate_id_display text,
  municipality_code text NOT NULL,
  register_unit_code text NOT NULL,
  block_code text NOT NULL,
  parcel_code text NOT NULL,
  part_number integer NOT NULL,
  part_count integer NOT NULL,
  source_properties jsonb NOT NULL,
  geom geometry(MultiPolygon, 3067) NOT NULL,
  label_point geometry(Point, 3067),
  loaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cadastral_parcels_compact_format_chk
    CHECK (estate_id_compact ~ '^[0-9]{14}$'),
  CONSTRAINT cadastral_parcels_normalized_format_chk
    CHECK (estate_id_normalized ~ '^[0-9]{3}-[0-9]+-[0-9]+-[0-9]+$'),
  CONSTRAINT cadastral_parcels_municipality_format_chk
    CHECK (municipality_code ~ '^[0-9]{3}$'),
  CONSTRAINT cadastral_parcels_part_number_chk
    CHECK (part_number >= 1),
  CONSTRAINT cadastral_parcels_part_count_chk
    CHECK (part_count >= part_number)
);

CREATE TABLE IF NOT EXISTS estate.cadastral_estates (
  estate_id_compact text NOT NULL,
  estate_id_normalized text NOT NULL,
  estate_id_display text,
  municipality_code text NOT NULL,
  register_unit_code text NOT NULL,
  block_code text NOT NULL,
  parcel_code text NOT NULL,
  part_count integer NOT NULL,
  source_metadata_id bigint NOT NULL REFERENCES estate.source_metadata(id),
  geom geometry(MultiPolygon, 3067) NOT NULL,
  label_point geometry(Point, 3067) NOT NULL,
  source_freshness_at timestamptz,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cadastral_estates_compact_format_chk
    CHECK (estate_id_compact ~ '^[0-9]{14}$'),
  CONSTRAINT cadastral_estates_normalized_format_chk
    CHECK (estate_id_normalized ~ '^[0-9]{3}-[0-9]+-[0-9]+-[0-9]+$'),
  CONSTRAINT cadastral_estates_municipality_format_chk
    CHECK (municipality_code ~ '^[0-9]{3}$'),
  CONSTRAINT cadastral_estates_part_count_chk
    CHECK (part_count >= 1)
);
