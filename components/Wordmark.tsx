import Image from "next/image";
import { BRAND, BRAND_HAS_WORDMARK } from "@/lib/brand";

/** Header logo: mascot mark (/public/brand/logo-mark.svg) + the "paperhands" wordmark. Swap the files, not this component. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span data-motion="wordmark" className="inline-flex items-center gap-1.5 font-semibold tracking-[-0.04em] text-accent select-none">
      <Image src={BRAND.mark2x} alt="" width={28} height={28} sizes="28px" priority className="size-7 shrink-0" />
      {!compact && (BRAND_HAS_WORDMARK
        ? <Image src={BRAND.wordmark} alt="paperhands" width={100} height={20} className="h-5 w-auto" />
        : <span className="text-[21px] leading-none">paperhands</span>)}
    </span>
  );
}
