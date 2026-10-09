# Deployment guide

Environments: **LOCAL** (localnet validator + local Postgres), **DEVNET** (public devnet, real ORAO), **MAINNET** (prepared, disabled).

> Never commit keys. `.gitignore` excludes `.env*`, `*.keypair.json`, `id.json`, `keys/` and `target/` (which holds `target/deploy/tunnel-keypair.json`, the program-address keypair — back it up securely).

## 0. Toolchain (Windows → WSL2)
Anchor is not supported on native Windows. In an **administrator** PowerShell:
```
wsl --install -d Ubuntu
```
Reboot, open Ubuntu, then from the repo (`cd /mnt/c/Users/<you>/tunnel`):
```
bash scripts/setup-wsl.sh
npm ci
```
Pinned: Solana/Agave 2.3.0, Anchor 0.32.1, Node 22.

## 1. LOCAL
```
cargo test -p tunnel                 # Rust unit tests (math)
anchor build && npm run idl:sync     # compile; verify + install the compiler IDL
anchor test                          # localnet suite (clones ORAO VRF from devnet)
npm test                             # SDK, keeper (incl. real-Postgres tests), app unit tests
npm run db:local                     # zero-install Postgres (PGlite) on :5432
npx --workspace packages/db prisma migrate deploy
npm run dev                          # http://localhost:3000 (set NEXT_PUBLIC_CLUSTER=localnet)
npm run test:e2e                     # Playwright (desktop + mobile)
```

## 2. DEVNET
```
solana config set --url devnet
solana airdrop 5                                  # or https://faucet.solana.com
anchor deploy --provider.cluster devnet           # deploys GyywTr1c…WrhF9 from target/deploy/tunnel-keypair.json
npm run setup:token                               # $TUNNEL mint + 1B supply → operator (add -- --revoke to fix supply)
npm run setup:protocol -- --treasury <TREASURY_PUBKEY>
npm run setup:fund                                # move 600M into the program reward vault
```
Addresses are recorded in `deployments/devnet.json` (public data only).

Keeper (indexer + crank):
```
cp .env.example .env    # set DATABASE_URL, KEEPER_KEYPAIR (a separate hot wallet with ~2 devnet SOL)
npm run keeper          # health: http://localhost:8787/health
```
Integration proof with real transactions:
```
npx tsx scripts/e2e-run.ts      # writes docs/DEVNET_RUN.md with explorer links
```
Frontend: `app/.env.local` from `app/.env.example` (`NEXT_PUBLIC_CLUSTER=devnet`, `DATABASE_URL`, `SESSION_SECRET`). Deploy to any Node host or Vercel (root `app`, build `npm run build -w app`; the monorepo root must be included for workspaces).

## 3. MAINNET — prepared, disabled
**Do not execute without explicit owner authorization and a completed independent audit.**

Built-in guards:
* `Anchor.toml` has no `[programs.mainnet]` entry.
* Every script identifies the cluster by **genesis hash** and refuses mainnet unless `TUNNEL_MAINNET_AUTHORIZED=I_HAVE_OWNER_APPROVAL_AND_AN_INDEPENDENT_AUDIT` **and** `--confirm-mainnet` are both present.
* The web app disables deposits on mainnet unless `NEXT_PUBLIC_MAINNET_DEPOSITS_ENABLED=true`.

Operator checklist (in order):
1. External audit complete; findings resolved; audited commit hash recorded.
2. Legal sign-off for target jurisdictions.
3. Fresh mainnet program keypair; `declare_id!`, `Anchor.toml`, `packages/sdk/src/program-id.json` updated; rebuild; `npm run idl:sync`.
4. Verifiable build (`anchor build --verifiable`) and published hash.
5. Admin, treasury and **upgrade authority** set to Squads multisigs (`solana program set-upgrade-authority`); timelock policy documented.
6. Token: mint created, supply minted, mint authority revoked; final tokenomics approved for the 400M.
7. Initialize with reviewed `ProtocolParams`; fund reserve; verify `reserve_available`.
8. Keeper on dedicated infra with a dedicated RPC (Helius/Triton/QuickNode), alerting enabled.
9. Soft launch: low per-position cap via `update_params`, monitor, then raise.

## Monitoring & error logging
* Keeper: structured JSON logs (pino); `GET :8787/health` returns 503 if the crank hasn't ticked in 60 s.
* App: `GET /api/health` returns indexer lag (503 if > 60 s).
* `KeeperAction` table: every crank attempt with status and error.
* Alert on: health 503; any round `Closed/AwaitingRandomness` > 2 min; `RoundFailed`; `TreasuryChanged`/`ParamsUpdated`/`AdminAccepted` events; keeper SOL balance < 1 SOL; treasury-vault growth stalls while rounds settle.

## Recovery procedures
| Situation | Action |
|---|---|
| Keeper down | Restart; it backfills from its cursor. Any other operator can crank in the meantime (all permissionless). |
| ORAO delay | Wait; after the timeout the planner calls `recover_round` (full refunds). |
| RPC outage | Retries with backoff; switch `SOLANA_RPC_URL`. No state is lost. |
| DB loss | Restore backup or start empty: the backfill rebuilds events from chain and the reconciler rebuilds rounds/positions/aggregates. |
| Suspected bug | `npm run admin -- pause` (stops new deposits only); investigate; claims/refunds keep working. |

## Backups
* PostgreSQL: daily logical dumps (`pg_dump -Fc`) + PITR on the managed provider; the DB is fully reconstructible from chain, so backups are an availability measure.
* Keys: program keypair, admin/treasury multisig signers, keeper hot wallet — offline, encrypted backups; never on the app server.
