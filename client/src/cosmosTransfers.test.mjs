import test from "node:test";
import assert from "node:assert/strict";
import { parseScoinAmountToBaseUnits } from "./cosmosTransferAmounts.ts";

test("converts S Coin display values to exact uscoin base units", () => {
  assert.equal(parseScoinAmountToBaseUnits("1"), "1000000");
  assert.equal(parseScoinAmountToBaseUnits("0.1"), "100000");
  assert.equal(parseScoinAmountToBaseUnits("12.345678"), "12345678");
  assert.equal(parseScoinAmountToBaseUnits("0.000001"), "1");
});

test("rejects invalid, zero and over-precision S Coin transfer values", () => {
  for (const amount of ["0", "-1", "1e-3", "1.0000001", "01", "", "  "]) {
    assert.throws(() => parseScoinAmountToBaseUnits(amount));
  }
});
