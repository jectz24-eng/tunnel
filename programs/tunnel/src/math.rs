//! Deterministic integer math for settlement. Mirrored exactly by
//! `packages/sdk/src/math.ts`; any change here must change there too.

use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;

use crate::constants::*;
use crate::errors::TunnelError;
use crate::state::ProtocolParams;

const FIXED_ONE: u128 = 1_000_000_000_000_000_000; // 1e18

/// Success threshold for a barrier: a particle tunnels iff its 64-bit draw is
/// strictly below this value. `floor(bps · 2^64 / 10^4)`; the deviation from
/// the exact probability is below 2^-64, so there is no modulo bias.
pub fn success_threshold(transmission_bps: u16) -> u64 {
    (((transmission_bps as u128) << 64) / BPS_DENOMINATOR as u128) as u64
}

/// The 64-bit draw for one particle:
/// `u64_le(sha256(DOMAIN ‖ randomness ‖ round_id_le ‖ owner ‖ barrier ‖ index_le)[0..8])`.
pub fn particle_draw(
    randomness: &[u8; 64],
    round_id: u64,
    owner: &Pubkey,
    barrier: u8,
    index: u32,
) -> u64 {
    let h = hashv(&[
        PARTICLE_DOMAIN,
        randomness,
        &round_id.to_le_bytes(),
        owner.as_ref(),
        &[barrier],
        &index.to_le_bytes(),
    ]);
    let mut b = [0u8; 8];
    b.copy_from_slice(&h.to_bytes()[..8]);
    u64::from_le_bytes(b)
}

/// Number of successes among `count` particles a position placed on `barrier`.
pub fn count_successes(
    randomness: &[u8; 64],
    round_id: u64,
    owner: &Pubkey,
    barrier: u8,
    count: u16,
    transmission_bps: u16,
) -> u16 {
    let threshold = success_threshold(transmission_bps);
    let mut n: u16 = 0;
    for i in 0..count as u32 {
        if particle_draw(randomness, round_id, owner, barrier, i) < threshold {
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

/// Scheduled emission for a round before the reserve cap:
/// `initial · (decay_bps / 10^4) ^ floor(round_id / epoch_rounds)`, in 1e18 fixed point.
pub fn scheduled_emission(params: &ProtocolParams, round_id: u64) -> u64 {
    let epoch = round_id / params.emission_epoch_rounds.max(1) as u64;
    let decay = params.emission_decay_bps as u128 * (FIXED_ONE / BPS_DENOMINATOR as u128);
    let factor = fixed_pow(decay, epoch);
    ((params.initial_emission_per_round as u128) * factor / FIXED_ONE) as u64
}

/// Splits a round's SOL pool into (protocol fee, distributable pool).
pub fn split_fee(total_lamports: u64, fee_bps: u16) -> Result<(u64, u64)> {
    let fee = mul_div(total_lamports, fee_bps as u64, BPS_DENOMINATOR)?;
    let distributable = total_lamports.checked_sub(fee).ok_or(TunnelError::MathOverflow)?;
    Ok((fee, distributable))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::BarrierParams;

    fn params() -> ProtocolParams {
        ProtocolParams {
            barriers: [
                BarrierParams { transmission_bps: 6500, reward_weight: 1 },
                BarrierParams { transmission_bps: 3000, reward_weight: 2 },
                BarrierParams { transmission_bps: 1000, reward_weight: 5 },
            ],
            particle_cost_lamports: 10_000_000,
            round_duration_secs: 60,
            protocol_fee_bps: 500,
            max_particles_per_position: 200,
            randomness_timeout_secs: 600,
            initial_emission_per_round: 416_000_000,
            emission_decay_bps: 9990,
            emission_epoch_rounds: 1440,
        }
    }

    #[test]
    fn threshold_bounds() {
        assert_eq!(success_threshold(0), 0);
        assert_eq!(success_threshold(5000), 1u64 << 63);
        assert!(success_threshold(9999) < u64::MAX);
    }

    #[test]
    fn empirical_rates_match_parameters() {
        let r = [7u8; 64];
        let owner = Pubkey::new_from_array([3u8; 32]);
        for (barrier, bps) in [(0u8, 6500u16), (1, 3000), (2, 1000)] {
            let mut hits = 0u32;
            let n = 20_000u32;
            for i in 0..n {
                if particle_draw(&r, 42, &owner, barrier, i) < success_threshold(bps) {
                    hits += 1;
                }
            }
            let rate = hits as f64 / n as f64;
            let expected = bps as f64 / 10_000.0;
            assert!((rate - expected).abs() < 0.015, "barrier {barrier}: {rate} vs {expected}");
        }
    }

    #[test]
    fn known_vector() {
        // Cross-checked by packages/sdk/test/math.test.ts ("matches the Rust known vector").
        let r = [1u8; 64];
        let owner = Pubkey::new_from_array([2u8; 32]);
        let d = particle_draw(&r, 7, &owner, 1, 3);
        assert_eq!(d, 2_211_064_809_742_104_174);
    }

    #[test]
    fn emission_decays() {
        let p = params();
        assert_eq!(scheduled_emission(&p, 0), 416_000_000);
        assert_eq!(scheduled_emission(&p, 1439), 416_000_000);
        assert_eq!(scheduled_emission(&p, 1440), 415_584_000);
        assert!(scheduled_emission(&p, 1440 * 5000) < scheduled_emission(&p, 1440 * 100));
        let mut zero = p;
        zero.emission_decay_bps = 0;
        assert_eq!(scheduled_emission(&zero, 1440), 0);
    }

    #[test]
    fn fee_split_conserves() {
        for total in [0u64, 1, 19, 10_000_000, 123_456_789_012, u64::MAX / 2] {
            let (fee, dist) = split_fee(total, 500).unwrap();
            assert_eq!(fee + dist, total);
        }
    }

    #[test]
    fn mul_div_handles_large_values() {
        assert_eq!(mul_div(u64::MAX, u64::MAX, u64::MAX).unwrap(), u64::MAX);
        assert!(mul_div(u64::MAX, 2, 1).is_err());
        assert!(mul_div(1, 1, 0).is_err());
    }
}
