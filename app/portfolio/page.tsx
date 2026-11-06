"use client";
import Link from "@/components/SiteLink";
import { useEffect, useState } from "react";
import { getApi, type TCoin } from "@/lib/api";

import { useLiveCoins } from "@/lib/live";
import { usePaper } from "@/lib/store";
import { compact, pct, sol } from "@/lib/format";
import { CoinAvatar } from "@/components/CoinAvatar";
import { EquityChart } from "@/components/EquityChart";
import { GateScreen } from "@/components/GateScreen";
import { MarkBadge } from "@/components/MarkBadge";
import { DemoTag } from "@/components/Demo";

function usePositionCoins(mints: string[]) {
  const [coins, setCoins] = useState<TCoin[]>([]);
  const key = mints.join(",");
  useEffect(() => {
    let on = true;

    Promise.all(key.split(",").filter(Boolean).map(async (m) => (await getApi().coin(m).catch(() => null)))).then((cs) => on && setCoins(cs.filter((x): x is TCoin => !!x)));
    return () => { on = false; };
  }, [key]);
  return useLiveCoins(coins).coins;
}

export default function PortfolioPage() {
  const p = usePaper();
  const coins = usePositionCoins(p.positions.map((x) => x.mint));
  if (!p.ready) return <div className="p-4"><div className="panel h-[60vh] animate-pulse" aria-busy="true" /></div>;
  if (!p.passes) return <div className="px-3 py-8 md:py-14"><GateScreen compact /></div>;
  const by = new Map(coins.map((c) => [c.mint, c]));
  const rows = p.positions.map((x) => { const c = by.get(x.mint); const value = x.markStatus && x.markStatus !== "fresh" ? 0 : c && x.valueSol == null ? x.tokens * c.priceSol : x.valueSol ?? x.costSol; return { ...x, c, value, pnl: value - x.costSol }; });
  const open = rows.reduce((a, r) => a + r.value, 0);
  const equity = p.balance + open;
  const pnl = equity - p.bankroll;
  const realized = p.fills.reduce((a, f) => a + (f.pnlSol ?? 0), 0);
  const curve = [{ t: p.fills.at(-1)?.ts ?? Date.now() - 60_000, v: p.bankroll }, ...p.equity, { t: Date.now(), v: equity }];
  return (
    <div className="mx-auto max-w-[1280px] space-y-4 p-3 md:p-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-[26px] font-semibold tracking-[-0.03em]">Portfolio</h1><p className="text-[13px] text-muted">This cycle’s paper account · {p.source === "live" ? "saved on the server" : "saved on the server"}</p></div>
        <DemoTag />
      </header>
      <section aria-label="Account" className="panel grid grid-cols-2 gap-px overflow-hidden bg-line md:grid-cols-4">
        {[
          ["Equity", sol(equity, 3), ""],
          ["Cash", sol(p.balance, 3), ""],
          ["Cycle PnL", `${sol(pnl, 3)} · ${pct((pnl / p.bankroll) * 100)}`, pnl >= 0 ? "text-up" : "text-down"],
          ["Realized", sol(realized, 3), realized >= 0 ? "text-up" : "text-down"],
        ].map(([k, v, cls]) => <div key={k} className="bg-panel p-3"><p className="text-[11px] uppercase tracking-wide text-muted">{k}</p><p className={`num mt-1 text-[17px] font-semibold ${cls}`}>{v}</p></div>)}
      </section>
      <section aria-label="Equity curve" className="panel p-3">
        <div className="flex items-center justify-between"><h2 className="text-[14px] font-semibold">Equity</h2><span className="num text-[12px] text-muted">start {sol(p.bankroll, 0)}</span></div>
        <div className="relative mt-2 h-[220px]">{curve.length > 2 ? <EquityChart points={curve} base={p.bankroll} /> : <p className="grid h-full place-items-center text-[13px] text-muted">Your equity curve starts with your first paper trade.</p>}</div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Open positions" className="panel overflow-hidden">
          <h2 className="border-b border-line px-3 py-2.5 text-[14px] font-semibold">Open positions <span className="num text-muted">{rows.length}</span></h2>
          {rows.length === 0 ? <p className="p-4 text-[13px] text-muted">No open positions. <Link href="/" className="text-accent hover:underline">Find a coin</Link> and paper buy.</p> : (
            <ul>{rows.map((r) => (
              <li key={r.mint} className="row border-t border-line/60 first:border-0"><Link href={`/coin/${r.mint}`} className="flex items-center gap-3 px-3 py-2.5">
                <CoinAvatar mint={r.mint} size={32} />
                <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 text-[14px] font-semibold">${r.symbol}<MarkBadge status={r.markStatus} asOf={r.markAsOf} /></span><span className="num block text-[12px] text-muted">{compact(r.tokens)} · cost {sol(r.costSol, 3)}</span></span>
                <span className="num text-right text-[13px]"><span className="block text-soft">{sol(r.value, 3)}</span><span className={r.pnl >= 0 ? "text-up" : "text-down"}>{pct((r.pnl / r.costSol) * 100)}</span></span>
              </Link></li>
            ))}</ul>
          )}
        </section>
        <section aria-label="Trade history" className="panel overflow-hidden">
          <h2 className="border-b border-line px-3 py-2.5 text-[14px] font-semibold">Trade history <span className="num text-muted">{p.fills.length}</span></h2>
          {p.fills.length === 0 ? <p className="p-4 text-[13px] text-muted">No paper fills yet this cycle.</p> : (
            <div className="scroll-thin max-h-[420px] overflow-auto" tabIndex={0} role="region" aria-label="Fills">
              <table className="num w-full text-[12px]"><thead className="sticky top-0 bg-panel text-left text-muted"><tr><th className="px-3 py-2 font-normal">Coin</th><th className="font-normal">Side</th><th className="text-right font-normal">SOL</th><th className="text-right font-normal">PnL</th><th className="px-3 text-right font-normal">Fee</th></tr></thead>
                <tbody>{p.fills.map((f) => (
                  <tr key={f.id} className="row border-t border-line/60"><td className="px-3 py-2"><Link href={`/coin/${f.mint}`} className="text-soft hover:text-accent">${f.symbol}</Link></td><td className={f.side === "buy" ? "text-up" : "text-down"}>{f.side}</td><td className="text-right">{sol(f.sol, 3)}</td><td className={`text-right ${(f.pnlSol ?? 0) >= 0 ? "text-up" : "text-down"}`}>{f.pnlSol == null ? "—" : sol(f.pnlSol, 3)}</td><td className="px-3 text-right text-muted">{sol(f.feeSol, 4)}</td></tr>
                ))}</tbody></table>
            </div>
          )}
        </section>
      </div>
      {p.practice && <button onClick={p.reset} className="btn btn-ghost h-9 px-3 text-[13px]">Reset practice account</button>}
    </div>
  );
}
