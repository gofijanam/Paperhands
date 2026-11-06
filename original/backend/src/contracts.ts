/**
 * Paperhands API contract schemas (zod).
 * Source of truth alongside /api/CONTRACT.md — if they disagree, this file wins.
 * @see /workspace/paperhands/api/CONTRACT.md
 */
import { z } from "zod";

/** Decimal money / qty as string (never JS number for SOL). */
export const DecimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "decimal string");

export const LamportsString = z.string().regex(/^\d+$/, "lamports integer string");

export const IsoTime = z.string().min(10); // ISO-8601 UTC; keep loose for mock fixtures

export const Base58 = z.string().min(32).max(64); // Solana address length band

export const Id = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}[a-zA-Z0-9]+$`));

export const Venue = z.enum(["bonding", "graduated", "unknown"]);
export const CoinStatus = z.enum(["tradeable", "untradeable", "rugged", "frozen"]);
export const Side = z.enum(["buy", "sell"]);
export const CycleStatus = z.enum(["scheduled", "active", "settling", "closed"]);
export const PositionStatus = z.enum(["open", "closed", "rugged", "frozen"]);
export const PayoutStatus = z.enum(["pending", "approved", "paid", "rejected"]);
export const FeedKind = z.enum(["trending", "new", "about_to_graduate", "graduated"]);
export const UpstreamStatus = z.enum(["up", "down", "degraded", "skipped"]);

export const ValidationIssue = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
});

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.array(ValidationIssue).nullable().optional(),
    retryAfterSec: z.number().int().nullable().optional(),
  }),
});

export const PageMeta = z.object({
  nextCursor: z.string().nullable(),
});

export const HoldInfo = z.object({
  mint: Base58,
  balance: DecimalString,
  minHold: DecimalString,
  ok: z.boolean(),
  checkedAt: IsoTime,
  cached: z.boolean(),
});

export const User = z.object({
  id: Id("usr_"),
  wallet: Base58,
  createdAt: IsoTime,
  role: z.enum(["user", "admin"]),
  banned: z.boolean(),
  hold: HoldInfo,
});

export const AuthNonceRes = z.object({
  nonce: z.string(),
  message: z.string(),
  domain: z.string(),
  issuedAt: IsoTime,
  expirationTime: IsoTime,
});

export const AuthVerifyReq = z.object({
  wallet: Base58,
  message: z.string().min(1),
  signature: z.string().min(1),
});

export const AuthVerifyRes = z.object({
  user: User,
  session: z.object({ expiresAt: IsoTime }),
  accessToken: z.string(),
  tokenExpiresAt: IsoTime,
  _mock: z.boolean().optional(),
});

export const RiskBadge = z.string();

export const CoinSummary = z.object({
  mint: Base58,
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int().nonnegative(),
  imageUrl: z.string().url().nullable(),
  venue: Venue,
  status: CoinStatus,
  priceSol: DecimalString.nullable(),
  priceUsd: DecimalString.nullable(),
  liquidityUsd: DecimalString.nullable(),
  marketCapUsd: DecimalString.nullable(),
  volume24hUsd: DecimalString.nullable(),
  change24hPct: DecimalString.nullable(),
  ageSec: z.number().int().nonnegative().nullable(),
  bondingProgressPct: DecimalString.nullable(),
  pairAddress: z.string().nullable(),
  dexId: z.string().nullable(),
  riskBadges: z.array(RiskBadge),
  _mock: z.boolean().optional(),
});

export const CoinDetail = CoinSummary.extend({
  description: z.string().nullable(),
  socials: z.object({
    twitter: z.string().nullable(),
    telegram: z.string().nullable(),
    website: z.string().nullable(),
  }),
  fdvUsd: DecimalString.nullable(),
  change5mPct: DecimalString.nullable(),
  change1hPct: DecimalString.nullable(),
  change6hPct: DecimalString.nullable(),
  virtualSolReserves: LamportsString.nullable(),
  virtualTokenReserves: LamportsString.nullable(),
  realSolReserves: LamportsString.nullable(),
  realTokenReserves: LamportsString.nullable(),
  complete: z.boolean().nullable(),
  updatedAt: IsoTime,
});

export const Candle = z.object({
  t: z.number().int(),
  o: DecimalString,
  h: DecimalString,
  l: DecimalString,
  c: DecimalString,
  v: DecimalString,
});

export const OhlcvRes = z.object({
  mint: Base58,
  resolution: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
  currency: z.enum(["usd", "sol"]),
  candles: z.array(Candle),
  _mock: z.boolean().optional(),
});

export const MarketTrade = z.object({
  id: z.string(),
  side: Side,
  priceSol: DecimalString,
  amountToken: DecimalString,
  amountSol: DecimalString,
  trader: Base58.nullable(),
  txSig: z.string().nullable(),
  at: IsoTime,
});

export const TradesTapeRes = z.object({
  mint: Base58.optional(),
  source: z.enum(["geckoterminal", "helius_parsed_events", "mock", "none"]),
  items: z.array(MarketTrade),
  nextCursor: z.string().nullable(),
  _mock: z.boolean().optional(),
});

export const HolderRow = z.object({
  rank: z.number().int().positive(),
  wallet: Base58,
  amount: DecimalString,
  pct: DecimalString,
});

export const QuoteFee = z.object({
  venueFeeBps: z.number().int().nonnegative(),
  venueFeeSol: DecimalString,
  priorityFeeSol: DecimalString,
  platformFeeBps: z.number().int().nonnegative(),
  platformFeeSol: DecimalString,
});

export const QuoteReq = z.object({
  mint: Base58,
  side: Side,
  amountSol: DecimalString.nullable().optional(),
  amountToken: DecimalString.nullable().optional(),
  slippageBps: z.number().int().min(1).max(5000).default(100),
});

export const QuoteRes = z.object({
  quoteId: Id("qte_"),
  mint: Base58,
  side: Side,
  venue: Venue,
  inAmount: DecimalString,
  inUnit: z.enum(["sol", "token"]),
  outAmount: DecimalString,
  outUnit: z.enum(["sol", "token"]),
  priceSol: DecimalString,
  priceImpactPct: DecimalString,
  fee: QuoteFee,
  slippageBps: z.number().int(),
  minOutAmount: DecimalString,
  liquidityUsd: DecimalString.nullable(),
  expiresAt: IsoTime,
  route: z.string(),
  warnings: z.array(z.string()),
  _mock: z.boolean().optional(),
});

export const TradeReq = z.object({
  quoteId: Id("qte_"),
  clientTradeId: z.string().optional(),
});

export const Trade = z.object({
  id: Id("trd_"),
  cycleId: Id("cyc_"),
  mint: Base58,
  side: Side,
  venue: Venue,
  inAmount: DecimalString,
  inUnit: z.enum(["sol", "token"]),
  outAmount: DecimalString,
  outUnit: z.enum(["sol", "token"]),
  priceSol: DecimalString,
  priceImpactPct: DecimalString,
  feesSol: DecimalString,
  realizedPnlSol: DecimalString.nullable(),
  status: z.enum(["filled", "rejected"]),
  filledAt: IsoTime,
  positionId: Id("pos_").nullable(),
});

export const Position = z.object({
  id: Id("pos_"),
  mint: Base58,
  symbol: z.string(),
  qty: DecimalString,
  avgEntrySol: DecimalString,
  markSol: DecimalString,
  costSol: DecimalString,
  valueSol: DecimalString,
  unrealizedPnlSol: DecimalString,
  unrealizedPnlPct: DecimalString,
  status: PositionStatus,
  /** Mark freshness from shared valuation: fresh | stale | rugged | unknown */
  markStatus: z.enum(["fresh", "stale", "rugged", "unknown"]),
  /** ISO observation time of the mark, or null when unknown */
  markAsOf: IsoTime.nullable(),
});

export const PortfolioSnapshot = z.object({
  cycleId: Id("cyc_"),
  mode: z.enum(["ranked", "practice"]),
  cashSol: DecimalString,
  equitySol: DecimalString,
  bankrollSol: DecimalString,
  pnlSol: DecimalString,
  pnlPct: DecimalString,
  realizedPnlSol: DecimalString,
  unrealizedPnlSol: DecimalString,
  positions: z.array(Position),
  updatedAt: IsoTime,
  _mock: z.boolean().optional(),
});

export const TradeRes = z.object({
  trade: Trade,
  portfolio: PortfolioSnapshot,
  _mock: z.boolean().optional(),
});

export const Cycle = z.object({
  id: Id("cyc_"),
  startsAt: IsoTime,
  endsAt: IsoTime,
  status: CycleStatus,
  bankrollSol: DecimalString,
  lengthSec: z.number().int().positive(),
  prizePoolSol: DecimalString.nullable(),
  entrants: z.number().int().nonnegative(),
  _mock: z.boolean().optional(),
});

export const LeaderboardRow = z.object({
  rank: z.number().int().positive(),
  wallet: Base58,
  displayName: z.string().nullable(),
  pnlPct: DecimalString,
  pnlSol: DecimalString,
  volumeSol: DecimalString,
  trades: z.number().int().nonnegative(),
  eligible: z.boolean(),
  ineligibleReason: z.string().nullable(),
});

export const LeaderboardRes = z.object({
  cycleId: Id("cyc_"),
  updatedAt: IsoTime,
  items: z.array(LeaderboardRow),
  nextCursor: z.string().nullable(),
  me: LeaderboardRow.nullable(),
  _mock: z.boolean().optional(),
});

export const Payout = z.object({
  id: Id("pay_"),
  cycleId: Id("cyc_"),
  rank: z.number().int().positive(),
  wallet: Base58,
  pnlPct: DecimalString,
  amountSol: DecimalString,
  status: PayoutStatus,
  txRef: z.string().nullable(),
  note: z.string().nullable(),
  updatedAt: IsoTime,
});

export const HealthRes = z.object({
  ok: z.boolean(),
  mode: z.enum(["mock", "live"]),
  version: z.string(),
  time: IsoTime,
  upstream: z.object({
    dexscreener: UpstreamStatus,
    jupiter: UpstreamStatus,
    helius: UpstreamStatus,
    pumpportal: UpstreamStatus,
    geckoterminal: UpstreamStatus,
    birdeye: UpstreamStatus,
  }),
});

export const StreamEventBase = z.object({
  v: z.literal(1),
  type: z.string(),
  ts: IsoTime,
});

export const PriceEvent = StreamEventBase.extend({
  type: z.literal("price"),
  mint: Base58,
  priceSol: DecimalString,
  priceUsd: DecimalString.nullable(),
  venue: Venue.optional(),
});

export const HeartbeatEvent = StreamEventBase.extend({
  type: z.literal("heartbeat"),
});

export const FeedEvent = StreamEventBase.extend({
  type: z.literal("feed"),
  kind: FeedKind,
  coin: CoinSummary,
});

export const LeaderboardEvent = StreamEventBase.extend({
  type: z.literal("leaderboard"),
  cycleId: Id("cyc_"),
  top: z.array(LeaderboardRow),
});

/** Pump.fun bonding-curve constants (Global account / pump-public-docs). */
export const PUMP_BONDING = {
  INITIAL_VIRTUAL_TOKEN_RESERVES: 1_073_000_000_000_000n,
  INITIAL_VIRTUAL_SOL_RESERVES: 30_000_000_000n,
  INITIAL_REAL_TOKEN_RESERVES: 793_100_000_000_000n,
  TOKEN_TOTAL_SUPPLY: 1_000_000_000_000_000n,
  /** Total bonding fee bps: creator 30 + protocol 95 = 125 (1.25%). Source: pump.fun/docs/fees 2026-10-17 */
  FEE_BPS: 125,
  CREATOR_FEE_BPS: 30,
  PROTOCOL_FEE_BPS: 95,
  TOKEN_DECIMALS: 6,
} as const;

export const PublicConfig = z.object({
  PAPER_MINT: Base58,
  PAPER_MIN_HOLD: DecimalString,
  CYCLE_BANKROLL_SOL: DecimalString,
  CYCLE_LENGTH_SEC: z.number().int().positive(),
  QUOTE_TTL_SEC: z.number().int().positive(),
  PLATFORM_FEE_BPS: z.number().int().nonnegative(),
  PRIORITY_FEE_LAMPORTS: z.number().int().nonnegative(),
  MIN_TRADE_SOL: DecimalString,
  MAX_POSITION_PCT: z.number().int().positive(),
  MIN_CYCLE_TRADES: z.number().int().nonnegative(),
  MIN_LIQUIDITY_USD: DecimalString,
  GRADUATING_PCT: z.number().int().min(1).max(100),
  FILL_LIQUIDITY_CAP_PCT: z.number().int().positive(),
  HOLD_CACHE_TTL_SEC: z.number().int().positive(),
  SIWS_DOMAIN: z.string(),
});

export type UserT = z.infer<typeof User>;
export type CoinSummaryT = z.infer<typeof CoinSummary>;
export type CoinDetailT = z.infer<typeof CoinDetail>;
export type QuoteReqT = z.infer<typeof QuoteReq>;
export type QuoteResT = z.infer<typeof QuoteRes>;
export type TradeResT = z.infer<typeof TradeRes>;
export type PortfolioSnapshotT = z.infer<typeof PortfolioSnapshot>;
export type CycleT = z.infer<typeof Cycle>;
export type LeaderboardResT = z.infer<typeof LeaderboardRes>;
export type HealthResT = z.infer<typeof HealthRes>;
export type PublicConfigT = z.infer<typeof PublicConfig>;
