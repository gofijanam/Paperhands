// Product constants. Values marked EXAMPLE come from PLAN.md §4/§6 "examples, labelled" and are not final.
export const TICKER = "$PAPER";
// Contract defaults (CONTRACT.md §1, API e2939f7). Live values come from the API; these are the fallback.
export const GATE_REQUIRED = 50_000; // PAPER_MIN_HOLD
export const START_BANKROLL = 10; // CYCLE_BANKROLL_SOL: paper SOL per 24h cycle
export const CYCLE_HOURS = 24; // CYCLE_LENGTH_SEC 86400
export const PLATFORM_FEE_BPS = 0; // PLATFORM_FEE_BPS (MVP: no platform cut)
export const PRIORITY_FEE_SOL = 0.0001; // PRIORITY_FEE_LAMPORTS 100000, per fill
export const BONDING_FEE_BPS = 125; // Pump bonding 1.25% (creator 0.30 + protocol 0.95)
export const GRAD_VENUE_FEE_BPS = 30; // MOCK venue fee the contract mock quotes for graduated routes
export const MIN_TRADE_SOL = 0.01;

/** PLAN.md §4.9 example payout curve. 10% held back as reserve. */
export const PAYOUT_CURVE = [
  { ranks: "1", share: 30 },
  { ranks: "2", share: 18 },
  { ranks: "3", share: 12 },
  { ranks: "4–10", share: 25, note: "split equally" },
  { ranks: "11–25", share: 15, note: "split equally" },
] as const;
export const RESERVE_PCT = 10;
export const PAPER_CA_PLACEHOLDER = "CA announced at launch"; // no mint exists yet: never show a fake CA

/**
 * Demo-only tools (e.g. "Pass the gate"). OFF unless NEXT_PUBLIC_PAPERHANDS_DEMO=1 at build time, so production/live builds never ship them.
 * They only flip local UI state; nothing is sent to the server, which re-checks the hold itself (403 hold_insufficient).
 */
export const DEMO_TOOLS = process.env.NEXT_PUBLIC_PAPERHANDS_DEMO === "1";

/**
 * Ranked mode. OFF (default) = "Paper · unranked preview": no prizes, no payouts implied anywhere.
 * Set NEXT_PUBLIC_PAPERHANDS_RANKED=1 only once ranked cycles with real prizes are approved.
 */
export const RANKED = process.env.NEXT_PUBLIC_PAPERHANDS_RANKED === "1";
export const UNRANKED_LABEL = "Unranked preview · no prizes";
