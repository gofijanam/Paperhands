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

## Portfolio and data resilience

Portfolio amounts show SOL plus the current USD equivalent, with an interactive baseline chart, time windows, crosshair inspection and a data table. Historical USD equivalents use the current SOL/USD rate, not a claimed historical FX series. Real account observations are persisted at most once per minute when all position marks are fresh. Missing position prices never become zero valuations.

Search, open positions and trade history use token metadata images. Native token charts retain prior data during temporary provider failures; switching to the external DEX chart is explicit. If full history is unavailable, candles can be aggregated from verified observed trades and are labeled limited history. Empty buckets are never fabricated. Helius Enhanced swap history supplies a bounded fallback for other DEX pools, with per-token caching; full realtime coverage and complete holder indexing remain provider-dependent.

Token Top traders accepts the existing bearer session to include the viewer's own practice fills (shown as You). Other anonymous practice accounts remain private; public wallet ranks and reward eligibility are unchanged. Refreshing the selected token ranking after an account fill avoids waiting for the polling interval. Sell tickets accept a token amount as well as 25/50/100% shortcuts; the server quote remains authoritative.
