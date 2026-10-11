//! TUNNEL — Quantum Tunneling Protocol.
//!
//! Wallets receive a free particle-energy allowance every mining cycle and
//! spend it deploying particles against rectangular potential barriers. The
//! program derives each tunneling probability from the barrier's physics
//! (`physics.rs`), ORAO VRF supplies verifiable randomness, and successful
//! particles earn $TUNNEL from a fixed, pre-funded emissions reserve.
//!
//! Cycle lifecycle (every transition is a program instruction):
//!
//! ```text
//! open_cycle ─► Open ─close_cycle─► Closed ─request_randomness─► AwaitingRandomness
//!                │ (no participants) ─► Settled           │ reveal_randomness ─► Resolving
//!                │                                         │                        │ settle_position × N
//!                │                    timeout (any stage)  ▼                        ▼
//!                └───────────────────────────────────► Void            finalize_cycle ─► Settled
//!                                                          └───── claim × N ─── sweep_cycle ─┘
//! ```
//!
//! The admin can tune parameters for *future* cycles, pause new deployments
//! and set an optional deployment co-signer. No instruction lets the admin
//! move the $TUNNEL reserve, set odds directly, or mint tokens.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod physics;
pub mod state;

pub use instructions::*;
use state::ProtocolParams;

declare_id!("GyywTr1c6yTJPSxDiADUfawcpuQBQ6JPwMKaoC6WrhF9");

#[program]
pub mod tunnel {
    use super::*;

    // ---- administration ----

    pub fn initialize(ctx: Context<Initialize>, gatekeeper: Pubkey, params: ProtocolParams) -> Result<()> {
        instructions::admin::initialize(ctx, gatekeeper, params)
    }

    pub fn update_params(ctx: Context<AdminOnly>, params: ProtocolParams) -> Result<()> {
        instructions::admin::update_params(ctx, params)
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        instructions::admin::set_paused(ctx, paused)
    }

    pub fn set_gatekeeper(ctx: Context<AdminOnly>, gatekeeper: Pubkey) -> Result<()> {
        instructions::admin::set_gatekeeper(ctx, gatekeeper)
    }

    pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::propose_admin(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::accept_admin(ctx)
    }

    pub fn fund_reserve(ctx: Context<FundReserve>, amount: u64) -> Result<()> {
        instructions::admin::fund_reserve(ctx, amount)
    }

    // ---- cycles (permissionless cranks) ----

    pub fn open_cycle(ctx: Context<OpenCycle>) -> Result<()> {
        instructions::cycle::open_cycle(ctx)
    }

    pub fn close_cycle(ctx: Context<CloseCycle>, cycle_id: u64) -> Result<()> {
        instructions::cycle::close_cycle(ctx, cycle_id)
    }

    pub fn request_randomness(ctx: Context<RequestRandomness>, cycle_id: u64) -> Result<()> {
        instructions::cycle::request_randomness(ctx, cycle_id)
    }

    pub fn reveal_randomness(ctx: Context<RevealRandomness>, cycle_id: u64) -> Result<()> {
        instructions::cycle::reveal_randomness(ctx, cycle_id)
    }

    pub fn settle_position(ctx: Context<SettlePosition>, cycle_id: u64) -> Result<()> {
        instructions::settle::settle_position(ctx, cycle_id)
    }

    pub fn finalize_cycle(ctx: Context<FinalizeCycle>, cycle_id: u64) -> Result<()> {
        instructions::settle::finalize_cycle(ctx, cycle_id)
    }

    pub fn void_cycle(ctx: Context<VoidCycle>, cycle_id: u64) -> Result<()> {
        instructions::cycle::void_cycle(ctx, cycle_id)
    }

    pub fn sweep_cycle(ctx: Context<SweepCycle>, cycle_id: u64) -> Result<()> {
        instructions::claim::sweep_cycle(ctx, cycle_id)
    }

    // ---- users ----

    pub fn deploy_particles(ctx: Context<DeployParticles>, cycle_id: u64, barrier: u8, level: u8, count: u16) -> Result<()> {
        instructions::deploy::deploy_particles(ctx, cycle_id, barrier, level, count)
    }

    pub fn claim(ctx: Context<Claim>, cycle_id: u64) -> Result<()> {
        instructions::claim::claim(ctx, cycle_id)
    }
}
