use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::TunnelError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct BarrierParams {
    /// Probability that one particle tunnels, in basis points (6500 = 65%).
    pub transmission_bps: u16,
    /// Reward weight of one successful particle.
    pub reward_weight: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct ProtocolParams {
    pub barriers: [BarrierParams; BARRIER_COUNT],
    pub particle_cost_lamports: u64,
    pub round_duration_secs: u32,
    pub protocol_fee_bps: u16,
    pub max_particles_per_position: u16,
    pub randomness_timeout_secs: u32,
    /// $TUNNEL base units emitted to round 0's epoch.
    pub initial_emission_per_round: u64,
    /// Multiplier applied once per epoch (9990 = emission × 0.999 each epoch).
    pub emission_decay_bps: u16,
    pub emission_epoch_rounds: u32,
}

impl ProtocolParams {
    pub fn validate(&self) -> Result<()> {
        for b in self.barriers.iter() {
            require!(
                (MIN_TRANSMISSION_BPS..=MAX_TRANSMISSION_BPS).contains(&b.transmission_bps),
                TunnelError::InvalidParams
            );
            require!(
                (MIN_REWARD_WEIGHT..=MAX_REWARD_WEIGHT).contains(&b.reward_weight),
                TunnelError::InvalidParams
            );
        }
        require!(
            self.particle_cost_lamports >= MIN_PARTICLE_COST_LAMPORTS,
            TunnelError::InvalidParams
        );
        require!(
            (MIN_ROUND_DURATION_SECS..=MAX_ROUND_DURATION_SECS).contains(&self.round_duration_secs),
            TunnelError::InvalidParams
        );
        require!(self.protocol_fee_bps <= MAX_PROTOCOL_FEE_BPS, TunnelError::InvalidParams);
        require!(
            self.max_particles_per_position >= 1
                && self.max_particles_per_position <= MAX_PARTICLES_PER_POSITION_LIMIT,
            TunnelError::InvalidParams
        );
        require!(
            (MIN_RANDOMNESS_TIMEOUT_SECS..=MAX_RANDOMNESS_TIMEOUT_SECS)
                .contains(&self.randomness_timeout_secs),
            TunnelError::InvalidParams
        );
        require!(self.emission_decay_bps <= MAX_EMISSION_DECAY_BPS, TunnelError::InvalidParams);
        require!(self.emission_epoch_rounds >= 1, TunnelError::InvalidParams);
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Protocol {
    pub admin: Pubkey,
    pub pending_admin: Option<Pubkey>,
    /// Wallet that receives protocol fees and swept dust.
    pub treasury: Pubkey,
    pub tunnel_mint: Pubkey,
    pub reward_vault: Pubkey,
    /// Parameters applied to rounds opened from now on. Open rounds keep their snapshot.
    pub params: ProtocolParams,
    pub paused: bool,
    pub next_round_id: u64,
    pub last_round_open_ts: i64,
    pub last_round_close_ts: i64,
    /// $TUNNEL in the reward vault that is not yet committed to any round.
    pub reserve_available: u64,
    pub reserve_funded_total: u64,
    pub total_lamports_committed: u64,
    pub total_particles: u64,
    pub total_successes: u64,
    pub total_tokens_allocated: u64,
    pub total_fees_lamports: u64,
    pub rounds_settled: u64,
    pub bump: u8,
    pub reward_vault_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum RoundStatus {
    /// Accepting deposits while `open_ts <= now < close_ts`.
    /// (UPCOMING / CLOSED are derived from the clock while in this status.)
    Open,
    /// Deposits closed and the VRF seed fixed from the latest slot hash.
    Closed,
    AwaitingRandomness,
    /// Randomness revealed; positions are being settled.
    Resolving,
    Settled,
    /// Randomness or close never arrived: every deposit is refundable in full.
    Failed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum RoundOutcome {
    Pending,
    /// At least one particle tunnelled: pool split by reward weight.
    Rewards,
    /// Nobody tunnelled: 95% pool refunded pro rata to commitment.
    NoSuccessRefund,
    /// Round failed: 100% refund, no fee.
    FullRefund,
    /// Round closed with no participants.
    Empty,
}

#[account]
#[derive(InitSpace)]
pub struct Round {
    pub id: u64,
    pub status: RoundStatus,
    pub outcome: RoundOutcome,
    pub bump: u8,
    pub vault_bump: u8,
    pub open_ts: i64,
    pub close_ts: i64,
    pub closed_ts: i64,
    // ---- parameter snapshot, immutable after creation ----
    pub barriers: [BarrierParams; BARRIER_COUNT],
    pub particle_cost_lamports: u64,
    pub protocol_fee_bps: u16,
    pub max_particles_per_position: u16,
    pub randomness_timeout_secs: u32,
    pub emission_budget: u64,
    // ---- deposits ----
    pub particles: [u64; BARRIER_COUNT],
    pub total_lamports: u64,
    pub participants: u32,
    // ---- randomness ----
    pub vrf_seed: [u8; 32],
    pub randomness_requested_ts: i64,
    pub randomness: [u8; 64],
    // ---- settlement ----
    pub positions_settled: u32,
    pub successes: [u64; BARRIER_COUNT],
    pub total_success_weight: u64,
    pub fee_lamports: u64,
    pub distributable_lamports: u64,
    pub settled_ts: i64,
    // ---- claims ----
    pub claims: u32,
    pub lamports_claimed: u64,
    pub tokens_claimed: u64,
    pub swept: bool,
}

/// Program-owned, always rent-exempt account that accumulates protocol fees
/// and swept dust. Fees land here (never directly in an external wallet), so
/// settlement can never be blocked by the treasury wallet's state.
/// `withdraw_fees` forwards the balance to the configured treasury.
#[account]
#[derive(InitSpace)]
pub struct TreasuryVault {
    pub bump: u8,
}

/// Program-owned escrow that holds a round's SOL. Only program instructions
/// can debit it, and none of them pay out to the admin.
#[account]
#[derive(InitSpace)]
pub struct RoundVault {
    pub round_id: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub round_id: u64,
    pub bump: u8,
    pub particles: [u16; BARRIER_COUNT],
    pub lamports: u64,
    pub settled: bool,
    pub successes: [u16; BARRIER_COUNT],
    pub success_weight: u64,
    pub claimed: bool,
    pub lamports_paid: u64,
    pub tokens_paid: u64,
}

impl Position {
    pub fn total_particles(&self) -> u32 {
        self.particles.iter().map(|&p| p as u32).sum()
    }
}
