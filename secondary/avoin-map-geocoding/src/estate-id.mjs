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
  const metadata = {
    query_type: "estate_id",
    original_query: classification.originalQuery,
    cleaned_query: classification.cleanedQuery,
    normalized_estate_id: classification.normalizedEstateId,
    compact_estate_id: classification.compactEstateId,
    municipality_code: classification.municipalityCode,
    estate_lookup: {
      enabled: false,
      reason: "not_configured",
    },
  };

  if (classification.partNumber !== null) {
    metadata.part_number = classification.partNumber;
  }

  return {
    type: "FeatureCollection",
    features: [],
    avoin: metadata,
  };
}
