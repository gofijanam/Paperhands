import { describe, expect, it } from "vitest";
import { PUMP_BONDING } from "../src/contracts.js";
import {
  applyFeeOnInput,
  bondingProgressPct,
  initialCurve,
  quoteBuy,
  quoteSell,
} from "../src/bonding/curve.js";

describe("PUMP_BONDING constants", () => {
  it("matches pump-public-docs Global account", () => {
    expect(PUMP_BONDING.INITIAL_VIRTUAL_SOL_RESERVES).toBe(30_000_000_000n);
    expect(PUMP_BONDING.INITIAL_VIRTUAL_TOKEN_RESERVES).toBe(1_073_000_000_000_000n);
    expect(PUMP_BONDING.INITIAL_REAL_TOKEN_RESERVES).toBe(793_100_000_000_000n);
    expect(PUMP_BONDING.TOKEN_TOTAL_SUPPLY).toBe(1_000_000_000_000_000n);
    expect(PUMP_BONDING.FEE_BPS).toBe(125);
  });
});

describe("fee", () => {
  it("takes 1.25% on 1 SOL input", () => {
    const { net, fee } = applyFeeOnInput(1_000_000_000n);
    expect(fee).toBe(12_500_000n);
    expect(net).toBe(987_500_000n);
  });
});

describe("quoteBuy / quoteSell", () => {
  it("buy then sell round-trips with fee drag (sol out < sol in)", () => {
    const s0 = initialCurve();
    const buy = quoteBuy(s0, 1_000_000_000n); // 1 SOL
    expect(buy.tokensOut).toBeGreaterThan(0n);
    expect(buy.feeLamports).toBe(12_500_000n);
    const sell = quoteSell(buy.newState, buy.tokensOut);
    expect(sell.solOutLamports).toBeLessThan(1_000_000_000n);
    expect(sell.solOutLamports).toBeGreaterThan(0n);
  });

  it("known small buy: 0.1 SOL yields expected token ballpark", () => {
    // Manual: solNet = 98_750_000; k = 30e9 * 1.073e15
    const s0 = initialCurve();
    const buy = quoteBuy(s0, 100_000_000n);
    const k = PUMP_BONDING.INITIAL_VIRTUAL_SOL_RESERVES * PUMP_BONDING.INITIAL_VIRTUAL_TOKEN_RESERVES;
    const solNet = 100_000_000n - (100_000_000n * 125n) / 10_000n;
    const newVSol = PUMP_BONDING.INITIAL_VIRTUAL_SOL_RESERVES + solNet;
    const newVTok = k / newVSol;
    const expected = PUMP_BONDING.INITIAL_VIRTUAL_TOKEN_RESERVES - newVTok;
    expect(buy.tokensOut).toBe(expected);
  });

  it("progress starts at 0", () => {
    expect(bondingProgressPct(initialCurve())).toBe(0);
  });

  it("rejects zero amount", () => {
    expect(() => quoteBuy(initialCurve(), 0n)).toThrow("amount_zero");
  });
});
