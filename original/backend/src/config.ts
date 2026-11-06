import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";

const Env = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().default(8807),
  PAPERHANDS_MODE: z.enum(["mock", "live"]).default("mock"),
  SIWS_DOMAIN: z.string().default("localhost"),
  SIWS_STATEMENT: z.string().default("Sign in to Paperhands"),
  SESSION_SECRET: z.string().default("dev-only-change-me"),
  ADMIN_TOKEN: z.string().default(""),
  /** Empty → mode-aware defaults (local only for mock/non-production). Live/production default: none. */
  CORS_ORIGINS: z.string().default(""),
  COOKIE_SECURE: z.enum(["0", "1"]).default("0"),
  PAPER_MINT: z.string().default("PaperTest111111111111111111111111111111111"),
  PAPER_MIN_HOLD: z.string().default("50000"),
  HOLD_CACHE_TTL_SEC: z.coerce.number().int().default(60),
  HOLD_RECHECK_SEC: z.coerce.number().int().default(300),
  HOLD_GRACE_SEC: z.coerce.number().int().default(900),
  CYCLE_BANKROLL_SOL: z.string().default("10"),
  CYCLE_LENGTH_SEC: z.coerce.number().int().default(86400),
  QUOTE_TTL_SEC: z.coerce.number().int().default(8),
  PLATFORM_FEE_BPS: z.coerce.number().int().default(0),
  PRIORITY_FEE_LAMPORTS: z.coerce.number().int().default(100_000),
  MIN_TRADE_SOL: z.string().default("0.01"),
  MAX_POSITION_PCT: z.coerce.number().int().default(25),
  MIN_CYCLE_TRADES: z.coerce.number().int().default(3),
  MIN_LIQUIDITY_USD: z.string().default("500"),
  GRADUATING_PCT: z.coerce.number().int().default(80),
  FILL_LIQUIDITY_CAP_PCT: z.coerce.number().int().default(5),
  WASH_WINDOW_MS: z.coerce.number().int().default(3000),
  WASH_LIQ_USD: z.string().default("2000"),
  HELIUS_API_KEY: z.string().optional().default(""),
  SOLANA_RPC_URL: z.string().optional().default(""),
  JUPITER_API_KEY: z.string().optional().default(""),
  BIRDEYE_API_KEY: z.string().optional().default(""),
  PAYOUT_TOP_N: z.coerce.number().int().default(25),
  STREAM_TICKET_TTL_SEC: z.coerce.number().int().default(60),
  LEADERBOARD_SSE_SEC: z.coerce.number().int().default(15),
  DATABASE_PATH: z.string().default(".data/paperhands.db"),
  /** Comma-separated proxy IPs allowed to set X-Forwarded-For. Default empty = trust none. */
  TRUSTED_PROXIES: z.string().default(""),
  /** Enable Helius bonding-tape fallback. Default off — header auth returns 404; query-key forbidden in logs. */
  HELIUS_TAPE_ENABLED: z.enum(["0", "1"]).default("0"),
  /** Per getCoin / upstream AbortSignal timeout (ms). */
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().default(4000),
});

export type Config = z.infer<typeof Env> & {
  version: string;
  isMock: boolean;
  corsOrigins: string[];
};

/** Live mode refuses weak admin tokens (empty disables admin; short/low-entropy refuses boot). */
export function assertAdminTokenOk(token: string, mode: "mock" | "live") {
  if (!token) return; // admin disabled
  if (mode !== "live") return;
  if (token.length < 32) {
    throw new Error("ADMIN_TOKEN must be at least 32 characters in live mode (or empty to disable admin)");
  }
  // Entropy: unique chars and not a trivial repeated pattern
  const uniq = new Set(token).size;
  if (uniq < 16) {
    throw new Error("ADMIN_TOKEN lacks sufficient entropy in live mode (need ≥16 distinct chars)");
  }
  const weak = ["password", "admin", "changeme", "secret", "test"];
  if (weak.some((w) => token.toLowerCase().includes(w))) {
    throw new Error("ADMIN_TOKEN looks weak; refuse live boot");
  }
}

/** Local web-dev origins — applied only when mock AND not NODE_ENV=production, and CORS_ORIGINS unset/empty. */
export const LOCAL_DEV_CORS_ORIGINS = [
  "http://127.0.0.1:3000",
  "http://localhost:3000",
  "http://127.0.0.1:4331",
  "http://localhost:4331",
];

function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
  } catch {
    return /localhost|127\.0\.0\.1/.test(origin);
  }
}

export function resolveCorsOrigins(
  raw: string,
  opts: { mode: "mock" | "live"; nodeEnv?: string; corsExplicitlySet: boolean },
): string[] {
  const listed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const productionLike = opts.nodeEnv === "production" || opts.mode === "live";
  if (listed.length === 0) {
    // No explicit list: local-dev defaults only for non-production mock
    if (!productionLike) return [...LOCAL_DEV_CORS_ORIGINS];
    return [];
  }
  // Explicit list honored; but live/production refuses accidental loopback unless CORS_ORIGINS was set in env
  if (productionLike && !opts.corsExplicitlySet) {
    return listed.filter((o) => !isLoopbackOrigin(o));
  }
  return listed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.parse(env);
  if (parsed.HOST !== "127.0.0.1" && parsed.HOST !== "localhost") {
    console.warn(JSON.stringify({ level: "warn", msg: "HOST is not 127.0.0.1 — MVP default is loopback only", host: parsed.HOST }));
  }
  assertAdminTokenOk(parsed.ADMIN_TOKEN, parsed.PAPERHANDS_MODE);
  const corsExplicitlySet = Object.prototype.hasOwnProperty.call(env, "CORS_ORIGINS");
  const corsOrigins = resolveCorsOrigins(parsed.CORS_ORIGINS, {
    mode: parsed.PAPERHANDS_MODE,
    nodeEnv: env.NODE_ENV,
    corsExplicitlySet,
  });
  return {
    ...parsed,
    version: "0.1.0",
    isMock: parsed.PAPERHANDS_MODE === "mock",
    corsOrigins,
  };
}

export function publicConfig(c: Config) {
  return {
    PAPER_MINT: c.PAPER_MINT,
    PAPER_MIN_HOLD: c.PAPER_MIN_HOLD,
    CYCLE_BANKROLL_SOL: c.CYCLE_BANKROLL_SOL,
    CYCLE_LENGTH_SEC: c.CYCLE_LENGTH_SEC,
    QUOTE_TTL_SEC: c.QUOTE_TTL_SEC,
    PLATFORM_FEE_BPS: c.PLATFORM_FEE_BPS,
    PRIORITY_FEE_LAMPORTS: c.PRIORITY_FEE_LAMPORTS,
    MIN_TRADE_SOL: c.MIN_TRADE_SOL,
    MAX_POSITION_PCT: c.MAX_POSITION_PCT,
    MIN_CYCLE_TRADES: c.MIN_CYCLE_TRADES,
    MIN_LIQUIDITY_USD: c.MIN_LIQUIDITY_USD,
    GRADUATING_PCT: c.GRADUATING_PCT,
    FILL_LIQUIDITY_CAP_PCT: c.FILL_LIQUIDITY_CAP_PCT,
    HOLD_CACHE_TTL_SEC: c.HOLD_CACHE_TTL_SEC,
    SIWS_DOMAIN: c.SIWS_DOMAIN,
    CORS_ORIGINS: c.corsOrigins,
  };
}

export function generateAdminToken(): string {
  return randomBytes(32).toString("base64url");
}

export function adminTokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}
