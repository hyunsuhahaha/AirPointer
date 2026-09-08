import assert from "node:assert/strict";
import test from "node:test";
import { normalizePrice } from "./price.mjs";

test("keeps cents from the checkout API", () => {
  assert.equal(normalizePrice("12.99"), 12.99);
});
