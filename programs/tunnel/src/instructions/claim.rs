use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::errors::TunnelError;
use crate::events::*;
use crate::math;
use crate::state::*;

/// What a position is owed. Shared by `claim` and mirrored by the SDK so the
/// UI shows exactly what the program will pay.
pub fn compute_payout(round: &Round, position: &Position) -> Result<(u64, u64)> {
    match round.outcome {
        RoundOutcome::Rewards => {
            let sol = math::mul_div(
                round.distributable_lamports,
                position.success_weight,
                round.total_success_weight,
            )?;
            let tokens =
                math::mul_div(round.emission_budget, position.success_weight, round.total_success_weight)?;
            Ok((sol, tokens))
        }
        RoundOutcome::NoSuccessRefund => Ok((
            math::mul_div(round.distributable_lamports, position.lamports, round.total_lamports)?,
            0,
        )),
        RoundOutcome::FullRefund => Ok((position.lamports, 0)),
        RoundOutcome::Pending | RoundOutcome::Empty => err!(TunnelError::RoundNotSettled),
    }
}

fn outcome_code(o: RoundOutcome) -> u8 {
    match o {
        RoundOutcome::Pending => 0,
        RoundOutcome::Rewards => 1,
        RoundOutcome::NoSuccessRefund => 2,
        RoundOutcome::FullRefund => 3,
        RoundOutcome::Empty => 4,
    }
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct Claim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        has_one = tunnel_mint,
        has_one = reward_vault,
    )]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(mut, seeds = [ROUND_VAULT_SEED, &round_id.to_le_bytes()], bump = round.vault_bump)]
    pub round_vault: Account<'info, RoundVault>,
    #[account(
        mut,
        seeds = [POSITION_SEED, &round_id.to_le_bytes(), owner.key().as_ref()],
        bump = position.bump,
        has_one = owner,
        close = owner,
    )]
    pub position: Account<'info, Position>,
    pub tunnel_mint: Account<'info, Mint>,
    #[account(mut)]
    pub reward_vault: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = tunnel_mint,
        associated_token::authority = owner,
        associated_token::token_program = token_program,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Pays a position's SOL reward/refund and its $TUNNEL reward in one
/// transaction, then closes the position account and returns its rent to the
/// owner. Can be called any time after settlement (no expiry). Because the
/// position account is closed, a second claim cannot even load it; and it can
/// never be re-created because deposits require an `Open` round.
pub fn claim(ctx: Context<Claim>, round_id: u64) -> Result<()> {
    let round = &mut ctx.accounts.round;
    let position = &mut ctx.accounts.position;
    require!(
        matches!(round.status, RoundStatus::Settled | RoundStatus::Failed),
        TunnelError::RoundNotSettled
    );
    require!(!position.claimed, TunnelError::AlreadyClaimed);
    if round.status == RoundStatus::Settled {
        require!(position.settled, TunnelError::PositionNotSettled);
    }

    let (lamports, tokens) = compute_payout(round, position)?;

    if lamports > 0 {
        let vault_info = ctx.accounts.round_vault.to_account_info();
        let rent_floor = Rent::get()?.minimum_balance(vault_info.data_len());
        let spendable = vault_info.lamports().saturating_sub(rent_floor);
        require!(spendable >= lamports, TunnelError::InsufficientEscrow);
        ctx.accounts.round_vault.sub_lamports(lamports)?;
        ctx.accounts.owner.add_lamports(lamports)?;
    }

    if tokens > 0 {
        require!(ctx.accounts.reward_vault.amount >= tokens, TunnelError::InsufficientReserve);
        let signer_seeds: &[&[&[u8]]] = &[&[PROTOCOL_SEED, &[ctx.accounts.protocol.bump]]];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.reward_vault.to_account_info(),
                    mint: ctx.accounts.tunnel_mint.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.protocol.to_account_info(),
                },
                signer_seeds,
            ),
            tokens,
            ctx.accounts.tunnel_mint.decimals,
        )?;
    }

    position.claimed = true;
    position.lamports_paid = lamports;
    position.tokens_paid = tokens;
    round.claims = round.claims.checked_add(1).ok_or(TunnelError::MathOverflow)?;
    round.lamports_claimed = round.lamports_claimed.checked_add(lamports).ok_or(TunnelError::MathOverflow)?;
    round.tokens_claimed = round.tokens_claimed.checked_add(tokens).ok_or(TunnelError::MathOverflow)?;

    emit!(RewardClaimed {
        round_id,
        owner: position.owner,
        lamports,
        tokens,
        outcome: outcome_code(round.outcome),
    });
    Ok(())
}

// ---------------------------------------------------------------- sweep

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct SweepRound<'info> {
    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [ROUND_VAULT_SEED, &round_id.to_le_bytes()],
        bump = round.vault_bump,
        close = treasury_vault,
    )]
    pub round_vault: Account<'info, RoundVault>,
    #[account(mut, seeds = [TREASURY_VAULT_SEED], bump = treasury_vault.bump)]
    pub treasury_vault: Account<'info, TreasuryVault>,
}

/// Permissionless, only after every participant has claimed. Rounding dust
/// (at most one lamport / base unit per participant) and the vault rent go to
/// the treasury vault; unclaimed-by-rounding $TUNNEL returns to the mining reserve.
pub fn sweep_round(ctx: Context<SweepRound>, round_id: u64) -> Result<()> {
    let round = &mut ctx.accounts.round;
    require!(
        matches!(round.status, RoundStatus::Settled | RoundStatus::Failed),
        TunnelError::RoundNotSettled
    );
    require!(!round.swept, TunnelError::AlreadySwept);
    require!(round.claims == round.participants, TunnelError::ClaimsOutstanding);

    let lamports = ctx.accounts.round_vault.to_account_info().lamports();
    let token_dust = if round.outcome == RoundOutcome::Rewards {
        round.emission_budget.checked_sub(round.tokens_claimed).ok_or(TunnelError::MathOverflow)?
    } else {
        0
    };
    let protocol = &mut ctx.accounts.protocol;
    protocol.reserve_available = protocol.reserve_available.checked_add(token_dust).ok_or(TunnelError::MathOverflow)?;
    protocol.total_tokens_allocated = protocol.total_tokens_allocated.saturating_sub(token_dust);
    round.swept = true;

    emit!(RoundSwept { round_id, lamports_to_treasury: lamports, tokens_returned_to_reserve: token_dust });
    Ok(())
}
