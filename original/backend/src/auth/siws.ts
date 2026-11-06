import * as nacl from "tweetnacl";
import bs58 from "bs58";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { id, nowIso } from "../lib/ids.js";

export function buildSiwsMessage(opts: {
  domain: string;
  wallet: string;
  statement: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
  uri?: string;
  chainId?: string;
}): string {
  const uri = opts.uri ?? `http://${opts.domain}`;
  const chainId = opts.chainId ?? "mainnet";
  return [
    `${opts.domain} wants you to sign in with your Solana account:`,
    opts.wallet,
    "",
    opts.statement,
    "",
    `URI: ${uri}`,
    `Version: 1`,
    `Chain ID: ${chainId}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${opts.issuedAt}`,
    `Expiration Time: ${opts.expirationTime}`,
  ].join("\n");
}

export function createNonce(db: Db, config: Config, wallet: string) {
  const nonce = `n_${randomBytes(12).toString("hex")}`;
  const issuedAt = nowIso();
  const expirationTime = nowIso(new Date(Date.now() + 10 * 60_000));
  const message = buildSiwsMessage({
    domain: config.SIWS_DOMAIN,
    wallet,
    statement: config.SIWS_STATEMENT,
    nonce,
    issuedAt,
    expirationTime,
  });
  db.prepare(
    `INSERT INTO nonces (nonce, wallet, message, expires_at, used) VALUES (?, ?, ?, ?, 0)`,
  ).run(nonce, wallet, message, expirationTime);
  return { nonce, message, domain: config.SIWS_DOMAIN, issuedAt, expirationTime };
}

export function verifySiwsSignature(message: string, signatureBase58: string, wallet: string): boolean {
  try {
    const sig = bs58.decode(signatureBase58);
    const pubkey = bs58.decode(wallet);
    const msg = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(msg, sig, pubkey);
  } catch {
    return false;
  }
}

/** Mock-mode accept: signature === "MOCK_SIG" and message contains wallet. */
export function verifyAuth(db: Db, config: Config, wallet: string, message: string, signature: string): { ok: true } | { ok: false; code: string; message: string } {
  const row = db.prepare(`SELECT * FROM nonces WHERE wallet = ? AND message = ?`).get(wallet, message) as
    | { nonce: string; expires_at: string; used: number }
    | undefined;
  if (!row) return { ok: false, code: "unauthorized", message: "Unknown or mismatched nonce message." };
  if (row.used) return { ok: false, code: "unauthorized", message: "Nonce already used." };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, code: "unauthorized", message: "Nonce expired." };

  const mockOk = config.isMock && signature === "MOCK_SIG";
  const realOk = !config.isMock && verifySiwsSignature(message, signature, wallet);
  if (!mockOk && !realOk) return { ok: false, code: "unauthorized", message: "Invalid signature." };

  db.prepare(`UPDATE nonces SET used = 1 WHERE nonce = ?`).run(row.nonce);
  return { ok: true };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueSession(db: Db, userId: string, wallet: string, days = 7) {
  const token = `ses_${randomBytes(24).toString("hex")}`;
  const sessionId = id("ses_");
  const expiresAt = nowIso(new Date(Date.now() + days * 86_400_000));
  db.prepare(
    `INSERT INTO sessions (id, user_id, wallet, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, userId, wallet, hashToken(token), expiresAt, nowIso());
  return { token, expiresAt, sessionId };
}

export function resolveSession(db: Db, token: string | undefined) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT s.*, u.role, u.banned, u.created_at AS user_created
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  ).get(hashToken(token)) as
    | {
        id: string;
        user_id: string;
        wallet: string;
        expires_at: string;
        role: string;
        banned: number;
        user_created: string;
      }
    | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}


export function revokeSession(db: Db, token: string | undefined) {
  if (!token) return;
  db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(hashToken(token));
}

export function revokeAllUserSessions(db: Db, userId: string) {
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userId);
}
