use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;
use orao_solana_vrf::cpi::accounts::RequestV2;
use orao_solana_vrf::program::OraoVrf;
use orao_solana_vrf::state::RandomnessAccountData;
use anchor_lang::solana_program::sysvar::slot_hashes;
use orao_solana_vrf::{CONFIG_ACCOUNT_SEED, RANDOMNESS_ACCOUNT_SEED};

use crate::constants::*;
use crate::errors::TunnelError;
use crate::events::*;
use crate::math;
use crate::state::*;

// ---------------------------------------------------------------- open

#[derive(Accounts)]
pub struct OpenRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(
        init,
        payer = payer,
        space = 8 + Round::INIT_SPACE,
        seeds = [ROUND_SEED, &protocol.next_round_id.to_le_bytes()],
        bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        init,
        payer = payer,
        space = 8 + RoundVault::INIT_SPACE,
        seeds = [ROUND_VAULT_SEED, &protocol.next_round_id.to_le_bytes()],
        bump
    )]
    pub round_vault: Account<'info, RoundVault>,
    pub system_program: Program<'info, System>,
}

/// Permissionless. Schedules the next round to start when the current one
/// ends (or now, if there is a gap). At most one round can be UPCOMING.
/// All odds, weights, fees and the $TUNNEL budget are snapshotted here,
/// before the round can accept any deposit.
pub fn open_round(ctx: Context<OpenRound>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let protocol = &mut ctx.accounts.protocol;
    require!(!protocol.paused, TunnelError::Paused);
    let id = protocol.next_round_id;
    if id > 0 {
        // The previous round must already have started.
        require!(now >= protocol.last_round_open_ts, TunnelError::RoundScheduleConflict);
    }
    let open_ts = now.max(protocol.last_round_close_ts);
    let p = protocol.params;
    let close_ts = open_ts
        .checked_add(p.round_duration_secs as i64)
        .ok_or(TunnelError::MathOverflow)?;

    let budget = math::scheduled_emission(&p, id).min(protocol.reserve_available);
    protocol.reserve_available -= budget;
    protocol.next_round_id = id.checked_add(1).ok_or(TunnelError::MathOverflow)?;
    protocol.last_round_open_ts = open_ts;
    protocol.last_round_close_ts = close_ts;

    ctx.accounts.round_vault.set_inner(RoundVault { round_id: id, bump: ctx.bumps.round_vault });
    ctx.accounts.round.set_inner(Round {
        id,
        status: RoundStatus::Open,
        outcome: RoundOutcome::Pending,
        bump: ctx.bumps.round,
        vault_bump: ctx.bumps.round_vault,
        open_ts,
        close_ts,
        closed_ts: 0,
        barriers: p.barriers,
        particle_cost_lamports: p.particle_cost_lamports,
        protocol_fee_bps: p.protocol_fee_bps,
        max_particles_per_position: p.max_particles_per_position,
        randomness_timeout_secs: p.randomness_timeout_secs,
        emission_budget: budget,
        particles: [0; BARRIER_COUNT],
        total_lamports: 0,
        participants: 0,
        vrf_seed: [0; 32],
        randomness_requested_ts: 0,
        randomness: [0; 64],
        positions_settled: 0,
        successes: [0; BARRIER_COUNT],
        total_success_weight: 0,
        fee_lamports: 0,
        distributable_lamports: 0,
        settled_ts: 0,
        claims: 0,
        lamports_claimed: 0,
        tokens_claimed: 0,
        swept: false,
    });

    emit!(RoundOpened {
        round_id: id,
        open_ts,
        close_ts,
        barriers: p.barriers,
        particle_cost_lamports: p.particle_cost_lamports,
        protocol_fee_bps: p.protocol_fee_bps,
        emission_budget: budget,
    });
    Ok(())
}

// ---------------------------------------------------------------- close

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct CloseRound<'info> {
    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    /// CHECK: the SlotHashes sysvar, read as raw bytes (too large to deserialize).
    #[account(address = slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
}

/// Most recent `(slot, hash)` entry of the SlotHashes sysvar.
/// Layout: `u64 len` followed by `len × (u64 slot, [u8; 32] hash)`, newest first.
fn latest_slot_hash(info: &AccountInfo) -> Result<(u64, [u8; 32])> {
    let data = info.try_borrow_data()?;
    require!(data.len() >= 48, TunnelError::SlotHashesUnavailable);
    let len = u64::from_le_bytes(data[0..8].try_into().unwrap());
    require!(len > 0, TunnelError::SlotHashesUnavailable);
    let slot = u64::from_le_bytes(data[8..16].try_into().unwrap());
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&data[16..48]);
    Ok((slot, hash))
}

/// VRF seed for a round. It mixes in the newest slot hash at close time, so it
/// cannot be known (by participants or by VRF operators) while deposits are
/// open, and the cranker cannot grind it.
pub fn vrf_seed_for(round_key: &Pubkey, round_id: u64, slot: u64, slot_hash: &[u8; 32]) -> [u8; 32] {
    let mut seed = hashv(&[
        VRF_SEED_DOMAIN,
        crate::ID.as_ref(),
        round_key.as_ref(),
        &round_id.to_le_bytes(),
        &slot.to_le_bytes(),
        slot_hash,
    ])
    .to_bytes();
    if seed == [0u8; 32] {
        seed[0] = 1; // ORAO rejects the all-zero seed
    }
    seed
}

/// Permissionless once the deposit window has ended. Empty rounds settle
/// immediately; otherwise the VRF seed is fixed and the round becomes Closed.
pub fn close_round(ctx: Context<CloseRound>, round_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let round_key = ctx.accounts.round.key();
    let round = &mut ctx.accounts.round;
    require!(round.status == RoundStatus::Open, TunnelError::RoundNotOpen);
    require!(now >= round.close_ts, TunnelError::RoundStillOpen);
    round.closed_ts = now;

    if round.participants == 0 {
        let protocol = &mut ctx.accounts.protocol;
        protocol.reserve_available = protocol
            .reserve_available
            .checked_add(round.emission_budget)
            .ok_or(TunnelError::MathOverflow)?;
        protocol.rounds_settled = protocol.rounds_settled.saturating_add(1);
        round.status = RoundStatus::Settled;
        round.outcome = RoundOutcome::Empty;
        round.settled_ts = now;
        emit!(RoundFinalized {
            round_id,
            outcome: 4,
            total_lamports: 0,
            fee_lamports: 0,
            distributable_lamports: 0,
            successes: [0; BARRIER_COUNT],
            total_success_weight: 0,
            emission_budget: round.emission_budget,
            tokens_allocated: 0,
        });
        return Ok(());
    }

    let (slot, hash) = latest_slot_hash(&ctx.accounts.slot_hashes.to_account_info())?;
    let seed = vrf_seed_for(&round_key, round_id, slot, &hash);
    round.vrf_seed = seed;
    round.status = RoundStatus::Closed;
    emit!(RoundClosed {
        round_id,
        vrf_seed: seed,
        participants: round.participants,
        total_lamports: round.total_lamports,
        particles: round.particles,
        closed_ts: now,
    });
    Ok(())
}

// ---------------------------------------------------------------- request VRF

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct RequestRandomness<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    /// CHECK: ORAO randomness request PDA for this round's seed. ORAO creates it.
    #[account(
        mut,
        seeds = [RANDOMNESS_ACCOUNT_SEED, round.vrf_seed.as_ref()],
        bump,
        seeds::program = orao_solana_vrf::ID
    )]
    pub vrf_request: UncheckedAccount<'info>,
    /// CHECK: ORAO network state PDA, validated by seeds and by ORAO itself.
    #[account(mut, seeds = [CONFIG_ACCOUNT_SEED], bump, seeds::program = orao_solana_vrf::ID)]
    pub vrf_config: UncheckedAccount<'info>,
    /// CHECK: ORAO fee treasury; ORAO validates it against its network state.
    #[account(mut)]
    pub vrf_treasury: UncheckedAccount<'info>,
    pub vrf_program: Program<'info, OraoVrf>,
    pub system_program: Program<'info, System>,
}

/// Permissionless. Requests ORAO VRF randomness for the round's fixed seed;
/// the cranker pays ORAO's fee. If someone already requested this exact seed
/// directly from ORAO, no CPI is needed: the output depends only on the seed.
pub fn request_randomness(ctx: Context<RequestRandomness>, round_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(ctx.accounts.round.status == RoundStatus::Closed, TunnelError::RoundNotClosed);
    let seed = ctx.accounts.round.vrf_seed;

    let existing = ctx.accounts.vrf_request.to_account_info();
    let already_requested = existing.owner == &orao_solana_vrf::ID && !existing.data_is_empty();
    if !already_requested {
        orao_solana_vrf::cpi::request_v2(
            CpiContext::new(
                ctx.accounts.vrf_program.to_account_info(),
                RequestV2 {
                    payer: ctx.accounts.cranker.to_account_info(),
                    network_state: ctx.accounts.vrf_config.to_account_info(),
                    treasury: ctx.accounts.vrf_treasury.to_account_info(),
                    request: ctx.accounts.vrf_request.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
            ),
            seed,
        )?;
    }

    let round = &mut ctx.accounts.round;
    round.randomness_requested_ts = now;
    round.status = RoundStatus::AwaitingRandomness;
    emit!(RandomnessRequested { round_id, vrf_seed: seed, requested_ts: now });
    Ok(())
}

// ---------------------------------------------------------------- reveal

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct RevealRandomness<'info> {
    #[account(mut, seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    /// CHECK: must be ORAO's request PDA for this round's seed and owned by ORAO.
    #[account(
        seeds = [RANDOMNESS_ACCOUNT_SEED, round.vrf_seed.as_ref()],
        bump,
        seeds::program = orao_solana_vrf::ID,
        owner = orao_solana_vrf::ID @ TunnelError::RandomnessAccountMismatch,
    )]
    pub vrf_request: UncheckedAccount<'info>,
}

/// Permissionless. Copies ORAO's fulfilled 64-byte randomness into the round.
/// Accepted from `Closed` too, in case the seed was requested directly at ORAO.
pub fn reveal_randomness(ctx: Context<RevealRandomness>, round_id: u64) -> Result<()> {
    let round = &mut ctx.accounts.round;
    require!(
        matches!(round.status, RoundStatus::Closed | RoundStatus::AwaitingRandomness),
        TunnelError::NotAwaitingRandomness
    );
    let info = ctx.accounts.vrf_request.to_account_info();
    let data = info.try_borrow_data()?;
    let account = RandomnessAccountData::try_deserialize(&mut &data[..])?;
    require!(account.seed() == &round.vrf_seed, TunnelError::RandomnessAccountMismatch);
    let randomness = account
        .fulfilled_randomness()
        .ok_or(TunnelError::RandomnessNotFulfilled)?;
    round.randomness = *randomness;
    round.status = RoundStatus::Resolving;
    emit!(RandomnessRevealed { round_id, randomness: *randomness });
    Ok(())
}

// ---------------------------------------------------------------- recover

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct RecoverRound<'info> {
    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [ROUND_SEED, &round_id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, Round>,
    /// CHECK: ORAO request PDA for the round's seed (may not exist). Checked so
    /// that a round whose randomness is already public can only be revealed.
    #[account(seeds = [RANDOMNESS_ACCOUNT_SEED, round.vrf_seed.as_ref()], bump, seeds::program = orao_solana_vrf::ID)]
    pub vrf_request: UncheckedAccount<'info>,
}

/// Permissionless liveness escape hatch. If a round stalls before randomness
/// is revealed for longer than its snapshotted timeout, it fails and every
/// participant can reclaim 100% of their deposit (no fee).
///
/// Refused while fulfilled randomness exists onchain: otherwise a participant
/// who saw an unfavourable (but unrevealed) result could wait out the timeout
/// and turn a loss into a refund.
pub fn recover_round(ctx: Context<RecoverRound>, round_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    {
        let info = ctx.accounts.vrf_request.to_account_info();
        if info.owner == &orao_solana_vrf::ID && !info.data_is_empty() {
            let data = info.try_borrow_data()?;
            if let Ok(acc) = RandomnessAccountData::try_deserialize(&mut &data[..]) {
                require!(acc.fulfilled_randomness().is_none(), TunnelError::RandomnessAvailable);
            }
        }
    }
    let round = &mut ctx.accounts.round;
    let timeout = round.randomness_timeout_secs as i64;
    let reason = match round.status {
        RoundStatus::Open if round.participants > 0 && now > round.close_ts + timeout => 0u8,
        RoundStatus::Closed if now > round.closed_ts + timeout => 0u8,
        RoundStatus::AwaitingRandomness if now > round.randomness_requested_ts + timeout => 1u8,
        _ => return err!(TunnelError::RecoveryNotAvailable),
    };
    let protocol = &mut ctx.accounts.protocol;
    protocol.reserve_available = protocol
        .reserve_available
        .checked_add(round.emission_budget)
        .ok_or(TunnelError::MathOverflow)?;
    protocol.rounds_settled = protocol.rounds_settled.saturating_add(1);
    round.status = RoundStatus::Failed;
    round.outcome = RoundOutcome::FullRefund;
    round.fee_lamports = 0;
    round.distributable_lamports = round.total_lamports;
    round.settled_ts = now;
    emit!(RoundFailed { round_id, reason });
    emit!(RoundFinalized {
        round_id,
        outcome: 3,
        total_lamports: round.total_lamports,
        fee_lamports: 0,
        distributable_lamports: round.total_lamports,
        successes: [0; BARRIER_COUNT],
        total_success_weight: 0,
        emission_budget: round.emission_budget,
        tokens_allocated: 0,
    });
    Ok(())
}
