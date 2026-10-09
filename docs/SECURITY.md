# TUNNEL security review, threat model and risk register

> **Status: internal review only. No independent audit has been performed.**
> Nothing in this document is a claim that the protocol is secure or production-ready.
> Automated tests passing is not evidence of security. An external audit is a hard
> prerequisite for mainnet (see `DEPLOYMENT.md`).

Scope: `programs/tunnel` (Anchor 0.32.1), its CPI to ORAO VRF v2, the keeper (`services/keeper`) and the web app's transaction paths.

---

## 1. Structured review by area

### 1.1 PDA and authority validation
| Account | Seeds | Validation |
|---|---|---|
| Protocol | `["protocol"]` | `seeds` + stored `bump` on every instruction |
| Reward vault (SPL) | `["reward_vault"]` | created with `token::authority = protocol`; `has_one = reward_vault` on use |
| Treasury vault | `["treasury_vault"]` | `seeds` + stored bump |
| Round | `["round", id_le]` | `seeds` with the instruction's `round_id` |
| Round vault | `["round_vault", id_le]` | `seeds` + `round.vault_bump` |
| Position | `["position", id_le, owner]` | `seeds` bind the owner; `has_one = owner` on claim |
| ORAO request | `["orao-vrf-randomness-request", seed]` @ ORAO | `seeds::program = ORAO`, `owner = ORAO` on reveal; seed read from the round, never from the caller |

* `initialize` requires the signer to be the program's **upgrade authority** (`program_data.upgrade_authority_address`), preventing front-run initialization with hostile config.
* All typed accounts are owner/discriminator-checked by Anchor. `UncheckedAccount`s are limited to: ORAO accounts (seeds-checked; ORAO validates its own), the SlotHashes sysvar (`address =` check), and lamport recipients (`address = protocol.treasury`).
* SPL: classic Token program only (`Program<Token>`); mint pinned via `has_one = tunnel_mint`; transfers use `transfer_checked` (decimals verified).

### 1.2 Escrow accounting
* SOL is held per round in a program-owned `RoundVault`. Debits happen only in: `finalize_round` (fee → treasury vault, once), `claim` (to the position owner), `sweep_round` (close remainder → treasury vault, only when `claims == participants`).
* Invariant: `vault = rent + total_lamports − fee − Σ claims`. `claim` additionally asserts the payout ≤ spendable balance above rent, so accounting bugs fail closed.
* Payouts use floor division, so `Σ payouts ≤ distributable` (property-tested in `packages/sdk/test/math.test.ts`); dust ≤ 1 lamport per participant.
* **No instruction transfers escrow to the admin.** Admin-gated instructions touch only `Protocol` fields.

### 1.3 Claim accounting / double-claim
* `claim` closes the Position (`close = owner`). A second claim cannot load the account (`AccountNotInitialized`). It cannot be re-created because `deploy_particles` requires `RoundStatus::Open`, and a settled/failed round can never return to Open.
* `claimed` flag set before close as defence in depth; the `RewardClaimed` event is the permanent record.
* Token payout is bounded by `emission_budget` (pro-rata floor) and asserted ≤ vault balance.

### 1.4 Randomness manipulation
* The VRF seed is derived inside `close_round` from the newest SlotHashes entry. It does not exist while deposits are possible. The caller cannot choose it.
* Each round has exactly one seed and one ORAO request PDA; `reveal_randomness` verifies `account.seed() == round.vrf_seed`, the PDA and the ORAO owner, so randomness cannot be substituted or replayed.
* Outcome mapping: `sha256(domain ‖ randomness ‖ round_id ‖ owner ‖ barrier ‖ index)` compared to `⌊bps·2⁶⁴/10⁴⌋`: no modulo bias, per-particle independence, domain-separated.
* `recover_round` is refused while fulfilled randomness exists for the round (prevents "wait out the timeout to dodge a loss").
* See §2 T3/T4 for residual trust in ORAO.

### 1.5 Settlement liveness
* Every transition after `open_round` is permissionless; no single party (including the keeper) is required.
* Stall points and escapes: `Open` past `close_ts + timeout` with participants → `recover`; `Closed` past timeout → `recover`; `AwaitingRandomness` past timeout (and not fulfilled) → `recover`.
* `Resolving` has no recovery path by design. Its steps (`settle_position` ×N, `finalize_round`) are permissionless, bounded in compute, and have no external dependency:
  * Fees go to the program-owned, rent-exempt **treasury vault**, not straight to an external wallet. *(Found during this review: paying an unfunded treasury wallet a fee below the rent-exempt minimum would have made `finalize_round` fail forever and locked the round. Fixed.)*
  * `settle_position` cost is bounded by `max_particles_per_position ≤ 250` (≈ one SHA-256 syscall per particle).
* `claim` of one user cannot block others.

### 1.6 Fee collection
* Fee = `⌊pool × fee_bps / 10⁴⌋`, `fee_bps ≤ 1000` enforced onchain, snapshotted per round; taken exactly once (status moves `Resolving → Settled`, never back).
* Failed rounds take no fee. `withdraw_fees` is permissionless but pays only `protocol.treasury`.

### 1.7 Admin permissions
| Power | Bound |
|---|---|
| `update_params` | future rounds only; hard bounds in `ProtocolParams::validate` |
| `set_paused` | blocks `open_round` / `deploy_particles` only; never claims, refunds or settlement |
| `set_treasury` | redirects *future* fee withdrawals (risk R5) |
| `propose_admin` / `accept_admin` | two-step transfer |
| — | **cannot** move escrow or reserve, edit rounds, or change outcomes |

### 1.8 Upgrade authority
The program is deployed upgradeable. **The upgrade authority can replace program logic, including all of the above guarantees.** This is the single largest trust assumption (R1).

### 1.9 Integer arithmetic
* `overflow-checks = true` in release; all accumulations use `checked_*` → `MathOverflow`.
* Products use `u128` intermediates (`math::mul_div`); emission uses 1e18 fixed-point with `u128` squaring (max 1e36 < 2¹²⁸).
* Unit tests (Rust) and property tests (TS mirror, fast-check) cover extremes, conservation and monotonicity. The TS mirror is checked against Rust test vectors.

### 1.10 Transaction ordering / MEV
* Deposits after `close_ts` are rejected by the program's clock check regardless of ordering.
* Nobody can observe the outcome before deposits close (seed doesn't exist yet). A leader can delay `close_round` inclusion, but cannot cheaply choose the slot hash, and gains nothing without also predicting ORAO's output.
* Front-running `request_randomness` by requesting the same seed at ORAO directly is harmless (the handler detects an existing request).

### 1.11 Denial-of-service vectors
* Many tiny positions → many `settle_position` calls (keeper cost) but no lock-up: each is independent and permissionless. Cost per position is borne by whoever cranks (R6).
* `open_round` spam is impossible beyond one upcoming round; empty rounds settle immediately and return their budget.
* A hostile actor pre-creating the ORAO request account: handled (no CPI needed).
* RPC/websocket failures affect only the keeper/indexer; the backfill cursor makes indexing complete after recovery.

### 1.12 Economic exploits
* The game is negative-sum for participants by the fee (5%). Barrier expected weights per particle: I 0.65, II 0.60, III 0.50. Payouts are pro rata to *realised* weight, so no barrier choice is risk-free.
* Sybil splitting across wallets gives no advantage (outcomes are per particle; per-wallet cap only bounds compute).
* **Free option via VRF collusion** (R2): an ORAO quorum colluding with a participant can withhold unfavourable randomness, forcing a full refund, and publish favourable randomness.

---

## 2. Threat model

| # | Adversary | Goal | Mitigation | Residual |
|---|---|---|---|---|
| T1 | Participant | Deposit after knowing the outcome | Seed derived at close; clock-checked deposit window | None known |
| T2 | Participant | Claim twice / claim others' rewards | Position PDA bound to owner; closed on claim | None known |
| T3 | ORAO authorities (quorum) | Predict/bias outcomes | Seed unknown during deposits; output is deterministic in the seed | Can **withhold** (R2) |
| T4 | Cranker / validator leader | Grind the seed | Seed from SlotHashes inside the program | Leader can delay a slot; can't select hash cheaply |
| T5 | Admin key | Drain escrow/reserve; change odds mid-round | No such instructions; per-round snapshot | Treasury redirection (R5) |
| T6 | Upgrade authority | Anything | — | **R1** |
| T7 | Keeper key compromise | Steal funds | Keeper only calls permissionless cranks; holds only rent/fee SOL | Loss of keeper's own SOL |
| T8 | Web frontend compromise | Phish users, fake balances | Wallet shows every tx; claims verified onchain; CSP/security headers | Malicious UI could still request a malicious tx (users must read wallet prompts) |
| T9 | Indexer/DB compromise | Show false history | DB is never authoritative; claimables read from chain; round pages recompute from chain | Misleading stats possible |
| T10 | RPC provider | Censor/lie | Wallet broadcasts; genesis-hash cluster detection | Liveness only |

---

## 3. Pre-mainnet security checklist

- [x] All PDAs seed-checked; bumps stored and reused
- [x] Upgrade-authority-gated `initialize`
- [x] Checked arithmetic + `overflow-checks`
- [x] Per-round parameter snapshot; bounded parameters
- [x] Late deposits rejected by clock
- [x] Idempotent settlement (`PositionAlreadySettled`, status machine)
- [x] Double-claim impossible (closed position)
- [x] Fee path cannot block settlement (treasury vault)
- [x] Recovery cannot dodge revealed randomness
- [x] Bounded compute per instruction
- [x] Events for every state change
- [ ] **Independent external audit** (required)
- [ ] `anchor test` suite run green on localnet (requires toolchain — see DEPLOYMENT.md)
- [ ] Devnet end-to-end run with real ORAO (`scripts/devnet-e2e.ts`) recorded in `docs/DEVNET_RUN.md`
- [ ] Upgrade authority moved to a multisig (Squads) with timelock, or made immutable
- [ ] Admin and treasury moved to multisigs
- [ ] Fuzzing (e.g. Trident) of settlement and claim paths
- [ ] Compute-unit measurement of `settle_position` at 250 particles on mainnet-equivalent config
- [ ] Legal/regulatory review of offering a game of chance in target jurisdictions
- [ ] Monitoring + alerting on keeper health, stuck rounds, vault invariants

---

## 4. Unresolved-risk register

| ID | Risk | Severity | Status / mitigation path |
|---|---|---|---|
| R1 | Upgrade authority can change all program logic | Critical | Open. Multisig + timelock, then consider immutability |
| R2 | ORAO quorum collusion gives a participant a free option (withhold → refund) | High | Open. Options: combine two independent VRFs (XOR); on timeout refund minus fee; monitor ORAO request/fulfilment latency |
| R3 | No independent audit | Critical | Open. Blocking for mainnet |
| R4 | Anchor/ORAO code compiled but not yet executed in this environment (no Solana toolchain on the build machine at time of writing) | High | Open. Run `anchor build`, `cargo test`, `anchor test`, `scripts/devnet-e2e.ts` |
| R5 | Admin can redirect future fee withdrawals via `set_treasury` | Medium | Admin multisig; emit + monitor `TreasuryChanged` |
| R6 | Crank operating cost: ~0.003 SOL rent per Round account (never reclaimed) + ORAO fee per round ≈ 4–7 SOL/day at 1,440 rounds/day; plus one `settle_position` per participant | Medium (economic) | Consider closing old Round accounts after an archival period; batch settlement; fee covers cost at sufficient volume |
| R7 | Rounds stall (not lose funds) if nobody cranks | Low | Permissionless cranks, keeper health alerts, timeout refunds |
| R8 | Users who never claim block `sweep_round` (dust + vault rent stay locked) | Low | Acceptable; amounts are tiny |
| R9 | Gambling / securities regulation | High (legal) | Owner must obtain legal advice before any real-value launch |
| R10 | Frontend supply chain (npm deps) | Medium | Lockfile, CI, minimal deps, CSP; consider SRI/static hosting |
| R11 | Recharts/wallet libs render untrusted wallet names/icons | Low | React escaping; icons are data URIs from wallet-standard |
