import { describe, expect, it } from "vitest";
import { lamportsToSol, solToLamports, mulBps } from "../src/lib/decimal.js";

describe("decimal helpers", () => {
  it("round-trips SOL ↔ lamports", () => {
    expect(solToLamports("1.5")).toBe(1_500_000_000n);
    expect(lamportsToSol(1_500_000_000n)).toBe("1.5");
    expect(lamportsToSol(1n)).toBe("0.000000001");
  });
  it("mulBps", () => {
    expect(mulBps(10_000n, 125)).toBe(125n);
  });
  it("rejects negatives and excess precision", () => {
    expect(() => solToLamports("-0.1")).toThrow();
    expect(() => solToLamports("1.1234567890")).toThrow();
  });
});
