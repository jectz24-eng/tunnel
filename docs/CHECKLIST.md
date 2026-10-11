# Deployment-readiness checklist

Status legend: ✅ done and verified in this repo · ⬜ not done · ⛔ blocked on an external party or owner decision.

## Program
- ✅ Builds with `anchor build` (Solana 2.3.0 / Anchor 0.32.1); 615 KB `.so`
- ✅ Rust unit tests (`cargo test -p tunnel --lib`): physics vs 50-digit reference, odds monotonicity & calibration, draw known vector, emissions, overflow
- ✅ Localnet integration suite (`anchor test`, 28 tests): init auth, physics-derived odds equal SDK exactly, energy limits, gatekeeper, pause, snapshots, late deployment, VRF request/reveal, settlement vs SDK, cap scaling, void + late fulfilment, fulfilled-randomness cannot be voided, reserve cap, double-claim, admin transfer, vault exits
- ✅ Full-stack localnet run (keeper + indexer + ORAO program + fulfiller + app): `docs/LOCALNET_RUN.md`
- ⛔ Devnet deployment and `docs/DEVNET_RUN.md` with the live ORAO network — blocked: the CLI faucet rate-limited the operator wallet `8QWtnT8AaHdcmyAiNvZscd4Ebah4JZdsZNXisKjnUdbx`; fund it with ≈ 5 devnet SOL at https://faucet.solana.com, then follow DEPLOYMENT.md §2
- ⬜ Fuzzing (e.g. Trident) of deploy/settle/claim
- ⬜ Compute profile of `settle_position` at the 250-particle maximum on devnet
- ⛔ **Independent security audit** (blocking for mainnet)
- ⛔ Verifiable build (`anchor build --verifiable`) published with the audited commit hash

## Authorities & keys
- ⬜ Program upgrade authority → multisig (Squads) with a timelock policy, or immutable
- ⬜ Protocol admin → multisig (`propose_admin` / `accept_admin`)
- ⬜ Keeper hot wallet funded, monitored, separate from admin
- ⬜ Gatekeeper key (if used) on the app server only, rotated via `set_gatekeeper`
- ✅ No secret keys in the frontend or repository (`.gitignore` covers keys, env files, deploy keypairs)

## Token
- ⛔ Final tokenomics from the owner (supply and allocations are placeholders)
- ⬜ Mint created on the target cluster; supply minted; **mint authority revoked**
- ⬜ Emissions reserve funded into the program vault; `reserve_available` verified
- ⬜ Emission schedule reviewed against the funded reserve (`/tokenomics` chart)

## Backend & app
- ✅ SDK tests (physics, wave solver, math, IDL/coder): 27
- ✅ Keeper tests incl. real Postgres (idempotent ingestion, constraints, experiment derivation, streaks): 24
- ✅ App unit tests (gatekeeper checks, reveal gating, rate limits, sessions, params): 18
- ✅ Playwright site tests (pages, overflow, gating, odds, lab, tokenomics, API validation) — run with `npm run test:e2e`
- ⬜ Managed PostgreSQL with backups/PITR; `DATABASE_URL` set
- ⬜ `SESSION_SECRET` (32+ bytes) set in production
- ⬜ Dedicated RPC provider for app, keeper and indexer
- ⬜ Monitoring/alerts wired (keeper health, stuck cycles, admin events, vault invariant)
- ⬜ CSP tuned for the production domain

## Legal / product
- ⛔ Legal review of token distributions in target jurisdictions
- ⛔ Owner sign-off on risk disclosures and copy
- ⛔ Mainnet launch decision (after audit) — then set `[programs.mainnet]`, `TUNNEL_MAINNET_AUTHORIZED`, `NEXT_PUBLIC_MAINNET_DEPOSITS_ENABLED`
