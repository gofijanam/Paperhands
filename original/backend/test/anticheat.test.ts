import { describe, expect, it, beforeEach } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import {
  assertFillLiquidityCap,
  assertMinTradeSize,
  checkWalletRateLimit,
  clearRateLimitsForTests,
  detectWash,
} from "../src/anticheat/guards.js";
import { id, nowIso } from "../src/lib/ids.js";

describe("anticheat", () => {
  beforeEach(() => clearRateLimitsForTests());

  const config = loadConfig({ PAPERHANDS_MODE: "mock", WASH_LIQ_USD: "2000", WASH_WINDOW_MS: "3000", FILL_LIQUIDITY_CAP_PCT: "5", MIN_TRADE_SOL: "0.01" });

  it("enforces min trade size", () => {
    expect(() => assertMinTradeSize(config, 0.001)).toThrow(/Min trade/);
    expect(() => assertMinTradeSize(config, 0.01)).not.toThrow();
  });

  it("caps fill vs liquidity", () => {
    // 1 SOL ~ $180; 5% of $1000 liq = $50 → 1 SOL exceeds
    expect(() => assertFillLiquidityCap(config, 1, "1000", 180)).toThrow(/liquidity/);
    expect(() => assertFillLiquidityCap(config, 0.01, "100000", 180)).not.toThrow();
    expect(() => assertFillLiquidityCap(config, 1, null)).toThrow();
  });

  it("detects wash on low-liq", () => {
    const db = openDb(config);
    const wallet = "W" + "1".repeat(43);
    db.prepare(`INSERT INTO users (id, wallet, role, banned, created_at) VALUES ('usr_1',?,'user',0,?)`).run(wallet, nowIso());
    db.prepare(
      `INSERT INTO trades (id, user_id, cycle_id, mint, side, payload, idempotency_key, filled_at) VALUES (?,?,?,?,?,?,?,?)`,
    ).run(id("trd_"), "usr_1", "cyc_1", "mintA", "buy", "{}", null, nowIso());
    expect(() => detectWash(db, config, "usr_1", "mintA", "sell", "500")).toThrow(/Wash/);
    expect(() => detectWash(db, config, "usr_1", "mintA", "sell", "50000")).not.toThrow();
  });

  it("rate limits per wallet", () => {
    const w = "WalletRateLimit111111111111111111111111111";
    let blocked = 0;
    for (let i = 0; i < 20; i++) {
      const r = checkWalletRateLimit(w, "trade");
      if (!r.ok) blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
  });
});
