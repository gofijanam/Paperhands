import type {PaperTrader} from '../paper-ranking';
// UI view-models. The wire contract lives in ./contract.ts (mirror of Sage's backend/src/contracts.ts, API e2939f7);
// live.ts validates wire payloads with it and maps them here (decimal strings -> numbers, null -> NaN shown as "—").
import { z } from "zod";

export const Mint = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const Venue = z.enum(["bonding", "graduated", "unknown"]);
export const Coin = z.object({
  observedAt: z.number().optional(),
  mint: Mint,
  symbol: z.string(),
  name: z.string(),
  priceUsd: z.number(),
  priceSol: z.number(),
  status: z.enum(["tradeable", "untradeable", "rugged", "frozen"]),
  imageUrl: z.string().nullable(),
  mcapUsd: z.number(),
  marketCapEstimated: z.boolean().optional(),
  vol24hUsd: z.number(),
  change24hPct: z.number(),
  holders: z.number().int(),
  ageSec: z.number(),
  venue: Venue,
  curvePct: z.number().min(0).max(100),
  liquidityUsd: z.number(),
  athUsd: z.number(),
  description: z.string().optional(),
  socials: z.object({ twitter: z.string().nullable(), telegram: z.string().nullable(), website: z.string().nullable() }).optional(),
  riskBadges: z.array(z.string()).default([]),
  mock: z.boolean().optional(),
  decimals: z.number().int().optional(),
});
export type TCoin = z.infer<typeof Coin>;
export const FeedColumn = z.enum(["trending", "new", "graduating"]);
export type TFeedColumn = z.infer<typeof FeedColumn>;

export const Candle = z.object({ source:z.enum(['pool-history','observed-trades']).optional(), time: z.number(), open: z.number(), high: z.number(), low: z.number(), close: z.number(), volume: z.number() });
export type TCandle = z.infer<typeof Candle>;
export const Timeframe = z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]);
export type TTimeframe = z.infer<typeof Timeframe>;

export const Trade = z.object({
  id: z.string(),
  mint: Mint,
  symbol: z.string(),
  trader: z.string(),
  side: z.enum(["buy", "sell"]),
  sol: z.number(),
  tokens: z.number(),
  priceUsd: z.number(),
  ts: z.number(),
});
export type TTrade = z.infer<typeof Trade>;
export const Holder = z.object({ owner: z.string(), label: z.string().optional(), pct: z.number(), tokens: z.number() });
export type THolder = z.infer<typeof Holder>;
export type TTopTrader={wallet:string;label:string;boughtUsd:number;soldUsd:number;realizedUsd:number;unrealizedUsd:number;holdingUsd:number;buys:number;sells:number};

export const Trader = z.object({ rank: z.number().int(), handle: z.string(), wallet: z.string(), pnlPct: z.number(), pnlSol: z.number(), volumeSol: z.number(), trades: z.number().int(), eligible: z.boolean(), ineligibleReason: z.string().nullable(), delta: z.number().int().optional(), demo: z.boolean().optional() });
export type TTrader = z.infer<typeof Trader>;
export const Cycle = z.object({ id: z.union([z.number(), z.string()]), startsAt: z.number(), endsAt: z.number(), poolSol: z.number().nullable(), rankedCount: z.number().int(), bankrollSol: z.number(), status: z.string() });
export type TCycle = z.infer<typeof Cycle>;
export const Payout = z.object({ cycleId: z.union([z.number(), z.string()]), endedAt: z.number(), poolSol: z.number(), winners: z.array(z.object({ rank: z.number().int(), handle: z.string(), sol: z.number() })), tx: z.string().nullable() });
export type TPayout = z.infer<typeof Payout>;
export const Leaderboard = z.object({ cycle: Cycle, rows: z.array(Trader), payouts: z.array(Payout), payoutsMock: z.boolean(), mock: z.boolean(), poolDemo: z.boolean().optional() });
export type TLeaderboard = z.infer<typeof Leaderboard>;
export const GateStatus = z.object({ wallet: z.string(), held: z.number(), required: z.number(), pass: z.boolean() });
export type TGateStatus = z.infer<typeof GateStatus>;

export type Tick = { mint: string; priceUsd: number; priceSol?: number; mcapUsd?: number; change24hPct?: number; observedAt?: number };

export interface PaperApi {
  mode: "mock" | "live";
  feed(column: TFeedColumn): Promise<TCoin[]>;
  coin(mint: string): Promise<TCoin | null>;
  candles(mint: string, tf: TTimeframe): Promise<TCandle[]>;
  trades(mint: string): Promise<TTape>;
  holders(mint: string): Promise<THolder[]>;
  topTraders?(mint:string):Promise<PaperTrader[]>;
  leaderboard(): Promise<TLeaderboard>;
  search(q: string): Promise<TCoin[]>;
  gate(wallet: string): Promise<TGateStatus>;
  /** Paper quote (contract POST /v1/quotes). Null when the trade engine must run locally. */
  quote?(req: QuoteInput, token: string): Promise<TQuote>;
  /** Live price ticks for every listed coin. Returns unsubscribe. */
  subscribeTicks(on: (t: Tick[]) => void, mints?: string[]): () => void;
  /** Called after the stream detected dropped events (seq gap): refetch snapshots. */
  onGap?(f: () => void): () => void;
  /** Feed upserts (new listings, graduations) from SSE. */
  subscribeFeed?(on: (kind: string, c: TCoin) => void): () => void;
  /** Live public trade tape (all coins, or one mint). */
  subscribeTrades(on: (t: TTrade) => void, mint?: string): () => void;
}

export type QuoteInput = { mint: string; side: "buy" | "sell"; amountSol?: string; amountToken?: string; slippageBps: number };
export type TQuote = { id: string; outAmount: number; outUnit: "sol" | "token"; minOut: number; priceSol: number; impactPct: number; feeSol: number; expiresAt: number; route: string; warnings: string[]; venue: string };
export type TTape = { items: TTrade[]; source: "geckoterminal" | "helius_parsed_events" | "mock" | "none" };
