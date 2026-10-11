# Deployment guide

Environments: **LOCAL** (local validator + local Postgres), **DEVNET** (public devnet, live ORAO), **MAINNET** (prepared, disabled).

> Never commit keys. `.gitignore` excludes `.env*`, `*.keypair.json`, `id.json`, `keys/` and `target/` (which holds `target/deploy/tunnel-keypair.json`, the program-address keypair — back it up securely).

## 0. Toolchain
Anchor needs Linux/WSL2. Pinned: Solana/Agave 2.3.0, Anchor 0.32.1 (platform-tools rustc 1.84), Node 22. On Windows: `wsl --install -d Ubuntu`, then `bash scripts/setup-wsl.sh` inside WSL. The web app, keeper and scripts run natively on Windows or Linux.

## 1. LOCAL (full stack)
```bash
# build + test the program (WSL/Linux)
cargo test -p tunnel --lib                    # physics + math unit tests
anchor build && npm run idl:sync              # compile; install the compiler IDL into the SDK
anchor test                                   # 28 integration tests on a fresh validator (ORAO cloned from devnet)

# run everything
bash scripts/local-validator.sh <OPERATOR_PUBKEY> --reset          # WSL: validator on :8899 with program + ORAO
npm run db:local                                                    # Postgres (PGlite) on :5432
npx --workspace packages/db prisma migrate deploy
SOLANA_RPC_URL=http://127.0.0.1:8899 npx tsx scripts/local-setup.ts --cycle-secs 90 [--gatekeeper]
SOLANA_RPC_URL=http://127.0.0.1:8899 npx tsx scripts/local-vrf-fulfiller.ts   # plays the ORAO network locally
KEEPER_KEYPAIR=keys/localnet-keeper.json SOLANA_RPC_URL=http://127.0.0.1:8899 DATABASE_URL=… npm run keeper
npm run dev                                                         # http://localhost:3000

# verify
npm test                                                            # SDK, keeper (real Postgres), app unit tests
SOLANA_RPC_URL=http://127.0.0.1:8899 npx tsx scripts/e2e-run.ts     # full cycle; writes docs/LOCALNET_RUN.md
npm run test:e2e                                                    # Playwright (desktop + mobile)
```
`<OPERATOR_PUBKEY>` is the public key of `keys/localnet-operator.json` (created on first use). `app/.env.local` for localnet:
```
NEXT_PUBLIC_CLUSTER=localnet
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
SOLANA_RPC_URL=http://127.0.0.1:8899
NEXT_PUBLIC_LOCAL_TEST_WALLET=true          # optional: in-browser burner wallet, localnet only
GATEKEEPER_KEYPAIR=../keys/localnet-gatekeeper.json   # only if set up with --gatekeeper
```

## 2. DEVNET
```bash
solana config set --url devnet
solana-keygen new -o ~/.config/solana/id.json        # if you don't have one; this becomes the upgrade authority/admin
solana airdrop 2   # repeat / use https://faucet.solana.com — a deploy needs ≈ 4.5 SOL (≈ 615 KB program)
anchor deploy --provider.cluster devnet               # deploys GyywTr1c…WrhF9 from target/deploy/tunnel-keypair.json
npm run setup:token                                   # $TUNNEL mint + placeholder supply → operator (add -- --revoke to fix supply)
npm run setup:protocol                                # program derives the odds; prints the table (add -- --gatekeeper <pubkey> to require co-signing)
npm run setup:fund                                    # move the emissions reserve into the program vault
```
Addresses are recorded in `deployments/devnet.json` (public data only). Then run the keeper with a separate hot wallet (~2 devnet SOL for cycle rent and ORAO fees) and record a live proof:
```bash
cp .env.example .env    # DATABASE_URL, KEEPER_KEYPAIR, SOLANA_RPC_URL (a dedicated RPC is recommended)
npm run keeper          # health: http://localhost:8787/health
npx tsx scripts/e2e-run.ts   # writes docs/DEVNET_RUN.md with explorer links
```
Frontend: `app/.env.local` from `app/.env.example` (`NEXT_PUBLIC_CLUSTER=devnet`, `DATABASE_URL`, `SESSION_SECRET`, optional `GATEKEEPER_KEYPAIR`). Deploy to any Node host or Vercel (root `app`, build `npm run build -w app`; include the monorepo root for workspaces). The keeper must run on a persistent host (not serverless).

Admin operations: `npm run admin -- status | pause | unpause | set-gatekeeper <pk> | disable-gatekeeper | set-cycle-duration <s> | set-params '<json>'`, or the `/admin` console with the admin wallet.

## 3. MAINNET — prepared, disabled
**Do not execute without explicit owner authorization and a completed independent audit.** Guards:
* `Anchor.toml` has no `[programs.mainnet]` entry.
* Scripts identify the cluster by genesis hash and refuse mainnet unless `TUNNEL_MAINNET_AUTHORIZED=I_HAVE_OWNER_APPROVAL_AND_AN_INDEPENDENT_AUDIT` **and** `--confirm-mainnet`.
* The web app disables mining on mainnet unless `NEXT_PUBLIC_MAINNET_DEPOSITS_ENABLED=true`.

See `CHECKLIST.md` for the ordered steps.

## Monitoring
* Keeper: JSON logs (pino); `GET :8787/health` → 503 if the crank hasn't ticked in 60 s.
* App: `GET /api/health` → indexer lag (503 if > 60 s). `/admin` shows stuck cycles, failed crank transactions and unclaimed totals.
* Alert on: health 503; cycles in `closed`/`awaitingRandomness` > 5 min; `CycleVoided`; `ParamsUpdated`/`GatekeeperChanged`/`AdminAccepted`/`PauseChanged`; keeper SOL < 1; vault balance ≠ reserve + outstanding allocations.

## Recovery
| Situation | Action |
|---|---|
| Keeper down | Restart; it backfills from its cursor. Anyone can crank meanwhile. |
| ORAO delay | Wait; after the timeout the keeper voids the cycle (no rewards, budget returned). |
| RPC outage | Retries with backoff; switch `SOLANA_RPC_URL`. |
| DB loss | Restore, or start empty: backfill + reconciler rebuild everything from chain. |
| Suspected bug | `npm run admin -- pause` (stops new deployments only); claims keep working. |
