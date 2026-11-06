import { TokenBucket } from "../lib/ratelimit.js";

type Kind = "auth" | "read" | "quote" | "trade" | "admin" | "ticket";

const ipBuckets = new Map<string, Record<Kind, TokenBucket>>();
const walletBuckets = new Map<string, Record<"quote" | "trade" | "read" | "auth" | "ticket", TokenBucket>>();

/** Comma-separated IPs that may set X-Forwarded-For / X-Real-IP. Default: none. */
let trustedProxies: Set<string> = new Set();

export function setTrustedProxies(list: string[]) {
  trustedProxies = new Set(list.map((s) => s.trim()).filter(Boolean));
}

function ipSet(ip: string) {
  let b = ipBuckets.get(ip);
  if (!b) {
    b = {
      auth: new TokenBucket(10 / 60, 10),
      read: new TokenBucket(120 / 60, 30),
      quote: new TokenBucket(30 / 60, 5),
      trade: new TokenBucket(20 / 60, 5),
      admin: new TokenBucket(60 / 60, 10),
      ticket: new TokenBucket(20 / 60, 5),
    };
    ipBuckets.set(ip, b);
  }
  return b;
}

function walletSet(wallet: string) {
  let b = walletBuckets.get(wallet);
  if (!b) {
    b = {
      auth: new TokenBucket(10 / 60, 5),
      read: new TokenBucket(180 / 60, 20),
      quote: new TokenBucket(30 / 60, 5),
      trade: new TokenBucket(20 / 60, 5),
      ticket: new TokenBucket(20 / 60, 5),
    };
    walletBuckets.set(wallet, b);
  }
  return b;
}

/**
 * Peer IP for quotas.
 * `peerIp` MUST come from the transport/socket only (never a request header).
 * X-Forwarded-For / X-Real-IP are honored ONLY when that socket peer is in TRUSTED_PROXIES.
 * Custom headers like x-paperhands-peer are NEVER consulted.
 */
export function clientIp(
  c: { req: { header: (n: string) => string | undefined } },
  peerIp?: string | null,
): string {
  const peer = peerIp && peerIp.length > 0 ? peerIp : "127.0.0.1";
  if (trustedProxies.size > 0 && trustedProxies.has(peer)) {
    const xri = c.req.header("x-real-ip")?.trim();
    const xff = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    return xri || xff || peer;
  }
  return peer;
}

export function limitIp(ip: string, kind: Kind): { ok: true } | { ok: false; retryAfterSec: number } {
  if (ipSet(ip)[kind].tryTake()) return { ok: true };
  return { ok: false, retryAfterSec: 3 };
}

export function limitWallet(
  wallet: string,
  kind: "quote" | "trade" | "read" | "auth" | "ticket",
): { ok: true } | { ok: false; retryAfterSec: number } {
  if (walletSet(wallet)[kind].tryTake()) return { ok: true };
  return { ok: false, retryAfterSec: 3 };
}

export function clearAllRateLimits() {
  ipBuckets.clear();
  walletBuckets.clear();
}
