import type { Config } from "../config.js";
import type { Db } from "../db.js";
import type { RpcClient } from "../rpc/client.js";
import { nowIso } from "../lib/ids.js";

export type HoldResult = {
  mint: string;
  balance: string;
  minHold: string;
  ok: boolean;
  checkedAt: string;
  cached: boolean;
};

export async function checkHold(
  db: Db,
  config: Config,
  wallet: string,
  opts?: { force?: boolean; rpc?: RpcClient },
): Promise<HoldResult> {
  const cacheKey = `${wallet}:${config.PAPER_MINT}`;
  const cached = db.prepare(`SELECT balance, checked_at FROM hold_cache WHERE wallet = ?`).get(cacheKey) as
    | { balance: string; checked_at: string }
    | undefined;
  const age = cached ? Date.now() - new Date(cached.checked_at).getTime() : Infinity;
  if (!opts?.force && cached && age < config.HOLD_CACHE_TTL_SEC * 1000) {
    return {
      mint: config.PAPER_MINT,
      balance: cached.balance,
      minHold: config.PAPER_MIN_HOLD,
      ok: Number(cached.balance) >= Number(config.PAPER_MIN_HOLD),
      checkedAt: cached.checked_at,
      cached: true,
    };
  }

  let balance = "0";
  if (config.isMock) {
    balance = "100000";
  } else if (opts?.rpc) {
    balance = await opts.rpc.getTokenBalanceUi(wallet, config.PAPER_MINT, { force: !!opts.force });
  } else {
    balance = "0";
  }

  const checkedAt = nowIso();
  db.prepare(
    `INSERT INTO hold_cache (wallet, balance, checked_at) VALUES (?, ?, ?)
     ON CONFLICT(wallet) DO UPDATE SET balance = excluded.balance, checked_at = excluded.checked_at`,
  ).run(cacheKey, balance, checkedAt);

  return {
    mint: config.PAPER_MINT,
    balance,
    minHold: config.PAPER_MIN_HOLD,
    ok: Number(balance) >= Number(config.PAPER_MIN_HOLD),
    checkedAt,
    cached: false,
  };
}
