import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { closeAndRotateCycle, openNewCycle } from "../src/cycles/scheduler.js";
import { nowIso, id } from "../src/lib/ids.js";
import { StreamHub } from "../src/stream/hub.js";
import { CatalogService } from "../src/services/catalog.js";

describe("cycle scheduler", () => {
  it("force-rotates, enqueues pending payouts, opens next, resets bankroll", async () => {
    const config = loadConfig({
      PAPERHANDS_MODE: "mock",
      DATABASE_PATH: ":memory:",
      CYCLE_BANKROLL_SOL: "10",
      MIN_CYCLE_TRADES: "0",
      CYCLE_LENGTH_SEC: "86400",
    });
    const db = openDb(config);
    const catalog = new CatalogService({ config, db });
    const hub = new StreamHub();
    const cycle = openNewCycle(db, config);

    const uid = id("usr_");
    const wallet = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    db.prepare(`INSERT INTO users (id, wallet, role, banned, created_at) VALUES (?, ?, 'user', 0, ?)`).run(uid, wallet, nowIso());
    db.prepare(
      `INSERT INTO portfolios (user_id, cycle_id, mode, cash_sol, realized_pnl_sol, volume_sol, trade_count)
       VALUES (?, ?, 'ranked', '15', '5', '20', 5)`,
    ).run(uid, cycle.id);

    const result = await closeAndRotateCycle(db, config, { hub, topN: 10, force: true, catalog });
    expect(result).not.toBeNull();
    expect(result!.closedId).toBe(cycle.id);
    expect(result!.nextId).not.toBe(cycle.id);
    expect(result!.payouts.length).toBe(1);

    const pay = db.prepare(`SELECT * FROM payouts WHERE cycle_id = ?`).get(cycle.id) as any;
    expect(pay.status).toBe("pending");
    expect(pay.tx_ref).toBeNull();

    const closed = db.prepare(`SELECT status FROM cycles WHERE id = ?`).get(cycle.id) as any;
    expect(closed.status).toBe("closed");

    const nextPf = db.prepare(`SELECT * FROM portfolios WHERE user_id = ? AND cycle_id = ?`).get(uid, result!.nextId) as any;
    expect(nextPf.cash_sol).toBe("10");
    expect(nextPf.trade_count).toBe(0);
  });
});
