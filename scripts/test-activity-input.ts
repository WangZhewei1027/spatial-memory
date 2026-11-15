import assert from "node:assert/strict";
import { test } from "node:test";
import { distanceMeters, effectiveConfig, parseActivityArea, parseActivityConfig, parseLocation, parsePoints } from "../lib/activities/input";

test("activity configuration is type-specific and bounded", () => {
  assert.deepEqual(effectiveConfig("shop_checkin", { checkinRadiusMeters: 60 }), { checkinRadiusMeters: 60 });
  assert.deepEqual(effectiveConfig("shop_checkin", {}), { checkinRadiusMeters: 50 });
  assert.deepEqual(effectiveConfig("danmaku", { maxLength: 200 }), { maxLength: 200 });
  assert.deepEqual(effectiveConfig("danmaku", {}), { maxLength: 50 });
  assert.deepEqual(effectiveConfig("danmaku", null), { maxLength: 50 });
  assert.deepEqual(effectiveConfig("danmaku", { maxLength: 500 }), { maxLength: 500 });
  for (const value of [0, 501, 1.5, "20", Number.NaN]) assert.throws(() => parseActivityConfig({ maxLength: value }, "danmaku"));
  assert.throws(() => parseActivityConfig({ maxLength: 200 }, "shop_checkin"));
  assert.throws(() => parseActivityConfig({ unknown: true }, "danmaku"));
});
test("location and point parsers reject partial, duplicate and malformed input", () => {
  assert.equal(parseLocation(null), null);
  assert.throws(() => parseLocation({ longitude: 121 }));
  assert.throws(() => parseLocation({ longitude: 181, latitude: 20 }));
  assert.throws(() => parsePoints([{ name: "point", imageAssetId: "arbitrary" }]));
  const id = "11111111-1111-4111-8111-111111111111";
  assert.throws(() => parsePoints([{ id, name: "one" }, { id, name: "two" }]));
  assert.throws(() => parsePoints([{ id, name: "point", enabled: false }]));
  assert.throws(() => parsePoints([{ id, name: "point", location: { longitude: 121 } }]));
  assert.deepEqual(parsePoints([{ name: "Point" }])[0], { name: "Point", description: null, ordinal: 0, imageAssetId: null, rewardAssetId: null, state: "active" });
  assert.equal(parsePoints([{ name: "Point", location: null }])[0].location, null);
  const location = { longitude: 121.5, latitude: 31.2 };
  assert.deepEqual(parsePoints([{ name: "Point", location }])[0].location, location);
});
test("activity area keeps omitted coordinates and validates a complete shared scope", () => {
  const location = { longitude: 121.5, latitude: 31.2 };
  const prior = { location, radius_meters: 100 };
  assert.deepEqual(parseActivityArea({}), { location: null, radius_meters: null });
  assert.deepEqual(parseActivityArea({}, prior), prior);
  assert.deepEqual(parseActivityArea({ radiusMeters: 200 }, prior), { location, radius_meters: 200 });
  assert.deepEqual(parseActivityArea({ location: null, radiusMeters: null }, prior), { location: null, radius_meters: null });
  for (const body of [{ location }, { radiusMeters: 100 }, { location, radiusMeters: 0 }, { location, radiusMeters: 100001 }, { location, radiusMeters: "100" }]) {
    assert.throws(() => parseActivityArea(body));
  }
  assert.throws(() => parseActivityArea({ location: null }, prior));
});
test("check-in distance handles exact positions and the date line", () => {
  assert.equal(distanceMeters({ latitude: 31, longitude: 121 }, { latitude: 31, longitude: 121 }), 0);
  const distance = distanceMeters({ latitude: 0, longitude: 179.9999 }, { latitude: 0, longitude: -179.9999 });
  assert.ok(distance > 20 && distance < 25);
  assert.ok(distanceMeters({ latitude: 31.2, longitude: 121.5 }, { latitude: 31.201, longitude: 121.5 }) > 50);
});
