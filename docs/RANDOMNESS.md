# Randomness

## Provider
| Option | Status (Oct 2026) | Fit |
|---|---|---|
| Switchboard On-Demand | Shut down (25 Sep 2026) | Not viable |
| MagicBlock VRF | Maintained; built around Ephemeral Rollups | Unneeded complexity |
| **ORAO VRF v2** | Maintained; `orao-solana-vrf 0.7.0`; same program on devnet & mainnet | **Selected** |

Program: `VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y`.

There is no `Math.random()` anywhere in settlement. Decorative animations in the web app use local randomness and are labelled as visual effects.

## Trust assumptions
ORAO authorities sign the seed (Ed25519); ORAO's program verifies the signatures onchain and combines them once a quorum responds.
* Unpredictable to anyone without a quorum of authority keys.
* **Not fully trustless**: a colluding quorum learns the output once the seed exists and can withhold it. In TUNNEL v2 withholding leads to `void_cycle` after the timeout: nobody earns, the budget returns to the reserve. There are no stakes to refund.

## Lifecycle
1. Deployment window closes (`close_ts`).
2. `close_cycle` (permissionless): `seed = sha256("TUNNEL/vrf-seed/v2" ‖ program_id ‖ cycle_pda ‖ cycle_id ‖ slot ‖ slot_hash)` from the newest SlotHashes entry.
3. `request_randomness` (permissionless; cranker pays ORAO's fee). If the request already exists, no CPI.
4. ORAO fulfils (seconds on devnet; `scripts/local-vrf-fulfiller.ts` plays the network on localnet using the real ORAO program).
5. `reveal_randomness` copies the 64 bytes after checking PDA, owner and seed.

Timeout (`randomness_timeout_secs`, 900 s at launch): `void_cycle` from `Open` (with participants) / `Closed` / `AwaitingRandomness`, refused while fulfilled randomness exists.

## Randomness → outcome
```
draw(i) = u64_le(sha256("TUNNEL/particle/v2" ‖ randomness[64] ‖ cycle_id_le ‖ owner[32] ‖ barrier ‖ level ‖ u32_le(i))[0..8])
tunnels ⇔ draw < ⌊ppb · 2⁶⁴ / 10⁹⌋
```
`i` runs over the particles a wallet placed in that [barrier][level] cell, in deployment order; experiment *k* covers `first_index .. first_index + count` (emitted in `ParticlesDeployed`).

## Verifying yourself
1. Read the Cycle account: `randomness`, `vrf_seed`, `odds`, `barriers`, `levels`, `id`.
2. Confirm the randomness at ORAO's request PDA `["orao-vrf-randomness-request", vrf_seed]`.
3. Recompute every odds entry from the barrier physics (`verifyOdds`) and every draw (`particleOutcomes`) and compare with Position accounts (or `PositionSettled` events for claimed ones).
4. Check payouts with `computePayout`.

The website does this in the browser on `/history/cycle/<id>` and `/history/<cycle>/<wallet>/<seq>`.
