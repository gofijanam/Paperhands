import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decodeBondingCurve, bondingCurvePda } from "../src/bonding/onchain.js";

describe("on-chain bonding curve decode", () => {
  it("derives PDA under pump program", () => {
    const mint = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
    const pda = bondingCurvePda(mint);
    expect(typeof pda).toBe("string");
    expect(pda.length).toBeGreaterThan(30);
  });

  it("decodes fixture reserves", () => {
    const b64 = readFileSync("fixtures/upstream/bonding_curve.b64.txt", "utf8").trim();
    const buf = Buffer.from(b64, "base64");
    const state = decodeBondingCurve(buf);
    expect(state).not.toBeNull();
    expect(state!.virtualSolReserves).toBe(45_000_000_000n);
    expect(state!.complete).toBe(false);
  });
});
