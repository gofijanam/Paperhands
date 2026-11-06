import Link from "@/components/SiteLink";
export const metadata = { title: "Not found" };
export default function NotFound() {
  return (
    <section className="mx-auto flex max-w-lg flex-col items-center px-4 py-24 text-center">
      <p className="num text-[64px] font-semibold leading-none tracking-[-0.05em] text-accent">404</p>
      <h1 className="mt-4 text-[22px] font-semibold tracking-tight">Nothing trades at this address</h1>
      <p className="mt-2 text-[14px] text-muted">The page or mint you asked for isn’t in the index. Check the link, or search with ⌘K.</p>
      <div className="mt-6 flex gap-2"><Link href="/" className="btn btn-accent h-10 px-4 text-[14px]">Back to the feed</Link><Link href="/leaderboard" className="btn btn-ghost h-10 px-4 text-[14px]">Leaderboard</Link></div>
    </section>
  );
}
