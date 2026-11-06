import { z } from "zod";
import bs58 from "bs58";

export const SolAddress = z.string().refine((s) => {
  try {
    const b = bs58.decode(s);
    return b.length === 32;
  } catch {
    return false;
  }
}, "invalid solana address");

/** Mint keys: base58 charset, 32–44 chars (accepts fixture mints that are not exact 32-byte). */
export const MintAddress = z
  .string()
  .min(32)
  .max(44)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, "invalid mint");

export const PositiveDecimal = (maxFrac: number) =>
  z.string().regex(new RegExp(`^\\d+(\\.\\d{1,${maxFrac}})?$`), "invalid decimal").refine((s) => {
    if (s === "0" || s.startsWith("0.") && /^0\.0+$/.test(s)) return false;
    return true;
  }, "must be positive");

export const NonNegDecimal = (maxFrac: number) =>
  z.string().regex(new RegExp(`^\\d+(\\.\\d{1,${maxFrac}})?$`), "invalid decimal");

export const QuoteBody = z
  .object({
    mint: MintAddress,
    side: z.enum(["buy", "sell"]),
    amountSol: PositiveDecimal(9).nullable().optional(),
    amountToken: PositiveDecimal(18).nullable().optional(),
    slippageBps: z.number().int().min(1).max(5000).default(100),
  })
  .superRefine((v, ctx) => {
    const hasSol = v.amountSol != null && v.amountSol !== "";
    const hasTok = v.amountToken != null && v.amountToken !== "";
    if (v.side === "buy" && !hasSol) ctx.addIssue({ code: "custom", message: "amountSol required for buy" });
    if (v.side === "sell" && !hasTok) ctx.addIssue({ code: "custom", message: "amountToken required for sell" });
  });

export const TradeBody = z.object({
  quoteId: z.string().regex(/^qte_[a-zA-Z0-9]+$/),
  clientTradeId: z.string().max(128).optional(),
});

export const AuthVerifyBody = z.object({
  wallet: SolAddress,
  message: z.string().min(32).max(4096),
  signature: z.string().min(8).max(128),
});

export const AuthNonceQuery = z.object({
  wallet: SolAddress,
});
