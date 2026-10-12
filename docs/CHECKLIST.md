# Launch checklist

✅ done and verified in this repo · ⬜ to do · ⛔ needs the owner or an external party

## Software
- ✅ SDK tests: physics, draws, emissions, payouts, fairness vectors, base58 (26)
- ✅ Core tests on real PostgreSQL: signed deploys, energy limits under concurrency, replay/forgery/staleness/closed/paused rejection, early close guard, verifiable settlement, reserve cap, void, claims, double-claim, failed payout release (13)
- ✅ Engine tests: cycle loop, entropy wait with skipped slots, void, exactly-once payouts (send → confirm / fail / expire → re-sign), safety cap (7)
- ✅ App unit tests (15) and Playwright site tests, desktop + mobile (33)
- ✅ Full localnet run with a real SPL payout: `docs/LOCALNET_RUN.md`
- ✅ No keys in the web app or repository; the engine is the only key holder
- ⛔ Independent security review of `packages/core` and `services/engine`

## Token
- ⛔ Final total supply and mining reserve from the owner
- ⬜ Mint created on mainnet; supply minted to the operator wallet
- ⬜ Mint authority revoked once supply is final
- ⬜ Reserve transferred to the reward wallet **and recorded** (`setup:fund`)

## Infrastructure
- ⬜ GitHub repo, Render Blueprint deployed (web, engine, Postgres)
- ⬜ Dedicated mainnet RPC
- ⬜ `ADMIN_WALLETS`, `TUNNEL_MINT`, `reward-wallet.json` secret file set
- ⬜ Reward wallet has SOL for fees; alerts configured
- ⬜ Render Postgres backups enabled (owed rewards live in the database)

## Launch
- ⬜ `/api/health`: db up, engine online, paused
- ⬜ Resume mining from `/admin`; watch the first cycles settle and the first payout confirm
- ⛔ Legal review of token distribution in target jurisdictions; owner sign-off on risk copy
