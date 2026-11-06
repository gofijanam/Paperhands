/**
 * Fixed-point money: SOL as lamports (bigint), tokens as raw units (bigint).
 * No IEEE floats in ledger math.
 */
const LAMPORTS_PER_SOL = 1_000_000_000n;

export type DecErr = { code: "validation_failed"; message: string };

export function parsePositiveDecimal(s: string, maxFrac: number): { whole: bigint; frac: bigint; scale: number } {
  if (typeof s !== "string" || !/^\d+(\.\d+)?$/.test(s)) {
    throw Object.assign(new Error("invalid decimal"), { code: "validation_failed" });
  }
  const [w, f = ""] = s.split(".");
  if (f.length > maxFrac) {
    throw Object.assign(new Error(`too many decimal places (max ${maxFrac})`), { code: "validation_failed" });
  }
  return { whole: BigInt(w || "0"), frac: BigInt(f.padEnd(maxFrac, "0") || "0"), scale: maxFrac };
}

/** Parse SOL string → lamports. Rejects negatives, empty, excess precision, non-canonical junk. */
export function solToLamports(sol: string): bigint {
  const { whole, frac } = parsePositiveDecimal(sol, 9);
  const lamports = whole * LAMPORTS_PER_SOL + frac;
  if (lamports < 0n) throw Object.assign(new Error("negative sol"), { code: "validation_failed" });
  return lamports;
}

export function lamportsToSol(lamports: bigint): string {
  if (lamports < 0n) throw Object.assign(new Error("negative lamports"), { code: "validation_failed" });
  const w = lamports / LAMPORTS_PER_SOL;
  const f = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return f ? `${w}.${f}` : w.toString();
}

export function tokenToRaw(amount: string, decimals: number): bigint {
  if (decimals < 0 || decimals > 18) throw Object.assign(new Error("bad decimals"), { code: "validation_failed" });
  const { whole, frac } = parsePositiveDecimal(amount, decimals);
  const scale = 10n ** BigInt(decimals);
  // frac already padded to decimals length as integer of 10^decimals scale? 
  // parsePositiveDecimal pads frac to maxFrac digits, so frac is the numerator for 10^decimals
  return whole * scale + frac;
}

export function rawToToken(raw: bigint, decimals: number): string {
  if (raw < 0n) throw Object.assign(new Error("negative raw"), { code: "validation_failed" });
  const scale = 10n ** BigInt(decimals);
  const w = raw / scale;
  const f = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return f ? `${w}.${f}` : w.toString();
}

export function mulBps(amount: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0) throw Object.assign(new Error("bad bps"), { code: "validation_failed" });
  return (amount * BigInt(bps)) / 10_000n;
}

/** Percentage string with 2 fractional digits from bigint numer/denom (scaled). */
export function pctFromLamports(numer: bigint, denom: bigint): string {
  if (denom === 0n) return "0.00";
  const sign = numer < 0n ? -1n : 1n;
  const n = numer < 0n ? -numer : numer;
  // (n/denom)*100 with 2 decimals → (n * 10000) / denom, then format
  const scaled = (n * 10000n) / denom;
  const whole = scaled / 100n;
  const frac = (scaled % 100n).toString().padStart(2, "0");
  return `${sign < 0n ? "-" : ""}${whole}.${frac}`;
}

export function addSolStrings(a: string, b: string): string {
  return lamportsToSol(solToLamports(a) + solToLamports(b));
}

export function subSolStrings(a: string, b: string): string {
  const r = solToLamports(a) - solToLamports(b);
  if (r < 0n) throw Object.assign(new Error("insufficient"), { code: "forbidden" });
  return lamportsToSol(r);
}

/** Compare decimal money strings via lamports. */
export function cmpSol(a: string, b: string): number {
  const d = solToLamports(a) - solToLamports(b);
  return d === 0n ? 0 : d > 0n ? 1 : -1;
}

// Back-compat shim used by non-ledger display paths — still rejects junk, but returns Number only for UI ranking sort.
export function parseDec(s: string): number {
  // Prefer money paths; this is for sorting display percentages only.
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw Object.assign(new Error("bad decimal"), { code: "validation_failed" });
  const n = Number(s);
  if (!Number.isFinite(n)) throw Object.assign(new Error("bad decimal"), { code: "validation_failed" });
  return n;
}

/** Parse SOL string that may be negative (realized PnL). */
export function solToLamportsSigned(sol: string): bigint {
  if (sol.startsWith("-")) return -solToLamports(sol.slice(1));
  return solToLamports(sol);
}

export function lamportsToSolSigned(lamports: bigint): string {
  if (lamports < 0n) return `-${lamportsToSol(-lamports)}`;
  return lamportsToSol(lamports);
}

/** Parse a non-negative decimal price with arbitrary fractional digits → {numer, denom=10^scale}. */
export function parsePriceRational(s: string): { numer: bigint; scale: number } {
  if (typeof s !== "string" || !/^\d+(\.\d+)?$/.test(s)) {
    throw Object.assign(new Error("invalid price"), { code: "validation_failed" });
  }
  const [w, f = ""] = s.split(".");
  if (f.length > 24) {
    throw Object.assign(new Error("price precision too high"), { code: "validation_failed" });
  }
  const scale = f.length;
  const numer = BigInt(w || "0") * 10n ** BigInt(scale) + BigInt(f || "0");
  return { numer, scale };
}

/**
 * valueLamports = qtyRaw * priceSol * 1e9 / 10^decimals
 * priceSol = numer / 10^scale
 */
export function valueLamportsFromPrice(qtyRaw: bigint, priceSol: string, decimals: number): bigint {
  if (qtyRaw === 0n || priceSol === "0") return 0n;
  const { numer, scale } = parsePriceRational(priceSol);
  // qtyRaw * numer * 1e9 / (10^scale * 10^decimals)
  const denomExp = scale + decimals;
  return (qtyRaw * numer * LAMPORTS_PER_SOL) / (10n ** BigInt(denomExp));
}
