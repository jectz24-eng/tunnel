# Architecture

```
┌────────────────────┐   wallet-approved txs    ┌──────────────────────────────┐   CPI   ┌──────────────┐
│  Next.js app (app) │ ───────────────────────► │  TUNNEL Anchor program        │ ──────► │  ORAO VRF v2 │
│  React 19 · TW 4   │ ◄─── RPC reads (authoritative) ───────────────────────── │         └──────────────┘
│  canvas chamber    │                          │  Protocol · Round · RoundVault│
│  API routes + SSE  │                          │  Position · RewardVault (SPL) │
└─────────┬──────────┘                          │  TreasuryVault                │
          │ SQL (derived views only)            └──────────────▲───────────────┘
┌─────────▼──────────┐   events + account reads                │ permissionless cranks
│ PostgreSQL (Prisma)│ ◄────────────────────── ┌────────────────┴───────────────┐
└────────────────────┘                          │ keeper (services/keeper)       │
                                                │ indexer · reconciler · crank   │
                                                └────────────────────────────────┘
```

## Repository
| Path | Contents |
|---|---|
| `programs/tunnel` | Anchor program (Rust) — the only authority over funds and outcomes |
| `packages/sdk` | TS: PDAs, instruction builders, account decoding, exact settlement-math mirror, verification, IDL |
| `packages/db` | Prisma schema, migrations, client |
| `services/keeper` | Indexer (websocket + cursor backfill), reconciler, crank, health endpoint |
| `app` | Next.js website, API routes, SSE stream |
| `scripts` | token creation, initialization, reserve funding, admin CLI, devnet e2e, IDL sync, local Postgres |
| `tests` | Anchor integration suite (localnet with cloned ORAO) |

## Onchain accounts
See `app/src/app/docs/page.tsx#contracts` (rendered at `/docs#contracts`) and `programs/tunnel/src/state.rs`.

## Settlement math
```
fee           = ⌊pool × fee_bps / 10⁴⌋
distributable = pool − fee
weight(p)     = Σ_b successes(p,b) × weight_b
Rewards:          sol(p) = ⌊distributable × weight(p) / Σweight⌋,  tok(p) = ⌊budget × weight(p) / Σweight⌋
NoSuccessRefund:  sol(p) = ⌊distributable × deposit(p) / pool⌋,   tok(p) = 0   (budget → reserve)
FullRefund:       sol(p) = deposit(p),                              tok(p) = 0   (no fee; budget → reserve)
emission(r)   = min(reserve_available, ⌊initial × (decay_bps/10⁴)^⌊r/epoch⌋⌋)   (1e18 fixed point)
```

## Transaction flows
1. **Deposit** — `deploy_particles(round_id, barrier, count)`: system transfer user → round vault; position created on first deposit (rent refunded on claim).
2. **Crank** (anyone; keeper by default) — `open_round` → `close_round` → `request_randomness` → `reveal_randomness` → `settle_position` × N (batched) → `finalize_round` → … → `sweep_round` after all claims; `withdraw_fees` periodically; `recover_round` on timeout.
3. **Claim** — `claim(round_id)`: SOL from round vault + $TUNNEL from reward vault (PDA signer) to the user's ATA (created if needed); position closed.

## Backend
* **Indexer**: `onLogs` subscription (confirmed) for latency + `getSignaturesForAddress` backfill from a DB cursor for completeness. Events are written with `(signature, eventIndex)` primary keys and `skipDuplicates` — idempotent under duplicates, overlaps and restarts.
* **Finality**: events start `confirmed`, promoted to `finalized` by slot; events still unfinalized after 2 minutes whose signatures the cluster no longer knows are deleted with their derived rows.
* **Reconciler**: re-reads Protocol, recent/non-final Round accounts and their Positions every few seconds and overwrites derived rows; wallet aggregates are recomputed from positions (never incremented).
* **Crank**: pure planner (`planner.ts`, unit-tested) decides the next instruction from chain state + chain clock; transient RPC errors retried with jittered backoff; benign races (another cranker got there first) logged and skipped; every attempt recorded in `KeeperAction`.
* **API**: `/api/stats`, `/api/activity`, `/api/rounds[/id]`, `/api/leaderboard`, `/api/wallet/[owner]`, `/api/stream` (SSE, resumable with `Last-Event-ID`), `/api/health`, `/api/auth/*` (Sign-In With Solana). Responses carry `available: false` when the indexer is down; the UI states that instead of showing zeros.

## Frontend data rules
* Live round state, balances and claimables come **from the chain**.
* History, leaderboard and charts come from the indexer and are labelled as such.
* The Mine chamber shows queued particles equal to the round's onchain counts, and replays outcomes only after recomputing them from onchain randomness and checking them against the program's recorded per-position success counts. The homepage chamber is labelled *illustrative*.
