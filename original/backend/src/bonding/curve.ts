/**
 * Pump.fun bonding-curve math.
 * Constants from pump-public-docs Global account + pump.fun/docs/fees (2026-10-17).
 * Fee: 1.25% total (creator 30 bps + protocol 95 bps) on bonding curve.
 */
import { PUMP_BONDING } from "../contracts.js";

export type CurveState = {
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realSolReserves: bigint;
  realTokenReserves: bigint;
  complete: boolean;
};

export function initialCurve(): CurveState {
  return {
    virtualSolReserves: PUMP_BONDING.INITIAL_VIRTUAL_SOL_RESERVES,
    virtualTokenReserves: PUMP_BONDING.INITIAL_VIRTUAL_TOKEN_RESERVES,
    realSolReserves: 0n,
    realTokenReserves: PUMP_BONDING.INITIAL_REAL_TOKEN_RESERVES,
    complete: false,
  };
}

/** Apply fee on input amount (buy: fee taken from SOL in). */
export function applyFeeOnInput(amount: bigint, feeBps = PUMP_BONDING.FEE_BPS): { net: bigint; fee: bigint } {
  const fee = (amount * BigInt(feeBps)) / 10_000n;
  return { net: amount - fee, fee };
}

/** Apply fee on output amount (sell: fee taken from SOL out). */
export function applyFeeOnOutput(amount: bigint, feeBps = PUMP_BONDING.FEE_BPS): { net: bigint; fee: bigint } {
  const fee = (amount * BigInt(feeBps)) / 10_000n;
  return { net: amount - fee, fee };
}

/**
 * Buy ExactIn: spend `solIn` lamports (gross, before fee) for tokens.
 * Fee deducted from SOL input, then constant-product on virtual reserves.
 */
export function quoteBuy(state: CurveState, solInLamports: bigint): {
  tokensOut: bigint;
  feeLamports: bigint;
  newState: CurveState;
  priceImpactPct: number;
} {
  if (state.complete) throw new Error("curve_complete");
  if (solInLamports <= 0n) throw new Error("amount_zero");
  const { net: solNet, fee } = applyFeeOnInput(solInLamports);
  const k = state.virtualSolReserves * state.virtualTokenReserves;
  const newVirtualSol = state.virtualSolReserves + solNet;
  const newVirtualToken = k / newVirtualSol;
  let tokensOut = state.virtualTokenReserves - newVirtualToken;
  if (tokensOut > state.realTokenReserves) tokensOut = state.realTokenReserves;

  const spotBefore = Number(state.virtualSolReserves) / Number(state.virtualTokenReserves);
  const spotAfter = Number(newVirtualSol) / Number(newVirtualToken);
  const priceImpactPct = spotBefore === 0 ? 0 : ((spotAfter - spotBefore) / spotBefore) * 100;

  const newState: CurveState = {
    virtualSolReserves: newVirtualSol,
    virtualTokenReserves: state.virtualTokenReserves - tokensOut,
    realSolReserves: state.realSolReserves + solNet,
    realTokenReserves: state.realTokenReserves - tokensOut,
    complete: state.realTokenReserves - tokensOut === 0n,
  };
  return { tokensOut, feeLamports: fee, newState, priceImpactPct };
}

/**
 * Sell ExactIn: sell `tokensIn` raw tokens for SOL.
 * Constant-product, then fee on SOL output.
 */
export function quoteSell(state: CurveState, tokensIn: bigint): {
  solOutLamports: bigint;
  feeLamports: bigint;
  newState: CurveState;
  priceImpactPct: number;
} {
  if (state.complete) throw new Error("curve_complete");
  if (tokensIn <= 0n) throw new Error("amount_zero");
  const k = state.virtualSolReserves * state.virtualTokenReserves;
  const newVirtualToken = state.virtualTokenReserves + tokensIn;
  const newVirtualSol = k / newVirtualToken;
  const solGross = state.virtualSolReserves - newVirtualSol;
  let { net: solNet, fee } = applyFeeOnOutput(solGross);
  // Native bound: when real reserves are tracked (>0), never pay out more than withdrawable
  if (state.realSolReserves > 0n && solNet > state.realSolReserves) {
    solNet = state.realSolReserves;
    fee = solGross > solNet ? solGross - solNet : 0n;
  }

  const spotBefore = Number(state.virtualSolReserves) / Number(state.virtualTokenReserves);
  const spotAfter = Number(newVirtualSol) / Number(newVirtualToken);
  const priceImpactPct = spotBefore === 0 ? 0 : ((spotBefore - spotAfter) / spotBefore) * 100;

  const newState: CurveState = {
    virtualSolReserves: newVirtualSol,
    virtualTokenReserves: newVirtualToken,
    realSolReserves: state.realSolReserves > solNet ? state.realSolReserves - solNet : 0n,
    realTokenReserves: state.realTokenReserves + tokensIn,
    complete: false,
  };
  return { solOutLamports: solNet, feeLamports: fee, newState, priceImpactPct };
}

/**
 * Spot price in SOL per whole token.
 * virtualSolReserves are lamports; virtualTokenReserves are raw (10^decimals).
 * SOL/token = (lamports/1e9) / (raw/10^decimals) = lamports * 10^decimals / (raw * 1e9).
 */
export function spotPriceSolPerToken(state: CurveState, decimals = 6): number {
  if (state.virtualTokenReserves === 0n) return 0;
  const scale = 10 ** decimals;
  return (Number(state.virtualSolReserves) * scale) / Number(state.virtualTokenReserves) / 1e9;
}

/** Exact spot as lamports-per-whole-token bigint for valuation. */
export function spotLamportsPerToken(state: CurveState, decimals = 6): bigint {
  if (state.virtualTokenReserves === 0n) return 0n;
  return (state.virtualSolReserves * 10n ** BigInt(decimals)) / state.virtualTokenReserves;
}

/** Bonding progress: fraction of real tokens sold from initial real reserves. */
export function bondingProgressPct(state: CurveState): number {
  const sold = PUMP_BONDING.INITIAL_REAL_TOKEN_RESERVES - state.realTokenReserves;
  return (Number(sold) / Number(PUMP_BONDING.INITIAL_REAL_TOKEN_RESERVES)) * 100;
}
