/**
 * Regression suite for Robin INTERIM gate c90c947 findings (P1/P2/Low).
 * One assertion block per finding id.
 */
import { it, expect, vi, describe } from "vitest";
import { StreamHub } from "../src/stream/hub.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { openNewCycle, closeAndRotateCycle } from "../src/cycles/scheduler.js";
import { createApp } from "../src/app.js";
import { initialCurve, quoteBuy, quoteSell, spotPriceSolPerToken } from "../src/bonding/curve.js";
import { upsertCurve } from "../src/catalog/curveStore.js";
import { CatalogService } from "../src/services/catalog.js";
import { markMint, valuePosition } from "../src/portfolio/valuation.js";
import { fetchBondingTradesViaHelius, mapGtTrades } from "../src/catalog/trades.js";
import { executeFillAtomic } from "../src/engine/fill.js";
import { clearAllRateLimits } from "../src/middleware/rateLimit.js";
import { clearRateLimitsForTests } from "../src/anticheat/guards.js";
import { issueSession } from "../src/auth/siws.js";
import { buildQuote } from "../src/engine/execute.js";
import { redactString, logError } from "../src/lib/logger.js";
import { readFileSync } from "node:fs";

const cfg = (extra: Record<string, string> = {}) =>
  loadConfig({ DATABASE_PATH: ":memory:", PAPERHANDS_MODE: "mock", ...extra });

describe("P1-01 rotation race", () => {
  it("double force-rotate leaves exactly one active cycle", async () => {
    const c = cfg(), d = openDb(c);
    openNewCycle(d, c, new Date(Date.now() - 90_000_000));
    const catalog: any = { getCoin: async () => null };
    await Promise.all([
      closeAndRotateCycle(d, c, { catalog, force: true }),
      closeAndRotateCycle(d, c, { catalog, force: true }),
    ]);
    expect(d.prepare("SELECT id FROM cycles WHERE status='active'").all().length).toBe(1);
    d.close();
  });
  it("forced rotation retry is idempotent", async () => {
    const c = cfg(), d = openDb(c);
    openNewCycle(d, c);
    const catalog: any = { getCoin: async () => null };
    const a = await closeAndRotateCycle(d, c, { catalog, force: true });
    const b = await closeAndRotateCycle(d, c, { catalog, force: true });
    expect(b?.nextId).toBe(a?.nextId);
    d.close();
  });
});

describe("P1-02 SSE backpressure", () => {
  it("bounds unread queue to <=64", async () => {
    vi.useFakeTimers();
    const h = new StreamHub(), a = new AbortController();
    try {
      const stream = h.createSseStream({ channels: new Set(["prices"]), mints: new Set(), userId: null, signal: a.signal });
      for (let batch = 0; batch < 20; batch++) {
        for (let i = 0; i < 60; i++) h.publish({ type: "price", mint: "m", priceSol: "1" });
        vi.advanceTimersByTime(60);
      }
      a.abort();
      const reader = stream.getReader();
      let n = 0;
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        n++;
      }
      expect(n).toBeLessThanOrEqual(64);
    } finally {
      a.abort();
      vi.useRealTimers();
    }
  });
  it("cancel removes hub listener", async () => {
    vi.useFakeTimers();
    const h = new StreamHub(), a = new AbortController();
    try {
      const s = h.createSseStream({ channels: new Set(["prices"]), mints: new Set(), userId: null, signal: a.signal });
      await s.cancel();
      expect(h.listenerCount("event")).toBe(0);
    } finally {
      a.abort();
      vi.useRealTimers();
    }
  });
});

describe("P1-03 SSE caps + ticket GC", () => {
  it("caps connections per user at 5", () => {
    vi.useFakeTimers();
    const h = new StreamHub();
    h.setMaxListeners(0);
    const acs: AbortController[] = [];
    try {
      for (let i = 0; i < 6; i++) {
        const a = new AbortController();
        acs.push(a);
        h.createSseStream({ channels: new Set(), mints: new Set(), userId: "same-wallet", signal: a.signal });
      }
      expect(h.listenerCount("event")).toBeLessThanOrEqual(5);
    } finally {
      acs.forEach((a) => a.abort());
      vi.useRealTimers();
    }
  });
  it("GCs expired tickets", () => {
    vi.useFakeTimers();
    try {
      const h = new StreamHub();
      for (let i = 0; i < 10000; i++) h.issueTicket(null, null);
      vi.advanceTimersByTime(3_600_000);
      expect((h as any).tickets.size).toBeLessThan(100);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("P1-04 thin bonding fills", () => {
  it("sell cannot exceed real SOL reserves", () => {
    const c = { ...initialCurve(), realSolReserves: 1n };
    const q = quoteSell(c, 1000000000000n);
    expect(q.solOutLamports).toBeLessThanOrEqual(c.realSolReserves);
  });
});

describe("P1-05 bonding spot units", () => {
  it("spot is SOL per whole token (not lamports/raw)", () => {
    const c = initialCurve();
    const q = quoteBuy(c, 10_000_000n);
    const qty = Number(q.tokensOut) / 1e6;
    const value = qty * spotPriceSolPerToken(c);
    expect(value).toBeLessThan(0.011);
  });
});

describe("P1-06 fail closed on missing market", () => {
  it("null catalog at fill rejects", async () => {
    clearAllRateLimits();
    clearRateLimitsForTests();
    const c = cfg(), d = openDb(c);
    const cy = openNewCycle(d, c);
    d.prepare("INSERT INTO users(id,wallet,role,banned,created_at) VALUES ('u',?,'user',0,?)").run("A".repeat(44), new Date().toISOString());
    d.prepare("INSERT INTO portfolios(user_id,cycle_id,mode,cash_sol,realized_pnl_sol,volume_sol,trade_count) VALUES ('u',?,'ranked','9','0','1',1)").run(cy.id);
    const token = issueSession(d, "u", "A".repeat(44)).token;
    const q: any = await buildQuote(c, {
      mint: "PumpBondMock11111111111111111111111111111",
      side: "buy",
      amountSol: "0.1",
      slippageBps: 500,
      venue: "bonding",
      decimals: 6,
      curve: initialCurve(),
      liquidityUsd: null,
    });
    d.prepare("INSERT INTO quotes(id,user_id,payload,expires_at,used) VALUES (?,?,?,?,0)").run(
      q.quoteId,
      "u",
      JSON.stringify({ ...q, userId: "u", decimals: 6 }),
      q.expiresAt,
    );
    const app = createApp({ config: c, db: d, catalog: { getCoin: async () => null } as any });
    const r = await app.request("/v1/trades", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token },
      body: JSON.stringify({ quoteId: q.quoteId }),
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    d.close();
  });
});

describe("P2-01 stream tickets", () => {
  it("single-use, short TTL, no renewal", () => {
    vi.useFakeTimers();
    try {
      const h = new StreamHub();
      const t = h.issueTicket("a", "wa");
      expect(h.resolveTicket(t.ticket)?.userId).toBe("a");
      expect(h.resolveTicket(t.ticket)).toBe(null);
      const t2 = h.issueTicket("a", "wa");
      h.resolveTicket(t2.ticket);
      vi.advanceTimersByTime(61_000);
      expect(h.resolveTicket(t2.ticket)).toBe(null);
      const t3 = h.issueTicket("a", "wa");
      vi.advanceTimersByTime(60_001);
      expect(h.resolveTicket(t3.ticket)).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });
  it("cannot override another identity", async () => {
    vi.useFakeTimers();
    const c = cfg(), d = openDb(c), hub = new StreamHub(), ac = new AbortController();
    try {
      d.prepare("INSERT INTO users(id,wallet,role,banned,created_at) VALUES ('b',?,'user',0,?)").run(
        "B".repeat(44),
        new Date().toISOString(),
      );
      const b = issueSession(d, "b", "B".repeat(44));
      const app = createApp({ config: c, db: d, hub });
      const t = hub.issueTicket("a", "wa", ["portfolio"]);
      const r = await app.request("/v1/stream?ticket=" + t.ticket + "&channels=portfolio", {
        headers: { authorization: "Bearer " + b.token },
        signal: ac.signal,
      });
      hub.publish({ type: "portfolio", userId: "a", private: "A_PRIVATE" });
      ac.abort();
      const text = await r.text();
      expect(text).not.toContain("A_PRIVATE");
    } finally {
      ac.abort();
      d.close();
      vi.useRealTimers();
    }
  });
});

describe("P2-02 X-Forwarded-For trust", () => {
  it("ignores spoofed x-real-ip by default", async () => {
    clearAllRateLimits();
    const c = cfg(), d = openDb(c), app = createApp({ config: c, db: d });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 30; i++) {
        const w = "A".repeat(42) + "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[i] + "1";
        const r = await app.request("/v1/auth/nonce?wallet=" + w, { headers: { "x-real-ip": "198.51.100." + i } });
        statuses.push(r.status);
      }
      expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(10);
    } finally {
      d.close();
    }
  });
});

describe("P2-03 loss-making sells", () => {
  it("commits negative realized PnL", async () => {
    const c = cfg(), d = openDb(c);
    const cy = openNewCycle(d, c);
    d.prepare("INSERT INTO users(id,wallet,role,banned,created_at) VALUES ('u',?,'user',0,?)").run("A".repeat(44), new Date().toISOString());
    d.prepare("INSERT INTO portfolios(user_id,cycle_id,mode,cash_sol,realized_pnl_sol,volume_sol,trade_count) VALUES ('u',?,'ranked','9','0','1',1)").run(cy.id);
    d.prepare("INSERT INTO positions(id,user_id,cycle_id,mint,symbol,qty,avg_entry_sol,cost_sol,status) VALUES ('p','u',?,'m','M','100','0.01','1','open')").run(cy.id);
    const q: any = {
      quoteId: "qte_loss",
      mint: "m",
      side: "sell",
      venue: "bonding",
      inAmount: "100",
      outAmount: "0.9",
      fee: { priorityFeeSol: "0.0001", venueFeeSol: "0" },
      expiresAt: new Date(Date.now() + 8000).toISOString(),
    };
    d.prepare("INSERT INTO quotes(id,user_id,payload,expires_at,used) VALUES (?,?,?,?,0)").run(q.quoteId, "u", JSON.stringify(q), q.expiresAt);
    const result = await executeFillAtomic({
      db: d,
      config: c,
      userId: "u",
      wallet: "A".repeat(44),
      cycleId: cy.id,
      quote: q,
      symbol: "M",
      decimals: 6,
      idempotencyKey: null,
      coinStatus: "tradeable",
      flaggedStatus: null,
    });
    expect(result.ok).toBe(true);
    d.close();
  });
});

describe("P2-04 high-precision valuation", () => {
  it("values sub-lamport unit prices", () => {
    const mark: any = { mint: "m", markSol: "0.00000001", status: "tradeable", source: "injected", asOf: new Date().toISOString() };
    expect(valuePosition({ mint: "m", qty: "100000000", cost_sol: "1" }, mark).valueSol).toBe("1");
    mark.markSol = "0.0000000015";
    expect(valuePosition({ mint: "m", qty: "100000000", cost_sol: "0.15" }, mark).valueSol).toBe("0.15");
  });
});

describe("P2-05 stale catalog marks", () => {
  it("stale curve cannot acquire fresh mark", async () => {
    const c = cfg({ PAPERHANDS_MODE: "live" }), d = openDb(c);
    const mint = "So11111111111111111111111111111111111111112";
    upsertCurve(d, mint, { ...initialCurve(), virtualSolReserves: 1000000000n, virtualTokenReserves: 1000000000000n }, { progressPct: 0 });
    d.prepare("UPDATE curve_state SET updated_at='2000-01-01'").run();
    const catalog = new CatalogService({
      config: c,
      db: d,
      fetcher: (async () => new Response("[]", { headers: { "content-type": "application/json" } })) as any,
    });
    const m = await markMint(catalog, d, mint);
    expect(m.markSol).toBe("0");
    d.close();
  });
});

describe("P2-06 log redaction", () => {
  it("redacts api-key, bearer, cookies", () => {
    expect(redactString("https://x?api-key=SECRET123")).not.toContain("SECRET123");
    expect(redactString("Authorization: Bearer abc.def.ghi")).not.toContain("abc.def");
    expect(redactString("cookie=sessionid=DEADBEEF")).not.toContain("DEADBEEF");
  });
});

describe("P2-07 Helius key not in URL", () => {
  it("does not place key in request URL", async () => {
    const old = globalThis.fetch;
    let hasKey = false;
    globalThis.fetch = (async (url: any) => {
      hasKey = String(url).includes("ROBIN_SYNTHETIC_KEY");
      return new Response("[]");
    }) as any;
    try {
      await fetchBondingTradesViaHelius({} as any, "So11111111111111111111111111111111111111112", 1, "ROBIN_SYNTHETIC_KEY");
      expect(hasKey).toBe(false);
    } finally {
      globalThis.fetch = old;
    }
  });
});

describe("P2-08 Gecko quote asset", () => {
  it("does not treat USDC quote as SOL", () => {
    const rows = mapGtTrades(
      { data: [{ id: "t", attributes: { kind: "buy", from_token_amount: "180", to_token_amount: "1000", price_to_in_currency_token: "0.18", from_token_address: "USDC" } }] },
      5,
    );
    expect(rows[0].amountSol).not.toBe("180");
  });
});

describe("P2-09 Idempotency-Key", () => {
  it("successful retry returns 200 with original trade", async () => {
    clearAllRateLimits();
    clearRateLimitsForTests();
    const c = cfg(), d = openDb(c);
    const cy = openNewCycle(d, c);
    d.prepare("INSERT INTO users(id,wallet,role,banned,created_at) VALUES ('u',?,'user',0,?)").run("A".repeat(44), new Date().toISOString());
    d.prepare("INSERT INTO portfolios(user_id,cycle_id,mode,cash_sol,realized_pnl_sol,volume_sol,trade_count) VALUES ('u',?,'ranked','9','0','1',1)").run(cy.id);
    const token = issueSession(d, "u", "A".repeat(44)).token;
    const app = createApp({ config: c, db: d });
    const headers = { "content-type": "application/json", authorization: "Bearer " + token };
    const qr = await app.request("/v1/quotes", {
      method: "POST",
      headers,
      body: JSON.stringify({ mint: "PumpBondMock11111111111111111111111111111", side: "buy", amountSol: "0.1", slippageBps: 500 }),
    });
    const q: any = await qr.json();
    const send = () =>
      app.request("/v1/trades", {
        method: "POST",
        headers: { ...headers, "idempotency-key": "00000000-0000-4000-8000-000000000001" },
        body: JSON.stringify({ quoteId: q.quoteId }),
      });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(200);
    d.close();
  });
});

describe("P2-10 live SSE no mock", () => {
  it("live mode stream does not publish mock fixture prices", async () => {
    const c = cfg({ PAPERHANDS_MODE: "live" }), d = openDb(c), hub = new StreamHub();
    const seen: any[] = [];
    const onEv = (ev: any) => seen.push(ev);
    hub.on("event", onEv);
    const app = createApp({ config: c, db: d, hub });
    const ac = new AbortController();
    try {
      // Fire-and-forget request; abort quickly so we do not hang on the open SSE body
      const pending = Promise.resolve(app.request("/v1/stream?channels=prices", { signal: ac.signal }));
      await new Promise((r) => setTimeout(r, 30));
      ac.abort();
      await pending.then(() => null, () => null);
      const mockish = seen.filter((e) => e.type === "price" && e._mock);
      expect(mockish.length).toBe(0);
      const fixtures = seen.filter((e) => e.type === "price" && String(e.mint || "").includes("Mock"));
      expect(fixtures.length).toBe(0);
    } finally {
      hub.off("event", onEv);
      ac.abort();
      d.close();
    }
  });
});

describe("Low-01 pinned deps", () => {
  it("package.json has exact versions (no caret/tilde)", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    for (const [k, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }) as [string, string][]) {
      expect(v, k).not.toMatch(/^[\^~]/);
      expect(v, k).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});

describe("N1 live/production CORS defaults", () => {
  it("live mode without CORS_ORIGINS does not allow localhost:4331", async () => {
    const c = loadConfig({ DATABASE_PATH: ":memory:", PAPERHANDS_MODE: "live" } as any);
    expect(c.corsOrigins).not.toContain("http://localhost:4331");
    expect(c.corsOrigins).not.toContain("http://127.0.0.1:4331");
    const d = openDb(c);
    const app = createApp({ config: c, db: d });
    const r = await app.request("/v1/health", { headers: { origin: "http://localhost:4331" } });
    expect(r.headers.get("access-control-allow-origin")).not.toBe("http://localhost:4331");
    d.close();
  });
  it("NODE_ENV=production mock does not inherit localhost defaults", async () => {
    const c = loadConfig({ DATABASE_PATH: ":memory:", PAPERHANDS_MODE: "mock", NODE_ENV: "production" } as any);
    expect(c.corsOrigins).toEqual([]);
  });
  it("mock non-production still gets local-dev defaults", () => {
    const c = loadConfig({ DATABASE_PATH: ":memory:", PAPERHANDS_MODE: "mock", NODE_ENV: "development" } as any);
    expect(c.corsOrigins).toContain("http://localhost:4331");
  });
});

describe("N2 graduated sell impact tolerance", () => {
  it("rejects Jupiter sell when priceImpact exceeds slippage", async () => {
    const { buildQuote } = await import("../src/engine/execute.js");
    // Monkeypatch getQuote via dynamic module — use mock graduated path with injected impact
    // Prefer calling jupiterQuote path: PAPERHANDS_MODE live + venue graduated + stub fetch in jupiter
    const c = loadConfig({ DATABASE_PATH: ":memory:", PAPERHANDS_MODE: "live", CORS_ORIGINS: "" } as any);
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes("jupiter") || u.includes("quote")) {
        return new Response(
          JSON.stringify({
            inputMint: "TokenMint1111111111111111111111111111111",
            outputMint: "So11111111111111111111111111111111111111112",
            inAmount: "1000000",
            outAmount: "100000000",
            otherAmountThreshold: "99000000",
            priceImpactPct: "50",
            routePlan: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    }) as any;
    try {
      await expect(
        buildQuote(c, {
          mint: "TokenMint1111111111111111111111111111111",
          side: "sell",
          amountToken: "1",
          slippageBps: 100,
          venue: "graduated",
          decimals: 6,
          liquidityUsd: "100000",
        }),
      ).rejects.toMatchObject({ code: "untradeable" });
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("F1 public current during settle", () => {
  it("GET /v1/cycles/current during settling does not create a second cycle", async () => {
    let unhandled = false;
    const onRej = () => {
      unhandled = true;
    };
    process.on("unhandledRejection", onRej);
    const c = cfg(), d = openDb(c);
    const cy = openNewCycle(d, c, new Date(Date.now() - 90_000_000));
    d.prepare("INSERT INTO users(id,wallet,role,banned,created_at) VALUES ('u',?,'user',0,?)").run("A".repeat(44), new Date().toISOString());
    d.prepare("INSERT INTO portfolios(user_id,cycle_id,mode,cash_sol,realized_pnl_sol,volume_sol,trade_count) VALUES ('u',?,'ranked','9','0','1',3)").run(cy.id);
    d.prepare("INSERT INTO positions(id,user_id,cycle_id,mint,symbol,qty,avg_entry_sol,cost_sol,status) VALUES ('p','u',?,'m','M','1','1','1','open')").run(cy.id);
    let release!: (v: any) => void;
    let first = true;
    const catalog: any = {
      getCoin: () => {
        if (first) {
          first = false;
          return new Promise((r) => {
            release = r;
          });
        }
        return Promise.resolve({ status: "rugged", priceSol: "0", decimals: 6 });
      },
    };
    const app = createApp({ config: c, db: d, catalog });
    const rotate = closeAndRotateCycle(d, c, { catalog, force: true }).then(
      () => ({ ok: true }),
      () => ({ ok: false }),
    );
    for (let i = 0; i < 40 && !release; i++) await Promise.resolve();
    const current = await app.request("/v1/cycles/current");
    expect(current.status).toBe(200);
    const body: any = await current.json();
    expect(body.status === "settling" || body.status === "active").toBe(true);
    release({ status: "rugged", priceSol: "0", decimals: 6 });
    const result = await rotate;
    await new Promise((r) => setTimeout(r, 10));
    const active = (d.prepare("SELECT COUNT(*) AS n FROM cycles WHERE status='active'").get() as any).n;
    const settling = (d.prepare("SELECT COUNT(*) AS n FROM cycles WHERE status='settling'").get() as any).n;
    process.off("unhandledRejection", onRej);
    expect(settling).toBe(0);
    expect(active).toBe(1);
    expect(result.ok).toBe(true);
    expect(unhandled).toBe(false);
    d.close();
  });
});
