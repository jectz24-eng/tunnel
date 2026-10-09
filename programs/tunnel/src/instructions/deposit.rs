use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::errors::TunnelError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct DeployParticles<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut, seeds = [ROUND_VAULT_SEED, &round_id.to_le_bytes()], bump = round.vault_bump)]
    pub round_vault: Account<'info, RoundVault>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, &round_id.to_le_bytes(), owner.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    pub system_program: Program<'info, System>,
}

/// Commits `count × particle_cost` lamports into the round escrow, placing
/// `count` particles on `barrier`. Deposits are only accepted while
/// `open_ts <= now < close_ts`, regardless of whether anyone cranked the close.
pub fn deploy_particles(
    ctx: Context<DeployParticles>,
    round_id: u64,
    barrier: u8,
    count: u16,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(!ctx.accounts.protocol.paused, TunnelError::Paused);
    require!((barrier as usize) < BARRIER_COUNT, TunnelError::InvalidBarrier);
    require!(count > 0, TunnelError::ZeroParticles);

    let round = &mut ctx.accounts.round;
    require!(round.status == RoundStatus::Open, TunnelError::RoundNotOpen);
    require!(now >= round.open_ts, TunnelError::RoundNotStarted);
    require!(now < round.close_ts, TunnelError::RoundExpired);

    let position = &mut ctx.accounts.position;
    let is_new = position.owner == Pubkey::default();
    if is_new {
        position.owner = ctx.accounts.owner.key();
        position.round_id = round_id;
        position.bump = ctx.bumps.position;
        round.participants = round.participants.checked_add(1).ok_or(TunnelError::MathOverflow)?;
    }
    let new_total = position
        .total_particles()
        .checked_add(count as u32)
        .ok_or(TunnelError::MathOverflow)?;
    require!(
        new_total <= round.max_particles_per_position as u32,
        TunnelError::PositionLimitExceeded
    );

    let lamports = round
        .particle_cost_lamports
        .checked_mul(count as u64)
        .ok_or(TunnelError::MathOverflow)?;

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: ctx.accounts.round_vault.to_account_info(),
            },
        ),
        lamports,
    )?;

    let b = barrier as usize;
    position.particles[b] += count; // bounded by the position limit above
    position.lamports = position.lamports.checked_add(lamports).ok_or(TunnelError::MathOverflow)?;
    round.particles[b] = round.particles[b].checked_add(count as u64).ok_or(TunnelError::MathOverflow)?;
    round.total_lamports = round.total_lamports.checked_add(lamports).ok_or(TunnelError::MathOverflow)?;

    let protocol = &mut ctx.accounts.protocol;
    protocol.total_lamports_committed = protocol
        .total_lamports_committed
        .checked_add(lamports)
        .ok_or(TunnelError::MathOverflow)?;
    protocol.total_particles = protocol
        .total_particles
        .checked_add(count as u64)
        .ok_or(TunnelError::MathOverflow)?;

    emit!(ParticlesDeployed {
        round_id,
        owner: position.owner,
        barrier,
        count,
        lamports,
        position_particles: position.particles,
        round_total_lamports: round.total_lamports,
    });
    Ok(())
}
