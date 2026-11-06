"use client";
import type {PaperTrader} from '@/lib/paper-ranking';
import { useEffect, useMemo, useState } from "react";
import {subscribeMarket} from '@/lib/market-stream';
import Link from "@/components/SiteLink";
import { getApi, type TCoin, type THolder, type TTape, type TTrade, type TTopTrader } from "@/lib/api";

import { useLiveCoin, useNow, useTradeTape } from "@/lib/live";
import { usePaper } from "@/lib/store";
import { age, compact, pct, price, short, sol, solPrice, usd } from "@/lib/format";
import { CoinAvatar, UserAvatar } from "../CoinAvatar";
import { Flash } from "../Flash";
import { DemoTag } from "../Demo";
import { ICopy, IExternal } from "../icons";
import { Chart } from "./Chart";
import { MarketActivity, PoolMarkets, useMarketDetails } from "./MarketDetails";
import {recentWalletActivity} from "@/lib/dex-analytics";
import { RangeBar } from "./RangeBar";
import { Odometer } from "../Odometer";
import dynamic from "next/dynamic";
// Trade panel is client-only (rendered after the wide/narrow media check), so split it off the LCP-critical route chunk.
const TradePanel = dynamic(() => import("./TradePanel").then((m) => m.TradePanel), { ssr: false });

const TABS = ["Trades", "Active wallets", "Holders", "Top traders", "Pools", "My positions", "About"] as const;

export function CoinView({ initial, trades, holders, source, tapeSource, tapeOff = false }: { initial: TCoin; trades: TTrade[]; holders: THolder[]; source: "api" | "mock"; tapeSource: TTape["source"]; tapeOff?: boolean }) {
  const api = useMemo(() => getApi(), []);
  const { coin: c } = useLiveCoin(initial, api);
  const tape = useTradeTape(c.mint, trades, 60, api);
  const marketDetails=useMarketDetails(c.mint);
  const activeWallets=useMemo(()=>recentWalletActivity(tape),[tape]);
  const [streamState,setStreamState]=useState('connecting');
  useEffect(()=>subscribeMarket(c.mint,{status:s=>setStreamState(s.state)}),[c.mint]);
  const tapeLabel = streamState==='connected'?'Helius live':streamState==='connecting'?'Connecting':streamState==='reconnecting'?'Reconnecting':'Snapshots';
  const [holderRows,setHolderRows]=useState(holders);
  const [traders,setTraders]=useState<PaperTrader[]>([]);
  const [detailError,setDetailError]=useState('');
  const [detailBusy,setDetailBusy]=useState(false),[detailRetry,setDetailRetry]=useState(0);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Trades");
  useEffect(()=>{if(tab!=='Holders'&&tab!=='Top traders')return;let active=true,busy=false;
    const load=async()=>{if(busy||document.hidden)return;busy=true;setDetailBusy(true);setDetailError('');try{if(tab==='Holders'){const rows=await api.holders(c.mint);if(active)setHolderRows(rows);}else{const rows=await api.topTraders!(c.mint);if(active)setTraders(rows);}if(active)setDetailError('');}catch(e:any){if(active)setDetailError(e.message);}finally{busy=false;if(active)setDetailBusy(false);}};
    void load();const id=setInterval(load,30000);return()=>{active=false;clearInterval(id);};},[tab,c.mint,api,detailRetry]);
  const [copied, setCopied] = useState(false);
  const p = usePaper();
  const [wide, setWide] = useState<boolean | null>(null);
  const [sheet, setSheet] = useState<"buy" | "sell" | null>(null);
  useEffect(() => { const m = matchMedia("(min-width: 1024px)"); const f = () => setWide(m.matches); f(); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  const supply = c.mcapUsd / c.priceUsd;
  const buys = tape.filter((t) => t.side === "buy").reduce((a, t) => a + t.sol, 0);
  const sells = tape.filter((t) => t.side === "sell").reduce((a, t) => a + t.sol, 0);
  const pos = p.positions.find((x) => x.mint === c.mint);
  const myFills = p.fills.filter((f) => f.mint === c.mint);
  const isDemo = false;
  const copy = async () => { try { await navigator.clipboard.writeText(c.mint); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ } };

  return (
    <div className="grid gap-3 p-3 pb-20 lg:pb-3 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[230px_minmax(0,1fr)_340px]">
      {/* Live trades column */}
      <aside aria-label="Live trades" className="panel hidden min-h-0 flex-col overflow-hidden xl:flex xl:h-[calc(100dvh-125px)]">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2.5"><span className="pulse-dot size-1.5 rounded-full bg-accent" aria-hidden="true" /><h2 className="text-[13px] font-semibold">Live trades</h2><span className="ml-auto rounded border border-line-2 px-1.5 py-px font-mono text-[11px] uppercase tracking-wide text-muted" title="Tape source">{tapeLabel}</span></header>
        {tapeOff ? <TapeOff /> : tape.length === 0 && ( <p className="p-3 text-[12px] text-muted">{tapeSource === "none" ? "No public tape for this coin yet." : "Waiting for trades…"}</p>)}
        <ol tabIndex={0} aria-label="Recent trades" className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {tape.map((t) => (
            <li key={t.id} className={`row-in flex items-center gap-2 border-b border-line/60 px-3 py-2 text-[12px] ${t.side === "buy" ? "[--fl:var(--color-up)]" : "[--fl:var(--color-down)]"}`} data-motion="tape-row">
              <UserAvatar handle={t.trader} size={22} />
              <span className="min-w-0 flex-1"><span className="num block truncate text-soft">{short(t.trader)}</span><span className={t.side === "buy" ? "text-up" : "text-down"}>{t.side === "buy" ? "bought" : "sold"}</span> <span className="text-muted"><Ago ts={t.ts} /></span></span>
              <span className={`num ${t.side === "buy" ? "text-up" : "text-down"}`}>{t.side === "buy" ? "+" : "−"}{sol(t.sol, 2)}</span>
            </li>
          ))}
        </ol>
      </aside>

      {/* Center */}
      <div className="flex min-w-0 flex-col gap-3">
        <header className="panel p-3" data-motion="coin-header">
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <div className="flex min-w-0 items-center gap-3">
              <CoinAvatar mint={c.mint} imageUrl={c.imageUrl} size={52} label={`${c.name} icon`} />
              <div className="min-w-0">
                <div className="flex items-center gap-2"><h1 className="text-[22px] font-semibold tracking-[-0.02em]">${c.symbol}</h1>{isDemo && <DemoTag />}</div>
                <p className="truncate text-[13px] text-muted">{c.name} · {age(c.ageSec)} old</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <button onClick={copy} className="chip num flex items-center gap-1.5 py-1"><span className="sr-only">Copy contract address </span>CA {short(c.mint, 4, 4)}<ICopy className="size-3.5" />{copied && <span className="text-accent">copied</span>}</button>
                  {!isDemo && c.socials?.twitter && <a className="chip py-1" href={c.socials.twitter} target="_blank" rel="noreferrer">X</a>}
                  {!isDemo && c.socials?.telegram && <a className="chip py-1" href={c.socials.telegram} target="_blank" rel="noreferrer">Telegram</a>}
                  {!isDemo && c.socials?.website && <a className="chip py-1" href={c.socials.website} target="_blank" rel="noreferrer">Website</a>}
                  {(isDemo || !(c.socials?.twitter || c.socials?.telegram || c.socials?.website)) && <span className="chip py-1 text-muted">No socials listed</span>}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:ml-auto">
              <div className="text-right">
                <Flash value={c.priceUsd} className="num block px-1 text-[26px] font-semibold leading-tight tracking-[-0.02em]"><Odometer text={price(c.priceUsd)} /></Flash>
                <p className="num text-[13px]"><span className={c.change24hPct >= 0 ? "text-up" : "text-down"}>{pct(c.change24hPct)}</span> <span className="text-muted">24h · {solPrice(c.priceSol)}</span></p>
              </div>
              <RangeBar api={api} mint={c.mint} live={c.priceUsd} />
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted"><span className={`status-light ${streamState==='connected'?'':'offline'}`}/>{streamState==='connected'?'Helius · confirmed trade events':streamState==='connecting'?'Connecting to on-chain feed…':streamState==='reconnecting'?'Reconnecting · market snapshots remain active':'Market snapshots · live connection paused'}<span className="ml-auto">Paper execution</span></div>
          <dl className="num mt-3 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-3 sm:grid-cols-4">
            <Stat k={c.marketCapEstimated?"FDV (cap unavailable)":"Market cap"}><Flash value={c.mcapUsd} className="px-0.5"><Odometer text={usd(c.mcapUsd)} /></Flash></Stat>
            <Stat k="24h volume">{usd(c.vol24hUsd)}</Stat>
            <Stat k="Liquidity">{usd(c.liquidityUsd)}</Stat>
            <Stat k="Holders">{Number.isFinite(c.holders) ? c.holders.toLocaleString("en-US") : "—"}</Stat>
          </dl>
        </header>

        {wide===false&&<MarketActivity {...marketDetails}/> }
        <section aria-label="Chart" className="panel h-[440px] overflow-hidden lg:h-[520px]"><Chart api={api} mint={c.mint} livePrice={c.priceUsd} observedAt={c.observedAt} supply={supply} /></section>

        {wide === false && (
          <>
            <div className="fixed inset-x-0 bottom-14 z-30 grid grid-cols-2 gap-2 border-t border-line bg-bg/90 p-2 backdrop-blur" data-motion="trade-dock">
              <button onClick={() => setSheet("buy")} className="btn btn-accent h-11 text-[15px]">Buy ${c.symbol}</button>
              <button onClick={() => setSheet("sell")} className="btn h-11 bg-sell text-[15px] text-white">Sell</button>
            </div>
            {sheet && (
              <div className="fixed inset-0 z-[65] flex items-end bg-black/60 backdrop-blur-sm" onMouseDown={() => setSheet(null)}>
                <div role="dialog" aria-modal="true" aria-label={`Paper trade $${c.symbol}`} className="sheet-in scroll-thin max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border-t border-line-2 bg-panel p-2 pb-[max(env(safe-area-inset-bottom),8px)]" onMouseDown={(e) => e.stopPropagation()}>
                  <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-line-2" aria-hidden="true" />
                  <TradePanel coin={c} api={api} initialSide={sheet} />
                  <button onClick={() => setSheet(null)} className="btn btn-ghost mt-2 h-10 w-full text-[14px]">Close</button>
                </div>
              </div>
            )}
          </>
        )}

        <section className="panel overflow-hidden">
          <div role="tablist" aria-label="Coin details" className="flex gap-1 overflow-x-auto border-b border-line px-2">
            {TABS.map((t) => <button key={t} role="tab" id={`tab-${t}`} aria-controls="coin-tabpanel" aria-selected={tab === t} onClick={() => setTab(t)} className={`relative shrink-0 px-3 py-2.5 text-[13px] transition-colors ${tab === t ? "text-text" : "text-muted hover:text-text"}`}>{t}{t === "My positions" && pos ? <span className="ml-1.5 rounded bg-accent/15 px-1 text-[11px] text-accent">1</span> : null}{tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-accent" data-motion="tab-pill" />}</button>)}
          </div>
          <div id="coin-tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={0} className="scroll-thin max-h-[440px] overflow-auto">
            {tab === "Pools" && <PoolMarkets {...marketDetails}/>}
            {tab === "Active wallets" && <>
              <p className="px-3 py-2 text-[12px] text-muted">Wallets in the latest {tape.length} displayed trades · sorted by traded SOL. This is a recent sample, not profit ranking.</p>
              <table className="num w-full text-[12px]"><thead className="text-left text-muted"><tr><th className="px-3 py-2 font-normal">Wallet</th><th className="text-right font-normal">Bought SOL</th><th className="text-right font-normal">Sold SOL</th><th className="px-3 text-right font-normal">Buys / Sells</th></tr></thead><tbody>{!activeWallets.length&&<tr><td colSpan={4} className="p-5 text-muted">Waiting for verified wallet addresses in the trade feed.</td></tr>}{activeWallets.map(w=><tr key={w.wallet} className="row border-t border-line/60"><td className="px-3 py-2"><a className="text-soft hover:text-accent" href={`https://solscan.io/account/${w.wallet}`} target="_blank" rel="noreferrer">{short(w.wallet)}</a></td><td className="text-right text-up">{sol(w.boughtSol,3)}</td><td className="text-right text-down">{sol(w.soldSol,3)}</td><td className="px-3 text-right">{w.buys} / {w.sells}</td></tr>)}</tbody></table>
            </>}
            {tab === "Holders" && (
              <table className="num w-full text-[12px]"><caption className="px-3 py-2 text-left text-[11px] text-muted">{holderRows.some(h=>h.label?.startsWith('RPC'))?'Largest 20 token accounts grouped by owner · Solana RPC · partial distribution':holderRows.length?'Holder distribution · GMGN':'Holder distribution · on-chain accounts'}</caption><thead className="sticky top-0 bg-panel text-left text-muted"><tr><th className="px-3 py-2 font-normal">#</th><th className="font-normal">Account</th><th className="text-right font-normal">Amount</th><th className="px-3 text-right font-normal">Share</th></tr></thead>
                <tbody>{!holderRows.length&&<tr><td colSpan={4} className="p-6 text-muted">{detailBusy?'Loading verified holders…':detailError||'No verified holder distribution is available for this token yet.'} <button className="text-accent underline mr-2" onClick={()=>setDetailRetry(x=>x+1)} disabled={detailBusy}>Retry</button><a href={`https://solscan.io/token/${c.mint}#holders`} target="_blank" rel="noreferrer" className="text-accent">View on Solscan</a></td></tr>}{holderRows.map((h, i) => (
                  <tr key={h.owner} className="row border-t border-line/60"><td className="px-3 py-2 text-muted">{i + 1}</td><td className="text-soft"><a href={`https://solscan.io/account/${h.owner}`} target="_blank" rel="noreferrer" className="hover:text-accent">{short(h.owner)}</a>{h.label && <span className="ml-2 rounded bg-panel-3 px-1 text-[11px] text-muted">{h.label}</span>}</td><td className="text-right text-soft">{compact(h.tokens)}</td>
                    <td className="px-3 text-right"><span className="inline-flex items-center gap-2"><span className="bar hidden w-16 sm:block"><i style={{ width: `${Math.min(100, h.pct * 3)}%` }} /></span>{h.pct.toFixed(2)}%</span></td></tr>
                ))}</tbody></table>
            )}
            {tab === "Top traders" && <>
              <p className="px-3 py-2 text-[12px] text-muted">Paperhands traders · this token · today (UTC) · ranked by realized paper PnL. Verified wallet accounts only; practice sessions are excluded.</p>
              <table className="num w-full text-[12px]"><thead className="sticky top-0 bg-panel text-left text-muted"><tr><th className="px-3 py-2 font-normal">Trader</th><th className="text-right font-normal">Realized PnL</th><th className="text-right font-normal">Volume</th><th className="px-3 text-right font-normal">Buys / Sells</th></tr></thead><tbody>
              {!traders.length&&<tr><td colSpan={4} className="p-6 text-muted">{detailBusy?'Loading Paperhands traders…':detailError?'Paper rankings are temporarily unavailable.':'No Paperhands traders for this token yet. Rankings appear after verified users paper trade.'}</td></tr>}
              {traders.map(t=><tr key={t.wallet} className="row border-t border-line/60"><td className="px-3 py-2 text-soft">{short(t.wallet)}</td><td className={`text-right ${t.realizedSol>=0?'text-up':'text-down'}`}>{sol(t.realizedSol,4)}</td><td className="text-right">{sol(t.volumeSol,3)}</td><td className="px-3 text-right"><span className="text-up">{t.buys}</span> / <span className="text-down">{t.sells}</span></td></tr>)}
              </tbody></table>
            </>}
            {tab === "Trades" && (tapeOff || !tape.length) && <TapeOff />}
            {tab === "Trades" && !tapeOff && tape.length > 0 && (
              <table className="num w-full text-[12px]"><thead className="sticky top-0 bg-panel text-left text-muted"><tr><th className="px-3 py-2 font-normal">Account</th><th className="font-normal">Type</th><th className="text-right font-normal">SOL</th><th className="hidden text-right font-normal sm:table-cell">Tokens</th><th className="px-3 text-right font-normal">Time</th></tr></thead>
                <tbody>{tape.map((t) => (
                  <tr key={t.id} className="row border-t border-line/60"><td className="px-3 py-2 text-soft">{/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t.trader)?<a href={`https://solscan.io/account/${t.trader}`} target="_blank" rel="noreferrer" className="hover:text-accent">{short(t.trader)}</a>:short(t.trader)}</td><td className={t.side === "buy" ? "text-up" : "text-down"}>{t.side === "buy" ? "Buy" : "Sell"}</td><td className="text-right">{sol(t.sol, 3)}</td><td className="hidden text-right text-soft sm:table-cell">{compact(t.tokens)}</td><td className="px-3 text-right text-muted"><Ago ts={t.ts} /></td></tr>
                ))}</tbody></table>
            )}
            {tab === "My positions" && (
              <div className="p-3 text-[13px]">
                {pos ? (
                  <dl className="num grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat k="Holding">{compact(pos.tokens)} ${c.symbol}</Stat>
                    <Stat k="Cost">{sol(pos.costSol, 3)}</Stat>
                    <Stat k="Value">{sol(pos.tokens * c.priceSol, 3)}</Stat>
                    <Stat k="Unrealized"><span className={pos.tokens * c.priceSol - pos.costSol >= 0 ? "text-up" : "text-down"}>{sol(pos.tokens * c.priceSol - pos.costSol, 3)}</span></Stat>
                  </dl>
                ) : <p className="text-muted">No open paper position in ${c.symbol}. Use the panel to paper buy.</p>}
                {myFills.length > 0 && (
                  <ul className="num mt-4 divide-y divide-line/60 text-[12px]">{myFills.map((f) => <li key={f.id} className="flex justify-between py-2"><span className={f.side === "buy" ? "text-up" : "text-down"}>{f.side === "buy" ? "Paper buy" : "Paper sell"}</span><span className="text-soft">{sol(f.sol, 3)}</span><span className="text-muted"><Ago ts={f.ts} /></span></li>)}</ul>
                )}
              </div>
            )}
            {tab === "About" && (
              <div className="space-y-3 p-3 text-[13px]">
                <p className="text-soft">{c.description || "No description in the coin metadata."}</p>
                <dl className="num grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat k="Venue">{c.venue === "bonding" ? "Pump bonding curve" : c.venue === "graduated" ? "Graduated (DEX)" : "Unknown"}</Stat>
                  <Stat k="Status">{c.status}</Stat>
                  <Stat k="Mint"><span className="break-all text-[12px]">{c.mint}</span></Stat>
                </dl>
                {isDemo ? <p className="text-[12px] text-muted">Demo coin: no explorer links, this mint is not on-chain.</p> : (
                  <div className="flex flex-wrap gap-2">
                    <a className="btn btn-ghost h-8 px-3 text-[12px]" href={`https://solscan.io/token/${c.mint}`} target="_blank" rel="noreferrer">Solscan <IExternal className="size-3.5" /></a>
                    <a className="btn btn-ghost h-8 px-3 text-[12px]" href={`https://dexscreener.com/solana/${c.mint}`} target="_blank" rel="noreferrer">Dexscreener <IExternal className="size-3.5" /></a>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Right rail */}
      <div className="hidden flex-col gap-3 lg:flex">
        {wide && <TradePanel coin={c} api={api} />}
        <MarketActivity {...marketDetails}/>
        <section aria-label="Flow and curve" className="panel space-y-4 p-3 text-[12px]">
          {tapeOff ? <div className="panel p-3 text-[13px]"><p className="text-muted">Tape flow</p><TapeOff compact /></div> : <FlowCard buys={buys} sells={sells} n={tape.length} nb={tape.filter((t) => t.side === "buy").length} />}
          <div>
            <div className="flex justify-between"><span className="text-muted">Bonding curve</span><span className="num text-soft">{c.curvePct.toFixed(1)}%</span></div>
            <div className="bar mt-2 h-1.5" role="progressbar" aria-label="Bonding curve progress" aria-valuenow={Math.round(c.curvePct)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${c.curvePct}%` }} /></div>
            <p className="mt-1.5 text-muted">{c.venue === "graduated" ? "Paper fills model pool liquidity, impact and a 0.3% fee." : "The liquidity model estimates paper fills from observed pool data."}</p>
          </div>
          <Link href="/portfolio" className="block text-accent hover:underline">Open portfolio →</Link>
        </section>
      </div>
    </div>
  );
}
function Stat({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-[11px] uppercase tracking-wide text-muted">{k}</dt><dd className="mt-0.5 truncate text-[14px] text-text">{children}</dd></div>;
}
function Ago({ ts }: { ts: number }) {
  const now = useNow(5000); // null during SSR: no hydration mismatch
  return <>{now ? `${age(Math.max(0, (now - ts) / 1000))} ago` : ""}</>;
}

function FlowCard({ buys, sells, n, nb }: { buys: number; sells: number; n: number; nb: number }) {
  if (!n) return <div className="panel p-3 text-[13px]"><p className="text-muted">Tape flow</p><TapeOff compact /></div>;
  const tot = buys + sells || 1;
  const bp = (buys / tot) * 100;
  return (
    <div data-motion="flow">
      <div className="flex justify-between"><span className="text-muted">Tape flow · last {n} prints</span><span className="num"><span className="text-up">{sol(buys, 1)}</span> / <span className="text-down">{sol(sells, 1)}</span></span></div>
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-down/70" role="meter" aria-label="Buy share of tape volume" aria-valuenow={Math.round(bp)} aria-valuemin={0} aria-valuemax={100}>
        <span className="absolute inset-y-0 left-0 rounded-full bg-up transition-[width] duration-700 ease-[var(--ease-house)]" style={{ width: `${bp}%` }} />
        <span className="absolute inset-y-0 w-0.5 bg-bg transition-[left] duration-700 ease-[var(--ease-house)]" style={{ left: `calc(${bp}% - 1px)` }} />
      </div>
      <div className="num mt-1.5 flex justify-between text-[11px]"><span className="text-up">{bp.toFixed(0)}% buys · {nb}</span><span className="text-down">{n - nb} · {(100 - bp).toFixed(0)}% sells</span></div>
    </div>
  );
}

/** Visible disabled state when the backend has a live tape switched off (health.features.marketTrade or heliusTape = "disabled"). */
function TapeOff({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "mt-2" : "grid place-items-center px-4 py-10 text-center"} data-motion="tape-off">
      {!compact && <span className="mb-3 grid size-9 place-items-center rounded-full border border-line-2"><span className="size-1.5 rounded-full bg-muted" /></span>}
      <p className="text-[13px] font-medium text-soft">No recent trades available</p>
      <p className="mt-1 max-w-[230px] text-[12px] text-muted">The data provider has not returned a public trade tape. No simulated prints are shown.</p>
    </div>
  );
}
