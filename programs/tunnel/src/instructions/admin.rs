use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::errors::TunnelError;
use crate::events::*;
use crate::math;
use crate::program::Tunnel;
use crate::state::*;

// ---------------------------------------------------------------- initialize

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Protocol::INIT_SPACE,
        seeds = [PROTOCOL_SEED],
        bump
    )]
    pub protocol: Account<'info, Protocol>,
    pub tunnel_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = admin,
        seeds = [REWARD_VAULT_SEED],
        bump,
        token::mint = tunnel_mint,
        token::authority = protocol,
        token::token_program = token_program,
    )]
    pub reward_vault: Account<'info, TokenAccount>,
    /// Only the program's upgrade authority may initialize, which prevents
    /// anyone front-running initialization with their own config.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, Tunnel>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ TunnelError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>, gatekeeper: Pubkey, params: ProtocolParams) -> Result<()> {
    params.validate()?;
    let odds = math::derive_odds(&params)?;
    let protocol = &mut ctx.accounts.protocol;
    protocol.set_inner(Protocol {
        admin: ctx.accounts.admin.key(),
        pending_admin: None,
        gatekeeper,
        tunnel_mint: ctx.accounts.tunnel_mint.key(),
        reward_vault: ctx.accounts.reward_vault.key(),
        params,
        odds,
        paused: false,
        next_cycle_id: 0,
        last_cycle_open_ts: 0,
        last_cycle_close_ts: 0,
        reserve_available: 0,
        reserve_funded_total: 0,
        total_experiments: 0,
        total_particles: 0,
        total_energy: 0,
        total_successes: 0,
        total_tokens_allocated: 0,
        total_tokens_claimed: 0,
        cycles_settled: 0,
        bump: ctx.bumps.protocol,
        reward_vault_bump: ctx.bumps.reward_vault,
    });
    emit!(ProtocolInitialized {
        admin: protocol.admin,
        gatekeeper,
        tunnel_mint: protocol.tunnel_mint,
        reward_vault: protocol.reward_vault,
        params,
        odds,
    });
    Ok(())
}

// ---------------------------------------------------------------- admin-only

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        has_one = admin @ TunnelError::Unauthorized,
    )]
    pub protocol: Account<'info, Protocol>,
}

/// Takes effect for cycles opened after this call. Existing cycles keep the
/// snapshot taken in `open_cycle`, so odds can never change under a deployment.
/// The odds table is re-derived from the physics model here; it cannot be set directly.
pub fn update_params(ctx: Context<AdminOnly>, params: ProtocolParams) -> Result<()> {
    params.validate()?;
    let odds = math::derive_odds(&params)?;
    let protocol = &mut ctx.accounts.protocol;
    protocol.params = params;
    protocol.odds = odds;
    emit!(ParamsUpdated { params, odds });
    Ok(())
}

/// Pausing blocks new cycles and new deployments only. Closing, settlement,
/// claims and voiding always remain available so rewards can never be frozen.
pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.protocol.paused = paused;
    emit!(PauseChanged { paused });
    Ok(())
}

/// `Pubkey::default()` disables the co-signing requirement.
pub fn set_gatekeeper(ctx: Context<AdminOnly>, gatekeeper: Pubkey) -> Result<()> {
    ctx.accounts.protocol.gatekeeper = gatekeeper;
    emit!(GatekeeperChanged { gatekeeper });
    Ok(())
}

pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
    ctx.accounts.protocol.pending_admin = Some(new_admin);
    emit!(AdminProposed { pending_admin: new_admin });
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
}

pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let protocol = &mut ctx.accounts.protocol;
    require!(
        protocol.pending_admin == Some(ctx.accounts.new_admin.key()),
        TunnelError::NotPendingAdmin
    );
    protocol.admin = ctx.accounts.new_admin.key();
    protocol.pending_admin = None;
    emit!(AdminAccepted { admin: protocol.admin });
    Ok(())
}

// ---------------------------------------------------------------- reserve

#[derive(Accounts)]
pub struct FundReserve<'info> {
    pub funder: Signer<'info>,
    #[account(
        mut,
        seeds = [PROTOCOL_SEED],
        bump = protocol.bump,
        has_one = tunnel_mint,
        has_one = reward_vault,
    )]
    pub protocol: Account<'info, Protocol>,
    pub tunnel_mint: Account<'info, Mint>,
    #[account(mut)]
    pub reward_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = tunnel_mint,
        token::authority = funder,
    )]
    pub funder_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// Anyone may add $TUNNEL to the emissions reserve. Tokens can only leave the
/// vault through `claim`, so the reserve can never be withdrawn by the admin.
pub fn fund_reserve(ctx: Context<FundReserve>, amount: u64) -> Result<()> {
    require!(amount > 0, TunnelError::ZeroAmount);
    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.funder_token_account.to_account_info(),
                mint: ctx.accounts.tunnel_mint.to_account_info(),
                to: ctx.accounts.reward_vault.to_account_info(),
                authority: ctx.accounts.funder.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.tunnel_mint.decimals,
    )?;
    let protocol = &mut ctx.accounts.protocol;
    protocol.reserve_available = protocol
        .reserve_available
        .checked_add(amount)
        .ok_or(TunnelError::MathOverflow)?;
    protocol.reserve_funded_total = protocol
        .reserve_funded_total
        .checked_add(amount)
        .ok_or(TunnelError::MathOverflow)?;
    emit!(ReserveFunded {
        funder: ctx.accounts.funder.key(),
        amount,
        reserve_available: protocol.reserve_available,
    });
    Ok(())
}
