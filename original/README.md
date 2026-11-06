# Paperhands: local run

Paper-trading for Solana coins: a Next.js web app plus a Node API. Everything runs locally on loopback. **Mock/demo mode is the
default, so no API keys are needed.** Nothing here touches mainnet, signs anything, or moves real funds.

## Requirements
- **Node.js 20 or newer** (with npm). Check with `node -v`.
- Ports **8807** (API) and **4331** (web) free.

## Quick start (two terminals). Start the backend FIRST, then the web.

**1. Backend (API on http://127.0.0.1:8807)**
```bash
cd backend
cp .env.example .env        # Windows: copy .env.example .env   (reference copy, see note)
npm ci
npm run mock                # serves http://127.0.0.1:8807  (check: http://127.0.0.1:8807/v1/health)
```
> **Note:** the backend reads settings from the **process environment**; it does not auto-load `.env`. The defaults are
> already mock-safe, so nothing is needed. To change one, set it in the shell, e.g. `PORT=8817 npm run mock`
> (Windows cmd: `set PORT=8817&& npm run mock`), or load the file with Node: `node --env-file=.env --import tsx src/main.ts`.

**2. Web (http://localhost:4331)**
```bash
cd web
cp .env.example .env.local  # Windows: copy .env.example .env.local
npm ci
npm run build && npm start  # production on :4331   (or: npm run dev  for hot reload on :4331)
```
Open http://localhost:4331.

Or use the helper scripts from this folder: `./run.sh` (macOS/Linux) or `run.cmd` (Windows). They install, build, and start both.

> `NEXT_PUBLIC_*` values are baked in at **build** time: after editing `web/.env.local`, run `npm run build` again.

### Modes
- Web `NEXT_PUBLIC_PAPER_API_MODE=mock` (default): the web runs entirely on built-in demo data, so the backend is optional.
- Set it to `live` to use the backend at `NEXT_PUBLIC_PAPER_API_BASE` (the backend in mock mode is still keyless). If the API is down
  the banner shows **"API offline · showing demo data"**.

## Environment variables

### Web (`web/.env.local`)
| Variable | Default | What it does |
|---|---|---|
| `NEXT_PUBLIC_PAPER_API_MODE` | `mock` | `mock` = built-in demo data; `live` = use the backend below (falls back to demo data with a visible notice). |
| `NEXT_PUBLIC_PAPER_API_BASE` | `http://127.0.0.1:8807/v1` | Backend URL (with or without `/v1`). Used in `live` mode. |
| `NEXT_PUBLIC_PAPERHANDS_DEMO` | `1` in `.env.example` (`0` if unset) | Demo-only tools such as "Pass the gate" (local UI state only, never trusted by the server). **Must be `0` for any public deploy.** |
| `NEXT_PUBLIC_PAPERHANDS_RANKED` | `0` | `0` = "Paper · unranked preview": no prizes/payouts shown. **Keep `0`.** |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:4331` | Absolute origin for social-preview image URLs. |

### Backend (process environment; `backend/.env.example` lists them all)
| Variable | Default | What it does |
|---|---|---|
| `HOST` / `PORT` | `127.0.0.1` / `8807` | Bind address (loopback only) and port. |
| `PAPERHANDS_MODE` | `mock` | `mock` = fixtures, no keys. `live` = real upstream quotes (needs keys below). |
| `DATABASE_PATH` | `.data/paperhands.db` | Local SQLite file (created on first run). |
| `SESSION_SECRET` | empty | Session signing secret. Mock generates one; **live needs a long random value**. |
| `ADMIN_TOKEN` | empty | Empty disables admin endpoints. |
| `COOKIE_SECURE` | `0` | `1` behind HTTPS. |
| `CORS_ORIGINS` | empty | Extra allowed web origins. Mock already allows `http://localhost:4331` / `http://127.0.0.1:4331`; live allows none by default. |
| `TRUSTED_PROXIES` | empty | Proxies whose `X-Forwarded-For` is trusted. |
| `SIWS_DOMAIN` / `SIWS_STATEMENT` | `localhost` / `Sign in to Paperhands` | Sign-In-With-Solana message fields. |
| `PAPER_MINT` / `PAPER_MIN_HOLD` | test mint / `50000` | Token gate: mint and minimum $PAPER hold. |
| `HOLD_CACHE_TTL_SEC` / `HOLD_RECHECK_SEC` / `HOLD_GRACE_SEC` | `60` / `300` / `900` | Hold-check caching, recheck and grace windows. |
| `CYCLE_BANKROLL_SOL` / `CYCLE_LENGTH_SEC` | `10` / `86400` | Paper SOL per cycle and cycle length. |
| `PAYOUT_TOP_N` | `25` | Size of the (pending, never auto-sent) payout queue. |
| `QUOTE_TTL_SEC` | `8` | Quote lifetime. |
| `PLATFORM_FEE_BPS` / `PRIORITY_FEE_LAMPORTS` | `0` / `100000` | Simulated fees. |
| `MIN_TRADE_SOL` / `MAX_POSITION_PCT` / `MIN_CYCLE_TRADES` | `0.01` / `25` / `3` | Trade and ranking rules. |
| `MIN_LIQUIDITY_USD` / `GRADUATING_PCT` / `FILL_LIQUIDITY_CAP_PCT` | `500` / `80` / `5` | Tradeability and fill limits. |
| `WASH_WINDOW_MS` / `WASH_LIQ_USD` | `3000` / `2000` | Wash-trade guards. |
| `STREAM_TICKET_TTL_SEC` / `LEADERBOARD_SSE_SEC` | `60` / `15` | Live stream (SSE) ticket lifetime and leaderboard push interval. |
| `HELIUS_API_KEY` / `SOLANA_RPC_URL` / `JUPITER_API_KEY` / `BIRDEYE_API_KEY` | empty | Live-mode upstream keys. **Not needed for mock.** Never commit real keys. |
| `HELIUS_TAPE_ENABLED` | `0` | Helius trade tape (off: the web shows "Live trades coming soon"). |
| `UPSTREAM_TIMEOUT_MS` | `4000` | Upstream request timeout. |

See `backend/RUN.md` and `web/README.md` for details.

## Ports and order
1. Backend, `:8807`. Start first.
2. Web, `:4331`.
Different ports: backend `PORT=8817 npm run mock` (env var, see note above); web `npx next start -p 4341` (and point `NEXT_PUBLIC_PAPER_API_BASE` at the new API port, then rebuild). For a web origin other than :4331 in `live` mode, add it to the backend `CORS_ORIGINS`.

## Safety
- Demo/mock by default; `DEMO=1` and `RANKED=0` locally. **Set `NEXT_PUBLIC_PAPERHANDS_DEMO=0` for any public deploy.**
- `.env.example` files contain empty placeholders only. Put real keys only in your own `.env`, never in the repo.
