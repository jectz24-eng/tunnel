use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::errors::TunnelError;
use crate::events::*;
use crate::math;
use crate::state::*;

pub fn outcome_code(o: CycleOutcome) -> u8 {
    match o {
        CycleOutcome::Pending => 0,
        CycleOutcome::Rewards => 1,
        CycleOutcome::NoTunnels => 2,
        CycleOutcome::Void => 3,
        CycleOutcome::Empty => 4,
    }
}

#[derive(Accounts)]
#[instruction(cycle_id: u64)]
pub struct Claim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        has_one = tunnel_mint,
        has_one = reward_vault,
    )]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [CYCLE_SEED, &cycle_id.to_le_bytes()], bump = cycle.bump)]
    pub cycle: Account<'info, Cycle>,
    #[account(
        mut,
        seeds = [POSITION_SEED, &cycle_id.to_le_bytes(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner,
        close = owner,
    )]
    pub position: Account<'info, Position>,
    pub tunnel_mint: Account<'info, Mint>,
    #[account(mut)]
    pub reward_vault: Account<'info, TokenAccount>,
    /// The owner's $TUNNEL associated token account. Only required when the
    /// payout is non-zero (clients create it idempotently in the same tx).
    #[account(
        mut,
        associated_token::mint = tunnel_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub owner_token_account: Option<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Pays a position's $TUNNEL reward (possibly zero), then closes the position
/// account and returns its rent to the owner. Available any time after the
/// cycle is settled or voided (no expiry). Because the position is closed, a
/// second claim cannot even load it; and it can never be re-created, because
/// deployments require an `Open` cycle.
pub fn claim(ctx: Context<Claim>, cycle_id: u64) -> Result<()> {
    let cycle = &mut ctx.accounts.cycle;
    let position = &mut ctx.accounts.position;
    require!(
        matches!(cycle.status, CycleStatus::Settled | CycleStatus::Void),
        TunnelError::CycleNotSettled
    );
    require!(!position.claimed, TunnelError::AlreadyClaimed);
    if cycle.status == CycleStatus::Settled {
        require!(position.settled, TunnelError::PositionNotSettled);
    }

    let tokens = math::compute_payout(cycle, position)?;
    if tokens > 0 {
        let dest = ctx.accounts.owner_token_account.as_ref().ok_or(TunnelError::TokenAccountRequired)?;
        require!(ctx.accounts.reward_vault.amount >= tokens, TunnelError::InsufficientReserve);
        let signer_seeds: &[&[&[u8]]] = &[&[PROTOCOL_SEED, &[ctx.accounts.protocol.bump]]];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.reward_vault.to_account_info(),
                    mint: ctx.accounts.tunnel_mint.to_account_info(),
                    to: dest.to_account_info(),
                    authority: ctx.accounts.protocol.to_account_info(),
                },
                signer_seeds,
            ),
            tokens,
            ctx.accounts.tunnel_mint.decimals,
        )?;
    }

    position.claimed = true;
    position.tokens_paid = tokens;
    cycle.claims = cycle.claims.checked_add(1).ok_or(TunnelError::MathOverflow)?;
    cycle.tokens_claimed = cycle.tokens_claimed.checked_add(tokens).ok_or(TunnelError::MathOverflow)?;
    let protocol = &mut ctx.accounts.protocol;
    protocol.total_tokens_claimed = protocol.total_tokens_claimed.checked_add(tokens).ok_or(TunnelError::MathOverflow)?;

    emit!(RewardClaimed {
        cycle_id,
        owner: position.owner,
        tokens,
        outcome: outcome_code(cycle.outcome),
    });
    Ok(())
}

// ---------------------------------------------------------------- sweep

#[derive(Accounts)]
#[instruction(cycle_id: u64)]
pub struct SweepCycle<'info> {
    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [CYCLE_SEED, &cycle_id.to_le_bytes()], bump = cycle.bump)]
    pub cycle: Account<'info, Cycle>,
}

/// Permissionless, only after every participant has claimed. Rounding dust
/// from pro-rata scaling (at most one base unit per participant) returns to
/// the emissions reserve.
pub fn sweep_cycle(ctx: Context<SweepCycle>, cycle_id: u64) -> Result<()> {
    let cycle = &mut ctx.accounts.cycle;
    require!(
        matches!(cycle.status, CycleStatus::Settled | CycleStatus::Void),
        TunnelError::CycleNotSettled
    );
    require!(!cycle.swept, TunnelError::AlreadySwept);
    require!(cycle.claims == cycle.participants, TunnelError::ClaimsOutstanding);

    let dust = cycle.tokens_allocated.checked_sub(cycle.tokens_claimed).ok_or(TunnelError::MathOverflow)?;
    let protocol = &mut ctx.accounts.protocol;
    protocol.reserve_available = protocol.reserve_available.checked_add(dust).ok_or(TunnelError::MathOverflow)?;
    protocol.total_tokens_allocated = protocol.total_tokens_allocated.saturating_sub(dust);
    cycle.swept = true;

    emit!(CycleSwept { cycle_id, tokens_returned_to_reserve: dust });
    Ok(())
}
