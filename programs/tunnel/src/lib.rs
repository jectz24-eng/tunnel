//! TUNNEL — a quantum-inspired stochastic mining protocol.
//!
//! Round lifecycle (every transition is a program instruction):
//!
//! ```text
//! open_round ─► Open ─close_round─► Closed ─request_randomness─► AwaitingRandomness
//!                │ (no participants) ─► Settled           │ reveal_randomness ─► Resolving
//!                │                                         │                        │ settle_position × N
//!                │                    timeout (any stage)  ▼                        ▼
//!                └───────────────────────────────────► Failed            finalize_round ─► Settled
//!                                                          └───── claim × N ─── sweep_round ─┘
//! ```
//!
//! The admin can tune parameters for *future* rounds, pause new deposits and
//! rotate the treasury. No instruction lets the admin move escrowed SOL or the
//! $TUNNEL reward reserve.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

pub use instructions::*;
use state::ProtocolParams;

declare_id!("GyywTr1c6yTJPSxDiADUfawcpuQBQ6JPwMKaoC6WrhF9");

#[program]
pub mod tunnel {
    use super::*;

    // ---- administration ----

    pub fn initialize(ctx: Context<Initialize>, treasury: Pubkey, params: ProtocolParams) -> Result<()> {
        instructions::admin::initialize(ctx, treasury, params)
    }

    pub fn update_params(ctx: Context<AdminOnly>, params: ProtocolParams) -> Result<()> {
        instructions::admin::update_params(ctx, params)
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        instructions::admin::set_paused(ctx, paused)
    }

    pub fn set_treasury(ctx: Context<AdminOnly>, treasury: Pubkey) -> Result<()> {
        instructions::admin::set_treasury(ctx, treasury)
    }

    pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::propose_admin(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::accept_admin(ctx)
    }

    pub fn withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
        instructions::admin::withdraw_fees(ctx)
    }

    pub fn fund_reserve(ctx: Context<FundReserve>, amount: u64) -> Result<()> {
        instructions::admin::fund_reserve(ctx, amount)
    }

    // ---- rounds (permissionless cranks) ----

    pub fn open_round(ctx: Context<OpenRound>) -> Result<()> {
        instructions::round::open_round(ctx)
    }

    pub fn close_round(ctx: Context<CloseRound>, round_id: u64) -> Result<()> {
        instructions::round::close_round(ctx, round_id)
    }

    pub fn request_randomness(ctx: Context<RequestRandomness>, round_id: u64) -> Result<()> {
        instructions::round::request_randomness(ctx, round_id)
    }

    pub fn reveal_randomness(ctx: Context<RevealRandomness>, round_id: u64) -> Result<()> {
        instructions::round::reveal_randomness(ctx, round_id)
    }

    pub fn settle_position(ctx: Context<SettlePosition>, round_id: u64) -> Result<()> {
        instructions::settle::settle_position(ctx, round_id)
    }

    pub fn finalize_round(ctx: Context<FinalizeRound>, round_id: u64) -> Result<()> {
        instructions::settle::finalize_round(ctx, round_id)
    }

    pub fn recover_round(ctx: Context<RecoverRound>, round_id: u64) -> Result<()> {
        instructions::round::recover_round(ctx, round_id)
    }

    pub fn sweep_round(ctx: Context<SweepRound>, round_id: u64) -> Result<()> {
        instructions::claim::sweep_round(ctx, round_id)
    }

    // ---- users ----

    pub fn deploy_particles(ctx: Context<DeployParticles>, round_id: u64, barrier: u8, count: u16) -> Result<()> {
        instructions::deposit::deploy_particles(ctx, round_id, barrier, count)
    }

    pub fn claim(ctx: Context<Claim>, round_id: u64) -> Result<()> {
        instructions::claim::claim(ctx, round_id)
    }
}
