import { UNRANKED_LABEL } from "@/lib/constants";
/** Shown when NEXT_PUBLIC_PAPERHANDS_RANKED != 1. */
export function UnrankedNote({ children }: { children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#ffc457]/35 bg-[#ffc457]/[.06] px-3 py-2.5 text-[13px]" role="note" data-motion="unranked">
      <p className="font-medium text-[#ffc457]">{UNRANKED_LABEL}</p>
      <p className="mt-0.5 text-[12px] text-soft">{children ?? "This is a paper-trading preview. Standings are for fun: no prize pool, no payouts, no rewards are paid."}</p>
    </div>
  );
}
