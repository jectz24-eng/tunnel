use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::TunnelError;
use crate::events::*;
use crate::math;
use crate::state::*;

// ---------------------------------------------------------------- settle one position

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct SettlePosition<'info> {
    #[account(mut, seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [POSITION_SEED, &round_id.to_le_bytes(), position.owner.as_ref()],
        bump = position.bump,
        constraint = position.round_id == round_id @ TunnelError::RoundMismatch,
    )]
    pub position: Account<'info, Position>,
}

/// Permissionless and idempotent (a settled position is rejected). Derives
/// every particle outcome of one position from the revealed randomness.
/// Settlement is split per position so no transaction ever has to touch all
/// participants; cost is bounded by `max_particles_per_position`.
pub fn settle_position(ctx: Context<SettlePosition>, round_id: u64) -> Result<()> {
    let round = &mut ctx.accounts.round;
    let position = &mut ctx.accounts.position;
    require!(round.status == RoundStatus::Resolving, TunnelError::NotResolving);
    require!(!position.settled, TunnelError::PositionAlreadySettled);

    let mut weight: u64 = 0;
    for b in 0..BARRIER_COUNT {
        let n = position.particles[b];
        if n == 0 {
            continue;
        }
        let s = math::count_successes(
            &round.randomness,
            round_id,
            &position.owner,
            b as u8,
            n,
            round.barriers[b].transmission_bps,
        );
        position.successes[b] = s;
        round.successes[b] = round.successes[b].checked_add(s as u64).ok_or(TunnelError::MathOverflow)?;
        weight = weight
            .checked_add((s as u64).checked_mul(round.barriers[b].reward_weight as u64).ok_or(TunnelError::MathOverflow)?)
            .ok_or(TunnelError::MathOverflow)?;
    }
    position.success_weight = weight;
    position.settled = true;
    round.total_success_weight = round
        .total_success_weight
        .checked_add(weight)
        .ok_or(TunnelError::MathOverflow)?;
    round.positions_settled = round.positions_settled.checked_add(1).ok_or(TunnelError::MathOverflow)?;

    emit!(PositionSettled {
        round_id,
        owner: position.owner,
        particles: position.particles,
        successes: position.successes,
        success_weight: weight,
    });
    Ok(())
}

// ---------------------------------------------------------------- finalize

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct FinalizeRound<'info> {
    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut, seeds = [ROUND_VAULT_SEED, &round_id.to_le_bytes()], bump = round.vault_bump)]
    pub round_vault: Account<'info, RoundVault>,
    #[account(mut, seeds = [TREASURY_VAULT_SEED], bump = treasury_vault.bump)]
    pub treasury_vault: Account<'info, TreasuryVault>,
}

/// Permissionless once every position is settled. Moves the protocol fee to
/// the (always rent-exempt) treasury vault and fixes the claimable pool. Runs exactly once: the status
/// moves to `Settled`, which no instruction can leave.
pub fn finalize_round(ctx: Context<FinalizeRound>, round_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let round = &mut ctx.accounts.round;
    require!(round.status == RoundStatus::Resolving, TunnelError::NotResolving);
    require!(round.positions_settled == round.participants, TunnelError::PositionsPending);

    let (fee, distributable) = math::split_fee(round.total_lamports, round.protocol_fee_bps)?;
    let protocol = &mut ctx.accounts.protocol;

    let (outcome, outcome_code, tokens_allocated) = if round.total_success_weight == 0 {
        // Nobody tunnelled: return the unused emission to the reserve.
        protocol.reserve_available = protocol
            .reserve_available
            .checked_add(round.emission_budget)
            .ok_or(TunnelError::MathOverflow)?;
        (RoundOutcome::NoSuccessRefund, 2u8, 0u64)
    } else {
        (RoundOutcome::Rewards, 1u8, round.emission_budget)
    };

    if fee > 0 {
        ctx.accounts.round_vault.sub_lamports(fee)?;
        ctx.accounts.treasury_vault.add_lamports(fee)?;
    }

    round.fee_lamports = fee;
    round.distributable_lamports = distributable;
    round.outcome = outcome;
    round.status = RoundStatus::Settled;
    round.settled_ts = now;

    let total_successes: u64 = round.successes.iter().sum();
    protocol.total_successes = protocol.total_successes.checked_add(total_successes).ok_or(TunnelError::MathOverflow)?;
    protocol.total_tokens_allocated = protocol
        .total_tokens_allocated
        .checked_add(tokens_allocated)
        .ok_or(TunnelError::MathOverflow)?;
    protocol.total_fees_lamports = protocol.total_fees_lamports.checked_add(fee).ok_or(TunnelError::MathOverflow)?;
    protocol.rounds_settled = protocol.rounds_settled.saturating_add(1);

    emit!(RoundFinalized {
        round_id,
        outcome: outcome_code,
        total_lamports: round.total_lamports,
        fee_lamports: fee,
        distributable_lamports: distributable,
        successes: round.successes,
        total_success_weight: round.total_success_weight,
        emission_budget: round.emission_budget,
        tokens_allocated,
    });
    Ok(())
}
