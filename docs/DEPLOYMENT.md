# Deployment guide (v3: Node server + Render, no smart contract)

> Never commit keys. `.gitignore` excludes `.env*`, `*.keypair.json`, `id.json` and `keys/`.

## 1. Local full stack

Needs Node 22. A local Solana validator needs Linux/WSL (`bash scripts/setup-wsl.sh` installs the CLI).

```bash
npm install
bash scripts/local-validator.sh --reset                 # WSL: plain validator on :8899 (no programs)
npm run db:local                                        # Postgres (PGlite) on :5432
npm run db:migrate
SOLANA_RPC_URL=http://127.0.0.1:8899 npx tsx scripts/local-setup.ts --cycle-secs 90
#   → prints REWARD_WALLET_KEYPAIR and TUNNEL_MINT for the engine
REWARD_WALLET_KEYPAIR=keys/localnet-reward-wallet.json TUNNEL_MINT=<mint> SOLANA_RPC_URL=http://127.0.0.1:8899 npm run engine
npm run dev                                             # http://localhost:3000
```

`app/.env.local` for localnet:
```
NEXT_PUBLIC_CLUSTER=localnet
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
ADMIN_WALLETS=<your wallet>
NEXT_PUBLIC_LOCAL_TEST_WALLET=true      # optional in-browser burner wallet (localnet only)
```

Tests: `npm test` (SDK, core and engine against real Postgres, app) and `npm run test:e2e` (Playwright).

### Presenting the local stack

* Start the validator **with `--reset`** every time. A test validator resumed from an old ledger can stop landing transactions (airdrops and payouts hang). Because a reset wipes the token, also delete `.pgdata/` and `deployments/localnet.json`, then rerun `db:migrate` and `local-setup.ts`.
* `--cycle-secs 60` gives a full deploy → settle → reveal → claim loop in about 1½ minutes. The engine measures the chain's real slot speed, so results arrive about 30 s after a cycle closes.
* With `NEXT_PUBLIC_LOCAL_TEST_WALLET=true`, choose **Local Test Wallet** in the connect dialog; no browser extension is needed.

## 2. Mainnet on Render

What you need: a GitHub repo with this code, a Render account, a mainnet RPC
URL (Helius/Triton/QuickNode), your admin wallet address, and the token numbers
(total supply, mining reserve).

### 2.1 Token and reward wallet (on your machine)

```bash
# Operator wallet: holds the supply. Fund it with ~0.1 SOL. Keep it offline afterwards.
solana-keygen new -o ~/.config/solana/id.json
export SOLANA_RPC_URL=<mainnet RPC>

npm run setup:token -- --supply <TOTAL_SUPPLY> --confirm-mainnet           # creates the mint (6 decimals)
npm run setup:reward-wallet -- --out ~/.config/tunnel/reward-wallet.json   # prints its address
# Send ~0.05–0.2 SOL to the reward wallet for transfer fees (≈ 0.000085 SOL per payout incl. priority fee;
# ≈ 0.002 SOL extra when a winner has no $TUNNEL account yet).
```

Every script refuses to run against mainnet without `--confirm-mainnet`.

### 2.2 Render

1. Render → **New → Blueprint** → select the repo. It creates `tunnel-db`, `tunnel-web`, `tunnel-engine` from `render.yaml`.
2. `tunnel-web` env: `NEXT_PUBLIC_RPC_URL` (your RPC), `ADMIN_WALLETS` (your wallet).
3. `tunnel-engine` env: `SOLANA_RPC_URL`, `TUNNEL_MINT`. **Secret Files** → add `reward-wallet.json` with the file's contents.
4. Deploy. Migrations run before the web service starts. `/api/health` should show `db: up`, `engineOnline: true`, `paused: true`.

### 2.3 Fund and launch

```bash
DATABASE_URL=<Render external DB URL> npm run setup:fund -- --reward-wallet <REWARD_WALLET> --amount <RESERVE> --confirm-mainnet
```

This transfers the reserve on-chain and records it so cycles can budget it.
Then sign in at `/admin` with your wallet and press **Resume mining**, or run
`npm run admin -- resume`. Optional: `npm run setup:token -- … --revoke` was not run above;
revoke the mint authority when the supply is final.

## 3. Operations

* `/admin`: engine status, reward wallet $TUNNEL/SOL, unallocated reserve, payout queue, failed payouts, audit log; pause/resume, cycle length, emission.
* `npm run admin -- status | pause | resume | cycle-secs <s> | emission <tokens>`.
* Alerts to set up: `/api/health` 503 or `engineOnline: false`; reward wallet SOL < 0.02; payouts `sending` > 5 min; any `CycleVoided`.

## 4. Recovery

| Situation | Action |
|---|---|
| Engine down | Restart. It resumes: closes overdue cycles, settles from the entropy block (still on chain), re-checks in-flight payouts. |
| RPC outage | Switch `SOLANA_RPC_URL`; closed cycles settle once the block is readable; after 1 h they void. |
| Reward wallet low on SOL / tokens | Payouts wait (nothing fails). Top up; they resume automatically. |
| Payout above cap | Waits in the queue; raise `ENGINE_MAX_PAYOUT_TOKENS` after review. |
| Suspected bug | Pause mining. Claims and payouts continue. |
| Database loss | Restore Render backup. Owed rewards live only in the database: backups are essential. |
