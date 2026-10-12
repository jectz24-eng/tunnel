# $TUNNEL — Quantum Tunneling Protocol

**Mine through the impossible.** Deploy particles. Defy energy barriers. Discover what makes it through.

Every cycle, each Solana wallet gets a free particle-energy allowance. Spend it deploying particles against low, medium or high potential barriers. Each **tunneling probability comes from rectangular-barrier physics**. A **provably fair draw** (server seed committed in advance + a future Solana blockhash) decides every particle. Particles that tunnel earn real **$TUNNEL (SPL)** from a fixed, pre-funded reserve, capped per cycle.

Playing is free: deploying and claiming are signed messages, not transactions. When you claim, TUNNEL sends your tokens and pays the network fee.

> **Not audited.** The game runs on the TUNNEL server (no smart contract); see the trust model in [docs/SECURITY.md](docs/SECURITY.md). Rewards are probabilistic and limited, and $TUNNEL has no guaranteed value. This is not quantum computing and not proof-of-work mining.

| | |
|---|---|
| Stack | Next.js 16 · React 19 · three.js / React Three Fiber · Motion · Tailwind 4 · Prisma 7 / PostgreSQL · Node engine · Solana SPL |
| Hosting | Render (web + engine worker + Postgres), `render.yaml` |

## Layout
* `packages/sdk`: physics, odds, draws, fairness, signed-message formats, verification (shared by server and browser).
* `packages/core`: protocol rules (deploy, cycles, settlement, claims), on PostgreSQL transactions.
* `packages/db`: Prisma schema and migrations.
* `services/engine`: cycle loop, entropy, exactly-once SPL payouts. The only key holder.
* `app`: the site and API. Home, Accelerator, Laboratory, How it works, Leaderboard, Tokenomics, History with in-browser verification, profiles, admin.
* `scripts`: token, reward wallet, reserve funding, admin CLI, local bootstrap.

## Quick start
```bash
npm install
npm test            # SDK + core + engine (real Postgres) + app
npm run test:e2e    # Playwright
```
Full local stack and Render mainnet deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation
* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): components, data model, cycle flow
* [docs/RANDOMNESS.md](docs/RANDOMNESS.md): fairness construction, verification, residual trust
* [docs/SECURITY.md](docs/SECURITY.md): trust model, keys, review, risk register
* [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): local, Render/mainnet, operations, recovery
* [docs/CHECKLIST.md](docs/CHECKLIST.md): launch checklist
* [docs/LOCALNET_RUN.md](docs/LOCALNET_RUN.md): recorded end-to-end run with a real payout
