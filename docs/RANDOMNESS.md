# Randomness

## Provider selection

| Option | Status (Oct 2026) | Fit |
|---|---|---|
| Switchboard On-Demand | **Shut down** (services ended 25 Sep 2026) | Not viable |
| MagicBlock VRF | Maintained; designed around Ephemeral Rollups (delegation + commit flows) | Unneeded complexity for a base-layer program |
| **ORAO VRF v2** | Maintained; `orao-solana-vrf 0.7.0` (Anchor 0.32.1); same program on devnet & mainnet | **Selected** — base-layer CPI, quorum-signed, onchain-verifiable |

Program: `VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y` (classic VRF v2).

## Trust assumptions
ORAO fulfillment authorities each produce an Ed25519 signature over the request seed. ORAO's program verifies them onchain and XOR-combines them once a Byzantine quorum responds; the 64-byte result is stored in the request account.

* Unpredictable to anyone without a quorum of authority keys.
* **Not fully trustless.** A colluding quorum learns the output once the seed exists and can *withhold* it. In TUNNEL, withholding fails the round with a full refund. It cannot redirect funds, but it gives a colluding participant a free option (risk R2 in `SECURITY.md`).

## Lifecycle
1. **Deposits close** (`close_ts` reached).
2. `close_round` (permissionless): `seed = sha256("TUNNEL/vrf-seed/v1" ‖ program_id ‖ round_pda ‖ round_id_le ‖ slot_le ‖ slot_hash)` from the **newest SlotHashes entry**, stored in the round → `Closed`.
3. `request_randomness` (permissionless, cranker pays ORAO fee): CPI `request_v2(seed)`; if the request account already exists (someone requested the seed directly), the CPI is skipped → `AwaitingRandomness`.
4. ORAO network fulfils (typically seconds on devnet/mainnet).
5. `reveal_randomness` (permissionless): checks PDA, ORAO ownership and `seed == round.vrf_seed`, copies 64 bytes → `Resolving`.

## Failure & timeout handling
* Timeout = `randomness_timeout_secs` snapshotted in the round (600 s at launch).
* `recover_round` → `Failed` (100% refunds, no fee, emission returned) if:
  `Open` with participants past `close_ts + timeout`, or `Closed` past `closed_ts + timeout`, or `AwaitingRandomness` past `requested_ts + timeout`, **and** the ORAO request is not fulfilled.
* A late fulfilment cannot revive a failed round (`reveal` requires `Closed|AwaitingRandomness`).

## Replay protection
One seed per round. The seed includes the round PDA and id and is checked against the account on reveal, so randomness cannot be reused across rounds. `reveal` can only run once (status transition).

## Randomness → outcome
```
draw(p, b, i) = u64_le(sha256("TUNNEL/particle/v1" ‖ randomness[64] ‖ u64_le(round_id) ‖ owner[32] ‖ u8(b) ‖ u32_le(i))[0..8])
tunnels       ⇔ draw < ⌊transmission_bps · 2⁶⁴ / 10_000⌋
```
No modulo: the uniform 64-bit draw is compared with a scaled threshold (error < 2⁻⁶⁴). Draws are independent per particle and deterministic, so anyone can reproduce them. Only the settled position's particles are hashed in each `settle_position`.

## Independent verification procedure
1. Read the Round account: `randomness`, `vrf_seed`, `barriers[]`, `id`.
2. Confirm the randomness at ORAO's request account `PDA(["orao-vrf-randomness-request", vrf_seed], ORAO)`.
3. For each position, from the Position account (unclaimed) or the `PositionSettled` event (claimed), recompute every draw with any SHA-256 implementation and count successes per barrier.
4. Check `successes`, `success_weight`, the round's `total_success_weight`, `fee = ⌊pool·fee_bps/10⁴⌋` and each `RewardClaimed` amount against the formulas in `docs/ARCHITECTURE.md`.

Reference implementations: `programs/tunnel/src/math.rs`, `packages/sdk/src/math.ts` (`verifyRound` in `verify.ts`). The web app runs this in the browser at `/rounds/<id>`.
