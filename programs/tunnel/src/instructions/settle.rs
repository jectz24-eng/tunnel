use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::TunnelError;
use crate::events::*;
use crate::math;
use crate::state::*;

// ---------------------------------------------------------------- settle one position

#[derive(Accounts)]
#[instruction(cycle_id: u64)]
pub struct SettlePosition<'info> {
    #[account(mut, seeds = [CYCLE_SEED, &cycle_id.to_le_bytes()], bump = cycle.bump)]
    pub cycle: Account<'info, Cycle>,
    #[account(
        mut,
        seeds = [POSITION_SEED, &cycle_id.to_le_bytes(), position.owner.as_ref()],
        bump = position.bump,
        constraint = position.cycle_id == cycle_id @ TunnelError::CycleMismatch,
    )]
    pub position: Account<'info, Position>,
}

/// Permissionless and idempotent (a settled position is rejected). Derives
/// every particle outcome of one position from the revealed randomness and
/// the cycle's snapshotted odds. Settlement is split per position so no
/// transaction ever has to touch all participants; cost is bounded by the
/// per-cycle energy allowance.
pub fn settle_position(ctx: Context<SettlePosition>, cycle_id: u64) -> Result<()> {
    let cycle = &mut ctx.accounts.cycle;
    let position = &mut ctx.accounts.position;
    require!(cycle.status == CycleStatus::Resolving, TunnelError::NotResolving);
    require!(!position.settled, TunnelError::PositionAlreadySettled);

    let mut nominal: u64 = 0;
    for b in 0..BARRIER_COUNT {
        let mut barrier_successes: u64 = 0;
        for l in 0..ENERGY_LEVELS {
            let n = position.particles[b][l];
            if n == 0 {
                continue;
            }
            let s = math::count_successes(
                &cycle.randomness,
                cycle_id,
                &position.owner,
                b as u8,
                l as u8,
                n,
                cycle.odds.transmission_ppb[b][l],
            );
            position.successes[b][l] = s;
            barrier_successes += s as u64;
            nominal = nominal
                .checked_add((s as u64).checked_mul(cycle.odds.reward[b][l]).ok_or(TunnelError::MathOverflow)?)
                .ok_or(TunnelError::MathOverflow)?;
        }
        cycle.successes[b] = cycle.successes[b].checked_add(barrier_successes).ok_or(TunnelError::MathOverflow)?;
    }
    position.nominal_reward = nominal;
    position.settled = true;
    cycle.total_nominal = cycle.total_nominal.checked_add(nominal).ok_or(TunnelError::MathOverflow)?;
    cycle.positions_settled = cycle.positions_settled.checked_add(1).ok_or(TunnelError::MathOverflow)?;

    emit!(PositionSettled {
        cycle_id,
        owner: position.owner,
        particles: position.particles,
        successes: position.successes,
        nominal_reward: nominal,
    });
    Ok(())
}

// ---------------------------------------------------------------- finalize

#[derive(Accounts)]
#[instruction(cycle_id: u64)]
pub struct FinalizeCycle<'info> {
    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [CYCLE_SEED, &cycle_id.to_le_bytes()], bump = cycle.bump)]
    pub cycle: Account<'info, Cycle>,
}

/// Permissionless once every position is settled. Fixes what the cycle pays:
/// `min(Σ nominal, emission_budget)`. Any unused budget goes straight back to
/// the reserve. Runs exactly once: `Settled` is terminal.
pub fn finalize_cycle(ctx: Context<FinalizeCycle>, cycle_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let cycle = &mut ctx.accounts.cycle;
    require!(cycle.status == CycleStatus::Resolving, TunnelError::NotResolving);
    require!(cycle.positions_settled == cycle.participants, TunnelError::PositionsPending);

    let allocated = cycle.total_nominal.min(cycle.emission_budget);
    let returned = cycle.emission_budget - allocated;
    let total_successes: u64 = cycle.successes.iter().sum();
    let (outcome, code) = if total_successes > 0 {
        (CycleOutcome::Rewards, 1u8)
    } else {
        (CycleOutcome::NoTunnels, 2u8)
    };

    let protocol = &mut ctx.accounts.protocol;
    protocol.reserve_available = protocol.reserve_available.checked_add(returned).ok_or(TunnelError::MathOverflow)?;
    protocol.total_successes = protocol.total_successes.checked_add(total_successes).ok_or(TunnelError::MathOverflow)?;
    protocol.total_tokens_allocated = protocol
        .total_tokens_allocated
        .checked_add(allocated)
        .ok_or(TunnelError::MathOverflow)?;
    protocol.cycles_settled = protocol.cycles_settled.saturating_add(1);

    cycle.tokens_allocated = allocated;
    cycle.outcome = outcome;
    cycle.status = CycleStatus::Settled;
    cycle.settled_ts = now;

    emit!(CycleFinalized {
        cycle_id,
        outcome: code,
        successes: cycle.successes,
        total_nominal: cycle.total_nominal,
        emission_budget: cycle.emission_budget,
        tokens_allocated: allocated,
        returned_to_reserve: returned,
    });
    Ok(())
}
