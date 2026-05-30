import assert from "node:assert/strict";
import test from "node:test";
import { buildPeliasUrl } from "../src/pelias.mjs";
import { parseSearchRequest, RequestValidationError } from "../src/request.mjs";

const config = Object.freeze({
  resultLimitDefault: 5,
  resultLimitMax: 10,
  defaultCountrycodes: "fi",
  defaultBbox: [19, 59, 32, 71],
  peliasBaseUrl: "http://pelias.example.test",
  requestTimeoutMs: 500,
  corsOrigins: { wildcard: true, origins: [] },
});

function parse(query, headers = {}) {
  return parseSearchRequest(new URLSearchParams(query), headers, config);
}

test("requires a non-empty text or q query", () => {
  assert.throws(() => parse(""), RequestValidationError);
  assert.throws(() => parse("text=   "), /text query parameter is required/);
});

test("rejects conflicting text and q aliases", () => {
  assert.throws(() => parse("text=Helsinki&q=Turku"), /text and q/);
});

test("accepts matching text and q aliases after trimming", () => {
  assert.equal(parse("text=%20Helsinki%20&q=Helsinki").text, "Helsinki");
});

test("resolves size and limit with default and max clamping", () => {
  assert.equal(parse("text=Helsinki").size, 5);
  assert.equal(parse("text=Helsinki&limit=99").size, 10);
  assert.equal(parse("text=Helsinki&size=3").size, 3);
  assert.throws(() => parse("text=Helsinki&limit=1.5"), /positive integer/);
  assert.throws(() => parse("text=Helsinki&size=2&limit=3"), /size and limit/);
});

test("parses service bbox and rejects malformed bbox values", () => {
  assert.deepEqual(parse("text=Helsinki&bbox=20,60,25,62").bbox, [20, 60, 25, 62]);
  assert.equal(parse("text=Helsinki&bbox=20,60,25,62").bboxSource, "bbox");
  assert.throws(() => parse("text=Helsinki&bbox=20,60,25"), /bbox must contain/);
  assert.throws(() => parse("text=Helsinki&bbox=25,60,20,62"), /ordered/);
});

test("parses Pelias boundary rect parameters", () => {
  const parsed = parse(
    "text=Helsinki&boundary.rect.min_lon=20&boundary.rect.min_lat=60&boundary.rect.max_lon=25&boundary.rect.max_lat=62",
  );

  assert.deepEqual(parsed.bbox, [20, 60, 25, 62]);
  assert.equal(parsed.bboxSource, "boundary.rect");
});

test("uses configured default country and bbox when omitted", () => {
  const parsed = parse("text=Helsinki");

  assert.equal(parsed.countrycodes, "fi");
  assert.deepEqual(parsed.bbox, [19, 59, 32, 71]);
  assert.equal(parsed.bboxSource, "default");
});

test("validates countrycodes, focus, filters, and lang", () => {
  assert.equal(parse("text=Helsinki&countrycodes=FI,SE").countrycodes, "fi,se");
  assert.deepEqual(parse("text=Helsinki&focus.point.lat=60&focus.point.lon=25").focus, {
    lat: 60,
    lon: 25,
  });
  assert.equal(parse("text=Helsinki&sources=openstreetmap&layers=venue,address").sources, "openstreetmap");
  assert.equal(parse("text=Helsinki&lang=fi-FI", { "accept-language": "en" }).effectiveLanguage, "fi-FI");
  assert.throws(() => parse("text=Helsinki&countrycodes=finland"), /countrycodes/);
  assert.throws(() => parse("text=Helsinki&focus.point.lat=60"), /required together/);
  assert.throws(() => parse("text=Helsinki&lang=not a tag"), /language tag/);
});

test("maps canonical request fields to Pelias URL parameters", () => {
  const parsed = parse(
    "text=Helsinki&limit=2&countrycodes=FI&bbox=20,60,25,62&focus.point.lat=61&focus.point.lon=24&sources=openstreetmap&layers=venue&lang=fi",
  );
  const url = buildPeliasUrl(config, parsed);

  assert.equal(url.pathname, "/v1/search");
  assert.equal(url.searchParams.get("text"), "Helsinki");
  assert.equal(url.searchParams.get("size"), "2");
  assert.equal(url.searchParams.get("boundary.country"), "fi");
  assert.equal(url.searchParams.get("boundary.rect.min_lon"), "20");
  assert.equal(url.searchParams.get("boundary.rect.min_lat"), "60");
  assert.equal(url.searchParams.get("boundary.rect.max_lon"), "25");
  assert.equal(url.searchParams.get("boundary.rect.max_lat"), "62");
  assert.equal(url.searchParams.get("focus.point.lat"), "61");
  assert.equal(url.searchParams.get("focus.point.lon"), "24");
  assert.equal(url.searchParams.get("sources"), "openstreetmap");
  assert.equal(url.searchParams.get("layers"), "venue");
  assert.equal(url.searchParams.get("lang"), "fi");
});
