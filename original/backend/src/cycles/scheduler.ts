/**
 * 24h cycle scheduler with atomic claim + unique active invariant.
 */
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { id, nowIso } from "../lib/ids.js";
import { parseDec } from "../lib/decimal.js";
import { audit } from "../lib/audit.js";
import type { StreamHub } from "../stream/hub.js";
import type { CatalogService } from "../services/catalog.js";
import { log } from "../lib/logger.js";
import {
  collectOpenMints,
  computePortfolioEquity,
  markMintsBatch,
  type MintMark,
} from "../portfolio/valuation.js";

export type CycleRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  bankroll_sol: string;
  length_sec: number;
  marks_json?: string | null;
  successor_id?: string | null;
};

let rotateInFlight: Promise<any> | null = null;

export function getActiveCycle(db: Db, config: Config): CycleRow {
  // F1: never open a new active while a settlement is in flight
  const settling = db
    .prepare(`SELECT * FROM cycles WHERE status = 'settling' ORDER BY starts_at DESC LIMIT 1`)
    .get() as CycleRow | undefined;
  if (settling) {
    if (settling.successor_id) {
      const succ = db.prepare(`SELECT * FROM cycles WHERE id = ?`).get(settling.successor_id) as CycleRow | undefined;
      if (succ) return succ;
    }
    return settling;
  }
  let row = db.prepare(`SELECT * FROM cycles WHERE status = 'active' ORDER BY starts_at DESC LIMIT 1`).get() as CycleRow | undefined;
  if (!row) row = openNewCycle(db, config);
  return row;
}

export function openNewCycle(db: Db, config: Config, startsAt = new Date()): CycleRow {
  const cid = id("cyc_");
  const ends = new Date(startsAt.getTime() + config.CYCLE_LENGTH_SEC * 1000);
  db.prepare(
    `INSERT INTO cycles (id, starts_at, ends_at, status, bankroll_sol, length_sec) VALUES (?, ?, ?, 'active', ?, ?)`,
  ).run(cid, startsAt.toISOString(), ends.toISOString(), config.CYCLE_BANKROLL_SOL, config.CYCLE_LENGTH_SEC);
  return db.prepare(`SELECT * FROM cycles WHERE id = ?`).get(cid) as CycleRow;
}

export type LeaderboardRow = {
  userId: string;
  wallet: string;
  pnlPct: string;
  pnlSol: string;
  volumeSol: string;
  trades: number;
  eligible: boolean;
  rank: number;
};

export async function snapshotLeaderboard(
  db: Db,
  config: Config,
  cycleId: string,
  opts: { catalog: CatalogService; marks?: Map<string, MintMark>; fetcher?: typeof fetch },
): Promise<{ items: LeaderboardRow[]; marks: MintMark[] }> {
  const mints = collectOpenMints(db, cycleId);
  const marks =
    opts.marks ??
    (await markMintsBatch({ mints, catalog: opts.catalog, db, config, fetcher: opts.fetcher }));

  const rows = db
    .prepare(
      `SELECT p.user_id, p.mode, p.trade_count, p.volume_sol, u.banned, u.wallet
       FROM portfolios p JOIN users u ON u.id = p.user_id
       WHERE p.cycle_id = ? AND p.mode = 'ranked' AND u.banned = 0`,
    )
    .all(cycleId) as any[];

  const items: Omit<LeaderboardRow, "rank">[] = [];
  for (const r of rows) {
    const eq = await computePortfolioEquity({
      db,
      config,
      catalog: opts.catalog,
      userId: r.user_id,
      cycleId,
      marks,
      fetcher: opts.fetcher,
    });
    items.push({
      userId: r.user_id,
      wallet: r.wallet,
      pnlPct: eq.pnlPct,
      pnlSol: eq.pnlSol,
      volumeSol: r.volume_sol,
      trades: r.trade_count,
      eligible: r.trade_count >= config.MIN_CYCLE_TRADES && r.mode === "ranked" && !r.banned,
    });
  }
  items.sort((a, b) => {
    const d = parseDec(b.pnlPct) - parseDec(a.pnlPct);
    if (d !== 0) return d;
    const d2 = parseDec(b.pnlSol) - parseDec(a.pnlSol);
    if (d2 !== 0) return d2;
    return parseDec(b.volumeSol) - parseDec(a.volumeSol);
  });
  return { items: items.map((x, i) => ({ ...x, rank: i + 1 })), marks: [...marks.values()] };
}

export function enqueuePayouts(db: Db, cycleId: string, leaderboard: LeaderboardRow[], topN: number) {
  const created: string[] = [];
  for (const row of leaderboard.filter((x) => x.eligible).slice(0, topN)) {
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
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, 'auto-enqueued on cycle close', ?)`,
    ).run(pid, cycleId, row.rank, row.wallet, row.pnlPct, (1.5 / row.rank).toFixed(4), nowIso());
    created.push(pid);
  }
  return created;
}

export function resetPortfoliosForCycle(db: Db, config: Config, newCycleId: string, previousCycleId: string) {
  const users = db.prepare(`SELECT DISTINCT user_id FROM portfolios WHERE cycle_id = ?`).all(previousCycleId) as { user_id: string }[];
  for (const u of users) {
    db.prepare(
      `INSERT INTO portfolios (user_id, cycle_id, mode, cash_sol, realized_pnl_sol, volume_sol, trade_count)
       VALUES (?, ?, 'ranked', ?, '0', '0', 0)
       ON CONFLICT(user_id, cycle_id) DO UPDATE SET cash_sol = excluded.cash_sol, realized_pnl_sol = '0', volume_sol = '0', trade_count = 0, mode = 'ranked'`,
    ).run(u.user_id, newCycleId, config.CYCLE_BANKROLL_SOL);
    db.prepare(`UPDATE positions SET status = 'closed', qty = '0' WHERE user_id = ? AND cycle_id = ?`).run(u.user_id, previousCycleId);
  }
}

export function persistCycleMarks(db: Db, cycleId: string, marks: MintMark[]) {
  const payload = JSON.stringify({
    asOf: nowIso(),
    marks: marks.map((m) => ({
      mint: m.mint,
      markSol: m.markSol,
      status: m.status,
      source: m.source,
      asOf: m.asOf,
    })),
  });
  try {
    db.prepare(`UPDATE cycles SET marks_json = ? WHERE id = ?`).run(payload, cycleId);
  } catch {
    /* */
  }
  return payload;
}

type RotateResult = {
  closedId: string;
  nextId: string;
  payouts: string[];
  leaderboardSize: number;
  marks: MintMark[];
};

function findSuccessorResult(db: Db, closedId: string): RotateResult | null {
  const row = db.prepare(`SELECT successor_id FROM cycles WHERE id = ?`).get(closedId) as
    | { successor_id: string | null }
    | undefined;
  if (!row?.successor_id) return null;
  return { closedId, nextId: row.successor_id, payouts: [], leaderboardSize: 0, marks: [] };
}

/**
 * Atomic rotate: claim active→settling under BEGIN IMMEDIATE, marks outside, then
 * finish under lock. Concurrent callers serialize; retries return the same successor.
 */
export async function closeAndRotateCycle(
  db: Db,
  config: Config,
  opts: {
    topN?: number;
    hub?: StreamHub;
    force?: boolean;
    catalog: CatalogService;
    fetcher?: typeof fetch;
    marks?: Map<string, MintMark>;
  },
): Promise<RotateResult | null> {
  const run = async (): Promise<RotateResult | null> => {
    // --- Claim phase ---
    db.exec("BEGIN IMMEDIATE");
    let claimedId: string | null = null;
    try {
      const active = db
        .prepare(`SELECT * FROM cycles WHERE status = 'active' ORDER BY starts_at DESC LIMIT 1`)
        .get() as CycleRow | undefined;
      const settling = db
        .prepare(`SELECT * FROM cycles WHERE status = 'settling' ORDER BY starts_at DESC LIMIT 1`)
        .get() as CycleRow | undefined;

      if (!active && !settling) {
        const next = openNewCycle(db, config);
        db.exec("COMMIT");
        return { closedId: "", nextId: next.id, payouts: [], leaderboardSize: 0, marks: [] };
      }

      // Idempotent: active is successor of a closed cycle and not yet due → return prior result
      if (active && opts.force) {
        const pred = db
          .prepare(`SELECT id FROM cycles WHERE successor_id = ? AND status = 'closed'`)
          .get(active.id) as { id: string } | undefined;
        const ended = Date.parse(active.ends_at) <= Date.now();
        if (pred && !ended) {
          db.exec("COMMIT");
          return { closedId: pred.id, nextId: active.id, payouts: [], leaderboardSize: 0, marks: [] };
        }
      }

      if (settling) {
        // Recover / join in-flight settlement
        const done = findSuccessorResult(db, settling.id);
        if (done) {
          db.exec("COMMIT");
          return done;
        }
        claimedId = settling.id;
        db.exec("COMMIT");
      } else if (active) {
        const ended = Date.parse(active.ends_at) <= Date.now();
        if (!ended && !opts.force) {
          db.exec("COMMIT");
          return null;
        }
        const upd = db.prepare(`UPDATE cycles SET status = 'settling' WHERE id = ? AND status = 'active'`).run(active.id);
        if (upd.changes !== 1) {
          // Lost race — reload
          const again = db.prepare(`SELECT * FROM cycles WHERE id = ?`).get(active.id) as CycleRow;
          db.exec("COMMIT");
          if (again?.status === "closed" && again.successor_id) {
            return { closedId: again.id, nextId: again.successor_id, payouts: [], leaderboardSize: 0, marks: [] };
          }
          if (again?.status === "settling") {
            claimedId = again.id;
          } else {
            return null;
          }
        } else {
          claimedId = active.id;
          db.exec("COMMIT");
        }
      } else {
        db.exec("COMMIT");
        return null;
      }
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* */
      }
      throw e;
    }

    if (!claimedId) return null;

    // --- Marks (outside ledger lock) ---
    const { items: lb, marks } = await snapshotLeaderboard(db, config, claimedId, {
      catalog: opts.catalog,
      marks: opts.marks,
      fetcher: opts.fetcher,
    });

    // --- Finish phase ---
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare(`SELECT * FROM cycles WHERE id = ?`).get(claimedId) as CycleRow;
      if (row.status === "closed" && row.successor_id) {
        db.exec("COMMIT");
        return { closedId: claimedId, nextId: row.successor_id, payouts: [], leaderboardSize: lb.length, marks };
      }
      if (row.status !== "settling") {
        db.exec("COMMIT");
        return null;
      }

      persistCycleMarks(db, claimedId, marks);
      const payouts = enqueuePayouts(db, claimedId, lb, opts.topN ?? 25);

      const nextId = id("cyc_");
      const starts = new Date();
      const ends = new Date(starts.getTime() + config.CYCLE_LENGTH_SEC * 1000);
      db.prepare(
        `INSERT INTO cycles (id, starts_at, ends_at, status, bankroll_sol, length_sec) VALUES (?, ?, ?, 'active', ?, ?)`,
      ).run(nextId, starts.toISOString(), ends.toISOString(), config.CYCLE_BANKROLL_SOL, config.CYCLE_LENGTH_SEC);

      db.prepare(`UPDATE cycles SET status = 'closed', successor_id = ? WHERE id = ?`).run(nextId, claimedId);
      resetPortfoliosForCycle(db, config, nextId, claimedId);
      db.exec("COMMIT");

      audit(db, "system", "cycle.rotate", {
        closedId: claimedId,
        nextId,
        payouts: payouts.length,
        leaderboardSize: lb.length,
        marks: marks.length,
      });

      opts.hub?.publish({ type: "cycle", cycleId: claimedId, status: "closed", nextCycleId: nextId });
      opts.hub?.publish({ type: "cycle", cycleId: nextId, status: "active" });
      opts.hub?.publish({
        type: "leaderboard",
        cycleId: claimedId,
        top: lb.slice(0, 10).map((x) => ({
          rank: x.rank,
          wallet: x.wallet,
          displayName: null,
          pnlPct: x.pnlPct,
          pnlSol: x.pnlSol,
          volumeSol: x.volumeSol,
          trades: x.trades,
          eligible: x.eligible,
          ineligibleReason: x.eligible ? null : "min trades",
        })),
      });

      return { closedId: claimedId, nextId, payouts, leaderboardSize: lb.length, marks };
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* */
      }
      throw e;
    }
  };

  // Serialize concurrent rotate calls in-process
  if (rotateInFlight) {
    await rotateInFlight.catch(() => {});
  }
  const p = run();
  rotateInFlight = p.finally(() => {
    if (rotateInFlight === p) rotateInFlight = null;
  });
  return p;
}

export function startCycleScheduler(
  db: Db,
  config: Config,
  hub: StreamHub,
  catalog: CatalogService,
  intervalMs = 30_000,
) {
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    void closeAndRotateCycle(db, config, { hub, topN: 25, catalog })
      .catch((e) => {
        log("error", "cycle_scheduler_tick_failed", { error: String((e as any)?.message ?? e).slice(0, 120) });
      })
      .finally(() => {
        busy = false;
      });
  };
  tick();
  const handle = setInterval(tick, intervalMs);
  return () => clearInterval(handle);
}
