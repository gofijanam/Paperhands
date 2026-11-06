"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "@/components/SiteLink";
import type { PaperApi, TCoin, TQuote } from "@/lib/api";
import { feeBps, friendlyError, usePaper } from "@/lib/store";
import { GATE_REQUIRED, MIN_TRADE_SOL, PRIORITY_FEE_SOL, TICKER } from "@/lib/constants";
import { compact, num, sol, solPrice, wireAmount } from "@/lib/format";

const QUICK_BUY = [0.1, 0.5, 1, 2];
const QUICK_SELL = [0.25, 0.5, 1];
const SLIPS = [50, 100, 200, 500];

/** Local estimate when no server quote is available (constant-product approximation on reported liquidity). */
function estimate(c: TCoin, side: "buy" | "sell", sol: number) {
  const liqSol = (c.liquidityUsd / 2) / (c.priceUsd / c.priceSol || 180);
  const impact = Number.isFinite(liqSol) && liqSol > 0 ? Math.min(50, (sol / (liqSol + sol)) * 100) : 0;
  return impact;
}

function useNowMs(ms: number) {
  const [n, setN] = useState(0);
  useEffect(() => { setN(Date.now()); const id = setInterval(() => setN(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return n;
}

export function TradePanel({ coin, api, initialSide = "buy" }: { coin: TCoin; api: PaperApi; initialSide?: "buy" | "sell" }) {
  const p = usePaper();
  const [side, setSide] = useState<"buy" | "sell">(initialSide);
  const [amt, setAmt] = useState("0.1"); // 0.5 at 1% slippage trips impact on small bonding curves
  const [frac, setFrac] = useState(1);
  const [slip, setSlip] = useState(100);
  const [qState, setQState] = useState<{ key: string; q: TQuote } | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  // Quote only after the user engages the panel: saves the 30/min quote budget and avoids noise on page load.
  const [touched, setTouched] = useState(true);
  const [requote, setRequote] = useState(0);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const pos = p.positions.find((x) => x.mint === coin.mint);
  const solIn = side === "buy" ? Number(amt) || 0 : 0;
  const tokensIn = side === "sell" ? (pos?.tokens ?? 0) * frac : 0;
  const notional = side === "buy" ? solIn : tokensIn * coin.priceSol;
  const live = p.source === "live" && !!p.token && !!api.quote;
  // Refresh the 10-second server quote while idle; suspend during order submission.
  useEffect(() => { if (!live || !touched || p.busy) return; const id = setInterval(() => setRequote((x) => x + 1), 7000); return () => clearInterval(id); }, [live, touched, p.busy]);
  const qKey = `${side}|${amt}|${frac}|${slip}|${coin.mint}`;
  const now = useNowMs(1000);
  // Use a quote only for its exact inputs, with at least one second remaining.
  const quote = (side === "buy" || tokensIn > 0) && qState && qState.key === qKey && qState.q.expiresAt - now > 1000 ? qState.q : null;
  const untradeable = coin.status !== "tradeable";

  // Server quote (contract POST /v1/quotes), debounced. Local estimate otherwise.
  useEffect(() => {
    setQErr(null);
    if (!live || !p.passes || notional < MIN_TRADE_SOL || untradeable || !touched || p.busy) return;
    let active = true;
    const t = setTimeout(() => {
      api.quote!({ mint: coin.mint, side, slippageBps: slip, ...(side === "buy" ? { amountSol: wireAmount(solIn, 9) } : { amountToken: wireAmount(tokensIn, coin.decimals ?? 6) }) }, p.token!)
        .then((q) => {if(active)setQState({ key: qKey, q });}).catch((e: Error) => {if(active)setQErr(friendlyError(e, side));});
    }, 350);
    return () => {active=false;clearTimeout(t);};
  }, [live, p.passes, p.token, api, coin.mint, side, solIn, tokensIn, slip, untradeable, touched, requote, coin.decimals, qKey, p.busy]);

  const impact = quote ? quote.impactPct : estimate(coin, side, notional);
  const fee = notional <= 0 ? 0 : quote ? quote.feeSol : (notional * feeBps(coin.venue)) / 10_000 + PRIORITY_FEE_SOL;
  const out = notional <= 0 ? 0 : quote ? quote.outAmount : side === "buy" ? (solIn - (solIn * feeBps(coin.venue)) / 10_000) / (coin.priceSol * (1 + impact / 100)) : notional * (1 - impact / 100) - fee;
  const tooMuch = impact > slip / 100;
  const IMPACT_CAP = 5; // CONTRACT 7eefdc3: hard cap on bonding fills
  const nearCap = coin.venue === "bonding" && impact >= IMPACT_CAP * 0.7;
  // One Idempotency-Key per intent (per server quote): a double-click resubmits the same key -> same trade, never two.
  const intentKey = useMemo(() => (quote?.id), [quote?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Largest buy the local model expects to stay under ~30% impact on a bonding curve (server is authoritative). */
  const maxBuy = useMemo(() => {
    const cash = Math.max(0, Math.min(p.balance - PRIORITY_FEE_SOL, p.bankroll * .25 - (pos?.costSol ?? 0) - PRIORITY_FEE_SOL));
    if (coin.venue !== "bonding") return cash;
    const liqSol = (coin.liquidityUsd / 2) / (coin.priceUsd / coin.priceSol || 180);
    return Number.isFinite(liqSol) && liqSol > 0 ? Math.min(cash, liqSol * 0.42) : cash;
  }, [p.balance, p.bankroll, pos?.costSol, coin.venue, coin.liquidityUsd, coin.priceUsd, coin.priceSol]);
  const insufficient = side === "buy" ? solIn + PRIORITY_FEE_SOL > p.balance : !pos;
  const blocked = (live && !quote) || !p.token || !p.passes || untradeable || notional < MIN_TRADE_SOL || insufficient || tooMuch || p.busy || !!qErr;

  const submit = async () => {
    setQState(null);
    const r = await p.trade({ mint: coin.mint, symbol: coin.symbol, side, sol: solIn, fraction: frac, priceSol: coin.priceSol, venue: coin.venue, impactPct: impact, quoteId: quote?.id, intentKey });
    if (typeof r === "string") setToast({ ok: false, text: r });
    else setToast({ ok: true, text: side === "buy" ? `Bought ${compact(r.tokens)} $${coin.symbol} for ${sol(r.sol, 3)} paper` : `Sold for ${sol(r.sol, 3)} paper · PnL ${r.pnlSol == null ? "—" : sol(r.pnlSol, 3)}` });
    setRequote(x=>x+1);
    setTimeout(() => setToast(null), 5000);
  };

  return (
    <section aria-label="Paper trade" className="panel p-3" data-motion="trade-panel" onPointerDown={() => setTouched(true)} onFocus={() => setTouched(true)}>
      <div role="tablist" aria-label="Side" className="grid grid-cols-2 gap-1 rounded-lg bg-panel-3 p-1">
        {(["buy", "sell"] as const).map((s) => (
          <button key={s} role="tab" aria-selected={side === s} onClick={() => setSide(s)}
            className={`h-9 rounded-md text-[14px] font-semibold capitalize transition-colors ${side === s ? (s === "buy" ? "bg-accent text-accent-ink" : "bg-sell text-white") : "text-muted hover:text-text"}`}>{s}</button>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between rounded-lg border border-line bg-bg/60 px-2.5 py-2" data-motion="paper-balance">
        <span className="text-[12px] text-muted">Paper balance</span>
        <span className="num text-[14px] font-semibold text-text">{sol(p.balance, 3)} <span className="text-[11px] font-normal text-muted">of {sol(p.bankroll, 0)}</span></span>
      </div>
      <div className="mt-3 text-[12px] text-muted">{side === "buy" ? "Amount (paper SOL)" : "Sell share of position"}</div>
      {side === "buy" ? (
        <>
          <label className="mt-1 flex h-11 items-center rounded-lg border border-line-2 bg-bg px-3 focus-within:border-accent">
            <span className="sr-only">Amount in paper SOL</span>
            <input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} className="num w-full bg-transparent text-[16px] outline-none" />
            <span className="shrink-0 text-[13px] text-muted">SOL</span>
          </label>
          <div className="mt-2 grid grid-cols-5 gap-1">
            {QUICK_BUY.map((q) => <button key={q} onClick={() => setAmt(String(q))} aria-pressed={Number(amt) === q} className="chip num py-1.5 text-center">{q}</button>)}
            <button onClick={() => setAmt(wireAmount(maxBuy, 3))} title={coin.venue === "bonding" ? "Maximum within balance and position limit" : "Maximum within balance and position limit"} className="chip py-1.5 text-center">Max</button>
          </div>
        </>
      ) : (
        <div className="mt-1 grid grid-cols-3 gap-1">
          {QUICK_SELL.map((f) => <button key={f} onClick={() => setFrac(f)} aria-pressed={frac === f} className="chip num py-2 text-center">{f * 100}%</button>)}
          <p className="col-span-3 mt-1 text-[12px] text-muted">{pos ? `You hold ${compact(pos.tokens)} $${coin.symbol}` : "No open position in this coin."}</p>
        </div>
      )}

      <div className="mt-3 text-[12px] text-muted">Max slippage</div>
      <div className="mt-1 grid grid-cols-4 gap-1" role="group" aria-label="Max slippage">
        {SLIPS.map((s) => <button key={s} onClick={() => setSlip(s)} aria-pressed={slip === s} className="chip num py-1.5 text-center">{s / 100}%</button>)}
      </div>

      <dl className="num mt-3 space-y-1.5 rounded-lg border border-line bg-bg/60 p-2.5 text-[12px]">
        <div className="flex justify-between"><dt className="text-muted">Est. fill</dt><dd className="text-soft">{side === "buy" ? `${compact(out)} $${coin.symbol}` : sol(out, 4)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Price</dt><dd className="text-soft">{solPrice(quote?.priceSol ?? coin.priceSol)}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Price impact</dt><dd className={tooMuch ? "text-down" : "text-soft"}>{impact.toFixed(2)}%</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Simulated fees (0.3% + priority)</dt><dd className="text-soft">{sol(fee, 4)}</dd></div>
        <div className="flex justify-between border-t border-line pt-1.5"><dt className="text-muted">Source</dt><dd className="text-muted">{quote ? `server quote · ${quote.route}` : live && touched && notional >= MIN_TRADE_SOL && !qErr ? "quoting…" : "estimate · server confirms"}</dd></div>
      </dl>
      {nearCap && !tooMuch && <p className="mt-2 text-[12px] text-[#ffc457]">Close to the 5% impact cap on this curve. Bigger sizes are rejected.</p>}
      {tooMuch && <p className="mt-2 text-[12px] text-down">Impact is above your {slip / 100}% max: raise slippage or trade smaller, or it rejects.</p>}
      {qErr && <p className="mt-2 text-[12px] text-down">{qErr}</p>}

      {!p.token ? (
        <button onClick={p.startPractice} disabled={p.busy} className="btn btn-accent mt-3 h-11 w-full text-[15px]">Start paper trading</button>
      ) : !p.passes ? (
        <Link href="/gate" className="btn btn-ghost mt-3 h-11 w-full text-[14px]">Hold {num(GATE_REQUIRED)} {TICKER} to trade</Link>
      ) : (
        <button onClick={submit} disabled={blocked} data-motion="cta" className={`btn mt-3 h-11 w-full text-[15px] ${side === "buy" ? `btn-accent ${blocked ? "" : "cta-ready"}` : "bg-sell text-white hover:brightness-110"}`}>
          {p.busy ? "Saving paper order…" : untradeable ? `Untradeable (${coin.status})` : insufficient && side === "buy" ? "Not enough paper SOL" : `Paper ${side} $${coin.symbol}`}
        </button>
      )}
      <p className="mt-2 text-center text-[12px] text-muted">Real prices · virtual SOL · <span className="text-soft">{p.practice?"practice":"holder account"}</span></p>
      <div aria-live="polite" className="min-h-0">
        {toast && <p className={`row-in mt-2 rounded-md border px-2.5 py-2 text-[12px] ${toast.ok ? "border-up/40 text-up" : "border-down/40 text-down"}`}>{toast.text}</p>}
      </div>
    </section>
  );
}

