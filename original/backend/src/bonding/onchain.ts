import { decodePubkey, encodePubkey, findProgramAddress } from "../lib/pda.js";
import type { CurveState } from "./curve.js";
import { initialCurve } from "./curve.js";
import type { RpcClient } from "../rpc/client.js";

export const PUMP_PROGRAM_ID = decodePubkey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

export function bondingCurvePda(mint: string): string {
  const { address } = findProgramAddress([Buffer.from("bonding-curve"), decodePubkey(mint)], PUMP_PROGRAM_ID);
  return encodePubkey(address);
}

export function decodeBondingCurve(data: Buffer): CurveState | null {
  if (data.length < 8 + 8 * 5 + 1) return null;
  const o = 8;
  const readU64 = (offset: number) => data.readBigUInt64LE(offset);
  return {
    virtualTokenReserves: readU64(o),
    virtualSolReserves: readU64(o + 8),
    realTokenReserves: readU64(o + 16),
    realSolReserves: readU64(o + 24),
    complete: data[o + 40] === 1,
  };
}

export async function fetchCurveState(rpc: RpcClient, mint: string): Promise<CurveState | null> {
  try {
    const pda = bondingCurvePda(mint);
    const buf = await rpc.getAccountInfoBase64(pda);
    if (!buf) return null;
    return decodeBondingCurve(buf);
  } catch {
    return null;
  }
}

export function curveToProgressPct(state: CurveState): number {
  const init = initialCurve().realTokenReserves;
  if (init === 0n) return 0;
  const sold = init - state.realTokenReserves;
  // Display-only; not ledger
  return Math.max(0, Math.min(100, Number((sold * 10000n) / init) / 100));
}
