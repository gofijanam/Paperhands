"use client";
import { RANKED, UNRANKED_LABEL } from "@/lib/constants";
import Link from "@/components/SiteLink";
import { getApi } from "@/lib/api";
import { pct, sol } from "@/lib/format";
import { useAsync } from "@/lib/live";
import { UserAvatar } from "../CoinAvatar";
import { CycleClock } from "../CycleClock";

export function LeaderColumn() {
  const lb = useAsync(() => getApi().leaderboard(), []);
  if (!lb) return <div className="flex-1 space-y-1.5 p-2" aria-busy="true">{Array.from({ length: 10 }, (_, i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-panel-2" />)}</div>;
  return (
    <>
      {lb.rows.length === 0 && <div className="grid flex-1 place-items-center px-4 text-center text-[12px] text-muted"><p><span className="block text-[13px] text-soft">Holder competition</span>Rankings open after token activation. Practice trades stay off the leaderboard.</p></div>}
      <ol hidden={lb.rows.length === 0} tabIndex={0} aria-label="Top traders this cycle" className="scroll-thin min-h-0 flex-1 overflow-y-auto py-1">
        {lb.rows.slice(0, 10).map((t) => (
          <li key={t.wallet} className="px-1.5 py-0.5">
            <div className={`card flex items-center gap-2.5 px-2 py-2 ${t.rank <= 3 ? "card-hot" : ""}`}>
              <span className={`num w-5 text-[13px] font-semibold ${t.rank <= 3 ? "text-accent" : "text-muted"}`}>{t.rank}</span>
              <UserAvatar handle={t.handle} size={30} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5"><span className="truncate text-[13px] font-medium" title={t.demo ? "Demo trader" : undefined}>{t.handle}</span></span>
                <span className="num block truncate text-[12px] text-muted">{t.trades} fills<span className="hidden @[260px]:inline"> · {sol(t.volumeSol, 0)}</span></span>
              </span>
              <span className="num text-right">
                <span className={`block text-[13px] ${t.pnlPct >= 0 ? "text-up" : "text-down"}`}>{pct(t.pnlPct, 1)}</span>
                <Delta d={t.delta} />
              </span>
            </div>
          </li>
        ))}
      </ol>
      <Link href="/leaderboard" className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-line px-3 py-3 transition-colors hover:bg-panel-3">
        {RANKED ? <>
        <span className="text-[12px] text-muted">Prize pool{lb.poolDemo || lb.mock ? " · demo" : ""}</span>
        <span className="num text-[15px] font-semibold text-accent">{lb.cycle.poolSol == null ? "Set at cycle start" : sol(lb.cycle.poolSol, 1)}</span>
        </> : <span className="text-[12px] font-medium text-[#ffc457]">{UNRANKED_LABEL}</span>}
        <span className="text-[12px] text-muted"><CycleClock cycle={lb.cycle} /></span>
      </Link>
    </>
  );
}
function Delta({ d }: { d?: number }) {
  if (d == null) return null;
  if (d === 0) return <span className="block text-[11px] text-muted" aria-label="rank unchanged">—</span>;
  return <span className={`block text-[11px] ${d > 0 ? "text-up" : "text-down"}`} aria-label={`${d > 0 ? "up" : "down"} ${Math.abs(d)} places`}>{d > 0 ? "▲" : "▼"}{Math.abs(d)}</span>;
}
