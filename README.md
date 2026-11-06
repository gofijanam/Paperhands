# Paperhands

A Solana paper-trading terminal: real market data, virtual SOL and simulated fills. This repository includes the current application and the original supplied backend in `original/` for reference.

## Run

Node 24+, pnpm 11.25.0. `pnpm install --frozen-lockfile`, `pnpm build`, then `pnpm start`. Copy `.env.example` to `.env.local` for development; never commit credentials.

## Railway

The root Dockerfile builds Next.js and serves the complete app on `$PORT`. Attach one persistent volume at `/data`; set `DATABASE_PATH=/data/paperhands.sqlite`. Run **one replica**: SQLite uses WAL and atomic transactions. Horizontal scaling requires migrating the ledger to a shared database first. SQL migrations run once at startup. Railway health check: `/api/paper/health`.

Required server variables: `SOLANA_RPC_URL`, `SOLANA_WS_URL`. Optional `GMGN_API_KEY`; direct GMGN access remains paused with `GMGN_DIRECT_PAUSED=1` until provider access is confirmed. Never use NEXT_PUBLIC variables for secrets.

## Data and rankings

- DEX Screener: pool statistics, prices, volume, liquidity and pair discovery.
- Helius: confirmed Pump/PumpSwap events, shared per mint among viewers; recent trades are buffered. Other pools use REST trade snapshots.
- Holders fallback: the largest 20 token accounts resolved and grouped by their owners. This is a **partial distribution**, not a complete holder index or a holder count.
- Token-page Top traders: verified Paperhands wallet accounts in the current UTC day, ranked by realized paper PnL on that token. Anonymous practice is excluded. No external trader rankings or seeded winners.
- Competition/token gating and real reward distribution are not launched. Set the final PAPER mint and review settlement/funding before activating ranked competition.

## Checks

`pnpm test`; `node --test services/market-gateway/gateway.test.mjs`; `pnpm exec tsc --noEmit`; `pnpm build`.

Account records and API keys are stored privately in Railway runtime storage/variables, not in GitHub. A one-time import of the old preview's practice ledger is supported through `PAPER_MIGRATION_BASE64`; it is accepted only into empty tables and recorded as a migration.
