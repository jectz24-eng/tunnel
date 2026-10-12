# Recorded localnet run (v3, server engine)

Date: 2026-10-12. Local `solana-test-validator` (no programs loaded), PGlite
Postgres, `tunnel-engine`, the Next.js app, and the real accelerator UI driven
by Playwright with the localnet test wallet (`app/flow.tmp.mjs`).

| Step | Result |
|---|---|
| Bootstrap (`scripts/local-setup.ts --cycle-secs 90`) | mint `24thyRs6aQnYbJyWDu4LP2y8PjfwAQ1vFDkYMQKrCqW7`; 600,000,000 placeholder reserve moved to reward wallet `FBuhTNfCZTQmMokSppgLPKcwAu8kMSJsimSgp3LZm1h1` and recorded |
| Cycle 7 opened | 04:05:52; budget 20,000 $TUNNEL; commitment `c1d8b9f9…5152`; entropy slot 1549 |
| Deployment (signed message, no transaction) | wallet `5U4P…Jobts`, LOW barrier, E5, 20 particles, p = 78.92% |
| Close | 04:07:22 (window end) |
| Entropy block | slot 1549 produced 04:09:44 (after close), hash `GuPY1QHqwxAGYai7c9nXn615jtufFRFP822kkGsWNXmB` |
| Settlement | 04:10:09; 20 / 20 tunneled; nominal = allocated = 120.37378 $TUNNEL; seed revealed `775dd873…880e` |
| Browser verification | "Verified in your browser" (commitment, randomness, outcomes, payout) |
| Claim (signed message) → payout | 04:10:22 requested; SPL transfer `Mjsn2Ef3Czo538Vs9JimY5RHjQq6zNx6rAP2y4GmZ7jKrCJWXBsHS8nkqrRcKJcqyG6ZHgnvFQFQjoYFptRFJ2V` confirmed 04:10:27; wallet token balance 120.37378 |

Independent recheck (`.scratch/check7.ts`): the seed hashes to the published
commitment; block 1549 exists with that hash; the randomness and all 20 draws
recompute exactly. 20/20 at p = 0.789 has probability ≈ 0.9%. The same draw
function over 4,000 synthetic particles gives 78.6%, matching the model.
