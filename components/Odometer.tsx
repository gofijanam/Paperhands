/** Rolling-digit counter. In-flow text is the real value (screen readers, copy); digits roll on an aria-hidden overlay.
 * Static under reduced motion (the strip transition is disabled in CSS). Hook: data-motion="odometer". */
export function Odometer({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span data-motion="odometer" className={`odo relative inline-block whitespace-nowrap ${className}`}>
      <span className="text-transparent select-text">{text}</span>
      <span aria-hidden="true" className="absolute inset-0 flex">
        {text.split("").map((ch, i) => /\d/.test(ch) ? (
          <span key={`${text.length - i}`} className="odo-col relative inline-block h-[1.2em] overflow-hidden leading-[1.2em]" style={{ width: "1ch" }}>
            <span className="odo-strip absolute left-0 top-0 flex flex-col" style={{ transform: `translateY(-${Number(ch) * 1.2}em)` }}>
              {"0123456789".split("").map((d) => <span key={d} className="h-[1.2em]">{d}</span>)}
            </span>
          </span>
        ) : <span key={`${text.length - i}`} className="leading-[1.2em]">{ch}</span>)}
      </span>
    </span>
  );
}
