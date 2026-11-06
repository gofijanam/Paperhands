/**
 * Structured logger with credential-aware redaction (P2-06 / F7 / Low).
 * Redacts labeled secrets, env canaries, long hex, and 64-byte secret key material.
 * Allowlists 32-byte Solana pubkeys/mints (base58 decoding to exactly 32 bytes).
 */
import bs58 from "bs58";

const SENSITIVE_KEY = /^(authorization|cookie|set-cookie|x-api-key|api[-_]?key|token|access[-_]?token|refresh[-_]?token|session|password|secret|bearer)$/i;
const SENSITIVE_INLINE =
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|bearer|cookie|session)[=:]\s*)([^\s&"'\\]+)/gi;
const URL_QUERY_SECRET = /([?&](?:api[-_]?key|access_token|token|auth|session|key)=)([^&\s"']+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9\-._~+\/]+=*/gi;
const LONG_HEX = /\b[a-fA-F0-9]{24,}\b/g;
const LONG_B58 = /\b[1-9A-HJ-NP-Za-km-z]{32,88}\b/g;

const SECRET_ENV_KEYS = [
  "HELIUS_API_KEY",
  "JUPITER_API_KEY",
  "BIRDEYE_API_KEY",
  "ADMIN_TOKEN",
  "SESSION_SECRET",
  "SOLANA_RPC_URL",
];

function configuredSecrets(): string[] {
  const out: string[] = [];
  for (const k of SECRET_ENV_KEYS) {
    const v = process.env[k];
    if (v && v.length >= 8) out.push(v);
    if (v) {
      const m = /api-key=([^&\s]+)/i.exec(v);
      if (m?.[1] && m[1].length >= 8) out.push(m[1]);
    }
  }
  return out;
}

/** True if base58 decodes to exactly 32 bytes (Solana pubkey / mint). */
export function isPublicKeyBase58(s: string): boolean {
  try {
    const bytes = bs58.decode(s);
    return bytes.length === 32;
  } catch {
    return false;
  }
}

/** True if base58 decodes to 64 bytes (ed25519 secret key material). */
export function isSecretKeyBase58(s: string): boolean {
  try {
    const bytes = bs58.decode(s);
    return bytes.length === 64;
  } catch {
    return false;
  }
}

export function redactString(s: string): string {
  let out = s
    .replace(URL_QUERY_SECRET, "$1***")
    .replace(BEARER, "Bearer ***")
    .replace(SENSITIVE_INLINE, "$1***");
  for (const secret of configuredSecrets()) {
    if (!secret) continue;
    const esc = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "g"), "***");
  }
  out = out.replace(LONG_HEX, (m) => (m.length >= 24 ? "***" : m));
  out = out.replace(LONG_B58, (m) => {
    // Allowlist normal pubkeys/mints (32-byte); redact 64-byte secrets and other long blobs
    if (isPublicKeyBase58(m)) return m;
    if (isSecretKeyBase58(m)) return "***";
    // Non-decodable or odd-length long base58 — redact if ≥40 (likely key material)
    return m.length >= 40 ? "***" : m;
  });
  return out;
}

export function redactValue(v: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof v === "string") return redactString(v);
  if (v == null || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map((x) => redactValue(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) out[k] = "***";
      else out[k] = redactValue(val, depth + 1);
    }
    return out;
  }
  return String(v);
}

export function log(level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}) {
  const safe = redactValue({ level, msg, ...fields }) as Record<string, unknown>;
  const line = JSON.stringify(safe);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function logError(code: string, detail?: unknown) {
  let d: string;
  if (detail == null) d = "";
  else if (typeof detail === "string") d = detail;
  else d = String((detail as any)?.message ?? detail);
  log("error", code, { code, detail: redactString(d).slice(0, 200) });
}
