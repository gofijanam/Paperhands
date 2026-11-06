import type { Config } from "../config.js";
import { initialCurve, quoteBuy, quoteSell, type CurveState } from "../bonding/curve.js";
import {
  lamportsToSol,
  solToLamports,
  tokenToRaw,
  rawToToken,
  mulBps,
  parseDec,
} from "../lib/decimal.js";
import { getQuote, WSOL } from "../quotes/jupiter.js";
import { id, nowIso } from "../lib/ids.js";
import { assertFillLiquidityCap, assertMinTradeSize } from "../anticheat/guards.js";

export type QuoteInput = {
  mint: string;
  side: "buy" | "sell";
  amountSol?: string | null;
  amountToken?: string | null;
  slippageBps: number;
  venue: "bonding" | "graduated" | "unknown";
  decimals: number;
  curve?: CurveState;
  mockPriceSol?: string | null;
  liquidityUsd?: string | null;
  status?: string;
};

export type InternalQuote = {
  quoteId: string;
  mint: string;
  side: "buy" | "sell";
  venue: "bonding" | "graduated" | "unknown";
  inAmount: string;
  inUnit: "sol" | "token";
  outAmount: string;
  outUnit: "sol" | "token";
  priceSol: string;
  priceImpactPct: string;
  fee: {
    venueFeeBps: number;
    venueFeeSol: string;
    priorityFeeSol: string;
    platformFeeBps: number;
    platformFeeSol: string;
  };
  slippageBps: number;
  minOutAmount: string;
  liquidityUsd: string | null;
  expiresAt: string;
  route: string;
  warnings: string[];
};

/** Floor out-amount by slippage (user-unfavorable). */
function slipFloor(amount: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps > 10_000) {
    throw Object.assign(new Error("bad slippage"), { code: "validation_failed" });
  }
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

/** Fail closed: impact must be finite, within slippage tolerance (pct), and ≤ hard cap. */
export function assertPriceImpactOk(impact: number, slippageBps: number, hardCapPct = 35) {
  if (!Number.isFinite(impact) || impact < 0) {
    throw Object.assign(new Error("Invalid price impact"), { code: "untradeable" });
  }
  if (impact > slippageBps / 100) {
    throw Object.assign(new Error("Price impact exceeds slippage"), { code: "untradeable" });
  }
  if (impact > hardCapPct) {
    throw Object.assign(new Error("Price impact exceeds hard cap"), { code: "untradeable" });
  }
}

/** SOL per whole token from in-lamports and out-raw. */
function priceFromInOut(inLamports: bigint, outRaw: bigint, decimals: number): string {
  if (outRaw <= 0n || inLamports <= 0n) return "0";
  const scale = 10n ** BigInt(decimals);
  return lamportsToSol((inLamports * scale) / outRaw);
}

/** Impact percent string with 4 fractional digits from bigint ratio (×1e6). */
function impactPctString(pctTimes1e4: number): string {
  // curve still returns number for display; clamp format
  if (!Number.isFinite(pctTimes1e4)) return "0.0000";
  return pctTimes1e4.toFixed(4);
}

export async function buildQuote(config: Config, input: QuoteInput): Promise<InternalQuote> {
  if (input.status === "rugged" || input.status === "untradeable" || input.status === "frozen") {
    throw Object.assign(new Error("Coin is untradeable"), { code: "untradeable" });
  }
  if (input.venue === "graduated") {
    if (input.liquidityUsd == null || input.liquidityUsd === "") {
      throw Object.assign(new Error("Liquidity unknown"), { code: "untradeable" });
    }
    const liq = parseDec(input.liquidityUsd);
    if (!(liq > 0) || input.status === "rugged") {
      throw Object.assign(new Error("Rugged or zero liquidity"), { code: "untradeable" });
    }
    if (liq < parseDec(config.MIN_LIQUIDITY_USD)) {
      throw Object.assign(new Error("Liquidity below floor"), { code: "untradeable" });
    }
  }
  if (input.side === "buy") {
    if (!input.amountSol) throw Object.assign(new Error("amountSol required"), { code: "validation_failed" });
    assertMinTradeSize(config, input.amountSol);
    if (input.venue === "graduated") {
      assertFillLiquidityCap(config, input.amountSol, input.liquidityUsd ?? null);
    }
  }

  const priorityFeeSol = lamportsToSol(BigInt(config.PRIORITY_FEE_LAMPORTS));
  const expiresAt = nowIso(new Date(Date.now() + config.QUOTE_TTL_SEC * 1000));
  const quoteId = id("qte_");

  if (input.venue === "bonding" || (config.isMock && input.venue !== "graduated")) {
    return bondingQuote(config, input, quoteId, expiresAt, priorityFeeSol);
  }
  if (config.isMock) {
    return mockGraduatedQuote(config, input, quoteId, expiresAt, priorityFeeSol);
  }
  return jupiterQuote(config, input, quoteId, expiresAt, priorityFeeSol);
}

function bondingQuote(
  config: Config,
  input: QuoteInput,
  quoteId: string,
  expiresAt: string,
  priorityFeeSol: string,
): InternalQuote {
  const curve = input.curve ?? initialCurve();
  const warnings: string[] = [];
  const decimals = input.decimals;

  if (input.side === "buy") {
    const solIn = input.amountSol ?? "0";
    const solLamports = solToLamports(solIn);
    if (solLamports < solToLamports(config.MIN_TRADE_SOL)) {
      throw Object.assign(new Error(`Min trade ${config.MIN_TRADE_SOL} SOL`), { code: "validation_failed" });
    }
    const r = quoteBuy(curve, solLamports);
    if (r.priceImpactPct > input.slippageBps / 100) {
      throw Object.assign(new Error("Price impact exceeds slippage"), { code: "untradeable" });
    }
    if (r.priceImpactPct > 35) {
      throw Object.assign(new Error("Price impact exceeds hard cap"), { code: "untradeable" });
    }
    // Max buy: not more than 25% of virtual SOL reserves in one fill
    if (solLamports > curve.virtualSolReserves / 4n) {
      throw Object.assign(new Error("Fill exceeds native bonding reserve bound"), { code: "untradeable" });
    }
    const outAmount = rawToToken(r.tokensOut, decimals);
    const minOutAmount = rawToToken(slipFloor(r.tokensOut, input.slippageBps), decimals);
    return {
      quoteId,
      mint: input.mint,
      side: "buy",
      venue: "bonding",
      inAmount: lamportsToSol(solLamports),
      inUnit: "sol",
      outAmount,
      outUnit: "token",
      priceSol: priceFromInOut(solLamports, r.tokensOut, decimals),
      priceImpactPct: impactPctString(r.priceImpactPct),
      fee: {
        venueFeeBps: 125,
        venueFeeSol: lamportsToSol(r.feeLamports),
        priorityFeeSol,
        platformFeeBps: config.PLATFORM_FEE_BPS,
        platformFeeSol: "0",
      },
      slippageBps: input.slippageBps,
      minOutAmount,
      liquidityUsd: input.liquidityUsd ?? null,
      expiresAt,
      route: "pump_bonding",
      warnings,
    };
  }

  const tokIn = input.amountToken ?? "0";
  let rawIn = tokenToRaw(tokIn, decimals);
  // Thin curve: real reserves present but dust
  if (curve.realSolReserves > 0n && curve.realSolReserves < 1000n) {
    throw Object.assign(new Error("Thin bonding curve reserves"), { code: "untradeable" });
  }
  // Bound by curve math (quoteSell clamps to real reserves). No half-reserve reject —
  // users must be able to exit holdings; net paperDepth caps farming.
  let r = quoteSell(curve, rawIn);
  const impactLimit = Math.min(input.slippageBps / 100, 35);
  if (r.priceImpactPct > impactLimit) {
    // Partially size down to fit impact; if nothing fits, allow exit when output ≤ real reserves
    let lo = 1n;
    let hi = rawIn;
    let best: { tokens: bigint; q: ReturnType<typeof quoteSell> } | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) / 2n;
      if (mid <= 0n) break;
      const trial = quoteSell(curve, mid);
      if (trial.priceImpactPct <= impactLimit) {
        best = { tokens: mid, q: trial };
        lo = mid + 1n;
      } else {
        hi = mid - 1n;
      }
    }
    if (best) {
      rawIn = best.tokens;
      r = best.q;
      warnings.push("sized_down_for_impact");
    } else if (curve.realSolReserves === 0n || r.solOutLamports <= curve.realSolReserves) {
      warnings.push("impact_above_slippage_exit_allowed");
    } else {
      throw Object.assign(new Error("Price impact exceeds slippage"), { code: "untradeable" });
    }
  }
  if (r.solOutLamports < solToLamports(config.MIN_TRADE_SOL) / 100n) {
    warnings.push("dust_output");
  }
  const outAmount = lamportsToSol(r.solOutLamports);
  const minOutAmount = lamportsToSol(slipFloor(r.solOutLamports, input.slippageBps));
  return {
    quoteId,
    mint: input.mint,
    side: "sell",
    venue: "bonding",
    inAmount: rawToToken(rawIn, decimals),
    inUnit: "token",
    outAmount,
    outUnit: "sol",
    priceSol: priceFromInOut(r.solOutLamports, rawIn, decimals),
    priceImpactPct: impactPctString(r.priceImpactPct),
    fee: {
      venueFeeBps: 125,
      venueFeeSol: lamportsToSol(r.feeLamports),
      priorityFeeSol,
      platformFeeBps: config.PLATFORM_FEE_BPS,
      platformFeeSol: "0",
    },
    slippageBps: input.slippageBps,
    minOutAmount,
    liquidityUsd: input.liquidityUsd ?? null,
    expiresAt,
    route: "pump_bonding",
    warnings,
  };
}

function mockGraduatedQuote(
  config: Config,
  input: QuoteInput,
  quoteId: string,
  expiresAt: string,
  priorityFeeSol: string,
): InternalQuote {
  const decimals = input.decimals;
  const priceLamports = solToLamports(input.mockPriceSol || "0.000012");
  const impactBps = 15; // 0.15%

  if (input.side === "buy") {
    const solLamports = solToLamports(input.amountSol ?? "0");
    if (solLamports < solToLamports(config.MIN_TRADE_SOL)) {
      throw Object.assign(new Error(`Min trade ${config.MIN_TRADE_SOL} SOL`), { code: "validation_failed" });
    }
    if (priceLamports <= 0n) {
      throw Object.assign(new Error("Bad mock price"), { code: "untradeable" });
    }
    // tokens = sol/px / (1 + impact/100) → outRaw = solLamports * 10^dec * 10000 / (priceLamports * (10000+impactBps))
    const scale = 10n ** BigInt(decimals);
    const outRaw = (solLamports * scale * 10_000n) / (priceLamports * BigInt(10_000 + impactBps));
    const venueFee = mulBps(solLamports, 30);
    return {
      quoteId,
      mint: input.mint,
      side: "buy",
      venue: "graduated",
      inAmount: lamportsToSol(solLamports),
      inUnit: "sol",
      outAmount: rawToToken(outRaw, decimals),
      outUnit: "token",
      priceSol: lamportsToSol(priceLamports),
      priceImpactPct: "0.1500",
      fee: {
        venueFeeBps: 30,
        venueFeeSol: lamportsToSol(venueFee),
        priorityFeeSol,
        platformFeeBps: config.PLATFORM_FEE_BPS,
        platformFeeSol: "0",
      },
      slippageBps: input.slippageBps,
      minOutAmount: rawToToken(slipFloor(outRaw, input.slippageBps), decimals),
      liquidityUsd: input.liquidityUsd ?? null,
      expiresAt,
      route: "mock_jupiter",
      warnings: ["_mock"],
    };
  }

  const rawIn = tokenToRaw(input.amountToken ?? "0", decimals);
  const scale = 10n ** BigInt(decimals);
  // sol = tok * px * (1 - impact/100) → lamports = rawIn * priceLamports * (10000-impactBps) / (10^dec * 10000)
  const solOut = (rawIn * priceLamports * BigInt(10_000 - impactBps)) / (scale * 10_000n);
  const venueFee = mulBps(solOut, 30);
  return {
    quoteId,
    mint: input.mint,
    side: "sell",
    venue: "graduated",
    inAmount: rawToToken(rawIn, decimals),
    inUnit: "token",
    outAmount: lamportsToSol(solOut),
    outUnit: "sol",
    priceSol: lamportsToSol(priceLamports),
    priceImpactPct: "0.1500",
    fee: {
      venueFeeBps: 30,
      venueFeeSol: lamportsToSol(venueFee),
      priorityFeeSol,
      platformFeeBps: config.PLATFORM_FEE_BPS,
      platformFeeSol: "0",
    },
    slippageBps: input.slippageBps,
    minOutAmount: lamportsToSol(slipFloor(solOut, input.slippageBps)),
    liquidityUsd: input.liquidityUsd ?? null,
    expiresAt,
    route: "mock_jupiter",
    warnings: ["_mock"],
  };
}

async function jupiterQuote(
  config: Config,
  input: QuoteInput,
  quoteId: string,
  expiresAt: string,
  priorityFeeSol: string,
): Promise<InternalQuote> {
  const decimals = input.decimals;
  if (input.side === "buy") {
    const solLamports = solToLamports(input.amountSol ?? "0");
    const q = await getQuote({
      inputMint: WSOL,
      outputMint: input.mint,
      amount: solLamports.toString(),
      slippageBps: input.slippageBps,
      apiKey: config.JUPITER_API_KEY || undefined,
    });
    const outRaw = BigInt(q.outAmount);
    if (outRaw <= 0n) {
      throw Object.assign(new Error("Nonpositive output"), { code: "untradeable" });
    }
    const impact = Number(q.priceImpactPct);
    assertPriceImpactOk(impact, input.slippageBps);
    const minRaw = BigInt(q.otherAmountThreshold);
    return {
      quoteId,
      mint: input.mint,
      side: "buy",
      venue: "graduated",
      inAmount: lamportsToSol(solLamports),
      inUnit: "sol",
      outAmount: rawToToken(outRaw, decimals),
      outUnit: "token",
      priceSol: priceFromInOut(solLamports, outRaw, decimals),
      priceImpactPct: Number.isFinite(impact) ? impact.toFixed(4) : "0.0000",
      fee: {
        venueFeeBps: 0,
        venueFeeSol: "0",
        priorityFeeSol,
        platformFeeBps: config.PLATFORM_FEE_BPS,
        platformFeeSol: "0",
      },
      slippageBps: input.slippageBps,
      minOutAmount: rawToToken(minRaw, decimals),
      liquidityUsd: input.liquidityUsd ?? null,
      expiresAt,
      route: "jupiter_v1_quote",
      warnings: [],
    };
  }

  const rawIn = tokenToRaw(input.amountToken ?? "0", decimals);
  const q = await getQuote({
    inputMint: input.mint,
    outputMint: WSOL,
    amount: rawIn.toString(),
    slippageBps: input.slippageBps,
    apiKey: config.JUPITER_API_KEY || undefined,
  });
  const solOut = BigInt(q.outAmount);
  if (solOut <= 0n) {
    throw Object.assign(new Error("Nonpositive output"), { code: "untradeable" });
  }
  const sellImpact = Number(q.priceImpactPct);
  assertPriceImpactOk(sellImpact, input.slippageBps);
  return {
    quoteId,
    mint: input.mint,
    side: "sell",
    venue: "graduated",
    inAmount: rawToToken(rawIn, decimals),
    inUnit: "token",
    outAmount: lamportsToSol(solOut),
    outUnit: "sol",
    priceSol: priceFromInOut(solOut, rawIn, decimals),
    priceImpactPct: Number.isFinite(sellImpact) ? sellImpact.toFixed(4) : "0.0000",
    fee: {
      venueFeeBps: 0,
      venueFeeSol: "0",
      priorityFeeSol,
      platformFeeBps: config.PLATFORM_FEE_BPS,
      platformFeeSol: "0",
    },
    slippageBps: input.slippageBps,
    minOutAmount: lamportsToSol(BigInt(q.otherAmountThreshold)),
    liquidityUsd: input.liquidityUsd ?? null,
    expiresAt,
    route: "jupiter_v1_quote",
    warnings: [],
  };
}

/** Test helper: assert quote amount fields respect unit precision. */
export function assertQuotePrecision(q: InternalQuote, decimals: number) {
  const solMax = 9;
  const check = (s: string, max: number, label: string) => {
    const f = s.includes(".") ? s.split(".")[1]!.length : 0;
    if (f > max) throw new Error(`${label} has ${f} decimals > ${max}: ${s}`);
  };
  if (q.inUnit === "sol") check(q.inAmount, solMax, "inAmount");
  else check(q.inAmount, decimals, "inAmount");
  if (q.outUnit === "sol") check(q.outAmount, solMax, "outAmount");
  else check(q.outAmount, decimals, "outAmount");
  check(q.minOutAmount, q.outUnit === "sol" ? solMax : decimals, "minOutAmount");
  check(q.fee.priorityFeeSol, solMax, "priorityFeeSol");
  check(q.fee.venueFeeSol, solMax, "venueFeeSol");
  check(q.priceSol, solMax, "priceSol");
}
