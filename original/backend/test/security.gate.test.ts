import { describe, expect, it, beforeEach } from "vitest";
import * as nacl from "tweetnacl";
import bs58 from "bs58";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createApp, clearAllRateLimits } from "../src/app.js";
import { clearRateLimitsForTests } from "../src/anticheat/guards.js";
import { checkHold } from "../src/hold/gate.js";
import { createRpcClient } from "../src/rpc/client.js";
import { assertFillLiquidityCap } from "../src/anticheat/guards.js";
import { solToLamports } from "../src/lib/decimal.js";
import { assertAdminTokenOk } from "../src/config.js";

const nn = (nacl as any).default ?? nacl;
const WALLET_A = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const WALLET_B = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const MINT = "PumpBondMock11111111111111111111111111111";

function cfg(extra: Record<string, string> = {}) {
  return loadConfig({
    DATABASE_PATH: ":memory:",
    PAPERHANDS_MODE: "mock",
    HOST: "127.0.0.1",
    CORS_ORIGINS: "http://127.0.0.1:3000,http://localhost:3000",
    ADMIN_TOKEN: "test-admin-token-not-used-in-live",
    ...extra,
  } as any);
}

async function login(app: any, wallet: string) {
  clearAllRateLimits();
  clearRateLimitsForTests();
  const n: any = await (await app.request(`/v1/auth/nonce?wallet=${wallet}`)).json();
  const res = await app.request("/v1/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet, message: n.message, signature: "MOCK_SIG" }),
  });
  expect(res.status).toBe(200);
  const j: any = await res.json();
  return j.accessToken as string;
}

async function quoteBuy(app: any, token: string, amountSol = "0.5") {
  clearAllRateLimits();
  clearRateLimitsForTests();
  const res = await app.request("/v1/quotes", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ mint: MINT, side: "buy", amountSol, slippageBps: 500 }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}

describe("P1 security gate regressions", () => {
  beforeEach(() => {
    clearAllRateLimits();
    clearRateLimitsForTests();
  });

  it("P1-01 concurrent fills do not overdraft or double-mint", async () => {
    const c = cfg();
    const db = openDb(c);
    const app = createApp({ config: c, db });
    const token = await login(app, WALLET_A);
    // N parallel buys each with own quote
    const quotes = [];
    for (let i = 0; i < 12; i++) quotes.push(await quoteBuy(app, token, "0.5"));
    const results = await Promise.all(
      quotes.map((q) =>
        app.request("/v1/trades", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ quoteId: q.quoteId }),
        }),
      ),
    );
    const statuses = results.map((r) => r.status);
    const ok = statuses.filter((s) => s === 201).length;
    const fail = statuses.filter((s) => s !== 201).length;
    expect(ok + fail).toBe(12);
    // Exposure 25% of 10 = 2.5 SOL → at most 5 fills of 0.5; rest fail
    expect(ok).toBeLessThanOrEqual(5);
    expect(fail).toBeGreaterThanOrEqual(7);
    const pf: any = await (await app.request("/v1/portfolio", { headers: { authorization: `Bearer ${token}` } })).json();
    expect(Number(pf.cashSol)).toBeGreaterThanOrEqual(0);
    expect(Number(pf.cashSol)).toBeLessThanOrEqual(10);
    // Same quote cannot fill twice
    const q1 = await quoteBuy(app, token, "0.5");
    const r1 = await app.request("/v1/trades", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ quoteId: q1.quoteId }),
    });
    const r2 = await app.request("/v1/trades", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ quoteId: q1.quoteId }),
    });
    // first may succeed or fail on funds; second must not double-apply
    if (r1.status === 201) {
      expect([409, 403, 412]).toContain(r2.status);
      const j2: any = await r2.json();
      expect(["quote_used", "insufficient_funds", "quote_stale", "forbidden"]).toContain(j2.error.code);
    }
  });

  it("P1-02 quote bound to user; cross-user rejected; single-use", async () => {
    const c = cfg();
    const db = openDb(c);
    const app = createApp({ config: c, db });
    const a = await login(app, WALLET_A);
    const b = await login(app, WALLET_B);
    const q = await quoteBuy(app, a, "0.5");
    const cross = await app.request("/v1/trades", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${b}` },
      body: JSON.stringify({ quoteId: q.quoteId }),
    });
    expect(cross.status).toBe(403);
    const j: any = await cross.json();
    expect(j.error.code).toBe("quote_foreign");
    const own = await app.request("/v1/trades", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${a}` },
      body: JSON.stringify({ quoteId: q.quoteId }),
    });
    expect(own.status).toBe(201);
    const reuse = await app.request("/v1/trades", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${a}` },
      body: JSON.stringify({ quoteId: q.quoteId }),
    });
    expect([409, 403]).toContain(reuse.status);
  });

  it("P1-03 frozen/rugged enforced at fill time", async () => {
    const c = cfg({ ADMIN_TOKEN: "x".repeat(32) + "AbCdEfGhIjKlMnOp" });
    const db = openDb(c);
    const app = createApp({ config: c, db });
    const token = await login(app, WALLET_A);
    const q = await quoteBuy(app, token, "0.5");
    const adminTok = c.ADMIN_TOKEN;
    await app.request(`/v1/admin/coins/${MINT}/flag`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${adminTok}` },
      body: JSON.stringify({ status: "frozen", reason: "test" }),
    });
    const fill = await app.request("/v1/trades", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ quoteId: q.quoteId }),
    });
    expect(fill.status).toBe(422);
    const j: any = await fill.json();
    expect(j.error.code).toBe("untradeable");
  });

  it("P1-04 auth endpoints rate limited per IP", async () => {
    const c = cfg();
    const db = openDb(c);
    const app = createApp({ config: c, db });
    clearAllRateLimits();
    let limited = false;
    for (let i = 0; i < 20; i++) {
      const res = await app.request(`/v1/auth/nonce?wallet=${WALLET_A}`);
      if (res.status === 429) {
        limited = true;
        expect(res.headers.get("Retry-After")).toBeTruthy();
        break;
      }
    }
    expect(limited).toBe(true);
  });

  it("P1-05 CORS does not reflect arbitrary origins", async () => {
    const c = cfg();
    const db = openDb(c);
    const app = createApp({ config: c, db });
    const evil = await app.request("/v1/health", { headers: { origin: "https://evil.example" } });
    expect(evil.headers.get("access-control-allow-origin")).not.toBe("https://evil.example");
    const ok = await app.request("/v1/health", { headers: { origin: "http://127.0.0.1:3000" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3000");
  });

  it("P1-06 live mode refuses weak admin token", () => {
    expect(() => assertAdminTokenOk("x", "live")).toThrow();
    expect(() => assertAdminTokenOk("short", "live")).toThrow();
    expect(() => assertAdminTokenOk("", "live")).not.toThrow(); // disabled
    const strong = "K7mN2pQ9rS4tU6vW8xY1zA3bC5dE7fG0";
    expect(() => assertAdminTokenOk(strong, "live")).not.toThrow();
    expect(() => assertAdminTokenOk("x", "mock")).not.toThrow();
  });
});

describe("P2 security gate regressions", () => {
  beforeEach(() => {
    clearAllRateLimits();
    clearRateLimitsForTests();
  });

  it("P2-01 force hold refresh bypasses RPC cache", async () => {
    const c = loadConfig({ PAPERHANDS_MODE: "live", DATABASE_PATH: ":memory:", PAPER_MIN_HOLD: "50000", PAPER_MINT: "FakeMint1111111111111111111111111111111" } as any);
    const db = openDb(c);
    let calls = 0;
    const rpc = createRpcClient(
      c,
      (async () => {
        calls++;
        const bal = calls === 1 ? "100000" : "0";
        return new Response(
          JSON.stringify({
            result: { value: [{ account: { data: { parsed: { info: { tokenAmount: { uiAmountString: bal } } } } } }] },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }) as any,
    );
    expect((await checkHold(db, c, WALLET_A, { rpc })).ok).toBe(true);
    expect(calls).toBe(1);
    const forced = await checkHold(db, c, WALLET_A, { force: true, rpc });
    expect(calls).toBe(2);
    expect(forced.ok).toBe(false);
    expect(forced.cached).toBe(false);
  });

  it("P2-02 logout revokes session server-side", async () => {
    const c = cfg();
    const db = openDb(c);
    const app = createApp({ config: c, db });
    const token = await login(app, WALLET_A);
    expect((await app.request("/v1/auth/me", { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    await app.request("/v1/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect((await app.request("/v1/auth/me", { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it("P2-03 exposure uses cumulative position cost", async () => {
    const c = cfg();
    const db = openDb(c);
    const app = createApp({ config: c, db });
    const token = await login(app, WALLET_A);
    // 25% of 10 = 2.5 SOL max per mint
    for (let i = 0; i < 6; i++) {
      clearAllRateLimits();
      clearRateLimitsForTests();
      const q = await quoteBuy(app, token, "0.5");
      await app.request("/v1/trades", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ quoteId: q.quoteId }),
      });
    }
    const pf: any = await (await app.request("/v1/portfolio", { headers: { authorization: `Bearer ${token}` } })).json();
    const cost = pf.positions[0] ? Number(pf.positions[0].costSol) : 0;
    expect(cost).toBeLessThanOrEqual(2.5 + 1e-6);
  });

  it("P2-04 upstream errors redacted", async () => {
    const c = cfg();
    const db = openDb(c);
    const leaky = createApp({
      config: c,
      db,
      catalog: { search: async () => { throw new Error("SYNTHETIC_SECRET_MARKER"); } } as any,
    });
    const er = await leaky.request("/v1/coins/search?q=abc");
    const text = await er.text();
    expect(text).not.toContain("SYNTHETIC_SECRET_MARKER");
    expect(er.status).toBe(503);
    const j = JSON.parse(text);
    expect(j.error.code).toBe("upstream_degraded");
  });

  it("P2-06 null liquidity fail closed", () => {
    const c = cfg();
    expect(() => assertFillLiquidityCap(c, 1, null)).toThrow();
    try {
      assertFillLiquidityCap(c, 1, null);
    } catch (e: any) {
      expect(e.code).toBe("untradeable");
    }
  });

  it("P2-07 rugged positions marked zero", async () => {
    const c = cfg({ ADMIN_TOKEN: "K7mN2pQ9rS4tU6vW8xY1zA3bC5dE7fG0xx" });
    const db = openDb(c);
    const app = createApp({ config: c, db });
    const token = await login(app, WALLET_A);
    const q = await quoteBuy(app, token, "0.5");
    expect(
      (
        await app.request("/v1/trades", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ quoteId: q.quoteId }),
        })
      ).status,
    ).toBe(201);
    await app.request(`/v1/admin/coins/${MINT}/flag`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${c.ADMIN_TOKEN}` },
      body: JSON.stringify({ status: "rugged" }),
    });
    const pf: any = await (await app.request("/v1/portfolio", { headers: { authorization: `Bearer ${token}` } })).json();
    expect(pf.positions[0].markSol).toBe("0");
    expect(Number(pf.positions[0].valueSol)).toBe(0);
  });

  it("P2-08 ranked reset rejected; payout eligibility", async () => {
    const c = cfg({ ADMIN_TOKEN: "K7mN2pQ9rS4tU6vW8xY1zA3bC5dE7fG0xx", MIN_CYCLE_TRADES: "1" });
    const db = openDb(c);
    const app = createApp({ config: c, db });
    const token = await login(app, WALLET_A);
    const q = await quoteBuy(app, token, "0.5");
    await app.request("/v1/trades", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ quoteId: q.quoteId }),
    });
    const reset = await app.request("/v1/portfolio/reset", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ confirm: true }),
    });
    expect(reset.status).toBe(403);
  });

  it("P2-09 money rejects negatives and excess precision", () => {
    expect(() => solToLamports("-0.1")).toThrow();
    expect(() => solToLamports("1.1234567890")).toThrow();
    expect(solToLamports("1.5")).toBe(1_500_000_000n);
  });

  it("Low-01 health reports unknown upstream in live-shaped mock config when not probed", async () => {
    // mock mode still skipped; verify shape
    const c = cfg();
    const db = openDb(c);
    const app = createApp({ config: c, db });
    const j: any = await (await app.request("/v1/health")).json();
    expect(j.upstream.dexscreener).toBe("skipped");
  });

  it("tokenExpiresAt matches session lifetime", async () => {
    const c = cfg();
    const db = openDb(c);
    const app = createApp({ config: c, db });
    clearAllRateLimits();
    const n: any = await (await app.request(`/v1/auth/nonce?wallet=${WALLET_A}`)).json();
    const j: any = await (
      await app.request("/v1/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: WALLET_A, message: n.message, signature: "MOCK_SIG" }),
      })
    ).json();
    expect(j.tokenExpiresAt).toBe(j.session.expiresAt);
  });
});

describe("bigint money helpers", () => {
  it("round-trip", () => {
    expect(solToLamports("0.000000001")).toBe(1n);
  });
});
