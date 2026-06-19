const test = require("node:test");
const assert = require("node:assert/strict");
const { distanceMeters, isInsideRadius } = require("../server/geo");

test("distanceMeters returns zero for the same point", () => {
  assert.equal(distanceMeters(40.4239, -3.6718, 40.4239, -3.6718), 0);
});

test("isInsideRadius accepts nearby clock-in coordinates", () => {
  const result = isInsideRadius(40.42395, -3.67182, 40.4239, -3.6718, 150);
  assert.equal(result.inside, true);
  assert.ok(result.distance < 20);
});

test("isInsideRadius rejects distant clock-in coordinates", () => {
  const result = isInsideRadius(40.4168, -3.7038, 40.4239, -3.6718, 150);
  assert.equal(result.inside, false);
  assert.ok(result.distance > 150);
});
