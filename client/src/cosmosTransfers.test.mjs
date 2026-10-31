import test from "node:test";
import assert from "node:assert/strict";
import { parseScoinAmountForTests } from "./cosmosTransfers.ts";

test("converts S Coin display values to exact uscoin base units", () => {
  assert.equal(parseScoinAmountForTests("1"), "1000000");
  assert.equal(parseScoinAmountForTests("0.1"), "100000");
  assert.equal(parseScoinAmountForTests("12.345678"), "12345678");
  assert.equal(parseScoinAmountForTests("0.000001"), "1");
});

test("rejects invalid, zero and over-precision S Coin transfer values", () => {
  for (const amount of ["0", "-1", "1e-3", "1.0000001", "01", "", "  "]) {
    assert.throws(() => parseScoinAmountForTests(amount));
  }
});
