import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildQuote } from "../src/engine/execute.js";

describe("execution guards", () => {
  const config = loadConfig({ PAPERHANDS_MODE: "mock", MIN_LIQUIDITY_USD: "500", MIN_TRADE_SOL: "0.01", FILL_LIQUIDITY_CAP_PCT: "5" });

  it("rejects rugged graduated", async () => {
    await expect(
      buildQuote(config, {
        mint: "x",
        side: "buy",
        amountSol: "0.1",
        slippageBps: 100,
        venue: "graduated",
        decimals: 6,
        status: "rugged",
        liquidityUsd: "0",
        mockPriceSol: "0",
      }),
    ).rejects.toMatchObject({ code: "untradeable" });
  });

  it("rejects stale-sized buy under min", async () => {
    await expect(
      buildQuote(config, {
        mint: "PumpBondMock11111111111111111111111111111",
        side: "buy",
        amountSol: "0.001",
        slippageBps: 500,
        venue: "bonding",
        decimals: 6,
        status: "tradeable",
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});
