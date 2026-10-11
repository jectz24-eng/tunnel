use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::TunnelError;

/// One rectangular potential barrier. Values are thousandths of the
/// normalized units in which ħ²/2m = 1 (for an electron: 1 length unit = 1 Å,
/// 1 energy unit ≈ 3.81 eV).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct BarrierConfig {
    /// Barrier height V₀ × 1000.
    pub height_milli: u32,
    /// Barrier width a × 1000.
    pub width_milli: u32,
    /// Expected reward per energy unit relative to par (10000 = par).
    pub reward_premium_bps: u16,
}

/// A particle energy setting a user can choose.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct EnergyLevel {
    /// Particle energy E as a fraction of the barrier height (bps of V₀).
    pub energy_bps: u16,
    /// Energy units drawn from the wallet's per-cycle allowance per particle.
    pub cost: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct ProtocolParams {
    pub barriers: [BarrierConfig; BARRIER_COUNT],
    pub levels: [EnergyLevel; ENERGY_LEVELS],
    /// Free particle-energy allowance per wallet per cycle. Unused energy expires.
    pub energy_per_cycle: u16,
    /// $TUNNEL base units paid per energy unit at par odds (before premium and caps).
    pub reward_per_energy: u64,
    pub cycle_duration_secs: u32,
    pub randomness_timeout_secs: u32,
    /// $TUNNEL base units budgeted for cycle 0's epoch.
    pub initial_emission_per_cycle: u64,
    /// Multiplier applied once per epoch (9950 = emission × 0.995 each epoch).
    pub emission_decay_bps: u16,
    pub emission_epoch_cycles: u32,
}

impl ProtocolParams {
    pub fn validate(&self) -> Result<()> {
        for b in self.barriers.iter() {
            require!(
                (MIN_HEIGHT_MILLI..=MAX_HEIGHT_MILLI).contains(&b.height_milli),
                TunnelError::InvalidParams
            );
            require!(
                (MIN_WIDTH_MILLI..=MAX_WIDTH_MILLI).contains(&b.width_milli),
                TunnelError::InvalidParams
            );
            require!(
                (MIN_PREMIUM_BPS..=MAX_PREMIUM_BPS).contains(&b.reward_premium_bps),
                TunnelError::InvalidParams
            );
        }
        for l in self.levels.iter() {
            require!(
                (MIN_ENERGY_BPS..=MAX_ENERGY_BPS).contains(&l.energy_bps),
                TunnelError::InvalidParams
            );
            require!(l.cost >= 1 && l.cost <= MAX_LEVEL_COST, TunnelError::InvalidParams);
        }
        require!(
            self.energy_per_cycle >= 1 && self.energy_per_cycle <= MAX_ENERGY_PER_CYCLE,
            TunnelError::InvalidParams
        );
        require!(self.reward_per_energy > 0, TunnelError::InvalidParams);
        require!(
            (MIN_CYCLE_DURATION_SECS..=MAX_CYCLE_DURATION_SECS).contains(&self.cycle_duration_secs),
            TunnelError::InvalidParams
        );
        require!(
            (MIN_RANDOMNESS_TIMEOUT_SECS..=MAX_RANDOMNESS_TIMEOUT_SECS)
                .contains(&self.randomness_timeout_secs),
            TunnelError::InvalidParams
        );
        require!(self.emission_decay_bps <= MAX_EMISSION_DECAY_BPS, TunnelError::InvalidParams);
        require!(self.emission_epoch_cycles >= 1, TunnelError::InvalidParams);
        Ok(())
    }
}

/// Odds and nominal rewards derived by the program from `ProtocolParams`:
/// the physics model fixes each probability, and each reward is calibrated
/// to it. Nobody can set these directly.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct OddsTable {
    /// Tunneling probability per [barrier][level], parts per billion.
    pub transmission_ppb: [[u32; ENERGY_LEVELS]; BARRIER_COUNT],
    /// Nominal $TUNNEL base units per successful particle, per [barrier][level].
    pub reward: [[u64; ENERGY_LEVELS]; BARRIER_COUNT],
}

#[account]
#[derive(InitSpace)]
pub struct Protocol {
    pub admin: Pubkey,
    pub pending_admin: Option<Pubkey>,
    /// When not the default key, every `deploy_particles` must be co-signed by
    /// this key (an operator rate-limiting service). Disabled by default.
    pub gatekeeper: Pubkey,
    pub tunnel_mint: Pubkey,
    pub reward_vault: Pubkey,
    /// Parameters applied to cycles opened from now on. Open cycles keep their snapshot.
    pub params: ProtocolParams,
    pub odds: OddsTable,
    pub paused: bool,
    pub next_cycle_id: u64,
    pub last_cycle_open_ts: i64,
    pub last_cycle_close_ts: i64,
    /// $TUNNEL in the reward vault that is not yet committed to any cycle.
    pub reserve_available: u64,
    pub reserve_funded_total: u64,
    pub total_experiments: u64,
    pub total_particles: u64,
    pub total_energy: u64,
    pub total_successes: u64,
    pub total_tokens_allocated: u64,
    pub total_tokens_claimed: u64,
    pub cycles_settled: u64,
    pub bump: u8,
    pub reward_vault_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum CycleStatus {
    /// Accepting particles while `open_ts <= now < close_ts`.
    /// (UPCOMING / CLOSED are derived from the clock while in this status.)
    Open,
    /// Deployments closed and the VRF seed fixed from the latest slot hash.
    Closed,
    AwaitingRandomness,
    /// Randomness revealed; positions are being settled.
    Resolving,
    Settled,
    /// Randomness never arrived: every particle is void, the budget returns to the reserve.
    Void,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum CycleOutcome {
    Pending,
    /// At least one particle tunneled.
    Rewards,
    /// Every particle was reflected.
    NoTunnels,
    /// Randomness timed out; no outcomes exist.
    Void,
    /// Cycle closed with no participants.
    Empty,
}

#[account]
#[derive(InitSpace)]
pub struct Cycle {
    pub id: u64,
    pub status: CycleStatus,
    pub outcome: CycleOutcome,
    pub bump: u8,
    pub open_ts: i64,
    pub close_ts: i64,
    pub closed_ts: i64,
    // ---- snapshot, immutable after creation ----
    pub barriers: [BarrierConfig; BARRIER_COUNT],
    pub levels: [EnergyLevel; ENERGY_LEVELS],
    pub odds: OddsTable,
    pub energy_per_cycle: u16,
    pub randomness_timeout_secs: u32,
    pub emission_budget: u64,
    // ---- deployments ----
    pub participants: u32,
    pub experiments: u32,
    pub particles: [u64; BARRIER_COUNT],
    pub energy_used: u64,
    // ---- randomness ----
    pub vrf_seed: [u8; 32],
    pub randomness_requested_ts: i64,
    pub randomness: [u8; 64],
    // ---- settlement ----
    pub positions_settled: u32,
    pub successes: [u64; BARRIER_COUNT],
    /// Σ successes × nominal reward over every position.
    pub total_nominal: u64,
    /// min(total_nominal, emission_budget): what claims can pay in total.
    pub tokens_allocated: u64,
    pub settled_ts: i64,
    // ---- claims ----
    pub claims: u32,
    pub tokens_claimed: u64,
    pub swept: bool,
}

/// One wallet's particles in one cycle. Created on the first deployment,
/// closed (rent returned) on claim.
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub cycle_id: u64,
    pub bump: u8,
    /// Particles per [barrier][level]. Particle `i` of a cell is drawn with index `i`.
    pub particles: [[u16; ENERGY_LEVELS]; BARRIER_COUNT],
    pub energy_used: u16,
    /// Number of `deploy_particles` calls (experiments) in this position.
    pub experiments: u16,
    pub settled: bool,
    pub successes: [[u16; ENERGY_LEVELS]; BARRIER_COUNT],
    pub nominal_reward: u64,
    pub claimed: bool,
    pub tokens_paid: u64,
}

impl Position {
    pub fn total_particles(&self) -> u32 {
        self.particles.iter().flatten().map(|&p| p as u32).sum()
    }
}
