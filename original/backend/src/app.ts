import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { cors } from "hono/cors";
import type { Config } from "./config.js";
import { publicConfig } from "./config.js";
import type { Db } from "./db.js";
import { createNonce, issueSession, resolveSession, safeEqual, verifyAuth, revokeSession } from "./auth/siws.js";
import { checkHold } from "./hold/gate.js";
import { buildQuote } from "./engine/execute.js";
import { executeFillAtomic, type QuotePayload } from "./engine/fill.js";
import { tryConsumePaperDepth, clearPaperDepthForTests } from "./engine/paperDepth.js";
import { solToLamports } from "./lib/money.js";
import { id, nowIso } from "./lib/ids.js";
import { parseDec } from "./lib/decimal.js";
import { audit } from "./lib/audit.js";
import { CatalogService } from "./services/catalog.js";
import type { RpcClient } from "./rpc/client.js";
import {
  assertFillLiquidityCap,
  assertMinTradeSize,
  checkWalletRateLimit,
  detectWash,
  clearRateLimitsForTests,
} from "./anticheat/guards.js";
import { loadMockCoins } from "./mock/fixtures.js";
import { globalHub, type StreamHub } from "./stream/hub.js";
import { closeAndRotateCycle } from "./cycles/scheduler.js";
import { respondError, mapThrown, publicError } from "./lib/errors.js";
import { clientIp, limitIp, limitWallet, clearAllRateLimits, setTrustedProxies } from "./middleware/rateLimit.js";
import { QuoteBody, TradeBody, AuthVerifyBody, SolAddress } from "./lib/validate.js";
import { computePortfolioEquity } from "./portfolio/valuation.js";
import type { HealthProbe, UpstreamHealth } from "./health/probe.js";
import { createHealthProbe } from "./health/probe.js";

export { clearRateLimitsForTests, clearAllRateLimits, clearPaperDepthForTests };

export type AppDeps = {
  config: Config;
  db: Db;
  rpc?: RpcClient;
  catalog?: CatalogService;
  fetcher?: typeof fetch;
  hub?: StreamHub;
  health?: HealthProbe;
};

/** Socket peer from @hono/node-server bindings (R2). Never from request headers. */
export function peerFromContext(c: { env?: HttpBindings | Record<string, unknown> }): string | null {
  try {
    const incoming = (c.env as HttpBindings | undefined)?.incoming;
    const addr = incoming?.socket?.remoteAddress;
    if (typeof addr === "string" && addr.length) {
      // Strip IPv6-mapped IPv4 prefix
      return addr.startsWith("::ffff:") ? addr.slice(7) : addr;
    }
  } catch {
    /* */
  }
  return null;
}

function err(c: any, status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return c.json(
    {
      error: {
        code,
        message,
        requestId: id("req_"),
        details: extra?.details ?? null,
        retryAfterSec: extra?.retryAfterSec ?? null,
      },
    },
    status,
  );
}

function formatCycle(db: Db, config: Config, row: any) {
  return {
    id: row.id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    bankrollSol: row.bankroll_sol,
    lengthSec: row.length_sec,
    prizePoolSol: null as string | null,
    entrants: Number((db.prepare(`SELECT COUNT(*) AS n FROM portfolios WHERE cycle_id = ?`).get(row.id) as { n: number }).n),
    _mock: config.isMock ? true : undefined,
  };
}

/** Visible current cycle. Never creates a new active while settling exists (F1). */
function currentCycle(db: Db, config: Config) {
  const settling = db
    .prepare(`SELECT * FROM cycles WHERE status = 'settling' ORDER BY starts_at DESC LIMIT 1`)
    .get() as any;
  if (settling) {
    if (settling.successor_id) {
      const succ = db.prepare(`SELECT * FROM cycles WHERE id = ?`).get(settling.successor_id) as any;
      if (succ) return formatCycle(db, config, succ);
    }
    return formatCycle(db, config, settling);
  }
  let row = db.prepare(`SELECT * FROM cycles WHERE status = 'active' ORDER BY starts_at DESC LIMIT 1`).get() as any;
  if (!row) {
    const cid = id("cyc_");
    const starts = new Date();
    starts.setUTCHours(0, 0, 0, 0);
    const ends = new Date(starts.getTime() + config.CYCLE_LENGTH_SEC * 1000);
    db.prepare(
      `INSERT INTO cycles (id, starts_at, ends_at, status, bankroll_sol, length_sec) VALUES (?, ?, ?, 'active', ?, ?)`,
    ).run(cid, starts.toISOString(), ends.toISOString(), config.CYCLE_BANKROLL_SOL, config.CYCLE_LENGTH_SEC);
    row = db.prepare(`SELECT * FROM cycles WHERE id = ?`).get(cid);
  }
  return formatCycle(db, config, row);
}

function ensurePortfolio(db: Db, config: Config, userId: string, cycleId: string) {
  const existing = db.prepare(`SELECT * FROM portfolios WHERE user_id = ? AND cycle_id = ?`).get(userId, cycleId) as any;
  if (existing) return existing;
  db.prepare(
    `INSERT INTO portfolios (user_id, cycle_id, mode, cash_sol, realized_pnl_sol, volume_sol, trade_count)
     VALUES (?, ?, 'ranked', ?, '0', '0', 0)`,
  ).run(userId, cycleId, config.CYCLE_BANKROLL_SOL);
  return db.prepare(`SELECT * FROM portfolios WHERE user_id = ? AND cycle_id = ?`).get(userId, cycleId);
}

async function portfolioSnapshot(db: Db, config: Config, catalog: CatalogService, userId: string, cycleId: string) {
  ensurePortfolio(db, config, userId, cycleId);
  const eq = await computePortfolioEquity({ db, config, catalog, userId, cycleId });
  const posRows = db
    .prepare(`SELECT * FROM positions WHERE user_id = ? AND cycle_id = ? AND status = 'open'`)
    .all(userId, cycleId) as any[];
  const byMint = new Map(posRows.map((r) => [r.mint, r]));
  return {
    cycleId,
    mode: eq.mode as "ranked" | "practice",
    cashSol: eq.cashSol,
    equitySol: eq.equitySol,
    bankrollSol: eq.bankrollSol,
    pnlSol: eq.pnlSol,
    pnlPct: eq.pnlPct,
    realizedPnlSol: eq.realizedPnlSol,
    unrealizedPnlSol: eq.unrealizedPnlSol,
    positions: eq.positions.map((pos) => {
      const row = byMint.get(pos.mint);
      return {
        id: row?.id ?? pos.mint,
        mint: pos.mint,
        symbol: row?.symbol ?? "TOK",
        qty: pos.qty,
        avgEntrySol: row?.avg_entry_sol ?? "0",
        markSol: pos.markSol,
        costSol: pos.costSol,
        valueSol: pos.valueSol,
        unrealizedPnlSol: pos.unrealizedPnlSol,
        unrealizedPnlPct: pos.unrealizedPnlPct,
        status: row?.status ?? "open",
        markStatus: pos.clientMarkStatus,
        markAsOf: pos.markAsOf,
      };
    }),
    updatedAt: nowIso(),
    _mock: config.isMock ? true : undefined,
  };
}

export function createApp(deps: AppDeps) {
  const { config, db, rpc } = deps;
  const hub = deps.hub ?? globalHub;
  const catalog = deps.catalog ?? new CatalogService({ config, db, rpc, fetcher: deps.fetcher });
  setTrustedProxies(
    String((config as any).TRUSTED_PROXIES ?? process.env.TRUSTED_PROXIES ?? "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean),
  );
  const health = deps.health ?? createHealthProbe(config, rpc, deps.fetcher);
  const app = new Hono<{ Bindings: HttpBindings }>();
  const quoteCache = new Map<string, { q: QuotePayload; userId: string; exp: number }>();
  const mockCoins = loadMockCoins();

  app.use(
    "*",
    cors({
      origin: (origin) => {
        // Empty allowlist → reflect nothing (deny). Never invent a localhost default.
        if (!origin) return config.corsOrigins[0] ?? "";
        return config.corsOrigins.includes(origin) ? origin : "";
      },
      credentials: true,
    }),
  );

  app.onError((e, c) => {
    console.error(JSON.stringify({ level: "error", msg: "unhandled", detail: String((e as any)?.message ?? e).slice(0, 200) }));
    const code = mapThrown(e);
    const { status, body } = publicError(code);
    return c.json(body, status as any);
  });

  const sessionOf = (c: any) => {
    const cookie = getCookie(c, "ph_session");
    const hdr = c.req.header("authorization");
    const bearer = hdr?.startsWith("Bearer ") ? hdr.slice(7) : undefined;
    return resolveSession(db, cookie || bearer);
  };

  app.get("/v1/health", (c) =>
    c.json({
      ok: true,
      mode: config.isMock ? "mock" : "live",
      version: config.version,
      time: nowIso(),
      upstream: health.snapshot() as UpstreamHealth,
      // K1: live market_trade SSE channel not wired — explicitly disabled
      features: {
        marketTrade: config.isMock ? "mock" : "disabled",
        heliusTape: config.HELIUS_TAPE_ENABLED === "1" ? "enabled" : "disabled",
      },
    }),
  );

  app.get("/v1/auth/nonce", (c) => {
    const ip = clientIp(c, peerFromContext(c));
    const ipLim = limitIp(ip, "auth");
    if (!ipLim.ok) return respondError(c, "rate_limited");
    const wallet = c.req.query("wallet") ?? "";
    const parsed = SolAddress.safeParse(wallet);
    if (!parsed.success) return respondError(c, "validation_failed");
    const wLim = limitWallet(wallet, "auth");
    if (!wLim.ok) return respondError(c, "rate_limited");
    return c.json(createNonce(db, config, wallet));
  });

  app.post("/v1/auth/verify", async (c) => {
    const ip = clientIp(c, peerFromContext(c));
    if (!limitIp(ip, "auth").ok) return respondError(c, "rate_limited");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return respondError(c, "validation_failed");
    }
    const parsed = AuthVerifyBody.safeParse(body);
    if (!parsed.success) return respondError(c, "validation_failed");
    const { wallet, message, signature } = parsed.data;
    if (!limitWallet(wallet, "auth").ok) return respondError(c, "rate_limited");
    const v = verifyAuth(db, config, wallet, message, signature);
    if (!v.ok) return respondError(c, "unauthorized", v.message);
    let user = db.prepare(`SELECT * FROM users WHERE wallet = ?`).get(wallet) as any;
    if (!user) {
      const uid = id("usr_");
      db.prepare(`INSERT INTO users (id, wallet, role, banned, created_at) VALUES (?, ?, 'user', 0, ?)`).run(uid, wallet, nowIso());
      user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(uid);
    }
    const hold = await checkHold(db, config, wallet, { force: true, rpc });
    const session = issueSession(db, user.id, wallet);
    setCookie(c, "ph_session", session.token, {
      httpOnly: true,
      path: "/",
      maxAge: 7 * 86400,
      sameSite: "Lax",
      secure: config.COOKIE_SECURE === "1",
    });
    ensurePortfolio(db, config, user.id, currentCycle(db, config).id);
    audit(db, wallet, "auth.verify", { holdOk: hold.ok });
    return c.json({
      user: {
        id: user.id,
        wallet: user.wallet,
        createdAt: user.created_at,
        role: user.role,
        banned: !!user.banned,
        hold,
      },
      session: { expiresAt: session.expiresAt },
      accessToken: session.token,
      tokenExpiresAt: session.expiresAt,
      _mock: config.isMock ? true : undefined,
    });
  });

  app.post("/v1/auth/logout", (c) => {
    const cookie = getCookie(c, "ph_session");
    const hdr = c.req.header("authorization");
    const bearer = hdr?.startsWith("Bearer ") ? hdr.slice(7) : undefined;
    revokeSession(db, cookie || bearer);
    deleteCookie(c, "ph_session", { path: "/" });
    return c.body(null, 204);
  });

  app.get("/v1/auth/me", async (c) => {
    const s = sessionOf(c);
    if (!s) return err(c, 401, "unauthorized", "Sign in required");
    const hold = await checkHold(db, config, s.wallet, { rpc });
    return c.json({
      id: s.user_id,
      wallet: s.wallet,
      createdAt: s.user_created,
      role: s.role,
      banned: !!s.banned,
      hold,
      cycle: currentCycle(db, config),
    });
  });

  app.post("/v1/auth/hold/refresh", async (c) => {
    const s = sessionOf(c);
    if (!s) return respondError(c, "unauthorized");
    const ip = clientIp(c, peerFromContext(c));
    if (!limitIp(ip, "auth").ok || !limitWallet(s.wallet, "auth").ok) return respondError(c, "rate_limited");
    try {
      return c.json(await checkHold(db, config, s.wallet, { force: true, rpc }));
    } catch (e) {
      return respondError(c, "upstream_degraded", e);
    }
  });

  app.get("/v1/coins/search", async (c) => {
    const ip = clientIp(c, peerFromContext(c));
    if (!limitIp(ip, "read").ok) return respondError(c, "rate_limited");
    const q = (c.req.query("q") ?? "").trim();
    const limit = Math.min(100, Number(c.req.query("limit") ?? 25));
    if (!q) return c.json({ items: [], nextCursor: null });
    try {
      const items = await catalog.search(q, limit);
      return c.json({ items, nextCursor: null });
    } catch (e: any) {
      return respondError(c, e.code === "rate_limited" ? "rate_limited" : "upstream_degraded", e);
    }
  });

  app.get("/v1/coins/:mint", async (c) => {
    const ip = clientIp(c, peerFromContext(c));
    if (!limitIp(ip, "read").ok) return respondError(c, "rate_limited");
    try {
      const coin = await catalog.getCoin(c.req.param("mint"));
      if (!coin) return respondError(c, "not_found");
      return c.json(coin);
    } catch (e: any) {
      return respondError(c, "upstream_degraded", e);
    }
  });

  app.get("/v1/coins/:mint/ohlcv", async (c) => {
    const resolution = c.req.query("resolution") ?? "5m";
    const currency = (c.req.query("currency") ?? "usd") as "usd" | "sol";
    try {
      return c.json(await catalog.ohlcv(c.req.param("mint"), resolution, currency));
    } catch (e: any) {
      return respondError(c, "upstream_degraded", e);
    }
  });

  app.get("/v1/coins/:mint/trades", async (c) => {
    const ip = clientIp(c, peerFromContext(c));
    if (!limitIp(ip, "read").ok) return respondError(c, "rate_limited");
    const mint = c.req.param("mint");
    const limit = Math.min(100, Number(c.req.query("limit") ?? 25));
    try {
      const result = await catalog.trades(mint, limit);
      return c.json({ ...result, mint });
    } catch (e: any) {
      return respondError(c, e.code === "rate_limited" ? "rate_limited" : "upstream_degraded", e);
    }
  });

  app.get("/v1/coins/:mint/holders", async (c) => {
    try {
      return c.json(await catalog.holders(c.req.param("mint"), Number(c.req.query("limit") ?? 50)));
    } catch (e: any) {
      return respondError(c, "upstream_degraded", e);
    }
  });

  app.get("/v1/feeds/:kind", async (c) => {
    try {
      const items = await catalog.feed(c.req.param("kind"), Math.min(100, Number(c.req.query("limit") ?? 25)));
      return c.json({ items, nextCursor: null });
    } catch (e: any) {
      return respondError(c, mapThrown(e) === "internal_error" ? (e.code ?? "upstream_degraded") : mapThrown(e), e);
    }
  });

  app.post("/v1/quotes", async (c) => {
    const s = sessionOf(c);
    if (!s) return respondError(c, "unauthorized");
    if (s.banned) return respondError(c, "forbidden");
    const ip = clientIp(c, peerFromContext(c));
    if (!limitIp(ip, "quote").ok) return respondError(c, "rate_limited");
    const rl = checkWalletRateLimit(s.wallet, "quote");
    if (!rl.ok || !limitWallet(s.wallet, "quote").ok) return respondError(c, "rate_limited");
    const hold = await checkHold(db, config, s.wallet, { rpc });
    if (!hold.ok) return respondError(c, "hold_insufficient", undefined, `Need ${hold.minHold} PAPER; have ${hold.balance}`);
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return respondError(c, "validation_failed");
    }
    const bodyParse = QuoteBody.safeParse(rawBody);
    if (!bodyParse.success) return respondError(c, "validation_failed");
    const body = bodyParse.data;
    try {
      const resolved = await catalog.resolveForQuote(body.mint);
      if (!resolved) return respondError(c, "not_found");
      const { coin, curve } = resolved;
      if (coin.status === "frozen" || coin.status === "rugged" || coin.status === "untradeable") {
        return respondError(c, "untradeable");
      }
      const q = await buildQuote(config, {
        mint: body.mint,
        side: body.side,
        amountSol: body.amountSol,
        amountToken: body.amountToken,
        slippageBps: body.slippageBps ?? 100,
        venue: coin.venue,
        decimals: coin.decimals,
        curve: curve ?? undefined,
        mockPriceSol: coin.priceSol,
        liquidityUsd: coin.liquidityUsd,
        status: coin.status,
      });
      const bound: QuotePayload = {
        ...q,
        userId: s.user_id,
        decimals: coin.decimals,
        ...(curve && coin.venue === "bonding"
          ? { curveRealSolLamports: curve.realSolReserves.toString() }
          : {}),
      } as QuotePayload;
      quoteCache.set(q.quoteId, { q: bound, userId: s.user_id, exp: Date.parse(q.expiresAt) });
      db.prepare(`INSERT INTO quotes (id, user_id, payload, expires_at, used) VALUES (?, ?, ?, ?, 0)`).run(
        q.quoteId,
        s.user_id,
        JSON.stringify(bound),
        q.expiresAt,
      );
      return c.json({ ...q, _mock: config.isMock ? true : undefined });
    } catch (e: any) {
      const code = mapThrown(e);
      return respondError(c, code === "internal_error" ? (e.code ?? "validation_failed") : code, e);
    }
  });

  app.post("/v1/trades", async (c) => {
    const s = sessionOf(c);
    if (!s) return respondError(c, "unauthorized");
    if (s.banned) return respondError(c, "forbidden");
    const ip = clientIp(c, peerFromContext(c));
    if (!limitIp(ip, "trade").ok) return respondError(c, "rate_limited");
    const rl = checkWalletRateLimit(s.wallet, "trade");
    if (!rl.ok || !limitWallet(s.wallet, "trade").ok) return respondError(c, "rate_limited");
    const hold = await checkHold(db, config, s.wallet, { rpc });
    if (!hold.ok) return respondError(c, "hold_insufficient", undefined, `Need ${hold.minHold} PAPER`);
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return respondError(c, "validation_failed");
    }
    const bodyParse = TradeBody.safeParse(rawBody);
    if (!bodyParse.success) return respondError(c, "validation_failed");
    const body = bodyParse.data;
    const idem = c.req.header("idempotency-key") ?? null;

    // Resolve quote — ownership required (cache + DB)
    const cached = quoteCache.get(body.quoteId);
    if (cached && cached.userId !== s.user_id) {
      audit(db, s.wallet, "trade.reject", { reason: "quote_foreign", quoteId: body.quoteId });
      return respondError(c, "quote_foreign");
    }
    const row = db.prepare(`SELECT * FROM quotes WHERE id = ?`).get(body.quoteId) as any;
    if (!row || row.user_id !== s.user_id) {
      return respondError(c, "quote_foreign");
    }
    const q: QuotePayload = cached?.q ?? JSON.parse(row.payload);
    if (q.userId && q.userId !== s.user_id) return respondError(c, "quote_foreign");

    // F8/P2-09: Idempotency-Key before expiry/consumption; fingerprint conflict on different quote
    if (idem) {
      const prev = db
        .prepare(`SELECT payload FROM trades WHERE user_id = ? AND idempotency_key = ?`)
        .get(s.user_id, idem) as { payload: string } | undefined;
      if (prev) {
        const parsed = JSON.parse(prev.payload);
        const prevQuote = parsed.quoteId ?? parsed.trade?.quoteId ?? null;
        if (prevQuote && prevQuote !== body.quoteId) {
          return respondError(c, "conflict");
        }
        return c.json(parsed, 200);
      }
    }

    if (Date.parse(q.expiresAt) < Date.now() || Date.parse(row.expires_at) < Date.now()) {
      audit(db, s.wallet, "trade.reject", { reason: "quote_stale", quoteId: body.quoteId });
      return respondError(c, "quote_stale");
    }

    // Revalidate coin status / flags at fill time (before single-use check so flags win over quote_used)
    // P1-06: fail closed when market state disappears
    let coinStatus = "tradeable";
    let flaggedStatus: string | null = null;
    let symbol = mockCoins.find((x) => x.mint === q.mint)?.symbol ?? "TOK";
    let decimals = q.decimals ?? 6;
    let liveLiq: string | null = null;
    let coinResolved = false;
    try {
      const coin = await catalog.getCoin(q.mint);
      if (!coin) {
        audit(db, s.wallet, "trade.reject", { reason: "market_state_missing", mint: q.mint });
        return respondError(c, "untradeable");
      }
      coinResolved = true;
      coinStatus = coin.status;
      symbol = coin.symbol ?? symbol;
      decimals = coin.decimals ?? decimals;
      // Never fall back to stale quote liquidity for missing current data
      liveLiq = coin.liquidityUsd ?? null;
      const liveVenue = String(coin.venue ?? "unknown");
      const quotedVenue = String(q.venue ?? "");
      // F6: reject every unsupported/unknown/mismatched venue (requote required)
      if (!liveVenue || liveVenue === "unknown" || (quotedVenue && liveVenue !== quotedVenue)) {
        audit(db, s.wallet, "trade.reject", { reason: "venue_mismatch", mint: q.mint, quotedVenue, liveVenue });
        return respondError(c, "untradeable");
      }
      const flag = db.prepare(`SELECT status FROM coin_flags WHERE mint = ?`).get(q.mint) as { status: string } | undefined;
      flaggedStatus = flag?.status ?? null;
    } catch (e) {
      return respondError(c, "upstream_degraded", e);
    }
    if (!coinResolved) {
      return respondError(c, "untradeable");
    }
    if (flaggedStatus === "frozen" || coinStatus === "frozen" || flaggedStatus === "rugged" || coinStatus === "rugged" || coinStatus === "untradeable" || coinStatus === "unknown") {
      audit(db, s.wallet, "trade.reject", { reason: "untradeable", mint: q.mint, flaggedStatus, coinStatus });
      return respondError(c, "untradeable");
    }
    if (row.used) return respondError(c, "quote_used");

    try {
      const notional = q.side === "buy" ? q.inAmount : q.outAmount;
      if (q.side === "buy") assertMinTradeSize(config, q.inAmount);
      // Bonding uses curve reserves (fail-open on USD null); graduated fail-closed
      if (q.venue === "graduated") {
        assertFillLiquidityCap(config, notional, liveLiq);
      }
      detectWash(db, config, s.user_id, q.mint, q.side, liveLiq);
    } catch (e: any) {
      audit(db, s.wallet, "trade.reject", { reason: e.code ?? "forbidden" });
      return respondError(c, mapThrown(e) === "internal_error" ? (e.code ?? "forbidden") : mapThrown(e), e);
    }

    // Resolve bonding real reserves once for net depth accounting
    let bondingRealReserves = 0n;
    if (q.venue === "bonding") {
      if ((q as any).curveRealSolLamports) {
        bondingRealReserves = BigInt((q as any).curveRealSolLamports);
      }
      if (bondingRealReserves === 0n) {
        try {
          const resolved = await (catalog as any).resolveForQuote?.(q.mint);
          if (resolved?.curve?.realSolReserves != null) {
            bondingRealReserves = BigInt(resolved.curve.realSolReserves);
          }
        } catch {
          /* */
        }
      }
    }

    const cycle = currentCycle(db, config);
    // Refuse trades against settling cycle (no new active mid-settle)
    if (cycle.status === "settling") {
      return respondError(c, "conflict");
    }

    // Net extraction cap from trades table (survives restart; no in-memory Map)
    if (q.venue === "bonding" && q.side === "sell") {
      const outLamports = solToLamports(q.outAmount);
      if (
        !tryConsumePaperDepth({
          db,
          userId: s.user_id,
          mint: q.mint,
          cycleId: cycle.id,
          realSolReserves: bondingRealReserves,
          amountLamports: outLamports,
          requirePriorBuys: !config.isMock,
        })
      ) {
        audit(db, s.wallet, "trade.reject", { reason: "paper_depth_exhausted", mint: q.mint });
        return respondError(c, "untradeable");
      }
    }

    const fill = await executeFillAtomic({
      db,
      config,
      userId: s.user_id,
      wallet: s.wallet,
      cycleId: cycle.id,
      quote: { ...q, liquidityUsd: liveLiq },
      symbol,
      decimals,
      idempotencyKey: idem,
      coinStatus,
      flaggedStatus,
    });
    if (!fill.ok) {
      return respondError(c, fill.code);
    }

    quoteCache.delete(body.quoteId);
    const portfolio = await portfolioSnapshot(db, config, catalog, s.user_id, cycle.id);
    const payload = {
      trade: { ...fill.trade, quoteId: body.quoteId },
      portfolio,
      quoteId: body.quoteId,
      _mock: config.isMock ? true : undefined,
    };
    db.prepare(`UPDATE trades SET payload = ? WHERE id = ?`).run(JSON.stringify(payload), fill.trade.id);

    hub.publish({
      type: "trade_fill",
      userId: s.user_id,
      wallet: s.wallet,
      mint: q.mint,
      trade: fill.trade,
    });
    hub.publish({ type: "portfolio", userId: s.user_id, portfolio });
    hub.publish({
      type: "price",
      mint: q.mint,
      priceSol: q.priceSol,
      priceUsd: null,
      venue: q.venue,
    });
    return c.json(payload, 201);
  });

  app.get("/v1/trades", (c) => {
    const s = sessionOf(c);
    if (!s) return err(c, 401, "unauthorized", "Sign in required");
    const rows = db.prepare(`SELECT payload FROM trades WHERE user_id = ? ORDER BY filled_at DESC LIMIT 50`).all(s.user_id) as any[];
    return c.json({ items: rows.map((r) => JSON.parse(r.payload).trade), nextCursor: null });
  });

  app.get("/v1/portfolio", async (c) => {
    const s = sessionOf(c);
    if (!s) return err(c, 401, "unauthorized", "Sign in required");
    return c.json(await portfolioSnapshot(db, config, catalog, s.user_id, currentCycle(db, config).id));
  });

  app.get("/v1/portfolio/history", async (c) => {
    const s = sessionOf(c);
    if (!s) return err(c, 401, "unauthorized", "Sign in required");
    const snap = await portfolioSnapshot(db, config, catalog, s.user_id, currentCycle(db, config).id);
    return c.json({ items: [{ at: snap.updatedAt, equitySol: snap.equitySol, pnlPct: snap.pnlPct }], nextCursor: null });
  });

  app.post("/v1/portfolio/reset", async (c) => {
    const s = sessionOf(c);
    if (!s) return respondError(c, "unauthorized");
    const body = await c.req.json().catch(() => ({}));
    if (!body?.confirm) return respondError(c, "validation_failed");
    const cycle = currentCycle(db, config);
    const pf = ensurePortfolio(db, config, s.user_id, cycle.id);
    // Active ranked participants cannot reset mid-cycle (contract)
    if (pf.mode === "ranked" && cycle.status === "active" && (pf.trade_count > 0 || Number(pf.volume_sol) > 0)) {
      return respondError(c, "forbidden");
    }
    const openPos = db
      .prepare(`SELECT COUNT(*) AS n FROM positions WHERE user_id = ? AND cycle_id = ? AND status = 'open'`)
      .get(s.user_id, cycle.id) as { n: number };
    if (pf.mode === "ranked" && openPos.n > 0) {
      return respondError(c, "forbidden");
    }
    db.prepare(
      `UPDATE portfolios SET mode = 'practice', cash_sol = ?, realized_pnl_sol = '0', volume_sol = '0', trade_count = 0 WHERE user_id = ? AND cycle_id = ?`,
    ).run(config.CYCLE_BANKROLL_SOL, s.user_id, cycle.id);
    db.prepare(`UPDATE positions SET status = 'closed', qty = '0' WHERE user_id = ? AND cycle_id = ?`).run(s.user_id, cycle.id);
    audit(db, s.wallet, "portfolio.reset", { cycleId: cycle.id });
    return c.json(await portfolioSnapshot(db, config, catalog, s.user_id, cycle.id));
  });

  app.get("/v1/cycles/current", (c) => c.json(currentCycle(db, config)));
  app.get("/v1/cycles", (c) => {
    const rows = db.prepare(`SELECT * FROM cycles ORDER BY starts_at DESC LIMIT 25`).all() as any[];
    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        status: r.status,
        bankrollSol: r.bankroll_sol,
        lengthSec: r.length_sec,
        prizePoolSol: null,
        entrants: 0,
      })),
      nextCursor: null,
    });
  });

  app.get("/v1/leaderboard", async (c) => {
    const requested = c.req.query("cycleId");
    let cycle = currentCycle(db, config);
    if (requested) {
      const row = db.prepare(`SELECT * FROM cycles WHERE id = ?`).get(requested) as any;
      if (row) {
        cycle = {
          id: row.id,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          status: row.status,
          bankrollSol: row.bankroll_sol,
          lengthSec: row.length_sec,
          prizePoolSol: null,
          entrants: Number((db.prepare(`SELECT COUNT(*) AS n FROM portfolios WHERE cycle_id = ?`).get(row.id) as { n: number }).n),
          _mock: config.isMock ? true : undefined,
        };
      }
    }
    const rows = db
      .prepare(
        `SELECT p.*, u.wallet, u.banned FROM portfolios p JOIN users u ON u.id = p.user_id
         WHERE p.cycle_id = ? AND p.mode = 'ranked' AND u.banned = 0`,
      )
      .all(cycle.id) as any[];
    const items = [];
    for (const r of rows) {
      const snap = await portfolioSnapshot(db, config, catalog, r.user_id, cycle.id);
      const tradeOk = r.trade_count >= config.MIN_CYCLE_TRADES;
      const hold = await checkHold(db, config, r.wallet, { rpc });
      const eligible = tradeOk && hold.ok && r.mode === "ranked" && !r.banned;
      let reason: string | null = null;
      if (!tradeOk) reason = `Need ≥${config.MIN_CYCLE_TRADES} trades`;
      else if (!hold.ok) reason = "Insufficient PAPER hold";
      items.push({
        rank: 0,
        wallet: r.wallet,
        displayName: null as string | null,
        pnlPct: snap.pnlPct,
        pnlSol: snap.pnlSol,
        volumeSol: r.volume_sol,
        trades: r.trade_count,
        eligible,
        ineligibleReason: reason,
      });
    }
    items.sort((a, b) => {
      const d = parseDec(b.pnlPct) - parseDec(a.pnlPct);
      if (d !== 0) return d;
      const d2 = parseDec(b.pnlSol) - parseDec(a.pnlSol);
      if (d2 !== 0) return d2;
      return parseDec(b.volumeSol) - parseDec(a.volumeSol);
    });
    items.forEach((x, i) => (x.rank = i + 1));
    if (config.isMock && items.filter((x) => x.eligible).length === 0) {
      for (let i = 0; i < 5; i++) {
        items.push({
          rank: 0,
          wallet: `MockLead${String(i).padStart(38, "1")}`,
          displayName: null,
          pnlPct: String(80 - i * 12),
          pnlSol: String(8 - i),
          volumeSol: String(40 - i * 5),
          trades: 10 - i,
          eligible: true,
          ineligibleReason: null,
        });
      }
      items.sort((a, b) => {
        const d = parseDec(b.pnlPct) - parseDec(a.pnlPct);
        if (d !== 0) return d;
        return parseDec(b.volumeSol) - parseDec(a.volumeSol);
      });
      items.forEach((x, i) => (x.rank = i + 1));
    }
    const s = sessionOf(c);
    const me = s ? items.find((x) => x.wallet === s.wallet) ?? null : null;
    return c.json({ cycleId: cycle.id, updatedAt: nowIso(), items, nextCursor: null, me, _mock: config.isMock ? true : undefined });
  });

  app.get("/v1/watchlist", async (c) => {
    const s = sessionOf(c);
    if (!s) return err(c, 401, "unauthorized", "Sign in required");
    const rows = db.prepare(`SELECT mint FROM watchlist WHERE user_id = ?`).all(s.user_id) as { mint: string }[];
    const items = [];
    for (const r of rows) {
      const coin = await catalog.getCoin(r.mint).catch(() => null);
      if (coin) items.push(coin);
    }
    return c.json({ items });
  });
  app.put("/v1/watchlist", async (c) => {
    const s = sessionOf(c);
    if (!s) return err(c, 401, "unauthorized", "Sign in required");
    const body = await c.req.json();
    const mints: string[] = (body.mints ?? []).slice(0, 50);
    db.prepare(`DELETE FROM watchlist WHERE user_id = ?`).run(s.user_id);
    for (const m of mints) db.prepare(`INSERT OR IGNORE INTO watchlist (user_id, mint) VALUES (?, ?)`).run(s.user_id, m);
    return c.json({ ok: true, count: mints.length });
  });
  app.post("/v1/watchlist/:mint", (c) => {
    const s = sessionOf(c);
    if (!s) return err(c, 401, "unauthorized", "Sign in required");
    db.prepare(`INSERT OR IGNORE INTO watchlist (user_id, mint) VALUES (?, ?)`).run(s.user_id, c.req.param("mint"));
    return c.json({ ok: true });
  });
  app.delete("/v1/watchlist/:mint", (c) => {
    const s = sessionOf(c);
    if (!s) return err(c, 401, "unauthorized", "Sign in required");
    db.prepare(`DELETE FROM watchlist WHERE user_id = ? AND mint = ?`).run(s.user_id, c.req.param("mint"));
    return c.body(null, 204);
  });

  const requireAdmin = (c: any) => {
    const ip = clientIp(c, peerFromContext(c));
    const hdr = c.req.header("authorization");
    const token = hdr?.startsWith("Bearer ") ? hdr.slice(7) : "";
    const ok = !!(config.ADMIN_TOKEN && token && safeEqual(token, config.ADMIN_TOKEN));
    if (!ok) {
      if (!limitIp(ip, "admin").ok) return false;
    }
    return ok;
  };

  app.get("/v1/admin/config", (c) => {
    if (!requireAdmin(c)) return err(c, 401, "unauthorized", "Admin only");
    return c.json(publicConfig(config));
  });
  app.patch("/v1/admin/config", async (c) => {
    if (!requireAdmin(c)) return err(c, 401, "unauthorized", "Admin only");
    return c.json({ ok: true, applied: await c.req.json(), note: "MVP acknowledges; restart with env to persist" });
  });
  app.get("/v1/admin/cycles", (c) => {
    if (!requireAdmin(c)) return err(c, 401, "unauthorized", "Admin only");
    return c.json({ items: [currentCycle(db, config)] });
  });
  app.post("/v1/admin/cycles", async (c) => {
    if (!requireAdmin(c)) return err(c, 401, "unauthorized", "Admin only");
    const body = await c.req.json().catch(() => ({}));
    const cid = id("cyc_");
    const starts = body.startsAt ? new Date(body.startsAt) : new Date();
    const length = Number(body.lengthSec ?? config.CYCLE_LENGTH_SEC);
    const ends = new Date(starts.getTime() + length * 1000);
    db.prepare(`UPDATE cycles SET status = 'closed' WHERE status = 'active'`).run();
    db.prepare(
      `INSERT INTO cycles (id, starts_at, ends_at, status, bankroll_sol, length_sec) VALUES (?, ?, ?, 'active', ?, ?)`,
    ).run(cid, starts.toISOString(), ends.toISOString(), config.CYCLE_BANKROLL_SOL, length);
    return c.json(currentCycle(db, config), 201);
  });
  app.post("/v1/admin/cycles/:id/close", (c) => {
    if (!requireAdmin(c)) return err(c, 401, "unauthorized", "Admin only");
    db.prepare(`UPDATE cycles SET status = 'closed' WHERE id = ?`).run(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.get("/v1/admin/users", (c) => {
    if (!requireAdmin(c)) return err(c, 401, "unauthorized", "Admin only");
    return c.json({ items: db.prepare(`SELECT id, wallet, role, banned, created_at FROM users LIMIT 100`).all() });
  });
  app.post("/v1/admin/users/:wallet/ban", async (c) => {
    if (!requireAdmin(c)) return err(c, 401, "unauthorized", "Admin only");
    const body = await c.req.json().catch(() => ({}));
    db.prepare(`UPDATE users SET banned = 1 WHERE wallet = ?`).run(c.req.param("wallet"));
    audit(db, "admin", "user.ban", { wallet: c.req.param("wallet"), reason: body.reason ?? null });
    return c.json({ ok: true });
  });
  app.post("/v1/admin/users/:wallet/unban", (c) => {
    if (!requireAdmin(c)) return err(c, 401, "unauthorized", "Admin only");
    db.prepare(`UPDATE users SET banned = 0 WHERE wallet = ?`).run(c.req.param("wallet"));
    return c.json({ ok: true });
  });
  app.post("/v1/admin/coins/:mint/flag", async (c) => {
    if (!requireAdmin(c)) return respondError(c, "unauthorized");
    const body = await c.req.json();
    const mint = c.req.param("mint");
    db.prepare(
      `INSERT INTO coin_flags (mint, status, reason, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(mint) DO UPDATE SET status = excluded.status, reason = excluded.reason, updated_at = excluded.updated_at`,
    ).run(mint, body.status, body.reason ?? null, nowIso());
    // Invalidate outstanding unused quotes for this mint
    const rows = db.prepare(`SELECT id, payload FROM quotes WHERE used = 0`).all() as any[];
    for (const r of rows) {
      try {
        const q = JSON.parse(r.payload);
        if (q.mint === mint) {
          db.prepare(`UPDATE quotes SET used = 1 WHERE id = ?`).run(r.id);
          quoteCache.delete(r.id);
        }
      } catch { /* */ }
    }
    audit(db, "admin", "coin.flag", { mint, status: body.status });
    return c.json({ ok: true });
  });
  app.get("/v1/admin/payouts", (c) => {
    if (!requireAdmin(c)) return err(c, 401, "unauthorized", "Admin only");
    const cycleId = c.req.query("cycleId");
    const rows = cycleId
      ? db.prepare(`SELECT * FROM payouts WHERE cycle_id = ?`).all(cycleId)
      : db.prepare(`SELECT * FROM payouts ORDER BY updated_at DESC LIMIT 100`).all();
    return c.json({
      items: (rows as any[]).map((r) => ({
        id: r.id,
        cycleId: r.cycle_id,
        rank: r.rank,
        wallet: r.wallet,
        pnlPct: r.pnl_pct,
        amountSol: r.amount_sol,
        status: r.status,
        txRef: r.tx_ref,
        note: r.note,
        updatedAt: r.updated_at,
      })),
    });
  });
  app.post("/v1/admin/payouts/generate", async (c) => {
    if (!requireAdmin(c)) return respondError(c, "unauthorized");
    const body = await c.req.json();
    const cycleId = body.cycleId ?? currentCycle(db, config).id;
    const topN = Number(body.topN ?? 10);
    const lbRes = await app.request(`/v1/leaderboard?cycleId=${encodeURIComponent(cycleId)}`);
    const lb = (await lbRes.json()) as any;
    const eligible = (lb.items ?? []).filter((r: any) => r.eligible);
    const created = [];
    for (const row of eligible.slice(0, topN)) {
      const existing = db
        .prepare(`SELECT id FROM payouts WHERE cycle_id = ? AND wallet = ? AND rank = ?`)
        .get(cycleId, row.wallet, row.rank) as { id: string } | undefined;
      if (existing) {
        created.push(existing.id);
        continue;
      }
      const pid = id("pay_");
      db.prepare(
        `INSERT INTO payouts (id, cycle_id, rank, wallet, pnl_pct, amount_sol, status, tx_ref, note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?)`,
      ).run(pid, cycleId, row.rank, row.wallet, row.pnlPct, (1.5 / Math.max(1, row.rank)).toFixed(4), nowIso());
      created.push(pid);
    }
    return c.json({ created, note: "Manual queue only — no SOL sent; eligible ranked only" }, 201);
  });
  app.patch("/v1/admin/payouts/:id", async (c) => {
    if (!requireAdmin(c)) return err(c, 401, "unauthorized", "Admin only");
    const body = await c.req.json();
    db.prepare(
      `UPDATE payouts SET status = ?, tx_ref = COALESCE(?, tx_ref), note = COALESCE(?, note), updated_at = ? WHERE id = ?`,
    ).run(body.status, body.txRef ?? null, body.note ?? null, nowIso(), c.req.param("id"));
    return c.json({ ok: true, note: "Marked only; Paperhands never sends mainnet funds in MVP" });
  });
  app.get("/v1/admin/audit", (c) => {
    if (!requireAdmin(c)) return err(c, 401, "unauthorized", "Admin only");
    return c.json({ items: db.prepare(`SELECT * FROM audit_log ORDER BY at DESC LIMIT 100`).all(), nextCursor: null });
  });

  app.get("/v1/stream", (c) => {
    const ip = clientIp(c, peerFromContext(c));
    const ticketParam = c.req.query("ticket");
    const ticket = hub.resolveTicket(ticketParam);
    if (ticketParam && !ticket) return err(c, 401, "unauthorized", "Stream ticket expired or invalid");
    // F4: bind ticket to issuing IP with no loopback exemption
    if (ticket?.ip && ticket.ip !== ip) {
      return err(c, 401, "unauthorized", "Stream ticket IP mismatch");
    }

    const channelList = (c.req.query("channels") ?? "prices,feeds,leaderboard,trades,portfolio,cycle").split(",").filter(Boolean);
    const mintList = (c.req.query("mints") ?? "").split(",").filter(Boolean);
    const channels = new Set([...(ticket?.channels ?? []), ...channelList].slice(0, 8));
    const mints = new Set([...(ticket?.mints ?? []), ...mintList].slice(0, 25));

    const s = sessionOf(c);
    // P2-01: session and ticket must not disagree; prefer session, reject override
    if (ticket?.userId && s?.user_id && ticket.userId !== s.user_id) {
      return err(c, 401, "unauthorized", "Stream ticket identity conflict");
    }
    const userId = s?.user_id ?? ticket?.userId ?? null;

    const stream = hub.createSseStream({
      channels,
      mints,
      userId,
      ip,
      signal: (c as any).req.raw?.signal,
    });
    // P2-10: never emit mock prices in live mode
    if (config.isMock && channels.has("prices")) {
      const coin = mockCoins[1] ?? mockCoins[0];
      hub.publish({ type: "price", mint: coin.mint, priceSol: coin.priceSol, priceUsd: coin.priceUsd, venue: coin.venue, _mock: true });
    }
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  });

  app.post("/v1/stream/ticket", async (c) => {
    const ip = clientIp(c, peerFromContext(c));
    if (!limitIp(ip, "ticket").ok) return respondError(c, "rate_limited");
    const s = sessionOf(c);
    if (s && !limitWallet(s.wallet, "ticket").ok) return respondError(c, "rate_limited");
    const body = await c.req.json().catch(() => ({}));
    const channels = Array.isArray(body.channels) ? body.channels.map(String) : ["prices", "feeds", "leaderboard", "trades", "portfolio", "cycle"];
    const mints = Array.isArray(body.mints) ? body.mints.map(String) : [];
    if (mints.length > 25) return err(c, 400, "validation_failed", "Max 25 mints per ticket");
    const t = hub.issueTicket(s?.user_id ?? null, s?.wallet ?? null, channels, mints, ip);
    return c.json({
      ticket: t.ticket,
      expiresAt: new Date(t.expiresAt).toISOString(),
      maxMints: 25,
      maxChannels: 8,
    });
  });

  app.post("/v1/admin/cycles/rotate", async (c) => {
    if (!requireAdmin(c)) return respondError(c, "unauthorized");
    const result = await closeAndRotateCycle(db, config, {
      hub,
      topN: 25,
      force: true,
      catalog,
      fetcher: deps.fetcher,
    });
    return c.json({ ok: true, result });
  });


  return app;
}

/** Back-compat for tests that called createApp(config, db). */
export function createAppLegacy(config: Config, db: Db) {
  return createApp({ config, db });
}
