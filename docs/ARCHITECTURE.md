# Architecture

```
┌──────────────────────────────┐  wallet-approved txs  ┌────────────────────────────────┐  CPI  ┌─────────────┐
│ Next.js app (app)            │ ─────────────────────► │ TUNNEL Anchor program          │ ────► │ ORAO VRF v2 │
│ React 19 · R3F/three · Motion│ ◄── RPC reads (truth) ─│ Protocol · Cycle · Position    │       └─────────────┘
│ API routes · SSE · gatekeeper│                        │ RewardVault (SPL) · physics.rs │
└────────────┬─────────────────┘                        └──────────────▲─────────────────┘
             │ SQL (derived views)                                     │ permissionless cranks
┌────────────▼─────────────────┐  events + account reads ┌────────────┴───────────────────┐
│ PostgreSQL (Prisma)          │ ◄────────────────────── │ keeper (services/keeper)        │
└──────────────────────────────┘                         │ indexer · reconciler · crank    │
                                                          └────────────────────────────────┘
```

Four independent concerns, as the brief requires:

| Concern | Where | Notes |
|---|---|---|
| **Physics → probability** | `programs/tunnel/src/physics.rs` (onchain, soft-float), `packages/sdk/src/physics.ts` (mirror + wavefunction solver) | Probability per [barrier][level] stored as ppb integers |
| **Randomness → outcome** | ORAO VRF + `math::particle_draw` | Seed fixed at close; per-particle SHA-256 draws |
| **Rules** | the program | energy, caps, payouts, claims, authority |
| **Presentation** | `app` | Reveals outcomes only after settlement; recomputes from chain |

## Repository
| Path | Contents |
|---|---|
| `programs/tunnel` | Anchor program: `admin`, `cycle`, `deploy`, `settle`, `claim` instructions; `physics.rs`, `math.rs` |
| `packages/sdk` | PDAs, instruction builders, account decoders, physics + wavefunction, exact settlement math, verification, compiler IDL |
| `packages/db` | Prisma schema + migrations (with CHECK constraints) |
| `services/keeper` | Indexer (websocket + cursor backfill), reconciler (cycles, positions, experiment outcomes, wallet stats), crank |
| `app` | Next.js site: Home, Accelerator, How it works, Laboratory, Leaderboard, Tokenomics, History (+ cycle/experiment verification), Profile, Admin; API routes |
| `scripts` | token, init, fund, admin CLI, localnet bootstrap/validator/VRF fulfiller, e2e run, physics reference values |
| `tests` | Anchor integration suite (localnet with cloned ORAO) |

## Onchain accounts
* **Protocol** — admin, pending admin, gatekeeper, mint, vault, `ProtocolParams` (barriers V₀/a/premium, energy levels E/V₀ + cost, energy per cycle, reward per energy, cycle duration, randomness timeout, emission schedule), derived `OddsTable`, counters.
* **Cycle** — status/outcome, window, *snapshot* of barriers, levels, odds, energy allowance and budget; participants, experiments, particles, energy; VRF seed and randomness; successes, Σ nominal, allocated, claims.
* **Position** (one per wallet per cycle) — particles and successes per [barrier][level], energy used, experiment count, nominal reward, claim state.

## Settlement math
```
T(E,V₀,a)      = 1 / (1 + V₀² a² f(x)² / 4E),  x = a√|V₀−E|, f = sinh(x)/x (E<V₀)        (ħ²/2m = 1)
ppb[b][l]      = round(T(V₀_b · E_l, V₀_b, a_b) · 10⁹)
reward[b][l]   = ⌊reward_per_energy · cost_l · premium_b · 10⁹ / (10⁴ · ppb)⌋
draw(i)        = u64_le(sha256("TUNNEL/particle/v2" ‖ R ‖ cycle ‖ owner ‖ b ‖ l ‖ i)[0..8]);  success ⇔ draw < ⌊ppb·2⁶⁴/10⁹⌋
nominal(pos)   = Σ successes[b][l] · reward[b][l]
budget(c)      = min(reserve_available, ⌊initial · decay^⌊c/epoch⌋⌋)
payout(pos)    = nominal              if Σ nominal ≤ budget
               = ⌊budget·nominal/Σ⌋   otherwise
```

## Flows
1. **Deploy** — `deploy_particles(cycle, barrier, level, count)` by the wallet (optionally co-signed by the gatekeeper). No transfer to the protocol; the position account's rent is the only lamport movement (refunded on claim).
2. **Crank** (anyone; the keeper by default) — `open_cycle` → `close_cycle` → `request_randomness` → (ORAO fulfils) → `reveal_randomness` → `settle_position` × N → `finalize_cycle` → … → `sweep_cycle`; `void_cycle` on timeout.
3. **Claim** — `claim(cycle)`: pays the payout (if any) to the wallet's ATA (created idempotently in the same tx) and closes the position.

## Backend
* **Indexer** — `onLogs` (confirmed) + `getSignaturesForAddress` backfill from a cursor; rows keyed by `(signature, eventIndex)` with `skipDuplicates`. Finality promotion; dropped-fork cleanup.
* **Reconciler** — re-reads Protocol/Cycles/Positions, rebuilds closed (claimed) positions from events, derives each experiment's particle outcomes from the revealed randomness and cross-checks them against the program's per-cell counts, recomputes wallet aggregates (incl. streaks) from positions.
* **Crank** — pure planner + retrying sender; benign races logged as skipped; every attempt in `KeeperAction`.
* **API** — `/api/stats`, `/api/activity`, `/api/stream` (SSE, resumable), `/api/cycles[/id]`, `/api/experiments[/cycle/owner/seq]` (search, filters, pagination), `/api/leaderboard?category=`, `/api/wallet/[owner]`, `/api/lab`, `/api/gatekeeper`, `/api/admin`, `/api/auth/*`, `/api/health`. Indexed responses carry `available: false` when the DB is down.

## Database (spec → model)
Users → `User` · MiningCycles → `Cycle` · MiningAttempts → `Experiment` · Rewards → `Position` + `Claim` · ProtocolConfiguration → `ProtocolState` · ProtocolEvents → `IndexedEvent`. Plus `WalletStats`, `IndexerCursor`, `KeeperAction`, `RateLimit`.

## Frontend data rules
* Live cycle state, balances, positions, claimables and reveal outcomes come **from chain**.
* History, leaderboards, live activity and lab statistics come from the indexer and say so when it is unavailable.
* Decorative visuals (hero ring, chamber ambient particles) are labelled as visual effects. The live ring only shows indexed events. Outcomes are animated only after `settle_position`; rewards only after `finalize_cycle`.
