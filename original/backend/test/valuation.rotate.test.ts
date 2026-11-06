import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { closeAndRotateCycle, openNewCycle } from "../src/cycles/scheduler.js";
import { CatalogService } from "../src/services/catalog.js";
import { id, nowIso } from "../src/lib/ids.js";
import { StreamHub } from "../src/stream/hub.js";
import { markMintsBatch, valuePosition, type MintMark } from "../src/portfolio/valuation.js";
import { computePortfolioEquity } from "../src/portfolio/valuation.js";

const MINT_UP = "PumpBondMock11111111111111111111111111111";
const MINT_RUG = "PumpGradMock11111111111111111111111111111";

describe("shared valuation + rotate marks", () => {
  it("valuePosition uses live mark not cost", () => {
    const mark: MintMark = {
      mint: MINT_UP,
      markSol: "0.0000001",
      status: "tradeable",
      source: "injected",
      asOf: nowIso(),
    };
    // qty such that value >> cost
    const v = valuePosition({ mint: MINT_UP, qty: "10000000", cost_sol: "0.5" }, mark, 6);
    expect(Number(v.valueSol)).toBeGreaterThan(0.5);
    expect(v.markSol).toBe("0.0000001");
  });

  it("rugged mark is zero and fails closed", async () => {
    const config = loadConfig({ PAPERHANDS_MODE: "mock", DATABASE_PATH: ":memory:" });
    const db = openDb(config);
    const catalog = new CatalogService({ config, db });
    db.prepare(
      `INSERT INTO coin_flags (mint, status, reason, updated_at) VALUES (?, 'rugged', 'test', ?)`,
    ).run(MINT_UP, nowIso());
    const marks = await markMintsBatch({ mints: [MINT_UP], catalog, db, config });
    expect(marks.get(MINT_UP)!.markSol).toBe("0");
    expect(marks.get(MINT_UP)!.status).toBe("rugged");
  });

  it("rotate ranks by live mark; rugged position counts as 0; persists marks_json", async () => {
    const config = loadConfig({
      PAPERHANDS_MODE: "mock",
      DATABASE_PATH: ":memory:",
      CYCLE_BANKROLL_SOL: "10",
      MIN_CYCLE_TRADES: "0",
    });
    const db = openDb(config);
    const catalog = new CatalogService({ config, db });
    const hub = new StreamHub();
    const cycle = openNewCycle(db, config);

    const uidA = id("usr_");
    const uidB = id("usr_");
    const walletA = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const walletB = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    db.prepare(`INSERT INTO users (id, wallet, role, banned, created_at) VALUES (?, ?, 'user', 0, ?)`).run(uidA, walletA, nowIso());
    db.prepare(`INSERT INTO users (id, wallet, role, banned, created_at) VALUES (?, ?, 'user', 0, ?)`).run(uidB, walletB, nowIso());

    // A: cash 5 + position cost 5, but live mark makes position worth ~20 → high equity
    db.prepare(
      `INSERT INTO portfolios (user_id, cycle_id, mode, cash_sol, realized_pnl_sol, volume_sol, trade_count)
       VALUES (?, ?, 'ranked', '5', '0', '10', 3)`,
    ).run(uidA, cycle.id);
    db.prepare(
      `INSERT INTO positions (id, user_id, cycle_id, mint, symbol, qty, avg_entry_sol, cost_sol, status)
       VALUES (?, ?, ?, ?, 'UP', '100000000', '0.00000005', '5', 'open')`,
    ).run(id("pos_"), uidA, cycle.id, MINT_UP);

    // B: cash 9 + rugged position cost 1 → should count as cash 9 only (mark 0)
    db.prepare(
      `INSERT INTO portfolios (user_id, cycle_id, mode, cash_sol, realized_pnl_sol, volume_sol, trade_count)
       VALUES (?, ?, 'ranked', '9', '0', '10', 3)`,
    ).run(uidB, cycle.id);
    db.prepare(
      `INSERT INTO positions (id, user_id, cycle_id, mint, symbol, qty, avg_entry_sol, cost_sol, status)
       VALUES (?, ?, ?, ?, 'RUG', '1000000', '0.000001', '1', 'open')`,
    ).run(id("pos_"), uidB, cycle.id, MINT_RUG);

    const injected = new Map<string, MintMark>([
      [
        MINT_UP,
        { mint: MINT_UP, markSol: "0.0000002", status: "tradeable", source: "injected", asOf: nowIso() },
      ],
      [
        MINT_RUG,
        { mint: MINT_RUG, markSol: "0", status: "rugged", source: "injected", asOf: nowIso() },
      ],
    ]);

    // Sanity: A equity with live mark >> B (who would win on cost-basis mark)
    const eqA = await computePortfolioEquity({
      db,
      config,
      catalog,
      userId: uidA,
      cycleId: cycle.id,
      marks: injected,
    });
    const eqB = await computePortfolioEquity({
      db,
      config,
      catalog,
      userId: uidB,
      cycleId: cycle.id,
      marks: injected,
    });
    // A: 5 + 100000000 * 0.0000002 / 1e0 with 6 decimals: qtyRaw=100000000 * 10^0? qty "100000000" decimals 6 → raw = 100000000 * 10^6
    // Actually tokenToRaw("100000000", 6) = 100000000 * 10^6 = 1e14
    // value = 1e14 * markLamports / 1e6; mark 0.0000002 SOL = 200 lamports
    // value = 1e14 * 200 / 1e6 = 2e10 lamports = 20 SOL. equity = 25
    expect(Number(eqA.equitySol)).toBeGreaterThan(20);
    // B: rugged → value 0, equity = 9
    expect(Number(eqB.equitySol)).toBe(9);
    // If marked at cost, A would be 10 equity, B 10 — tie/B could win on volume. Live mark must put A first.
    expect(Number(eqA.pnlPct)).toBeGreaterThan(Number(eqB.pnlPct));

    const result = await closeAndRotateCycle(db, config, {
      hub,
      topN: 10,
      force: true,
      catalog,
      marks: injected,
    });
    expect(result).not.toBeNull();
    expect(result!.marks.length).toBeGreaterThanOrEqual(2);

    const closed = db.prepare(`SELECT marks_json, status FROM cycles WHERE id = ?`).get(cycle.id) as any;
    expect(closed.status).toBe("closed");
    expect(closed.marks_json).toBeTruthy();
    const snap = JSON.parse(closed.marks_json);
    expect(snap.marks.find((m: any) => m.mint === MINT_UP).markSol).toBe("0.0000002");
    expect(snap.marks.find((m: any) => m.mint === MINT_RUG).markSol).toBe("0");

    // Payouts: A should be rank 1 (higher live PnL)
    const pays = db.prepare(`SELECT * FROM payouts WHERE cycle_id = ? ORDER BY rank`).all(cycle.id) as any[];
    expect(pays[0].wallet).toBe(walletA);
    expect(pays[0].rank).toBe(1);
  });
});
