use anchor_lang::prelude::*;

use crate::constants::{BARRIER_COUNT, ENERGY_LEVELS};
use crate::state::{OddsTable, ProtocolParams};

#[event]
pub struct ProtocolInitialized {
    pub admin: Pubkey,
    pub gatekeeper: Pubkey,
    pub tunnel_mint: Pubkey,
    pub reward_vault: Pubkey,
    pub params: ProtocolParams,
    pub odds: OddsTable,
}

#[event]
pub struct ParamsUpdated {
    pub params: ProtocolParams,
    pub odds: OddsTable,
}

#[event]
pub struct PauseChanged {
    pub paused: bool,
}

#[event]
pub struct GatekeeperChanged {
    pub gatekeeper: Pubkey,
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
pub struct CycleOpened {
    pub cycle_id: u64,
    pub open_ts: i64,
    pub close_ts: i64,
    pub energy_per_cycle: u16,
    pub emission_budget: u64,
}

/// One experiment: a single `deploy_particles` call.
#[event]
pub struct ParticlesDeployed {
    pub cycle_id: u64,
    pub owner: Pubkey,
    /// Sequence number of this experiment within the wallet's position (0-based).
    pub experiment: u16,
    pub barrier: u8,
    pub level: u8,
    pub count: u16,
    /// Draw index of the first particle; particles use `first_index..first_index+count`.
    pub first_index: u16,
    pub energy_cost: u16,
    pub energy_used: u16,
    pub energy_per_cycle: u16,
    /// Physical inputs of this attempt (from the cycle snapshot): V₀×1000, a×1000, E/V₀ in bps.
    pub height_milli: u32,
    pub width_milli: u32,
    pub energy_bps: u16,
    pub transmission_ppb: u32,
    pub nominal_reward: u64,
}

#[event]
pub struct CycleClosed {
    pub cycle_id: u64,
    pub vrf_seed: [u8; 32],
    pub participants: u32,
    pub experiments: u32,
    pub particles: [u64; BARRIER_COUNT],
    pub energy_used: u64,
    pub closed_ts: i64,
}

#[event]
pub struct RandomnessRequested {
    pub cycle_id: u64,
    pub vrf_seed: [u8; 32],
    pub requested_ts: i64,
}

#[event]
pub struct RandomnessRevealed {
    pub cycle_id: u64,
    pub randomness: [u8; 64],
}

#[event]
pub struct PositionSettled {
    pub cycle_id: u64,
    pub owner: Pubkey,
    pub particles: [[u16; ENERGY_LEVELS]; BARRIER_COUNT],
    pub successes: [[u16; ENERGY_LEVELS]; BARRIER_COUNT],
    pub nominal_reward: u64,
}

#[event]
pub struct CycleFinalized {
    pub cycle_id: u64,
    /// 1 = Rewards, 2 = NoTunnels, 3 = Void, 4 = Empty
    pub outcome: u8,
    pub successes: [u64; BARRIER_COUNT],
    pub total_nominal: u64,
    pub emission_budget: u64,
    pub tokens_allocated: u64,
    pub returned_to_reserve: u64,
}

#[event]
pub struct CycleVoided {
    pub cycle_id: u64,
    /// 0 = never closed, 1 = randomness timeout
    pub reason: u8,
}

#[event]
pub struct RewardClaimed {
    pub cycle_id: u64,
    pub owner: Pubkey,
    pub tokens: u64,
    pub outcome: u8,
}

#[event]
pub struct CycleSwept {
    pub cycle_id: u64,
    pub tokens_returned_to_reserve: u64,
}
