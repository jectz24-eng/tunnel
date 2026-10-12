# Randomness and verification

Each particle's outcome must be (a) unknowable to everyone, the server included,
while deployments are open, (b) impossible for the server to steer, and
(c) recomputable by anyone afterwards. TUNNEL combines a committed server seed
with a future Solana blockhash.

## Construction

At cycle open the engine:

* draws `seed` (32 bytes, `crypto.randomBytes`);
* publishes `seedCommitment = sha256("TUNNEL/seed-commit/v3" ‖ seed)`;
* publishes `entropySlot = currentSlot + ceil(cycleDuration / 400 ms) + 75`.

Deployments are refused once the cycle closes, and also when the chain's latest
slot is within 30 slots of `entropySlot` (in case slots run faster than 400 ms).

After close, once `entropySlot` is finalized, the engine takes the **first
produced block at or after `entropySlot`** (slots can be skipped) and computes

```
randomness = sha512("TUNNEL/cycle-randomness/v3" ‖ seed ‖ blockhash ‖ u64_le(cycleId))      (64 bytes)
draw(i)    = u64_le(sha256("TUNNEL/particle/v3" ‖ randomness ‖ u64_le(cycleId) ‖ wallet(32) ‖ barrier ‖ level ‖ u32_le(i))[0..8])
tunnels    ⇔ draw(i) < ⌊ppb · 2⁶⁴ / 10⁹⌋
```

`i` indexes the wallet's particles within one [barrier][level] cell, in
deployment order. The seed is revealed in the cycle record after settlement.

## Why it is fair

* **The server cannot steer outcomes.** The seed is fixed (committed) before
  any deployment. Changing it would break the published commitment.
* **Nobody can predict outcomes during deployment.** The blockhash does not
  exist until after deployments close. The server knows its seed, but without
  the blockhash it knows nothing about any draw.
* **Anyone can verify.** Check `sha256(domain ‖ seed) = seedCommitment`, fetch
  the block at `entropySlotUsed` from any Solana RPC or explorer, confirm it is
  the first produced block ≥ `entropySlot`, then recompute every particle and
  payout. `packages/sdk/src/verify.ts` does this; the cycle page runs it in the
  browser.

## Residual trust (stated plainly)

* **Withholding.** After the blockhash appears, the server knows every outcome
  before publishing. It cannot change them, but it could refuse to settle. The
  cycle would then void after `ENGINE_VOID_AFTER_MS`: no rewards, and the
  withholding would be visible publicly.
* **Insertion.** Deployment timestamps are recorded by the server. Each
  deployment carries a wallet signature over its cycle and issue time, and
  late deployments are refused by a database lock. But a malicious operator
  controlling a wallet could, in principle, insert records after the fact.
  The entropy-slot guard and the public activity log make this detectable, not
  impossible.
* **Validator influence.** The leader producing the entropy block could, in
  theory, choose to skip it. Doing so only moves to the next block and does
  not reveal the seed.

## Test vectors

`packages/sdk/test/fairness.test.ts`: seed = bytes 0..31, blockhash = 32 × 0x07,
cycle 42 → commitment `bd66390f…2605`, randomness `c60ef795…55ff`.
`packages/sdk/test/math.test.ts`: particle draw vector `7227306695852544847`.
