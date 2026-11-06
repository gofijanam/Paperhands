import { describe, expect, it, beforeEach } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createApp, clearAllRateLimits } from "../src/app.js";
import { clearRateLimitsForTests } from "../src/anticheat/guards.js";
import { buildQuote, assertQuotePrecision } from "../src/engine/execute.js";
import { solToLamports, tokenToRaw } from "../src/lib/money.js";

const WALLET = "FENR2S4DbG8dNfGsvQR3GcAMRcjr6kKGeNYycUX4eaMD";

const CASES = [
  { mint: "So11111111111111111111111111111111111111112", venue: "graduated", decimals: 9, label: "graduated-9" },
  { mint: "PumpGradMock111111111111111111111111111111", venue: "graduated", decimals: 6, label: "graduated-6" },
  { mint: "PumpBondMock11111111111111111111111111111", venue: "bonding", decimals: 6, label: "bonding-6" },
  { mint: "PumpBond9Dec11111111111111111111111111111", venue: "bonding", decimals: 9, label: "bonding-9" },
] as const;

function fracDigits(s: string): number {
  return s.includes(".") ? s.split(".")[1]!.length : 0;
}

describe("mock E2E quote→trade buy+sell", () => {
  beforeEach(() => {
    clearAllRateLimits();
    clearRateLimitsForTests();
  });

  async function login(app: any) {
    clearAllRateLimits();
    clearRateLimitsForTests();
    const n: any = await (await app.request(`/v1/auth/nonce?wallet=${WALLET}`)).json();
    const res = await app.request("/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: WALLET, message: n.message, signature: "MOCK_SIG" }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as any).accessToken as string;
  }

  for (const c of CASES) {
    it(`${c.label}: nonce→verify→quote→buy→sell with canonical amounts`, async () => {
      const config = loadConfig({
        PAPERHANDS_MODE: "mock",
        DATABASE_PATH: ":memory:",
        HOST: "127.0.0.1",
        ADMIN_TOKEN: "test-admin",
      });
      const db = openDb(config);
      const app = createApp({ config, db });
      const token = await login(app);

      clearAllRateLimits();
      clearRateLimitsForTests();
      const qRes = await app.request("/v1/quotes", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ mint: c.mint, side: "buy", amountSol: "0.1", slippageBps: 500 }),
      });
      expect(qRes.status).toBe(200);
      const q: any = await qRes.json();
      expect(q.venue).toBe(c.venue);
      expect(fracDigits(q.outAmount)).toBeLessThanOrEqual(c.decimals);
      expect(fracDigits(q.inAmount)).toBeLessThanOrEqual(9);
      expect(fracDigits(q.minOutAmount)).toBeLessThanOrEqual(c.decimals);
      expect(fracDigits(q.fee.priorityFeeSol)).toBeLessThanOrEqual(9);
      // Must be parseable by ledger helpers (the regression)
      expect(() => tokenToRaw(q.outAmount, c.decimals)).not.toThrow();
      expect(() => solToLamports(q.inAmount)).not.toThrow();

      clearAllRateLimits();
      clearRateLimitsForTests();
      const buyRes = await app.request("/v1/trades", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "idempotency-key": `e2e-buy-${c.label}`,
        },
        body: JSON.stringify({ quoteId: q.quoteId }),
      });
      expect(buyRes.status).toBe(201);
      const buy: any = await buyRes.json();
      expect(buy.trade.status).toBe("filled");
      expect(buy.portfolio.positions.length).toBeGreaterThanOrEqual(1);
      const pos = buy.portfolio.positions.find((p: any) => p.mint === c.mint);
      expect(pos).toBeTruthy();
      expect(Number(buy.portfolio.cashSol)).toBeLessThan(10);

      // Sell half the position
      const qty = pos.qty as string;
      const halfRaw = tokenToRaw(qty, c.decimals) / 2n;
      expect(halfRaw > 0n).toBe(true);
      const { rawToToken } = await import("../src/lib/money.js");
      const sellAmt = rawToToken(halfRaw, c.decimals);

      clearAllRateLimits();
      clearRateLimitsForTests();
      const sqRes = await app.request("/v1/quotes", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ mint: c.mint, side: "sell", amountToken: sellAmt, slippageBps: 500 }),
      });
      expect(sqRes.status).toBe(200);
      const sq: any = await sqRes.json();
      expect(fracDigits(sq.outAmount)).toBeLessThanOrEqual(9);
      expect(() => solToLamports(sq.outAmount)).not.toThrow();

      clearAllRateLimits();
      clearRateLimitsForTests();
      const sellRes = await app.request("/v1/trades", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          "idempotency-key": `e2e-sell-${c.label}`,
        },
        body: JSON.stringify({ quoteId: sq.quoteId }),
      });
      expect(sellRes.status).toBe(201);
      const sell: any = await sellRes.json();
      expect(sell.trade.status).toBe("filled");
      expect(Number(sell.portfolio.cashSol)).toBeGreaterThan(Number(buy.portfolio.cashSol));
    });
  }
});

describe("quote engine never emits excess precision", () => {
  it("bonding + graduated mock quotes are ledger-safe", async () => {
    const config = loadConfig({ PAPERHANDS_MODE: "mock" });
    for (const decimals of [6, 9]) {
      const bond = await buildQuote(config, {
        mint: "x",
        side: "buy",
        amountSol: "0.1",
        slippageBps: 500,
        venue: "bonding",
        decimals,
        status: "tradeable",
        liquidityUsd: "22000",
      });
      assertQuotePrecision(bond, decimals);
      expect(() => tokenToRaw(bond.outAmount, decimals)).not.toThrow();

      const grad = await buildQuote(config, {
        mint: "y",
        side: "buy",
        amountSol: "0.1",
        slippageBps: 100,
        venue: "graduated",
        decimals,
        status: "tradeable",
        liquidityUsd: "180000",
        mockPriceSol: "0.000012",
      });
      assertQuotePrecision(grad, decimals);
      expect(() => tokenToRaw(grad.outAmount, decimals)).not.toThrow();
    }
  });

  it("repro: WSOL 0.1 buy quote fills (was 400 validation_failed)", async () => {
    const config = loadConfig({
      PAPERHANDS_MODE: "mock",
      DATABASE_PATH: ":memory:",
      HOST: "127.0.0.1",
    });
    const db = openDb(config);
    const app = createApp({ config, db });
    clearAllRateLimits();
    clearRateLimitsForTests();
    const n: any = await (await app.request(`/v1/auth/nonce?wallet=${WALLET}`)).json();
    const login: any = await (
      await app.request("/v1/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: WALLET, message: n.message, signature: "MOCK_SIG" }),
      })
    ).json();
    const token = login.accessToken;
    clearAllRateLimits();
    clearRateLimitsForTests();
    const q: any = await (
      await app.request("/v1/quotes", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          mint: "So11111111111111111111111111111111111111112",
          side: "buy",
          amountSol: "0.1",
        }),
      })
    ).json();
    expect(q.outAmount).toBeDefined();
    expect(fracDigits(q.outAmount)).toBeLessThanOrEqual(9);
    // classic bug: 17-decimal float string
    expect(fracDigits(q.outAmount)).toBeLessThan(17);
    clearAllRateLimits();
    clearRateLimitsForTests();
    const tRes = await app.request("/v1/trades", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ quoteId: q.quoteId }),
    });
    expect(tRes.status).toBe(201);
  });
});
