# TUNNEL architecture (v3: server-authoritative, no smart contract)

TUNNEL is a physics-inspired mining game. Wallets spend a free per-cycle energy
allowance on particles; each particle's tunneling probability comes from the
rectangular-barrier transmission formula; a provably fair random draw decides
each particle; successful particles earn real $TUNNEL (an SPL token) from a
pre-funded reserve.

There is **no on-chain program**. The game runs on a Node server. Solana is used
for three things only:

1. **$TUNNEL itself**: a standard SPL mint, held in wallets.
2. **Payouts**: real SPL `transferChecked` transfers from the reward wallet.
3. **Public entropy**: each cycle's randomness includes the hash of a Solana
   block that does not exist until the cycle has closed.

```
 browser ──signMessage──▶ tunnel-web (Next.js)  ──▶ PostgreSQL ◀── tunnel-engine (Node)
   │   (free, no tx)       /api/deploy, /api/claim        ▲            │  cycles: open → close → settle
   │                       /api/state, /api/me, …          │            │  payouts: SPL transfers
   └── reads balances ─────────────── Solana RPC ◀─────────┴────────────┘  entropy: blockhash
```

## Packages

| Path | Role |
|---|---|
| `packages/sdk` | Pure TypeScript: physics (`transmission`, `transmissionPpb`, wave solver), odds and reward calibration (`deriveOdds`), emissions, particle draws, fairness (`commitSeed`, `deriveRandomness`), the canonical signed-message formats, and `verifyCycle`. Used by the server, the engine and the browser. |
| `packages/db` | Prisma 7 schema + migrations (PostgreSQL). |
| `packages/core` | The protocol rules, shared by web and engine: `deploy`, `requestClaim`, `openCycle`, `closeDueCycles`, `settleCycle`, `voidCycle`, payout state transitions, wallet stats, configuration. Every state change is a database transaction holding the rows it depends on. |
| `services/engine` | The only process with a key. Runs the cycle loop, reads entropy blocks, sends payouts, publishes reward-wallet balances and a heartbeat. |
| `app` | Next.js 16 site and API. Holds no keys. |
| `scripts` | Token creation, reward wallet creation, reserve funding, admin CLI, local bootstrap. |

## Data model (PostgreSQL)

* `ProtocolConfig`: parameters, derived odds, paused flag, reserve funded, reward-wallet balances, engine heartbeat.
* `Cycle`: one row per cycle with its parameter/odds snapshot, budget, seed commitment, secret seed (revealed after settlement), entropy slot/blockhash, randomness and totals.
* `Position`: one wallet in one cycle, with particles and successes per [barrier][level], nominal reward, final payout and link to a `Payout`.
* `Experiment`: one signed deployment: the exact message and signature, plus its outcome bits after settlement.
* `Payout`: one claim → one SPL transfer (`requested → sending → confirmed | failed`).
* `ProtocolEvent`: append-only audit/activity log. `WalletStats` is recomputed from positions, never incremented.
* `UsedNonce` and `RateLimit`: replay protection and rate limits.

## A cycle

1. **Open** (engine): snapshot params and odds; budget = `min(scheduled emission, unallocated reserve)`; generate a 32-byte seed; publish `sha256(domain ‖ seed)` and an `entropySlot` ≈ close + 30 s of slots. Mining paused or reserve empty → no cycle.
2. **Deploy** (web): the wallet signs a readable message (wallet, cycle, barrier, level, particles, nonce, time). The server checks the canonical format, the ed25519 signature, freshness (5 min), nonce uniqueness, rate limits, then in one transaction locks the cycle row, checks it is open, checks energy, and records the experiment.
3. **Close** (engine): at `closeTs`, or earlier if the chain is within 30 slots of `entropySlot`.
4. **Settle** (engine): once the entropy slot is finalized, take the first produced block ≥ it; `randomness = sha512(domain ‖ seed ‖ blockhash ‖ cycle)`; draw every particle; compute payouts (pro rata above budget); reveal the seed. One transaction holding the cycle lock; idempotent.
5. **Claim** (web + engine): the wallet signs a claim message; all settled, unpaid positions are bundled into one `Payout`; the engine signs the transfer, saves its signature and `lastValidBlockHeight`, then broadcasts. It is re-signed only after that blockhash has provably expired unconfirmed, so a payout can never land twice.

See `RANDOMNESS.md` for the fairness argument and `SECURITY.md` for the trust model.

## The accelerator (instant $TUNNEL shots)

The live accelerator is an instant game; the cycle engine above is off by default (`ENGINE_CYCLES=true` re-enables it).

* **Barrier = volatility.** LOW / MEDIUM / HIGH have fixed win chances and multipliers (`VOLATILITY` in `packages/sdk/src/casino.ts`).
* **Particle energy = stake per particle**, **particles = simultaneous shots** (1–20). Total bet = energy × particles.
* **Balances** live in `Account`. Deposits are SPL transfers to the vault, credited once finalized by the engine's deposit watcher (`services/engine/src/deposits.ts`, keyed by transaction signature). Withdrawals are signed messages that become `Payout` rows (`kind = withdrawal`) sent by the same exactly-once payout loop; a failed transfer re-credits the balance.
* **Bets** (`placeBet` in `packages/core/src/casino.ts`) run in one transaction holding the account row lock: limits, max-win vs free bankroll, debit, resolve, credit.
* **Provably fair:** per-wallet server seed (only its SHA-256 shown until rotation), player client seed, nonce. Particle *i* = HMAC-SHA256(serverSeed, `TUNNEL/bet/v1:clientSeed:nonce:i`), first 8 bytes vs the win threshold. `/history/bet/[id]` recomputes a shot in the browser once its seed is revealed.
* **Laboratory** runs the same `resolveBet` in the browser with free practice credits.
* Operator controls: `/admin` or `npm run admin -- betting on|off | bet-limits <min> <max> | max-win-bps <bps>`.
