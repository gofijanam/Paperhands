/**
 * Residuals R1/R2/Low + net-budget gameplay fixes from Robin 64ee679.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import {
  tryConsumePaperDepth,
  creditPaperDepthBuy,
  recordPaperDepthTradeForTests,
  clearPaperDepthForTests,
  spentPaperDepth,
  paperDepthBuys,
  paperDepthSells,
} from "../src/engine/paperDepth.js";
import { clientIp, setTrustedProxies, clearAllRateLimits } from "../src/middleware/rateLimit.js";
import { peerFromContext, createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { redactString, isPublicKeyBase58 } from "../src/lib/logger.js";
import { issueSession } from "../src/auth/siws.js";
import { openNewCycle } from "../src/cycles/scheduler.js";
import { initialCurve, quoteBuy } from "../src/bonding/curve.js";
import { clearRateLimitsForTests } from "../src/anticheat/guards.js";
import { solToLamports } from "../src/lib/money.js";

const WSOL = "So11111111111111111111111111111111111111112";
const CAP = 987_500_000n;

const reset = () => {
  clearPaperDepthForTests();
  clearAllRateLimits();
  clearRateLimitsForTests();
  setTrustedProxies([]);
};

describe("R1 net paperDepth (updated from lifetime)", () => {
  afterEach(() => clearPaperDepthForTests());

  function mem() {
    const c = loadConfig({ DATABASE_PATH: ":memory:", PAPERHANDS_MODE: "mock" });
    const d = openDb(c);
    const cy = openNewCycle(d, c);
    return { c, d, cy, cycleId: cy.id };
  }

  /** Check then record sell (mirrors fill writing a trade on success). */
  function consume(d: ReturnType<typeof openDb>, opts: {
    userId: string; mint: string; cycleId: string; realSolReserves: bigint; amountLamports: bigint; requirePriorBuys?: boolean;
  }) {
    const ok = tryConsumePaperDepth({ db: d, ...opts });
    if (ok && opts.amountLamports > 0n) {
      recordPaperDepthTradeForTests(d, {
        userId: opts.userId,
        mint: opts.mint,
        cycleId: opts.cycleId,
        side: "sell",
        amountLamports: opts.amountLamports,
      });
    }
    return ok;
  }

  it("farming sells without buys stay capped across many window boundaries", () => {
    const { d, cycleId } = mem();
    const mint = WSOL;
    const userId = "farmer";
    let paid = 0n;
    const old = Date.now;
    let clock = old();
    Date.now = () => clock;
    try {
      for (let window = 0; window < 12; window++) {
        clock += 5 * 60_000 + 1_000;
        for (let i = 0; i < 40; i++) {
          const chunk = 50_000_000n;
          const ok = consume(d, { userId, mint, cycleId, realSolReserves: CAP, amountLamports: chunk });
          if (!ok) break;
          paid += chunk;
        }
      }
      expect(paid).toBeLessThanOrEqual(CAP);
      expect(spentPaperDepth(d, userId, mint, cycleId)).toBeLessThanOrEqual(CAP);
      const rem = CAP - paid;
      if (rem > 0n) {
        expect(consume(d, { userId, mint, cycleId, realSolReserves: CAP, amountLamports: rem })).toBe(true);
        paid += rem;
      }
      expect(paid).toBe(CAP);
      expect(consume(d, { userId, mint, cycleId, realSolReserves: CAP, amountLamports: 1n })).toBe(false);
    } finally {
      Date.now = old;
      d.close();
    }
  });

  it("buys credit so a large buy can fully exit (a)", () => {
    const { d, cycleId } = mem();
    const mint = WSOL;
    creditPaperDepthBuy({ db: d, userId: "u", mint, cycleId, amountLamports: 2_500_000_000n });
    expect(consume(d, { userId: "u", mint, cycleId, realSolReserves: CAP, amountLamports: CAP })).toBe(true);
    expect(paperDepthBuys(d, "u", mint, cycleId)).toBe(2_500_000_000n);
    expect(paperDepthSells(d, "u", mint, cycleId)).toBe(CAP);
    expect(spentPaperDepth(d, "u", mint, cycleId)).toBe(CAP - 2_500_000_000n);
    d.close();
  });

  it("one heavy user does not block another user's exit (b)", () => {
    const { d, cycleId } = mem();
    const mint = WSOL;
    expect(consume(d, { userId: "heavy", mint, cycleId, realSolReserves: CAP, amountLamports: CAP })).toBe(true);
    expect(consume(d, { userId: "heavy", mint, cycleId, realSolReserves: CAP, amountLamports: 1n })).toBe(false);
    creditPaperDepthBuy({ db: d, userId: "peer", mint, cycleId, amountLamports: 500_000_000n });
    expect(consume(d, { userId: "peer", mint, cycleId, realSolReserves: CAP, amountLamports: 400_000_000n })).toBe(true);
    d.close();
  });

  it("reserve shrink after spending does not block exits that keep net ≤ cap (c)", () => {
    const { d, cycleId } = mem();
    const mint = WSOL;
    creditPaperDepthBuy({ db: d, userId: "u", mint, cycleId, amountLamports: 800_000_000n });
    expect(consume(d, { userId: "u", mint, cycleId, realSolReserves: 1_000_000_000n, amountLamports: 300_000_000n })).toBe(true);
    expect(consume(d, { userId: "u", mint, cycleId, realSolReserves: 200_000_000n, amountLamports: 100_000_000n })).toBe(true);
    expect(consume(d, { userId: "u", mint, cycleId, realSolReserves: 200_000_000n, amountLamports: 700_000_000n })).toBe(false);
    d.close();
  });

  it("when reserves increase after buys, only net extraction is capped", () => {
    const { d, cycleId } = mem();
    const mint = "MintNet11111111111111111111111111111111111";
    creditPaperDepthBuy({ db: d, userId: "a", mint, cycleId, amountLamports: 100n });
    expect(consume(d, { userId: "a", mint, cycleId, realSolReserves: 100n, amountLamports: 100n })).toBe(true);
    expect(consume(d, { userId: "a", mint, cycleId, realSolReserves: 100n, amountLamports: 100n })).toBe(true);
    expect(consume(d, { userId: "a", mint, cycleId, realSolReserves: 100n, amountLamports: 1n })).toBe(false);
    expect(consume(d, { userId: "a", mint, cycleId, realSolReserves: 150n, amountLamports: 50n })).toBe(true);
    d.close();
  });
});

describe("Low logger pubkey allowlist", () => {
  it("keeps WSOL mint visible and redacts env canaries / long hex", () => {
    expect(isPublicKeyBase58(WSOL)).toBe(true);
    const text = redactString(`trade mint=${WSOL} ok`);
    expect(text).toContain(WSOL);
    expect(text).not.toContain("mint=***");

    const old = process.env.HELIUS_API_KEY;
    process.env.HELIUS_API_KEY = "ROBIN_SYNTHETIC_CANARY_LOW";
    try {
      expect(redactString("upstream returned credential ROBIN_SYNTHETIC_CANARY_LOW")).not.toContain(
        "ROBIN_SYNTHETIC_CANARY_LOW",
      );
    } finally {
      if (old === undefined) delete process.env.HELIUS_API_KEY;
      else process.env.HELIUS_API_KEY = old;
    }
    expect(redactString("deadbeefdeadbeefdeadbeefdeadbeef")).toContain("***");
  });
});

describe("R2 socket peer via real node http server", () => {
  afterEach(() => {
    clearAllRateLimits();
    setTrustedProxies([]);
  });

  it("untrusted: spoofed XFF ignored; trusted proxy peer honors XFF", async () => {
    const app = new Hono<{ Bindings: HttpBindings }>();
    app.get("/ip", (c) => {
      const peer = peerFromContext(c);
      const ip = clientIp(c, peer);
      return c.json({ ip, peer });
    });

    const nodeServer = createAdaptorServer({ fetch: app.fetch });
    await new Promise<void>((resolve) => nodeServer.listen(0, "127.0.0.1", () => resolve()));
    const addr = nodeServer.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const port = addr.port;
    const base = `http://127.0.0.1:${port}`;

    try {
      setTrustedProxies([]);
      let r = await fetch(base + "/ip", { headers: { "x-forwarded-for": "203.0.113.50" } });
      let j: any = await r.json();
      expect(j.peer).toBe("127.0.0.1");
      expect(j.ip).toBe("127.0.0.1");

      setTrustedProxies(["127.0.0.1"]);
      r = await fetch(base + "/ip", { headers: { "x-forwarded-for": "203.0.113.99" } });
      j = await r.json();
      expect(j.ip).toBe("203.0.113.99");

      setTrustedProxies([]);
      r = await fetch(base + "/ip", { headers: { "x-forwarded-for": "198.51.100.1", "x-real-ip": "198.51.100.2" } });
      j = await r.json();
      expect(j.ip).toBe("127.0.0.1");
    } finally {
      await new Promise<void>((resolve, reject) => nodeServer.close((e) => (e ? reject(e) : resolve())));
    }
  });

  it("createApp boot path exposes socket peer through clientIp", async () => {
    clearAllRateLimits();
    setTrustedProxies([]);
    const c = loadConfig({ DATABASE_PATH: ":memory:", PAPERHANDS_MODE: "mock" });
    const d = openDb(c);
    const honoApp = createApp({ config: c, db: d });
    const nodeServer = createAdaptorServer({ fetch: honoApp.fetch });
    await new Promise<void>((resolve) => nodeServer.listen(0, "127.0.0.1", () => resolve()));
    const addr = nodeServer.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const port = addr.port;
    try {
      let ok = 0;
      for (let i = 0; i < 30; i++) {
        const w =
          "A".repeat(42) +
          "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[i] +
          "1";
        const r = await fetch(`http://127.0.0.1:${port}/v1/auth/nonce?wallet=${w}`, {
          headers: { "x-forwarded-for": `198.51.100.${i}`, "x-real-ip": `198.51.100.${i}` },
        });
        if (r.status === 200) ok++;
      }
      expect(ok).toBeLessThanOrEqual(10);
    } finally {
      d.close();
      await new Promise<void>((resolve, reject) => nodeServer.close((e) => (e ? reject(e) : resolve())));
    }
  });
});

describe("net-budget HTTP gameplay (a)(b)(c) + modest round-trips", () => {
  afterEach(() => reset());

  async function quote(app: any, headers: any, body: any) {
    clearAllRateLimits();
    clearRateLimitsForTests();
    return app.request("/v1/quotes", { method: "POST", headers, body: JSON.stringify(body) });
  }
  async function trade(app: any, headers: any, quoteId: string) {
    clearAllRateLimits();
    clearRateLimitsForTests();
    return app.request("/v1/trades", { method: "POST", headers, body: JSON.stringify({ quoteId }) });
  }

  function setup(curve = quoteBuy(initialCurve(), 1_000_000_000n).newState) {
    reset();
    const c = loadConfig({ DATABASE_PATH: ":memory:", PAPERHANDS_MODE: "mock" });
    const d = openDb(c);
    const mint = WSOL;
    const coin: any = {
      mint,
      symbol: "TEST",
      decimals: 6,
      status: "tradeable",
      venue: "bonding",
      priceSol: "0.00000003",
      liquidityUsd: "100000",
    };
    const cy = openNewCycle(d, c);
    d.prepare("INSERT INTO users(id,wallet,role,banned,created_at) VALUES ('u',?,'user',0,?)").run(
      "A".repeat(44),
      new Date().toISOString(),
    );
    d.prepare(
      "INSERT INTO portfolios(user_id,cycle_id,mode,cash_sol,realized_pnl_sol,volume_sol,trade_count) VALUES ('u',?,'ranked','10','0','0',0)",
    ).run(cy.id);
    const t = issueSession(d, "u", "A".repeat(44)).token;
    const catalog: any = {
      getCoin: async () => coin,
      resolveForQuote: async () => ({ coin, curve }),
    };
    const app = createApp({ config: c, db: d, catalog });
    const headers = { "content-type": "application/json", authorization: "Bearer " + t };
    return { c, d, app, headers, mint, curve, cy };
  }

  it("modest buy then full sell succeeds", async () => {
    const x = setup();
    try {
      const qr = await x.app.request("/v1/quotes", {
        method: "POST",
        headers: x.headers,
        body: JSON.stringify({ mint: x.mint, side: "buy", amountSol: "0.2", slippageBps: 500 }),
      });
      expect(qr.status).toBe(200);
      const q: any = await qr.json();
      expect((await x.app.request("/v1/trades", { method: "POST", headers: x.headers, body: JSON.stringify({ quoteId: q.quoteId }) })).status).toBe(201);

      const pf: any = await (await x.app.request("/v1/portfolio", { headers: x.headers })).json();
      const qty = pf.positions[0]?.qty;
      expect(qty).toBeTruthy();
      const sq = await x.app.request("/v1/quotes", {
        method: "POST",
        headers: x.headers,
        body: JSON.stringify({ mint: x.mint, side: "sell", amountToken: qty, slippageBps: 5000 }),
      });
      expect(sq.status).toBe(200);
      const sellQ: any = await sq.json();
      expect(
        (await x.app.request("/v1/trades", { method: "POST", headers: x.headers, body: JSON.stringify({ quoteId: sellQ.quoteId }) }))
          .status,
      ).toBe(201);
      const pf2: any = await (await x.app.request("/v1/portfolio", { headers: x.headers })).json();
      expect(pf2.positions.filter((p: any) => p.status === "open").length).toBe(0);
    } finally {
      x.d.close();
    }
  });

  it("buy→sell→buy round trip works", async () => {
    const x = setup();
    try {
      for (const amount of ["0.15", "0.15"]) {
        const qr = await x.app.request("/v1/quotes", {
          method: "POST",
          headers: x.headers,
          body: JSON.stringify({ mint: x.mint, side: "buy", amountSol: amount, slippageBps: 500 }),
        });
        expect(qr.status).toBe(200);
        const q: any = await qr.json();
        expect((await x.app.request("/v1/trades", { method: "POST", headers: x.headers, body: JSON.stringify({ quoteId: q.quoteId }) })).status).toBe(201);
        const pf: any = await (await x.app.request("/v1/portfolio", { headers: x.headers })).json();
        const qty = pf.positions[0]?.qty;
        if (!qty) continue;
        const sq = await x.app.request("/v1/quotes", {
          method: "POST",
          headers: x.headers,
          body: JSON.stringify({ mint: x.mint, side: "sell", amountToken: qty, slippageBps: 5000 }),
        });
        expect(sq.status).toBe(200);
        const sellQ: any = await sq.json();
        expect(
          (await x.app.request("/v1/trades", { method: "POST", headers: x.headers, body: JSON.stringify({ quoteId: sellQ.quoteId }) }))
            .status,
        ).toBe(201);
      }
    } finally {
      x.d.close();
    }
  });

  it("(a) large buy then full sell does not strand tokens via net budget", async () => {
    // Curve after 1 SOL buy — real ≈ 987500000; user buys 2.5 SOL against same snapshot venue
    const x = setup();
    try {
      // Top up cash for large buy
      x.d.prepare("UPDATE portfolios SET cash_sol='20' WHERE user_id='u'").run();
      let left = "0";
      for (const amount of ["0.5", "0.5", "0.5", "0.5", "0.5"]) {
        clearAllRateLimits(); clearRateLimitsForTests();
        const qr = await x.app.request("/v1/quotes", {
          method: "POST",
          headers: x.headers,
          body: JSON.stringify({ mint: x.mint, side: "buy", amountSol: amount, slippageBps: 800 }),
        });
        if (qr.status !== 200) break;
        const q: any = await qr.json();
        const tr = await x.app.request("/v1/trades", { method: "POST", headers: x.headers, body: JSON.stringify({ quoteId: q.quoteId }) });
        expect(tr.status).toBe(201);
      }
      const pf: any = await (await x.app.request("/v1/portfolio", { headers: x.headers })).json();
      const qty = pf.positions[0]?.qty;
      expect(Number(qty)).toBeGreaterThan(0);
      // Drain via repeated sells if needed (impact sizing)
      let guard = 0;
      while (guard++ < 30) {
        clearAllRateLimits(); clearRateLimitsForTests();
        const pfNow: any = await (await x.app.request("/v1/portfolio", { headers: x.headers })).json();
        const open = pfNow.positions.filter((p: any) => p.status === "open" && Number(p.qty) > 0);
        if (!open.length) break;
        const qsell = open[0].qty;
        const sq = await x.app.request("/v1/quotes", {
          method: "POST",
          headers: x.headers,
          body: JSON.stringify({ mint: x.mint, side: "sell", amountToken: qsell, slippageBps: 5000 }),
        });
        if (sq.status !== 200) {
          clearAllRateLimits(); clearRateLimitsForTests();
          const halfStr = String(Number(qsell) / 2);
          const sq2 = await x.app.request("/v1/quotes", {
            method: "POST",
            headers: x.headers,
            body: JSON.stringify({ mint: x.mint, side: "sell", amountToken: halfStr, slippageBps: 5000 }),
          });
          if (sq2.status !== 200) break;
          const s2: any = await sq2.json();
          const tr2 = await x.app.request("/v1/trades", { method: "POST", headers: x.headers, body: JSON.stringify({ quoteId: s2.quoteId }) });
          if (tr2.status !== 201) break;
          continue;
        }
        const s: any = await sq.json();
        const tr = await x.app.request("/v1/trades", { method: "POST", headers: x.headers, body: JSON.stringify({ quoteId: s.quoteId }) });
        expect(tr.status).toBe(201);
      }
      const pfEnd: any = await (await x.app.request("/v1/portfolio", { headers: x.headers })).json();
      const leftQty = pfEnd.positions.filter((p: any) => p.status === "open").reduce((a: number, p: any) => a + Number(p.qty), 0);
      // Must not strand ~48M tokens — allow dust
      expect(leftQty).toBeLessThan(1);
    } finally {
      x.d.close();
    }
  });

  it("(b) heavy user cannot grief peer sells via global budget", async () => {
    const curve = quoteBuy(initialCurve(), 1_000_000_000n).newState;
    reset();
    const c = loadConfig({ DATABASE_PATH: ":memory:", PAPERHANDS_MODE: "mock" });
    const d = openDb(c);
    const mint = WSOL;
    const coin: any = { mint, symbol: "T", decimals: 6, status: "tradeable", venue: "bonding", priceSol: "0.00000003", liquidityUsd: "100000" };
    const cy = openNewCycle(d, c);
    for (const [id, w] of [
      ["heavy", "H".repeat(44)],
      ["peer", "P".repeat(44)],
    ] as const) {
      d.prepare("INSERT INTO users(id,wallet,role,banned,created_at) VALUES (?,?, 'user',0,?)").run(id, w, new Date().toISOString());
      d.prepare(
        "INSERT INTO portfolios(user_id,cycle_id,mode,cash_sol,realized_pnl_sol,volume_sol,trade_count) VALUES (?,?,'ranked','10','0','0',0)",
      ).run(id, cy.id);
    }
    // Seed heavy with large position (no buy credit) — farm until cap
    d.prepare(
      "INSERT INTO positions(id,user_id,cycle_id,mint,symbol,qty,avg_entry_sol,cost_sol,status) VALUES ('ph','heavy',?,?,'T','80000000','0.00000001','0.1','open')",
    ).run(cy.id, mint);
    d.prepare(
      "INSERT INTO positions(id,user_id,cycle_id,mint,symbol,qty,avg_entry_sol,cost_sol,status) VALUES ('pp','peer',?,?,'T','1000000','0.00000001','0.5','open')",
    ).run(cy.id, mint);
    creditPaperDepthBuy({ db: d, userId: "peer", mint, cycleId: cy.id, amountLamports: 500_000_000n });

    const catalog: any = { getCoin: async () => coin, resolveForQuote: async () => ({ coin, curve }) };
    const app = createApp({ config: c, db: d, catalog });
    const heavyTok = issueSession(d, "heavy", "H".repeat(44)).token;
    const peerTok = issueSession(d, "peer", "P".repeat(44)).token;
    const hH = { "content-type": "application/json", authorization: "Bearer " + heavyTok };
    const hP = { "content-type": "application/json", authorization: "Bearer " + peerTok };
    try {
      // Heavy drains their net farm budget
      for (let i = 0; i < 20; i++) {
        clearAllRateLimits(); clearRateLimitsForTests();
        const sq = await app.request("/v1/quotes", {
          method: "POST",
          headers: hH,
          body: JSON.stringify({ mint, side: "sell", amountToken: "5000000", slippageBps: 5000 }),
        });
        if (sq.status !== 200) break;
        const q: any = await sq.json();
        const tr = await app.request("/v1/trades", { method: "POST", headers: hH, body: JSON.stringify({ quoteId: q.quoteId }) });
        if (tr.status !== 201) break;
      }
      // Peer can still sell (bought credit)
      clearAllRateLimits(); clearRateLimitsForTests();
      const sq = await app.request("/v1/quotes", {
        method: "POST",
        headers: hP,
        body: JSON.stringify({ mint, side: "sell", amountToken: "500000", slippageBps: 5000 }),
      });
      expect(sq.status).toBe(200);
      const q: any = await sq.json();
      expect((await app.request("/v1/trades", { method: "POST", headers: hP, body: JSON.stringify({ quoteId: q.quoteId }) })).status).toBe(201);
    } finally {
      d.close();
    }
  });

  it("farming without buys still blocked at real reserves", async () => {
    const x = setup();
    try {
      x.d.prepare(
        "INSERT INTO positions(id,user_id,cycle_id,mint,symbol,qty,avg_entry_sol,cost_sol,status) VALUES ('p','u',?,?,'T','80000000','0.00000001','0','open')",
      ).run(x.cy.id, x.mint);
      let paid = 0n;
      for (let i = 0; i < 30; i++) {
        const sq = await x.app.request("/v1/quotes", {
          method: "POST",
          headers: x.headers,
          body: JSON.stringify({ mint: x.mint, side: "sell", amountToken: "10000000", slippageBps: 5000 }),
        });
        if (sq.status !== 200) break;
        const q: any = await sq.json();
        const tr = await x.app.request("/v1/trades", { method: "POST", headers: x.headers, body: JSON.stringify({ quoteId: q.quoteId }) });
        if (tr.status !== 201) break;
        paid += solToLamports(q.outAmount);
      }
      expect(paid).toBeLessThanOrEqual(x.curve.realSolReserves);
    } finally {
      x.d.close();
    }
  });
});

describe("live inventory provenance (Robin c02e4f8 caveat)", () => {
  afterEach(() => reset());

  it("live: seeded bag cannot extract; net extraction ≤ own paper buys", async () => {
    reset();
    // Provenance gate unit: live requirePriorBuys blocks zero-buy sells
    {
      const c0 = loadConfig({ DATABASE_PATH: ":memory:", PAPERHANDS_MODE: "mock" });
      const d0 = openDb(c0);
      const cy0 = openNewCycle(d0, c0);
      expect(
        tryConsumePaperDepth({
          db: d0,
          userId: "seeded",
          mint: WSOL,
          cycleId: cy0.id,
          realSolReserves: CAP,
          amountLamports: 100_000_000n,
          requirePriorBuys: true,
        }),
      ).toBe(false);
      creditPaperDepthBuy({ db: d0, userId: "buyer", mint: WSOL, cycleId: cy0.id, amountLamports: 500_000_000n });
      expect(
        tryConsumePaperDepth({
          db: d0,
          userId: "buyer",
          mint: WSOL,
          cycleId: cy0.id,
          realSolReserves: CAP,
          amountLamports: 200_000_000n,
          requirePriorBuys: true,
        }),
      ).toBe(true);
      // Record the allowed sell so spent reflects it
      recordPaperDepthTradeForTests(d0, {
        userId: "buyer",
        mint: WSOL,
        cycleId: cy0.id,
        side: "sell",
        amountLamports: 200_000_000n,
      });
      expect(spentPaperDepth(d0, "buyer", WSOL, cy0.id)).toBeLessThanOrEqual(paperDepthBuys(d0, "buyer", WSOL, cy0.id));
      d0.close();
    }

    // HTTP live: SQL-seeded position cannot sell without buy credit
    const c = loadConfig({
      DATABASE_PATH: ":memory:",
      PAPERHANDS_MODE: "live",
      CORS_ORIGINS: "http://127.0.0.1:4331",
      ADMIN_TOKEN: "",
    } as any);
    expect(c.isMock).toBe(false);
    const d = openDb(c);
    const curve = quoteBuy(initialCurve(), 1_000_000_000n).newState;
    const mint = WSOL;
    const coin: any = {
      mint,
      symbol: "T",
      decimals: 6,
      status: "tradeable",
      venue: "bonding",
      priceSol: "0.00000003",
      liquidityUsd: "100000",
    };
    const cy = openNewCycle(d, c);
    const wallet = "B".repeat(44);
    d.prepare("INSERT INTO users(id,wallet,role,banned,created_at) VALUES ('liveu',?,'user',0,?)").run(
      wallet,
      new Date().toISOString(),
    );
    d.prepare(
      "INSERT INTO portfolios(user_id,cycle_id,mode,cash_sol,realized_pnl_sol,volume_sol,trade_count) VALUES ('liveu',?,'ranked','10','0','0',0)",
    ).run(cy.id);
    // Cold-start / seeded inventory — no buy credit
    d.prepare(
      "INSERT INTO positions(id,user_id,cycle_id,mint,symbol,qty,avg_entry_sol,cost_sol,status) VALUES ('seed','liveu',?,?,'T','5000000','0.00000001','0','open')",
    ).run(cy.id, mint);
    const token = issueSession(d, "liveu", wallet).token;
    const catalog: any = { getCoin: async () => coin, resolveForQuote: async () => ({ coin, curve }) };
    const rpc: any = { getTokenBalanceUi: async () => "100000" };
    const app = createApp({ config: c, db: d, catalog, rpc });
    const headers = { "content-type": "application/json", authorization: "Bearer " + token };
    try {
      const sq = await app.request("/v1/quotes", {
        method: "POST",
        headers,
        body: JSON.stringify({ mint, side: "sell", amountToken: "1000000", slippageBps: 5000 }),
      });
      expect(sq.status).toBe(200);
      const q: any = await sq.json();
      const tr = await app.request("/v1/trades", {
        method: "POST",
        headers,
        body: JSON.stringify({ quoteId: q.quoteId }),
      });
      expect(tr.status).toBeGreaterThanOrEqual(400); // untradeable — no buy credit in live
      expect(paperDepthBuys(d, "liveu", mint, cy.id)).toBe(0n);
      expect(paperDepthSells(d, "liveu", mint, cy.id)).toBe(0n);

      // Same wallet buys with paper cash, then sells — net ≤ own buys
      clearAllRateLimits();
      clearRateLimitsForTests();
      const bq = await app.request("/v1/quotes", {
        method: "POST",
        headers,
        body: JSON.stringify({ mint, side: "buy", amountSol: "0.3", slippageBps: 500 }),
      });
      expect(bq.status).toBe(200);
      const buyQ: any = await bq.json();
      expect(
        (await app.request("/v1/trades", { method: "POST", headers, body: JSON.stringify({ quoteId: buyQ.quoteId }) })).status,
      ).toBe(201);
      expect(paperDepthBuys(d, "liveu", mint, cy.id)).toBeGreaterThan(0n);
      const pf: any = await (await app.request("/v1/portfolio", { headers })).json();
      const qty = pf.positions.find((p: any) => p.status === "open")?.qty;
      expect(qty).toBeTruthy();
      clearAllRateLimits();
      clearRateLimitsForTests();
      const sq2 = await app.request("/v1/quotes", {
        method: "POST",
        headers,
        body: JSON.stringify({ mint, side: "sell", amountToken: qty, slippageBps: 5000 }),
      });
      expect(sq2.status).toBe(200);
      const sellQ: any = await sq2.json();
      expect(
        (await app.request("/v1/trades", { method: "POST", headers, body: JSON.stringify({ quoteId: sellQ.quoteId }) })).status,
      ).toBe(201);
      const net = spentPaperDepth(d, "liveu", mint, cy.id);
      const buys = paperDepthBuys(d, "liveu", mint, cy.id);
      expect(net).toBeLessThanOrEqual(buys);
      expect(net).toBeLessThanOrEqual(curve.realSolReserves);
    } finally {
      d.close();
    }
  });
});

describe("paperDepth restart persistence (trades-derived)", () => {
  afterEach(() => reset());

  it("(1) buy then simulated restart (fresh module state, same DB) → full sell succeeds", async () => {
    reset();
    const c = loadConfig({ DATABASE_PATH: ":memory:", PAPERHANDS_MODE: "mock" });
    const d = openDb(c);
    const curve = quoteBuy(initialCurve(), 1_000_000_000n).newState;
    const mint = WSOL;
    const coin: any = {
      mint,
      symbol: "T",
      decimals: 6,
      status: "tradeable",
      venue: "bonding",
      priceSol: "0.00000003",
      liquidityUsd: "100000",
    };
    const cy = openNewCycle(d, c);
    d.prepare("INSERT INTO users(id,wallet,role,banned,created_at) VALUES ('u',?,'user',0,?)").run(
      "A".repeat(44),
      new Date().toISOString(),
    );
    d.prepare(
      "INSERT INTO portfolios(user_id,cycle_id,mode,cash_sol,realized_pnl_sol,volume_sol,trade_count) VALUES ('u',?,'ranked','10','0','0',0)",
    ).run(cy.id);
    const catalog: any = { getCoin: async () => coin, resolveForQuote: async () => ({ coin, curve }) };
    const app1 = createApp({ config: c, db: d, catalog });
    const token = issueSession(d, "u", "A".repeat(44)).token;
    const headers = { "content-type": "application/json", authorization: "Bearer " + token };
    try {
      const bq = await app1.request("/v1/quotes", {
        method: "POST",
        headers,
        body: JSON.stringify({ mint, side: "buy", amountSol: "0.25", slippageBps: 500 }),
      });
      expect(bq.status).toBe(200);
      const buyQ: any = await bq.json();
      expect(
        (await app1.request("/v1/trades", { method: "POST", headers, body: JSON.stringify({ quoteId: buyQ.quoteId }) })).status,
      ).toBe(201);
      expect(paperDepthBuys(d, "u", mint, cy.id)).toBeGreaterThan(0n);

      // Simulate process restart: wipe any in-memory leftovers + new app instance, same DB
      clearPaperDepthForTests();
      clearAllRateLimits();
      clearRateLimitsForTests();
      const app2 = createApp({ config: c, db: d, catalog });
      expect(paperDepthBuys(d, "u", mint, cy.id)).toBeGreaterThan(0n); // credit survives via trades

      const pf: any = await (await app2.request("/v1/portfolio", { headers })).json();
      const qty = pf.positions.find((p: any) => p.status === "open")?.qty;
      expect(qty).toBeTruthy();
      const sq = await app2.request("/v1/quotes", {
        method: "POST",
        headers,
        body: JSON.stringify({ mint, side: "sell", amountToken: qty, slippageBps: 5000 }),
      });
      expect(sq.status).toBe(200);
      const sellQ: any = await sq.json();
      expect(
        (await app2.request("/v1/trades", { method: "POST", headers, body: JSON.stringify({ quoteId: sellQ.quoteId }) })).status,
      ).toBe(201);
    } finally {
      d.close();
    }
  });

  it("(2) zero-buy sell still rejected after restart (live)", async () => {
    reset();
    const c = loadConfig({
      DATABASE_PATH: ":memory:",
      PAPERHANDS_MODE: "live",
      CORS_ORIGINS: "http://127.0.0.1:4331",
      ADMIN_TOKEN: "",
    } as any);
    const d = openDb(c);
    const curve = quoteBuy(initialCurve(), 1_000_000_000n).newState;
    const mint = WSOL;
    const coin: any = {
      mint,
      symbol: "T",
      decimals: 6,
      status: "tradeable",
      venue: "bonding",
      priceSol: "0.00000003",
      liquidityUsd: "100000",
    };
    const cy = openNewCycle(d, c);
    d.prepare("INSERT INTO users(id,wallet,role,banned,created_at) VALUES ('u',?,'user',0,?)").run(
      "Z".repeat(44),
      new Date().toISOString(),
    );
    d.prepare(
      "INSERT INTO portfolios(user_id,cycle_id,mode,cash_sol,realized_pnl_sol,volume_sol,trade_count) VALUES ('u',?,'ranked','10','0','0',0)",
    ).run(cy.id);
    d.prepare(
      "INSERT INTO positions(id,user_id,cycle_id,mint,symbol,qty,avg_entry_sol,cost_sol,status) VALUES ('seed','u',?,?,'T','5000000','0.00000001','0','open')",
    ).run(cy.id, mint);
    const catalog: any = { getCoin: async () => coin, resolveForQuote: async () => ({ coin, curve }) };
    const rpc: any = { getTokenBalanceUi: async () => "100000" };
    const app1 = createApp({ config: c, db: d, catalog, rpc });
    const token = issueSession(d, "u", "Z".repeat(44)).token;
    const headers = { "content-type": "application/json", authorization: "Bearer " + token };
    try {
      clearPaperDepthForTests();
      const app2 = createApp({ config: c, db: d, catalog, rpc });
      expect(paperDepthBuys(d, "u", mint, cy.id)).toBe(0n);
      const sq = await app2.request("/v1/quotes", {
        method: "POST",
        headers,
        body: JSON.stringify({ mint, side: "sell", amountToken: "1000000", slippageBps: 5000 }),
      });
      expect(sq.status).toBe(200);
      const q: any = await sq.json();
      expect(
        (await app2.request("/v1/trades", { method: "POST", headers, body: JSON.stringify({ quoteId: q.quoteId }) })).status,
      ).toBeGreaterThanOrEqual(400);
    } finally {
      d.close();
    }
  });
});
