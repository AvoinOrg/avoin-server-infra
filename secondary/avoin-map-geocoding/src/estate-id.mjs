function stripTrailingAnnotations(value) {
  let next = value.trim();
  let previous;

  do {
    previous = next;
    next = next.replace(/\s*(?:\([^()]*\)|\[[^\[\]]*\])\s*$/, "").trim();
  } while (next !== previous);

  return next;
}

function stripLeadingZeros(value) {
  const stripped = value.replace(/^0+/, "");
  return stripped === "" ? "0" : stripped;
}

function normalizeHyphenated(parts) {
  const [municipality, registerUnit, block, parcel] = parts;
  return [
    municipality.padStart(3, "0"),
    stripLeadingZeros(registerUnit),
    stripLeadingZeros(block),
    stripLeadingZeros(parcel),
  ].join("-");
}

function compactFromNormalized(normalizedEstateId) {
  const [municipality, registerUnit, block, parcel] = normalizedEstateId.split("-");
  if (municipality.length > 3 || registerUnit.length > 3 || block.length > 4 || parcel.length > 4) {
    return null;
  }

  return [
    municipality.padStart(3, "0"),
    registerUnit.padStart(3, "0"),
    block.padStart(4, "0"),
    parcel.padStart(4, "0"),
  ].join("");
}

export function classifyEstateIdQuery(query) {
  const originalQuery = typeof query === "string" ? query : "";
  let cleanedQuery = stripTrailingAnnotations(originalQuery);
  let partNumber = null;

  const partMatch = cleanedQuery.match(/\s*#\s*(\d+)\s*$/);
  if (partMatch) {
    const parsedPart = Number(partMatch[1]);
    partNumber = Number.isSafeInteger(parsedPart) ? parsedPart : null;
    cleanedQuery = stripTrailingAnnotations(cleanedQuery.slice(0, partMatch.index));
  }

  const hyphenatedMatch = cleanedQuery.match(/^(\d{1,3})-(\d{1,4})-(\d{1,4})-(\d{1,4})$/);
  if (hyphenatedMatch) {
    const normalizedEstateId = normalizeHyphenated(hyphenatedMatch.slice(1));
    return {
      isEstateId: true,
      originalQuery,
      cleanedQuery,
      normalizedEstateId,
      compactEstateId: compactFromNormalized(normalizedEstateId),
      municipalityCode: normalizedEstateId.split("-")[0],
      partNumber,
      inputFormat: "hyphenated",
    };
  }

  const compactMatch = cleanedQuery.match(/^(\d{3})(\d{3})(\d{4})(\d{4})$/);
  if (compactMatch) {
    const normalizedEstateId = normalizeHyphenated(compactMatch.slice(1));
    return {
      isEstateId: true,
      originalQuery,
      cleanedQuery,
      normalizedEstateId,
      compactEstateId: compactFromNormalized(normalizedEstateId),
      municipalityCode: normalizedEstateId.split("-")[0],
      partNumber,
      inputFormat: "compact",
    };
  }

  return {
    isEstateId: false,
    originalQuery,
    cleanedQuery,
    normalizedEstateId: null,
    compactEstateId: null,
    municipalityCode: null,
    partNumber,
    inputFormat: null,
  };
}

export function disabledEstateFeatureCollection(classification) {
  const metadata = estateMetadata(classification, {
    estateLookup: {
      enabled: false,
      reason: "not_configured",
    },
  });

  return {
    type: "FeatureCollection",
    features: [],
    avoin: metadata,
  };
}

function estateMetadata(classification, { estateLookup, error } = {}) {
  const metadata = {
    query_type: "estate_id",
    original_query: classification.originalQuery,
    cleaned_query: classification.cleanedQuery,
    normalized_estate_id: classification.normalizedEstateId,
    compact_estate_id: classification.compactEstateId,
    municipality_code: classification.municipalityCode,
    estate_lookup: estateLookup,
  };

  if (classification.partNumber !== null) {
    metadata.part_number = classification.partNumber;
  }

  if (error) {
    metadata.error = error;
  }

  return metadata;
}

function optionalProperties(item) {
  const properties = {};

  if (item.sourceFreshnessAt) {
    properties.source_freshness_at = item.sourceFreshnessAt;
  }
  if (item.loadedAt) {
    properties.loaded_at = item.loadedAt;
  }
  if (item.partLookup) {
    properties.part_number = item.partNumber;
    properties.part_lookup = true;
  }

  return properties;
}

export function foundEstateFeatureCollection(classification, result) {
  const item = result.item;
  const lookupDataset = result.lookupDataset ?? "nls_cadastral_estates";
  const feature = {
    type: "Feature",
    geometry: item.geometry,
    properties: {
      estate_id_compact: item.estateIdCompact,
      estate_id_normalized: item.estateIdNormalized,
      estate_id_display: item.estateIdDisplay,
      municipality_code: item.municipalityCode,
      part_count: item.partCount,
      ...optionalProperties(item),
      avoin: {
        query_type: "estate_id",
        lookup_dataset: lookupDataset,
      },
    },
  };

  if (Array.isArray(item.bbox)) {
    feature.bbox = item.bbox;
  }

  const collection = {
    type: "FeatureCollection",
    features: [feature],
    avoin: estateMetadata(classification, {
      estateLookup: {
        enabled: true,
        status: "found",
        lookup_dataset: lookupDataset,
      },
    }),
  };

  if (Array.isArray(item.bbox)) {
    collection.bbox = item.bbox;
  }

  return collection;
}

export function notFoundEstateFeatureCollection(classification) {
  return {
    type: "FeatureCollection",
    features: [],
    avoin: estateMetadata(classification, {
      estateLookup: {
        enabled: true,
        status: "not_found",
      },
    }),
  };
}

export function estateLookupErrorFeatureCollection(classification, code, message, status) {
  return {
    type: "FeatureCollection",
    features: [],
    avoin: estateMetadata(classification, {
      estateLookup: {
        enabled: true,
        status: code === "estate_lookup_timeout" ? "timeout" : "unavailable",
      },
      error: {
        code,
        message,
        status,
      },
    }),
  };
}
