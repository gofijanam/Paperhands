export const SOL = "◎";
const MINUS = "−";
export function usd(n: number, compact = true) {
  if (!Number.isFinite(n)) return "—";
  if (!compact) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a < 1 ? tiny(a, 4) : a.toFixed(2);
  return `${n < 0 ? MINUS : ""}$${s}`;
}
export function num(n: number, d = 0) {
  return n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
}
export function compact(n: number) {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  return a >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0);
}
export function sol(n: number, d = 2) {
  if (!Number.isFinite(n)) return "—";
  return `${n < 0 ? MINUS : ""}${SOL}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`;
}
export function pct(n: number, d = 2) {
  if (!Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : n < 0 ? MINUS : ""}${Math.abs(n).toFixed(d)}%`;
}
export function signed(n: number, d = 2) {
  return `${n > 0 ? "+" : n < 0 ? MINUS : ""}${Math.abs(n).toFixed(d)}`;
}
const SUB = "₀₁₂₃₄₅₆₇₈₉";
/**
 * Shared tiny-number formatter, pump.fun style: 0.00001189 -> "0.0₄1189" (subscript = count of zeros after the point).
 * Kicks in at >= 4 leading zeros; never emits e-notation. `sig` significant digits, trailing zeros trimmed.
 */
export function tiny(n: number, sig = 4): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const neg = n < 0, a = Math.abs(n);
  let out: string;
  if (a >= 1) out = a >= 1000 ? a.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(+a.toFixed(4));
  else {
    const [m, e] = a.toExponential(sig - 1).split("e");
    const z = -Number(e) - 1; // zeros between "0." and first significant digit
    const digits = m.replace(".", "").replace(/0+$/, "") || "0";
    if (z < 0) out = "1";
    else if (z >= 4) out = `0.0${String(z).split("").map((d) => SUB[+d]).join("")}${digits}`;
    else out = `0.${"0".repeat(z)}${digits}`;
  }
  return `${neg ? MINUS : ""}${out}`;
}
/** USD price of a token (tiny-aware). */
export function price(n: number) {
  if (!Number.isFinite(n)) return "—";
  return `${n < 0 ? MINUS : ""}$${tiny(Math.abs(n), n >= 1 ? 6 : 4)}`;
}
/** Compact USD for axes and stats: $1.80M, $950K, $12.3K, $412, $0.0₄1189. */
export function axisUsd(n: number) {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n), sg = n < 0 ? MINUS : "";
  if (a >= 1e9) return `${sg}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sg}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e5) return `${sg}$${(a / 1e3).toFixed(0)}K`;
  if (a >= 1e3) return `${sg}$${(a / 1e3).toFixed(1)}K`;
  if (a >= 1) return `${sg}$${a.toFixed(a >= 100 ? 0 : 2)}`;
  return price(n);
}
export function age(sec: number) {
  if (!Number.isFinite(sec)) return "—";
  if (sec < 60) return `${Math.floor(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 86400 * 365) return `${Math.floor(sec / 86400)}d`;
  return `${Math.floor(sec / (86400 * 365))}y`;
}
export function short(addr: string, a = 4, b = 4) {
  return `${addr.slice(0, a)}…${addr.slice(-b)}`;
}
export function clock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return [h, m, x].map((v) => String(v).padStart(2, "0")).join(":");
}
export const tone = (n: number) => (n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted");
/** SOL per token, for tiny memecoin prices. */
export function solPrice(n: number) {
  if (!Number.isFinite(n)) return "—";
  return `${n < 0 ? MINUS : ""}${SOL}${tiny(Math.abs(n), 4)}`;
}
/** Canonical wire decimal (CONTRACT: SOL ≤ 9 dp, tokens ≤ coin decimals). Truncates toward zero, no exponent, no trailing zeros. */
export function wireAmount(n: number, dp: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  const f = 10 ** dp;
  const t = Math.floor(n * f + 1e-7) / f;
  const s = t.toFixed(dp);
  return (dp > 0 ? s.replace(/0+$/, "").replace(/\.$/, "") : s) || "0";
}
