\set ON_ERROR_STOP on

CREATE UNIQUE INDEX IF NOT EXISTS cadastral_estates_compact_uidx
  ON estate.cadastral_estates (estate_id_compact);

CREATE UNIQUE INDEX IF NOT EXISTS cadastral_estates_normalized_uidx
  ON estate.cadastral_estates (estate_id_normalized);

CREATE INDEX IF NOT EXISTS cadastral_estates_municipality_idx
  ON estate.cadastral_estates (municipality_code);

CREATE INDEX IF NOT EXISTS cadastral_estates_compact_prefix_idx
  ON estate.cadastral_estates (estate_id_compact text_pattern_ops);

CREATE INDEX IF NOT EXISTS cadastral_estates_normalized_prefix_idx
  ON estate.cadastral_estates (estate_id_normalized text_pattern_ops);

CREATE INDEX IF NOT EXISTS cadastral_parcels_estate_part_idx
  ON estate.cadastral_parcels (estate_id_compact, part_number);

CREATE INDEX IF NOT EXISTS cadastral_parcels_geom_gix
  ON estate.cadastral_parcels USING gist (geom);

CREATE INDEX IF NOT EXISTS cadastral_estates_geom_gix
  ON estate.cadastral_estates USING gist (geom);

CREATE INDEX IF NOT EXISTS cadastral_parcels_municipality_idx
  ON estate.cadastral_parcels (municipality_code);

ANALYZE estate.source_metadata;
ANALYZE estate.cadastral_parcels;
ANALYZE estate.cadastral_estates;
