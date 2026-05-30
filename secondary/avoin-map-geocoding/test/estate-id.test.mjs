import assert from "node:assert/strict";
import test from "node:test";
import { classifyEstateIdQuery, disabledEstateFeatureCollection } from "../src/estate-id.mjs";

test("recognizes hyphenated Finnish estate IDs", () => {
  assert.deepEqual(
    {
      normalizedEstateId: classifyEstateIdQuery("92-58-552-21").normalizedEstateId,
      municipalityCode: classifyEstateIdQuery("92-58-552-21").municipalityCode,
    },
    {
      normalizedEstateId: "092-58-552-21",
      municipalityCode: "092",
    },
  );
  assert.equal(classifyEstateIdQuery("5-895-2-2").normalizedEstateId, "005-895-2-2");
});

test("normalizes zero-padded hyphenated IDs", () => {
  const parsed = classifyEstateIdQuery("010-0042-0001-0001");

  assert.equal(parsed.isEstateId, true);
  assert.equal(parsed.normalizedEstateId, "010-42-1-1");
  assert.equal(parsed.compactEstateId, "01004200010001");
});

test("recognizes compact 14-digit IDs", () => {
  const parsed = classifyEstateIdQuery("00589500020002");

  assert.equal(parsed.isEstateId, true);
  assert.equal(parsed.inputFormat, "compact");
  assert.equal(parsed.normalizedEstateId, "005-895-2-2");
});

test("strips bracketed annotations and preserves part suffix", () => {
  const parsed = classifyEstateIdQuery(" 010-0042-0001-0001 #2 [draft] ");

  assert.equal(parsed.isEstateId, true);
  assert.equal(parsed.cleanedQuery, "010-0042-0001-0001");
  assert.equal(parsed.normalizedEstateId, "010-42-1-1");
  assert.equal(parsed.partNumber, 2);
});

test("strips parenthesized annotations", () => {
  const parsed = classifyEstateIdQuery("92-58-552-21 (some suffix)");

  assert.equal(parsed.isEstateId, true);
  assert.equal(parsed.cleanedQuery, "92-58-552-21");
});

test("does not classify natural-language place names as estate IDs", () => {
  const parsed = classifyEstateIdQuery("Helsinki");

  assert.equal(parsed.isEstateId, false);
  assert.equal(parsed.normalizedEstateId, null);
});

test("builds disabled estate lookup FeatureCollection metadata", () => {
  const parsed = classifyEstateIdQuery("00589500020002 #7");
  const collection = disabledEstateFeatureCollection(parsed);

  assert.equal(collection.type, "FeatureCollection");
  assert.deepEqual(collection.features, []);
  assert.equal(collection.avoin.query_type, "estate_id");
  assert.equal(collection.avoin.estate_lookup.enabled, false);
  assert.equal(collection.avoin.estate_lookup.reason, "not_configured");
  assert.equal(collection.avoin.part_number, 7);
});
