use anchor_lang::prelude::*;

use crate::constants::BARRIER_COUNT;
use crate::state::{BarrierParams, ProtocolParams};

#[event]
pub struct ProtocolInitialized {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub tunnel_mint: Pubkey,
    pub reward_vault: Pubkey,
    pub params: ProtocolParams,
}

#[event]
pub struct ParamsUpdated {
    pub params: ProtocolParams,
}

#[event]
pub struct PauseChanged {
    pub paused: bool,
}

#[event]
pub struct TreasuryChanged {
    pub treasury: Pubkey,
}

#[event]
pub struct AdminProposed {
    pub pending_admin: Pubkey,
}

#[event]
pub struct AdminAccepted {
    pub admin: Pubkey,
}

#[event]
pub struct ReserveFunded {
    pub funder: Pubkey,
    pub amount: u64,
    pub reserve_available: u64,
}

#[event]
pub struct RoundOpened {
    pub round_id: u64,
    pub open_ts: i64,
    pub close_ts: i64,
    pub barriers: [BarrierParams; BARRIER_COUNT],
    pub particle_cost_lamports: u64,
    pub protocol_fee_bps: u16,
    pub emission_budget: u64,
}

#[event]
pub struct ParticlesDeployed {
    pub round_id: u64,
    pub owner: Pubkey,
    pub barrier: u8,
    pub count: u16,
    pub lamports: u64,
    pub position_particles: [u16; BARRIER_COUNT],
    pub round_total_lamports: u64,
}

#[event]
pub struct RoundClosed {
    pub round_id: u64,
    pub vrf_seed: [u8; 32],
    pub participants: u32,
    pub total_lamports: u64,
    pub particles: [u64; BARRIER_COUNT],
    pub closed_ts: i64,
}

#[event]
pub struct RandomnessRequested {
    pub round_id: u64,
    pub vrf_seed: [u8; 32],
    pub requested_ts: i64,
}

#[event]
pub struct RandomnessRevealed {
    pub round_id: u64,
    pub randomness: [u8; 64],
}

#[event]
pub struct PositionSettled {
    pub round_id: u64,
    pub owner: Pubkey,
    pub particles: [u16; BARRIER_COUNT],
    pub successes: [u16; BARRIER_COUNT],
    pub success_weight: u64,
}

#[event]
pub struct RoundFinalized {
    pub round_id: u64,
    /// 1 = Rewards, 2 = NoSuccessRefund, 3 = FullRefund, 4 = Empty
    pub outcome: u8,
    pub total_lamports: u64,
    pub fee_lamports: u64,
    pub distributable_lamports: u64,
    pub successes: [u64; BARRIER_COUNT],
    pub total_success_weight: u64,
    pub emission_budget: u64,
    pub tokens_allocated: u64,
}

#[event]
pub struct RoundFailed {
    pub round_id: u64,
    /// 0 = never closed, 1 = randomness timeout
    pub reason: u8,
}

#[event]
pub struct RewardClaimed {
    pub round_id: u64,
    pub owner: Pubkey,
    pub lamports: u64,
    pub tokens: u64,
    pub outcome: u8,
}

#[event]
pub struct FeesWithdrawn {
    pub treasury: Pubkey,
    pub lamports: u64,
}

#[event]
pub struct RoundSwept {
    pub round_id: u64,
    pub lamports_to_treasury: u64,
    pub tokens_returned_to_reserve: u64,
}
