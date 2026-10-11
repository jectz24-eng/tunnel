# $TUNNEL — Quantum Tunneling Protocol

**Mine through the impossible.** Deploy particles. Defy energy barriers. Discover what makes it through.

Every 10 minutes, each Solana wallet receives a free particle-energy allowance. Spend it deploying particles against low, medium or high potential barriers. The **program derives each tunneling probability from the rectangular-barrier physics**, **ORAO VRF** randomness decides every particle, and particles that tunnel earn $TUNNEL from a **fixed, pre-funded emissions reserve** with a per-cycle cap.

> Devnet/localnet software. **Not audited.** Mainnet is prepared but disabled. Mining charges no protocol fees; rewards are probabilistic and limited, and $TUNNEL has no guaranteed value. This is not quantum computing and not proof-of-work mining.

| | |
|---|---|
| Program | `GyywTr1c6yTJPSxDiADUfawcpuQBQ6JPwMKaoC6WrhF9` |
| Randomness | ORAO VRF v2 (`VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y`) |
| Stack | Anchor 0.32.1 · Next.js 16 · React 19 · three.js / React Three Fiber · Motion · Tailwind 4 · Prisma 7 / PostgreSQL |

## What's in the box
* **Program** (`programs/tunnel`): cycles, energy allowance, physics-derived odds (`physics.rs`), calibrated rewards, capped emissions, ORAO VRF settlement, claims, pause / gatekeeper / two-step admin.
* **SDK** (`packages/sdk`): instruction builders, decoders, exact math mirror, physics + exact wavefunction solver, in-browser verification.
* **Keeper** (`services/keeper`): permissionless crank, event indexer, reconciler (experiment outcomes, streaks, leaderboards).
* **Web app** (`app`): cinematic home with a WebGL accelerator, the Accelerator (configure → deploy → settlement-gated reveal cinematic → claim), Laboratory, How it works, Leaderboard, Tokenomics, History with per-cycle and per-experiment verification, wallet profiles, and an admin console. Procedural sound (off by default).

## Quick start (local full stack)
See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) §1** — validator (WSL), local Postgres, bootstrap, VRF fulfiller, keeper, `npm run dev`. With `NEXT_PUBLIC_LOCAL_TEST_WALLET=true` on localnet you can play without a browser wallet.

```bash
npm install
npm test            # SDK + keeper (real Postgres) + app unit tests
npm run test:e2e    # Playwright
```

## Documentation
* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — components, accounts, math, flows, database
* [docs/RANDOMNESS.md](docs/RANDOMNESS.md) — provider, trust assumptions, lifecycle, verification
* [docs/SECURITY.md](docs/SECURITY.md) — internal review, threat model, risk register
* [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — local / devnet / mainnet, monitoring, recovery
* [docs/CHECKLIST.md](docs/CHECKLIST.md) — deployment-readiness checklist
* [docs/LOCALNET_RUN.md](docs/LOCALNET_RUN.md) — recorded end-to-end run with transactions
