# Paperhands backend — local run (Wren handoff)

No VPS deploy. Bind is loopback only.

## Requirements

- **Node ≥ 20** (developed on Node 20+/24; `engines.node` is `>=20`)
- npm (lockfile present — use `npm ci`)

## Setup

```bash
git clone <repo> paperhands && cd paperhands/backend
cp .env.example .env          # optional; defaults are mock-safe
npm ci
```

There is **no** `build` script; the server runs TypeScript via `tsx`.
Typecheck: `npm run typecheck`.

## Run (mock — default)

```bash
npm run mock
# → http://127.0.0.1:8807
curl -s http://127.0.0.1:8807/v1/health
```

Equivalent: `PAPERHANDS_MODE=mock npm start` or `npm run dev` (watch).

## Optional live

Fill in `.env` (never commit):

- `PAPERHANDS_MODE=live`
- `SESSION_SECRET=` (long random)
- `HELIUS_API_KEY=` / `SOLANA_RPC_URL=`
- optional `JUPITER_API_KEY=`, `BIRDEYE_API_KEY=`
- `CORS_ORIGINS=http://127.0.0.1:4331` (or your web origin)
- `ADMIN_TOKEN=` empty disables admin; live requires ≥32 chars + entropy if set

Then: `npm run live`.

## Web CORS

Mock auto-allows local web on **`:4331`** (`http://127.0.0.1:4331` / `http://localhost:4331`).
Live needs an explicit `CORS_ORIGINS`.

## Ports

| Service | Default |
|---------|---------|
| Backend API | `127.0.0.1:8807` |
| Web (frontend) | `:4331` |

## Tests

```bash
npm test                 # vitest run (full suite)
npm run typecheck
npm audit --omit=dev     # expect 0
```

## Notes

- SQLite file defaults to `.data/paperhands.db` (gitignored).
- Do not track `.env`, `node_modules/`, or `*.db`.
- Mock fixtures seed **catalog/prices only** — never live user token inventory.
