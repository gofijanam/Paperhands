// Minimal 1.5px-stroke icon set (inline, no icon font).
type P = { className?: string };
const S = ({ d, className }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className ?? "size-[18px]"} aria-hidden="true"><path d={d} /></svg>
);
export const IHome = (p: P) => <S {...p} d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />;
export const IChart = (p: P) => <S {...p} d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6" />;
export const IWallet = (p: P) => <S {...p} d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm0 0V6a2 2 0 0 1 2-2h11M16 13.5h2" />;
export const ITrophy = (p: P) => <S {...p} d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4m-4 3h8l-1-3H9z" />;
export const IGift = (p: P) => <S {...p} d="M4 11h16v9H4zM3 7h18v4H3zm9 0v13M12 7S10.5 3 8 4s1 3 4 3zm0 0s1.5-4 4-3-1 3-4 3" />;
export const ILock = (p: P) => <S {...p} d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />;
export const ISearch = (p: P) => <S {...p} d="m20 20-4.2-4.2M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14" />;
export const ICollapse = (p: P) => <S {...p} d="M15 6l-6 6 6 6" />;
export const IExpand = (p: P) => <S {...p} d="M9 6l6 6-6 6" />;
export const ICopy = (p: P) => <S {...p} d="M9 9h10v10H9zM5 15V5h10" />;
export const IExternal = (p: P) => <S {...p} d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />;
export const IClose = (p: P) => <S {...p} d="M6 6l12 12M18 6 6 18" />;
export const IBolt = (p: P) => <S {...p} d="M13 3 5 14h6l-1 7 8-11h-6z" />;
