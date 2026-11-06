"use client";
import type { MarkStatus } from "@/lib/store";
import { useNow } from "@/lib/live";

const STYLE: Record<Exclude<MarkStatus, "fresh">, string> = {
  stale: "border-[#ffc457]/50 text-[#ffc457]",
  rugged: "border-down/60 text-down",
  unknown: "border-line-2 text-muted",
};
/** Server mark status (CONTRACT fbdabef). Non-fresh marks are valued at 0. */
export function MarkBadge({ status, asOf }: { status?: MarkStatus; asOf?: number | null }) {
  const now = useNow();
  if (!status || status === "fresh") return null;
  const ago = asOf && now ? Math.max(0, Math.round((now - asOf) / 60_000)) : null;
  const tip =
    status === "stale" ? `${ago != null ? `Marked ${ago}m ago. ` : ""}No price update for 15+ minutes: valued at 0 until a fresh mark.`
    : status === "rugged" ? "Liquidity pulled or rugged: valued at 0."
    : "No reliable price source: valued at 0.";
  return (
    <span className={`rounded border px-1 font-mono text-[10px] font-normal uppercase ${STYLE[status]}`} title={tip} data-motion="mark-badge">
      {status}<span className="sr-only">. {tip}</span>
    </span>
  );
}
