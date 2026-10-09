use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::errors::TunnelError;
use crate::events::*;
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
    #[account(
        init,
        payer = admin,
        space = 8 + TreasuryVault::INIT_SPACE,
        seeds = [TREASURY_VAULT_SEED],
        bump
    )]
    pub treasury_vault: Account<'info, TreasuryVault>,
    /// Only the program's upgrade authority may initialize, which prevents
    /// anyone front-running initialization with their own config.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, Tunnel>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ TunnelError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>, treasury: Pubkey, params: ProtocolParams) -> Result<()> {
    params.validate()?;
    ctx.accounts.treasury_vault.bump = ctx.bumps.treasury_vault;
    let protocol = &mut ctx.accounts.protocol;
    protocol.set_inner(Protocol {
        admin: ctx.accounts.admin.key(),
        pending_admin: None,
        treasury,
        tunnel_mint: ctx.accounts.tunnel_mint.key(),
        reward_vault: ctx.accounts.reward_vault.key(),
        params,
        paused: false,
        next_round_id: 0,
        last_round_open_ts: 0,
        last_round_close_ts: 0,
        reserve_available: 0,
        reserve_funded_total: 0,
        total_lamports_committed: 0,
        total_particles: 0,
        total_successes: 0,
        total_tokens_allocated: 0,
        total_fees_lamports: 0,
        rounds_settled: 0,
        bump: ctx.bumps.protocol,
        reward_vault_bump: ctx.bumps.reward_vault,
    });
    emit!(ProtocolInitialized {
        admin: protocol.admin,
        treasury,
        tunnel_mint: protocol.tunnel_mint,
        reward_vault: protocol.reward_vault,
        params,
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

/// Takes effect for rounds opened after this call. Existing rounds keep the
/// snapshot taken in `open_round`, so odds can never change under a deposit.
pub fn update_params(ctx: Context<AdminOnly>, params: ProtocolParams) -> Result<()> {
    params.validate()?;
    ctx.accounts.protocol.params = params;
    emit!(ParamsUpdated { params });
    Ok(())
}

/// Pausing blocks new rounds and new deposits only. Closing, settlement,
/// claims and refunds always remain available so funds can never be frozen.
pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.protocol.paused = paused;
    emit!(PauseChanged { paused });
    Ok(())
}

pub fn set_treasury(ctx: Context<AdminOnly>, treasury: Pubkey) -> Result<()> {
    ctx.accounts.protocol.treasury = treasury;
    emit!(TreasuryChanged { treasury });
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

// ---------------------------------------------------------------- fees

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    #[account(seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [TREASURY_VAULT_SEED], bump = treasury_vault.bump)]
    pub treasury_vault: Account<'info, TreasuryVault>,
    /// CHECK: lamport recipient only; must equal the configured treasury.
    #[account(mut, address = protocol.treasury @ TunnelError::TreasuryMismatch)]
    pub treasury: UncheckedAccount<'info>,
}

/// Permissionless: forwards accumulated fees (everything above the vault's
/// rent-exempt minimum) to the configured treasury. The destination is fixed
/// by the Protocol account, so calling it can only ever pay the treasury.
pub fn withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
    let info = ctx.accounts.treasury_vault.to_account_info();
    let floor = Rent::get()?.minimum_balance(info.data_len());
    let amount = info.lamports().saturating_sub(floor);
    require!(amount > 0, TunnelError::ZeroAmount);
    ctx.accounts.treasury_vault.sub_lamports(amount)?;
    ctx.accounts.treasury.add_lamports(amount)?;
    emit!(FeesWithdrawn { treasury: ctx.accounts.treasury.key(), lamports: amount });
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

/// Anyone may add $TUNNEL to the mining reserve. Tokens can only leave the
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
