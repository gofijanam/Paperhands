"use client";
import { getApi } from "@/lib/api";
import { useAsync } from "@/lib/live";
import { usePaper } from "@/lib/store";
import { pct, short, sol } from "@/lib/format";
import { PAYOUT_CURVE, RANKED, RESERVE_PCT, UNRANKED_LABEL } from "@/lib/constants";
import { UnrankedNote } from "@/components/UnrankedNote";
import { UserAvatar } from "@/components/CoinAvatar";
import { Countdown } from "@/components/Countdown";
import { CycleClock } from "@/components/CycleClock";
import { DemoTag } from "@/components/Demo";

export default function LeaderboardPage() {
  const lb = useAsync(() => getApi().leaderboard(), []);
  const p = usePaper();
  if (!lb) return <div className="p-4"><div className="panel h-[70vh] animate-pulse" aria-busy="true" /></div>;
  const [a, b, c] = lb.rows;
  const pool = lb.cycle.poolSol;
  return (
    <div className="mx-auto grid max-w-[1280px] gap-4 p-3 md:p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div><h1 className="text-[26px] font-semibold tracking-[-0.03em]">Leaderboard</h1><p className="text-[13px] text-muted">Ranked by % PnL on the {sol(lb.cycle.bankrollSol, 0)} paper bankroll. Ties: absolute PnL, then volume, then first trade.</p></div>
          {lb.mock && <DemoTag />}
        </header>
        {!RANKED && <UnrankedNote />}

        <section aria-label="Cycle" className="panel grid grid-cols-2 gap-px overflow-hidden bg-line sm:grid-cols-4">
          {[
            [lb.cycle.status === "settling" ? "Cycle" : "Cycle ends in", lb.cycle.status === "settling" ? <CycleClock key="c" cycle={lb.cycle} /> : <Countdown key="c" to={lb.cycle.endsAt} />],
            [RANKED ? "Prize pool" : "Prizes", !RANKED ? <span key="p" className="text-[14px] text-[#ffc457]">{UNRANKED_LABEL}</span> : pool == null ? <span key="p" className="text-soft">Set at cycle close</span> : <span key="p" className="text-accent">{sol(pool, 1)}</span>],
            ["Entrants", lb.cycle.rankedCount.toLocaleString("en-US")],
            ["Status", <span key="s" className="capitalize">{lb.cycle.status}</span>],
          ].map(([k, v]) => <div key={k as string} className="bg-panel p-3"><p className="text-[11px] uppercase tracking-wide text-muted">{k}</p><p className="num mt-1 text-[18px] font-semibold">{v}</p></div>)}
        </section>

        {a && (
          <section aria-label="Top three" className="grid grid-cols-3 items-end gap-2 sm:gap-3" data-motion="podium">
            {[b, a, c].map((t, i) => !t ? (
              <div key={`open-${i}`} className="panel flex flex-col items-center justify-center px-2 py-6 text-center"><span className="num text-[28px] font-semibold text-line-2 sm:text-[40px]">{i === 0 ? 2 : 3}</span><span className="mt-2 text-[12px] text-muted">Open seat</span></div>
            ) : (
              <div key={t.wallet} className={`panel relative flex flex-col items-center overflow-hidden px-2 pb-3 text-center ${i === 1 ? "pt-6 sm:pt-8" : "pt-4"}`} style={i === 1 ? { boxShadow: "0 0 0 1px color-mix(in oklab, var(--color-accent) 35%, transparent), 0 20px 60px -30px color-mix(in oklab, var(--color-accent) 60%, transparent)" } : undefined}>
                <span className={`num text-[28px] font-semibold leading-none sm:text-[40px] ${i === 1 ? "text-accent" : "text-soft"}`}>{t.rank}</span>
                <span className="mt-3"><UserAvatar handle={t.handle} size={i === 1 ? 48 : 38} /></span>
                <span className="mt-2 w-full truncate text-[13px] font-medium sm:text-[14px]">{t.handle}</span>
                <span className={`num text-[14px] sm:text-[16px] ${t.pnlPct >= 0 ? "text-up" : "text-down"}`}>{pct(t.pnlPct)}</span>
                <span className="num text-[12px] text-muted">{sol(t.pnlSol)}</span>
              </div>
            ))}
          </section>
        )}

        <section aria-label="Rankings" className="panel overflow-hidden">
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Rankings table">
            <table className="num w-full min-w-[520px] text-[13px]">
              {lb.rows.length === 0 && <caption className="caption-bottom px-3 py-6 text-[13px] text-muted">No paper traders on the board yet this cycle.</caption>}
              <thead className="text-left text-[12px] text-muted"><tr><th className="px-3 py-2.5 font-normal">#</th><th className="font-normal">Trader</th><th className="text-right font-normal">PnL</th><th className="text-right font-normal">Paper SOL</th><th className="hidden text-right font-normal sm:table-cell">Volume</th><th className="text-right font-normal">Fills</th><th className="px-3 text-right font-normal">Ranked</th></tr></thead>
              <tbody>
                {lb.rows.map((t) => (
                  <tr key={t.wallet} className={`row border-t border-line/60 ${p.wallet === t.wallet ? "bg-accent/5" : ""}`}>
                    <td className={`px-3 py-2.5 ${t.rank <= 3 ? "text-accent" : "text-muted"}`}>{t.rank}</td>
                    <td><span className="flex items-center gap-2"><UserAvatar handle={t.handle} size={24} /><span className="font-sans text-soft">{t.handle}</span><span className="hidden text-[11px] text-muted md:inline">{short(t.wallet)}</span></span></td>
                    <td className={`text-right ${t.pnlPct >= 0 ? "text-up" : "text-down"}`}>{pct(t.pnlPct)}</td>
                    <td className="text-right text-soft">{sol(t.pnlSol)}</td>
                    <td className="hidden text-right text-soft sm:table-cell">{sol(t.volumeSol, 0)}</td>
                    <td className="text-right text-soft">{t.trades}</td>
                    <td className="px-3 text-right">{t.eligible ? <span className="text-up">yes</span> : <span className="text-muted" title={t.ineligibleReason ?? undefined}>no</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <aside className="space-y-4">
        {!RANKED ? <UnrankedNote>Prize pools and payouts are switched off for the preview. Ranking here is paper %PnL only.</UnrankedNote> : <>
        <section className="panel p-4">
          <h2 className="text-[14px] font-semibold">Payout split</h2>
          <p className="mt-1 text-[12px] text-muted">Example curve from the plan; final split is set per cycle. {RESERVE_PCT}% of each pool is held back as reserve.</p>
          <ul className="num mt-3 space-y-2 text-[13px]">
            {PAYOUT_CURVE.map((r) => (
              <li key={r.ranks}><div className="flex justify-between"><span className="text-soft">Rank {r.ranks}</span><span>{r.share}%{"note" in r ? <span className="text-muted"> · split</span> : null}</span></div><div className="bar mt-1"><i style={{ width: `${r.share * 3}%` }} /></div></li>
            ))}
          </ul>
        </section>
        <section className="panel p-4">
          <div className="flex items-center justify-between"><h2 className="text-[14px] font-semibold">Payout history</h2>{lb.payoutsMock && <DemoTag />}</div>
          <p className="mt-1 text-[12px] text-muted">Each cycle the top 25 enter a pending payout queue. Payouts are sent manually after review; tx links appear only once marked paid.</p>
          <ul className="mt-3 divide-y divide-line/70">
            {lb.payouts.map((x) => (
              <li key={String(x.cycleId)} className="py-2.5 text-[12px]">
                <div className="flex justify-between"><span className="text-soft">Cycle {String(x.cycleId)}</span><span className="num text-accent">{sol(x.poolSol, 1)}</span></div>
                <div className="num mt-1 flex flex-wrap gap-x-3 text-muted">{x.winners.map((w) => <span key={w.rank}>#{w.rank} {w.handle} {sol(w.sol, 2)}</span>)}</div>
                <div className="mt-1 text-muted">{x.tx ? <a href={`https://solscan.io/tx/${x.tx}`} target="_blank" rel="noreferrer" className="text-accent">View tx</a> : "Pending · manual review · demo"}</div>
              </li>
            ))}
          </ul>
        </section>
        </>}
      </aside>
    </div>
  );
}
