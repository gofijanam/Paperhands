// Run: node --test lib/format.test.ts  (Node >= 23 strips types natively)
import { test } from "node:test";
import assert from "node:assert/strict";
import { axisUsd, price, solPrice, tiny, usd } from "./format.ts";

test("tiny: subscript zeros from 4 leading zeros", () => {
  assert.equal(tiny(0.00001189), "0.0₄1189");
  assert.equal(tiny(0.000001189), "0.0₅1189");
  assert.equal(tiny(1.2e-12), "0.0₁₁12");
  assert.equal(tiny(0.0001189), "0.0001189");
  assert.equal(tiny(0.0123456), "0.01235");
  assert.equal(tiny(0.5), "0.5");
  assert.equal(tiny(0), "0");
  assert.equal(tiny(-0.00001189), "−0.0₄1189");
  assert.equal(tiny(0.000099999), "0.0001"); // rounding carries out of the subscript range
});
test("never e-notation", () => {
  for (const n of [1e-5, 3.3e-9, 7.77e-15, 1e-20, 0.000099999, 123456789, 1e21 / 1e9])
    for (const f of [tiny, price, solPrice, axisUsd, usd]) assert.ok(!/e[-+]?\d/i.test(f(n)), `${f.name}(${n}) = ${f(n)}`);
});
test("price / solPrice", () => {
  assert.equal(price(0.00001189), "$0.0₄1189");
  assert.equal(price(1.5), "$1.5");
  assert.equal(solPrice(0.000000042), "◎0.0₇42");
});
test("axisUsd compact", () => {
  assert.equal(axisUsd(1_800_000), "$1.80M");
  assert.equal(axisUsd(950_000), "$950K");
  assert.equal(axisUsd(12_340), "$12.3K");
  assert.equal(axisUsd(412), "$412");
  assert.equal(axisUsd(0.00001189), "$0.0₄1189");
});
