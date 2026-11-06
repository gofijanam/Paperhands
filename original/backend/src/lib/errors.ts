import type { Context } from "hono";
import { id } from "./ids.js";
import { logError } from "./logger.js";

const PUBLIC: Record<string, { status: number; message: string }> = {
  validation_failed: { status: 400, message: "Invalid request." },
  unauthorized: { status: 401, message: "Authentication required." },
  forbidden: { status: 403, message: "Forbidden." },
  hold_insufficient: { status: 403, message: "Insufficient PAPER hold." },
  not_found: { status: 404, message: "Not found." },
  conflict: { status: 409, message: "Conflict." },
  quote_stale: { status: 412, message: "Quote expired." },
  quote_foreign: { status: 403, message: "Quote does not belong to this session." },
  quote_used: { status: 409, message: "Quote already used." },
  untradeable: { status: 422, message: "Instrument is untradeable." },
  rate_limited: { status: 429, message: "Rate limit exceeded." },
  upstream_degraded: { status: 503, message: "Upstream temporarily unavailable." },
  insufficient_funds: { status: 403, message: "Insufficient paper SOL." },
  exposure_exceeded: { status: 403, message: "Position exposure limit exceeded." },
};

export function publicError(code: string, fallbackMessage?: string) {
  const p = PUBLIC[code] ?? { status: 500, message: "Internal error." };
  return {
    status: p.status,
    body: {
      error: {
        code: PUBLIC[code] ? code : "internal_error",
        message: PUBLIC[code] ? (code === "hold_insufficient" && fallbackMessage ? fallbackMessage : p.message) : "Internal error.",
        requestId: id("req_"),
        details: null,
        retryAfterSec: code === "rate_limited" ? 3 : null,
      },
    },
  };
}

export function respondError(c: Context, code: string, internalDetail?: unknown, holdMsg?: string) {
  if (internalDetail !== undefined) {
    logError(code, internalDetail);
  }
  const { status, body } = publicError(code, holdMsg);
  if (code === "rate_limited") c.header("Retry-After", "3");
  return c.json(body, status as any);
}

export function mapThrown(e: unknown): string {
  const code = (e as any)?.code;
  if (typeof code === "string" && PUBLIC[code]) return code;
  return "internal_error";
}
