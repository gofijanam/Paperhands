/** Minimal Solana PDA finder (SHA-256 + ed25519 on-curve check). No web3.js. */
import { createHash } from "node:crypto";
import bs58 from "bs58";

const P = (1n << 255n) - 19n;
const D = (P - ((121665n * modInv(121666n, P)) % P)) % P;

function modPow(a: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  a %= m;
  while (e > 0n) {
    if (e & 1n) r = (r * a) % m;
    a = (a * a) % m;
    e >>= 1n;
  }
  return r;
}
function modInv(a: bigint, m: bigint): bigint {
  return modPow(a, m - 2n, m);
}
function leToBig(b: Uint8Array): bigint {
  let x = 0n;
  for (let i = 0; i < b.length; i++) x |= BigInt(b[i]!) << BigInt(8 * i);
  return x;
}

/** True if bytes are a valid compressed ed25519 point on the curve. */
export function isOnCurve(pubkey: Uint8Array): boolean {
  if (pubkey.length !== 32) return false;
  const y = leToBig(pubkey) & ((1n << 255n) - 1n);
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const u = (y2 - 1n + P) % P;
  const v = (D * y2 + 1n) % P;
  const x2 = (u * modInv(v, P)) % P;
  const legendre = modPow(x2, (P - 1n) / 2n, P);
  return legendre === 1n || x2 === 0n;
}

export function findProgramAddress(seeds: Uint8Array[], programId: Uint8Array): { address: Uint8Array; bump: number } {
  for (let bump = 255; bump >= 0; bump--) {
    const h = createHash("sha256");
    for (const s of seeds) h.update(s);
    h.update(Uint8Array.of(bump));
    h.update(programId);
    h.update(Buffer.from("ProgramDerivedAddress"));
    const digest = new Uint8Array(h.digest());
    if (!isOnCurve(digest)) return { address: digest, bump };
  }
  throw new Error("unable_to_find_pda");
}

export function decodePubkey(base58Str: string): Uint8Array {
  const b = bs58.decode(base58Str);
  if (b.length !== 32) throw Object.assign(new Error("invalid_pubkey"), { code: "validation_failed" });
  return b;
}

export function encodePubkey(bytes: Uint8Array): string {
  return bs58.encode(bytes);
}
