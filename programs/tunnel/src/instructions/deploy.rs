use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::TunnelError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(cycle_id: u64)]
pub struct DeployParticles<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [CYCLE_SEED, &cycle_id.to_le_bytes()], bump = cycle.bump)]
    pub cycle: Account<'info, Cycle>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, &cycle_id.to_le_bytes(), owner.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    /// Required (and must match `protocol.gatekeeper`) only when a gatekeeper is configured.
    pub gatekeeper: Option<Signer<'info>>,
    pub system_program: Program<'info, System>,
}

/// One experiment: places `count` particles at energy `level` against
/// `barrier`, drawing `count × cost(level)` from the wallet's free per-cycle
/// energy allowance. No SOL is transferred to the protocol; the owner pays
/// only network fees and the (refundable) rent of the position account.
pub fn deploy_particles(
    ctx: Context<DeployParticles>,
    cycle_id: u64,
    barrier: u8,
    level: u8,
    count: u16,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let protocol = &mut ctx.accounts.protocol;
    require!(!protocol.paused, TunnelError::Paused);
    if protocol.gatekeeper != Pubkey::default() {
        let gk = ctx.accounts.gatekeeper.as_ref().ok_or(TunnelError::GatekeeperRequired)?;
        require_keys_eq!(gk.key(), protocol.gatekeeper, TunnelError::GatekeeperRequired);
    }
    require!((barrier as usize) < BARRIER_COUNT, TunnelError::InvalidBarrier);
    require!((level as usize) < ENERGY_LEVELS, TunnelError::InvalidLevel);
    require!(count > 0, TunnelError::ZeroParticles);

    let cycle = &mut ctx.accounts.cycle;
    require!(cycle.status == CycleStatus::Open, TunnelError::CycleNotOpen);
    require!(now >= cycle.open_ts, TunnelError::CycleNotStarted);
    require!(now < cycle.close_ts, TunnelError::CycleExpired);

    let position = &mut ctx.accounts.position;
    if position.owner == Pubkey::default() {
        position.owner = ctx.accounts.owner.key();
        position.cycle_id = cycle_id;
        position.bump = ctx.bumps.position;
        cycle.participants = cycle.participants.checked_add(1).ok_or(TunnelError::MathOverflow)?;
    }

    let (b, l) = (barrier as usize, level as usize);
    let cost = (cycle.levels[l].cost as u32)
        .checked_mul(count as u32)
        .ok_or(TunnelError::MathOverflow)?;
    let energy_used = (position.energy_used as u32).checked_add(cost).ok_or(TunnelError::MathOverflow)?;
    require!(energy_used <= cycle.energy_per_cycle as u32, TunnelError::EnergyExhausted);
    // energy_per_cycle ≤ MAX_ENERGY_PER_CYCLE and cost ≥ 1, so every count below fits in u16.

    let first_index = position.particles[b][l];
    let experiment = position.experiments;
    position.particles[b][l] += count;
    position.energy_used = energy_used as u16;
    position.experiments = position.experiments.checked_add(1).ok_or(TunnelError::MathOverflow)?;

    cycle.experiments = cycle.experiments.checked_add(1).ok_or(TunnelError::MathOverflow)?;
    cycle.particles[b] = cycle.particles[b].checked_add(count as u64).ok_or(TunnelError::MathOverflow)?;
    cycle.energy_used = cycle.energy_used.checked_add(cost as u64).ok_or(TunnelError::MathOverflow)?;

    protocol.total_experiments = protocol.total_experiments.checked_add(1).ok_or(TunnelError::MathOverflow)?;
    protocol.total_particles = protocol
        .total_particles
        .checked_add(count as u64)
        .ok_or(TunnelError::MathOverflow)?;
    protocol.total_energy = protocol.total_energy.checked_add(cost as u64).ok_or(TunnelError::MathOverflow)?;

    emit!(ParticlesDeployed {
        cycle_id,
        owner: position.owner,
        experiment,
        barrier,
        level,
        count,
        first_index,
        energy_cost: cost as u16,
        energy_used: position.energy_used,
        energy_per_cycle: cycle.energy_per_cycle,
        transmission_ppb: cycle.odds.transmission_ppb[b][l],
        nominal_reward: cycle.odds.reward[b][l],
    });
    Ok(())
}
