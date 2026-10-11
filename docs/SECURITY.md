# TUNNEL security review, threat model and risk register (v2)

> **Status: internal review only. No independent audit has been performed.**
> Nothing in this document claims the protocol is secure or production-ready.
> Passing tests is not evidence of security. An external audit is a hard
> prerequisite for mainnet (see `DEPLOYMENT.md` and `CHECKLIST.md`).

Scope: `programs/tunnel` (Anchor 0.32.1) and its CPI to ORAO VRF v2, the keeper (`services/keeper`), and the web app's server routes and transaction paths.

**v2 design in one line:** wallets spend a free per-cycle energy allowance (no SOL to the protocol) on particles; the program derives tunneling probabilities from barrier physics; ORAO VRF randomness decides each particle; $TUNNEL is paid from a pre-funded reserve, capped per cycle.

---

## 1. Structured review by area

### 1.1 PDA and authority validation
| Account | Seeds | Validation |
|---|---|---|
| Protocol | `["protocol"]` | `seeds` + stored `bump` on every instruction |
| Reward vault (SPL) | `["reward_vault"]` | created with `token::authority = protocol`; `has_one = reward_vault` and `has_one = tunnel_mint` on use |
| Cycle | `["cycle", id_le]` | `seeds` with the instruction's `cycle_id` |
| Position | `["position", id_le, owner]` | `seeds` bind the owner; `has_one = owner` and `close = owner` on claim |
| ORAO request | `["orao-vrf-randomness-request", seed]` @ ORAO | `seeds::program = ORAO`, `owner = ORAO` on reveal; the seed is read from the cycle, never from the caller |

* `initialize` requires the signer to be the program's **upgrade authority**, preventing front-run initialization.
* Typed accounts are owner/discriminator-checked by Anchor. `UncheckedAccount`s: ORAO accounts (seeds-checked; ORAO validates its own) and the SlotHashes sysvar (`address =`).
* Optional accounts: `gatekeeper` (must equal `protocol.gatekeeper` when one is configured) and the claimant's associated token account (`associated_token::mint/authority` constraints apply when present; required when the payout is non-zero).
* SPL: classic Token program; transfers use `transfer_checked`.

### 1.2 Reserve accounting
* $TUNNEL leaves the vault **only** through `claim` (the IDL-scan test asserts that only `initialize`, `fund_reserve` and `claim` mark the vault writable).
* `reserve_available` is decremented when a cycle opens (`budget = min(scheduled, reserve_available)`) and credited back with unused budget at `finalize_cycle`, void/empty cycles, and rounding dust at `sweep_cycle`.
* Invariant: `vault balance = reserve_available + Σ(open cycle budgets) + Σ(allocated − claimed over final cycles)`. `claim` also asserts the vault holds the payout, so accounting bugs fail closed.
* Per-cycle cap: `tokens_allocated = min(Σ nominal, emission_budget)`; payouts are `nominal` (within budget) or `⌊budget · nominal / Σ nominal⌋` (pro rata). Property-tested: Σ payouts ≤ budget, each ≤ nominal, dust ≤ 1 unit per position.
* The program never mints.

### 1.3 Energy accounting
* `energy_used ≤ energy_per_cycle` is checked in `deploy_particles` against the cycle's snapshot; one Position per (cycle, wallet) makes the allowance per wallet per cycle.
* Counts are bounded so per-cell `u16` never overflows (`energy_per_cycle ≤ 250`, cost ≥ 1).

### 1.4 Odds derivation
* Probabilities are not admin inputs. `derive_odds` evaluates the rectangular-barrier formula (soft-float `libm`) in `initialize` / `update_params` and stores parts-per-billion integers; out-of-bounds physics is rejected (`InvalidParams`).
* Outcome comparisons are integer-only. The SDK recomputes the table in V8; the localnet suite asserts the onchain table equals the SDK's **exactly**, and the UI flags any cycle whose snapshot differs from the model by more than 1 ppb.
* Rewards are calibrated from the stored integers (`cost · premium · 10⁹ / (10⁴ · ppb)`), so EV per energy is invariant across levels (tested to 1e-6).

### 1.5 Claims / double-claim
* `claim` closes the Position; a second claim cannot load it. It cannot be re-created: deployments require an `Open` cycle and settled/void cycles never reopen.
* Zero-payout claims are allowed (they just return the deposit) and need no token account.

### 1.6 Randomness
* VRF seed derived inside `close_cycle` from the newest SlotHashes entry; it does not exist while deployments are possible.
* One seed and one ORAO request PDA per cycle; `reveal_randomness` checks `account.seed() == cycle.vrf_seed`, the PDA and ORAO ownership.
* Per-particle draw: `sha256("TUNNEL/particle/v2" ‖ randomness ‖ cycle ‖ owner ‖ barrier ‖ level ‖ index)` vs `⌊ppb·2⁶⁴/10⁹⌋`. No modulo bias, domain-separated, per-particle independent; known vector checked in Rust, TS and Python.
* `void_cycle` is refused while fulfilled randomness exists (no "wait out the timeout" escape).

### 1.7 Liveness
* Every transition after `open_cycle` is permissionless. Stalls before reveal → `void_cycle` after the snapshotted timeout (no rewards, budget returned, positions closable).
* `Resolving` has no recovery path by design; its steps are permissionless, bounded in compute (≤ 250 SHA-256 per position) and have no external dependency.

### 1.8 Admin permissions
| Power | Bound |
|---|---|
| `update_params` | future cycles only; validated bounds; odds re-derived |
| `set_paused` | blocks `open_cycle` / `deploy_particles` only |
| `set_gatekeeper` | requires (or disables) a co-signature on deployments — can censor deployments, cannot touch rewards |
| `propose_admin` / `accept_admin` | two-step transfer |
| — | **cannot** move the reserve, set odds, mint, edit cycles or block settlement/claims |

### 1.9 Upgrade authority
The program is upgradeable. **The upgrade authority can replace all program logic.** Largest trust assumption (R1).

### 1.10 Arithmetic
`overflow-checks = true`; `checked_*` everywhere; `u128` intermediates; emission decay in 1e18 fixed point.

### 1.11 Off-chain services
* **Gatekeeper co-signer** (`/api/gatekeeper`): signs only a transaction whose fee payer is the SIWS-authenticated wallet and which contains exactly one `deploy_particles` (plus compute-budget) for that wallet with the configured gatekeeper key (`checkDeployTransaction`, unit-tested). Rate-limited per wallet, per IP and globally (DB-backed, fixed window). Its key authorizes deployments only.
* **Sessions**: Sign-In With Solana message with a MAC'd, time-bounded nonce; HTTP-only, SameSite=Strict cookie; `SESSION_SECRET` required in production.
* **Admin API** (`/api/admin`): read-only; requires the session wallet to equal the onchain admin. All admin actions are wallet-signed instructions.
* **Indexer/DB**: derived only; claimables and reveal outcomes are always computed from chain in the browser. CHECK constraints catch impossible rows.

### 1.12 Economics & abuse
* Per-wallet energy limits do **not** prevent Sybil attacks. Mitigations: per-cycle emission cap (splitting across wallets cannot extract more than the cycle budget), per-wallet fees + refundable rent, optional gatekeeper with SIWS + rate limits. One person with many wallets can still dilute others within a cycle's budget (R6).
* Free option via ORAO collusion is reduced vs v1: withholding randomness voids the cycle (nobody earns) instead of refunding stakes; there are no stakes.

---

## 2. Threat model

| # | Adversary | Goal | Mitigation | Residual |
|---|---|---|---|---|
| T1 | Participant | Deploy after knowing outcomes | Seed fixed at close; clock-checked window | None known |
| T2 | Participant | Exceed allowance / claim twice / claim others' | Energy check on snapshot; position PDA bound to owner; closed on claim | None known |
| T3 | ORAO quorum | Predict/bias outcomes | Seed unknown during deployments | Can withhold (→ void cycle) |
| T4 | Cranker / leader | Grind the seed | Seed from SlotHashes in-program | Can delay a slot |
| T5 | Admin key | Drain reserve / change odds mid-cycle | No such instructions; snapshots; odds derived | Can pause/censor via gatekeeper |
| T6 | Upgrade authority | Anything | — | **R1** |
| T7 | Keeper key | Steal rewards | Only permissionless cranks | Loses its own SOL |
| T8 | Gatekeeper key / server | Abuse co-signature | Strict tx shape check; key controls no funds | Can refuse service |
| T9 | Frontend compromise | Phish users | Wallet shows every tx; outcomes recomputed from chain | Malicious UI could request malicious txs |
| T10 | Indexer/DB compromise | Fake history/leaderboards | Never authoritative; cycle pages verify from chain | Misleading stats possible |
| T11 | Sybil farmer | Capture emissions | Per-cycle cap; fees + rent; gatekeeper | Dilution within cap (R6) |

---

## 3. Unresolved-risk register

| ID | Risk | Severity | Path |
|---|---|---|---|
| R1 | Upgrade authority can change all logic | Critical | Multisig + timelock, then consider immutability |
| R2 | No independent audit | Critical | Blocking for mainnet |
| R3 | ORAO authorities trusted for liveness and secrecy | High | Monitor fulfilment; consider combining two VRFs |
| R4 | Soft-float physics on SBF vs off-chain mirrors could differ by 1 ppb in rare rounding cases | Low | Onchain table is authoritative; UI tolerance 1 ppb; tested equal for launch params |
| R5 | Admin can censor deployments (pause, gatekeeper) | Medium | Multisig admin; monitor `PauseChanged`/`GatekeeperChanged` |
| R6 | Sybil dilution within the per-cycle budget | Medium | Gatekeeper + stronger identity checks if needed; accept as documented |
| R7 | Crank cost: Cycle account rent (~0.004 SOL, never reclaimed) + ORAO fee per cycle ≈ 144 cycles/day | Medium (economic) | Budget for keeper; consider closing archived cycles |
| R8 | Unclaimed positions keep `sweep_cycle` from running (dust stays allocated) | Low | Acceptable; amounts tiny |
| R9 | Token distribution / gaming regulation | High (legal) | Legal advice before any real-value launch |
| R10 | Frontend supply chain | Medium | Lockfile, pinned versions, CSP, minimal deps |
| R11 | Localnet test wallet stores a throwaway key in localStorage | Low | Double-gated (localnet + explicit flag); never shipped on devnet/mainnet builds |
