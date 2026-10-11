//! Deterministic integer math for odds, outcomes and payouts. Mirrored
//! exactly by `packages/sdk/src/math.ts`; any change here must change there too.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::constants::*;
use crate::errors::TunnelError;
use crate::physics;
use crate::state::{Cycle, OddsTable, Position, ProtocolParams};

const FIXED_ONE: u128 = 1_000_000_000_000_000_000; // 1e18

/// A particle tunnels iff its 64-bit draw is strictly below this value:
/// `floor(ppb · 2^64 / 10^9)`. Deviation from the exact probability is below
/// 2^-64, so there is no modulo bias.
pub fn success_threshold(transmission_ppb: u32) -> u64 {
    (((transmission_ppb as u128) << 64) / PPB as u128) as u64
}

/// The 64-bit draw for one particle:
/// `u64_le(sha256(DOMAIN ‖ randomness ‖ cycle_id_le ‖ owner ‖ barrier ‖ level ‖ index_le)[0..8])`.
pub fn particle_draw(
    randomness: &[u8; 64],
    cycle_id: u64,
    owner: &Pubkey,
    barrier: u8,
    level: u8,
    index: u32,
) -> u64 {
    let h = hashv(&[
        PARTICLE_DOMAIN,
        randomness,
        &cycle_id.to_le_bytes(),
        owner.as_ref(),
        &[barrier, level],
        &index.to_le_bytes(),
    ]);
    let mut b = [0u8; 8];
    b.copy_from_slice(&h.to_bytes()[..8]);
    u64::from_le_bytes(b)
}

/// Successes among the `count` particles a position placed in one cell.
pub fn count_successes(
    randomness: &[u8; 64],
    cycle_id: u64,
    owner: &Pubkey,
    barrier: u8,
    level: u8,
    count: u16,
    transmission_ppb: u32,
) -> u16 {
    let threshold = success_threshold(transmission_ppb);
    let mut n: u16 = 0;
    for i in 0..count as u32 {
        if particle_draw(randomness, cycle_id, owner, barrier, level, i) < threshold {
            n += 1;
        }
    }
    n
}

/// `floor(amount · num / den)` without intermediate overflow.
pub fn mul_div(amount: u64, num: u64, den: u64) -> Result<u64> {
    require!(den != 0, TunnelError::MathOverflow);
    let v = (amount as u128)
        .checked_mul(num as u128)
        .ok_or(TunnelError::MathOverflow)?
        / den as u128;
    u64::try_from(v).map_err(|_| error!(TunnelError::MathOverflow))
}

/// Nominal reward for one successful particle, calibrated so that the
/// expected reward per energy unit is `reward_per_energy × premium` at any
/// energy level:
/// `floor(reward_per_energy · cost · premium_bps · 10^9 / (10^4 · ppb))`.
pub fn nominal_reward(reward_per_energy: u64, cost: u16, premium_bps: u16, transmission_ppb: u32) -> Result<u64> {
    require!(transmission_ppb > 0, TunnelError::InvalidParams);
    let num = (reward_per_energy as u128)
        .checked_mul(cost as u128)
        .and_then(|v| v.checked_mul(premium_bps as u128))
        .and_then(|v| v.checked_mul(PPB as u128))
        .ok_or(TunnelError::MathOverflow)?;
    let den = BPS_DENOMINATOR as u128 * transmission_ppb as u128;
    u64::try_from(num / den).map_err(|_| error!(TunnelError::MathOverflow))
}

/// Derives the odds table from physical barrier parameters. The only place
/// probabilities come from.
pub fn derive_odds(params: &ProtocolParams) -> Result<OddsTable> {
    let mut odds = OddsTable {
        transmission_ppb: [[0; ENERGY_LEVELS]; BARRIER_COUNT],
        reward: [[0; ENERGY_LEVELS]; BARRIER_COUNT],
    };
    for (b, barrier) in params.barriers.iter().enumerate() {
        for (l, level) in params.levels.iter().enumerate() {
            let ppb = physics::transmission_ppb(barrier.height_milli, barrier.width_milli, level.energy_bps)
                .ok_or(TunnelError::InvalidParams)?;
            odds.transmission_ppb[b][l] = ppb;
            odds.reward[b][l] =
                nominal_reward(params.reward_per_energy, level.cost, barrier.reward_premium_bps, ppb)?;
        }
    }
    Ok(odds)
}

fn fixed_pow(base: u128, mut exp: u64) -> u128 {
    let mut result = FIXED_ONE;
    let mut b = base;
    while exp > 0 {
        if exp & 1 == 1 {
            result = result * b / FIXED_ONE;
        }
        exp >>= 1;
        if exp > 0 {
            b = b * b / FIXED_ONE;
        }
        if result == 0 {
            break;
        }
    }
    result
}

/// Scheduled emission for a cycle before the reserve cap:
/// `initial · (decay_bps / 10^4) ^ floor(cycle_id / epoch_cycles)`, in 1e18 fixed point.
pub fn scheduled_emission(params: &ProtocolParams, cycle_id: u64) -> u64 {
    let epoch = cycle_id / params.emission_epoch_cycles.max(1) as u64;
    let decay = params.emission_decay_bps as u128 * (FIXED_ONE / BPS_DENOMINATOR as u128);
    let factor = fixed_pow(decay, epoch);
    ((params.initial_emission_per_cycle as u128) * factor / FIXED_ONE) as u64
}

/// $TUNNEL a settled position can claim. Nominal rewards are paid in full
/// while the cycle's total stays within its emission budget; otherwise every
/// position is scaled down pro rata so the cycle never exceeds its budget.
pub fn compute_payout(cycle: &Cycle, position: &Position) -> Result<u64> {
    if cycle.outcome != crate::state::CycleOutcome::Rewards || position.nominal_reward == 0 {
        return Ok(0);
    }
    if cycle.total_nominal <= cycle.emission_budget {
        Ok(position.nominal_reward)
    } else {
        mul_div(cycle.emission_budget, position.nominal_reward, cycle.total_nominal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{BarrierConfig, EnergyLevel};

    pub fn params() -> ProtocolParams {
        ProtocolParams {
            barriers: [
                BarrierConfig { height_milli: 1_000, width_milli: 900, reward_premium_bps: 9_500 },
                BarrierConfig { height_milli: 2_000, width_milli: 1_300, reward_premium_bps: 10_000 },
                BarrierConfig { height_milli: 4_000, width_milli: 1_500, reward_premium_bps: 10_500 },
            ],
            levels: [
                EnergyLevel { energy_bps: 2_000, cost: 1 },
                EnergyLevel { energy_bps: 3_500, cost: 2 },
                EnergyLevel { energy_bps: 5_000, cost: 3 },
                EnergyLevel { energy_bps: 6_500, cost: 4 },
                EnergyLevel { energy_bps: 8_000, cost: 5 },
            ],
            energy_per_cycle: 100,
            reward_per_energy: 1_000_000,
            cycle_duration_secs: 600,
            randomness_timeout_secs: 900,
            initial_emission_per_cycle: 20_000_000_000,
            emission_decay_bps: 9_950,
            emission_epoch_cycles: 144,
        }
    }

    #[test]
    fn threshold_bounds() {
        assert_eq!(success_threshold(0), 0);
        assert_eq!(success_threshold(500_000_000), 1u64 << 63);
        assert!(success_threshold(999_999_999) < u64::MAX);
    }

    #[test]
    fn empirical_rates_match_odds() {
        let r = [7u8; 64];
        let owner = Pubkey::new_from_array([3u8; 32]);
        for (barrier, ppb) in [(0u8, 650_000_000u32), (1, 300_000_000), (2, 20_000_000)] {
            let n = 40_000u32;
            let hits = (0..n).filter(|&i| particle_draw(&r, 42, &owner, barrier, 1, i) < success_threshold(ppb)).count();
            let rate = hits as f64 / n as f64;
            let expected = ppb as f64 / 1e9;
            assert!((rate - expected).abs() < 0.012, "barrier {barrier}: {rate} vs {expected}");
        }
    }

    #[test]
    fn draws_depend_on_every_input() {
        let r = [1u8; 64];
        let o = Pubkey::new_from_array([2u8; 32]);
        let base = particle_draw(&r, 7, &o, 1, 2, 3);
        assert_ne!(base, particle_draw(&[9u8; 64], 7, &o, 1, 2, 3));
        assert_ne!(base, particle_draw(&r, 8, &o, 1, 2, 3));
        assert_ne!(base, particle_draw(&r, 7, &Pubkey::new_from_array([4u8; 32]), 1, 2, 3));
        assert_ne!(base, particle_draw(&r, 7, &o, 0, 2, 3));
        assert_ne!(base, particle_draw(&r, 7, &o, 1, 3, 3));
        assert_ne!(base, particle_draw(&r, 7, &o, 1, 2, 4));
    }

    #[test]
    fn known_vector() {
        // Cross-checked by packages/sdk/test/math.test.ts and an independent Python hashlib computation.
        let r = [1u8; 64];
        let owner = Pubkey::new_from_array([2u8; 32]);
        let d = particle_draw(&r, 7, &owner, 1, 2, 3);
        assert_eq!(d, KNOWN_DRAW);
    }
    const KNOWN_DRAW: u64 = 5_097_536_720_253_246_649;

    #[test]
    fn odds_follow_physics_and_rewards_are_calibrated() {
        let p = params();
        let odds = derive_odds(&p).unwrap();
        for b in 0..BARRIER_COUNT {
            for l in 1..ENERGY_LEVELS {
                // More energy → higher probability; higher barrier → lower probability.
                assert!(odds.transmission_ppb[b][l] > odds.transmission_ppb[b][l - 1]);
            }
        }
        for l in 0..ENERGY_LEVELS {
            assert!(odds.transmission_ppb[0][l] > odds.transmission_ppb[1][l]);
            assert!(odds.transmission_ppb[1][l] > odds.transmission_ppb[2][l]);
        }
        // Expected reward per energy unit ≈ reward_per_energy × premium.
        for b in 0..BARRIER_COUNT {
            for l in 0..ENERGY_LEVELS {
                let ev = odds.reward[b][l] as f64 * odds.transmission_ppb[b][l] as f64 / 1e9 / p.levels[l].cost as f64;
                let target = p.reward_per_energy as f64 * p.barriers[b].reward_premium_bps as f64 / 1e4;
                assert!((ev - target).abs() / target < 1e-6, "b{b} l{l}: {ev} vs {target}");
            }
        }
    }

    #[test]
    fn invalid_physics_is_rejected() {
        let mut p = params();
        p.barriers[2] = BarrierConfig { height_milli: 20_000, width_milli: 5_000, reward_premium_bps: 10_000 };
        assert!(derive_odds(&p).is_err());
    }

    #[test]
    fn emission_decays() {
        let p = params();
        assert_eq!(scheduled_emission(&p, 0), 20_000_000_000);
        assert_eq!(scheduled_emission(&p, 143), 20_000_000_000);
        assert_eq!(scheduled_emission(&p, 144), 19_900_000_000);
        assert!(scheduled_emission(&p, 144 * 5000) < scheduled_emission(&p, 144 * 100));
        let mut zero = p;
        zero.emission_decay_bps = 0;
        assert_eq!(scheduled_emission(&zero, 144), 0);
    }

    #[test]
    fn mul_div_handles_large_values() {
        assert_eq!(mul_div(u64::MAX, u64::MAX, u64::MAX).unwrap(), u64::MAX);
        assert!(mul_div(u64::MAX, 2, 1).is_err());
        assert!(mul_div(1, 1, 0).is_err());
    }
}
