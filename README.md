# TUNNEL ($TUNNEL)

**Mine through the impossible.** A quantum-inspired stochastic mining protocol on Solana: commit SOL to particles, aim them at an energy barrier, and every 60 seconds a round resolves with verifiable randomness. Particles that tunnel share 95% of the pool and the round's $TUNNEL emission.

> Devnet software. Not audited. Mainnet is prepared but disabled. Committing SOL can result in partial or total loss. TUNNEL does not use quantum hardware.

| | |
|---|---|
| Program (devnet) | `GyywTr1c6yTJPSxDiADUfawcpuQBQ6JPwMKaoC6WrhF9` |
| Randomness | ORAO VRF v2 (`VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y`) |
| Stack | Anchor 0.32.1 · Next.js 16 · React 19 · Tailwind 4 · Prisma 7 / PostgreSQL · Recharts · Motion |

## Layout
`programs/tunnel` (Anchor) · `packages/sdk` (TS client + math mirror + verification) · `packages/db` (Prisma) · `services/keeper` (indexer + crank) · `app` (website + API) · `scripts` · `tests` · `docs`

## Quick start (frontend + backend, no Solana toolchain needed)
```
npm install
npm run db:local                                    # terminal 1: local Postgres (PGlite)
npx --workspace packages/db prisma migrate deploy
npm run dev                                         # terminal 2: http://localhost:3000
npm test                                            # unit + property + DB tests
npm run test:e2e                                    # Playwright
```
Program build, tests and deployment: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Documentation
* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — components, accounts, math, flows, backend
* [docs/RANDOMNESS.md](docs/RANDOMNESS.md) — provider choice, trust assumptions, lifecycle, verification
* [docs/SECURITY.md](docs/SECURITY.md) — review, threat model, checklist, unresolved risks
* [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — local / devnet / mainnet, monitoring, recovery, backups
* `/docs` on the website — user-facing protocol documentation and risk disclosures
