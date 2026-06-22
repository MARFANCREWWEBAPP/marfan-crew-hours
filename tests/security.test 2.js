const test = require("node:test");
const assert = require("node:assert/strict");
const { hashPassword, randomId, randomToken, verifyPassword } = require("../server/security");

test("password hashes verify only the original password", () => {
  const credentials = hashPassword("marfan123");

  assert.equal(verifyPassword("marfan123", credentials.salt, credentials.hash), true);
  assert.equal(verifyPassword("wrong-password", credentials.salt, credentials.hash), false);
});

test("random tokens and ids are unique and prefixed", () => {
  const tokenA = randomToken();
  const tokenB = randomToken();
  const idA = randomId("usr");
  const idB = randomId("usr");

  assert.notEqual(tokenA, tokenB);
  assert.notEqual(idA, idB);
  assert.equal(idA.startsWith("usr_"), true);
  assert.equal(idB.startsWith("usr_"), true);
});
