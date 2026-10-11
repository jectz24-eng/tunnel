use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::slot_hashes;
use orao_solana_vrf::cpi::accounts::RequestV2;
use orao_solana_vrf::program::OraoVrf;
use orao_solana_vrf::state::RandomnessAccountData;
use orao_solana_vrf::{CONFIG_ACCOUNT_SEED, RANDOMNESS_ACCOUNT_SEED};
use solana_sha256_hasher::hashv;

use crate::constants::*;
use crate::errors::TunnelError;
use crate::events::*;
use crate::math;
use crate::state::*;

// ---------------------------------------------------------------- open

#[derive(Accounts)]
pub struct OpenCycle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(
        init,
        payer = payer,
        space = 8 + Cycle::INIT_SPACE,
        seeds = [CYCLE_SEED, &protocol.next_cycle_id.to_le_bytes()],
        bump
    )]
    pub cycle: Account<'info, Cycle>,
    pub system_program: Program<'info, System>,
}

/// Permissionless. Schedules the next cycle to start when the current one
/// ends (or now, if there is a gap). At most one cycle can be UPCOMING.
/// Barriers, odds, rewards, the energy allowance and the $TUNNEL budget are
/// snapshotted here, before the cycle can accept any particle.
pub fn open_cycle(ctx: Context<OpenCycle>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let protocol = &mut ctx.accounts.protocol;
    require!(!protocol.paused, TunnelError::Paused);
    let id = protocol.next_cycle_id;
    if id > 0 {
        // The previous cycle must already have started.
        require!(now >= protocol.last_cycle_open_ts, TunnelError::CycleScheduleConflict);
    }
    let open_ts = now.max(protocol.last_cycle_close_ts);
    let p = protocol.params;
    let close_ts = open_ts
        .checked_add(p.cycle_duration_secs as i64)
        .ok_or(TunnelError::MathOverflow)?;

    let budget = math::scheduled_emission(&p, id).min(protocol.reserve_available);
    protocol.reserve_available -= budget;
    protocol.next_cycle_id = id.checked_add(1).ok_or(TunnelError::MathOverflow)?;
    protocol.last_cycle_open_ts = open_ts;
    protocol.last_cycle_close_ts = close_ts;

    ctx.accounts.cycle.set_inner(Cycle {
        id,
        status: CycleStatus::Open,
        outcome: CycleOutcome::Pending,
        bump: ctx.bumps.cycle,
        open_ts,
        close_ts,
        closed_ts: 0,
        barriers: p.barriers,
        levels: p.levels,
        odds: protocol.odds,
        energy_per_cycle: p.energy_per_cycle,
        randomness_timeout_secs: p.randomness_timeout_secs,
        emission_budget: budget,
        participants: 0,
        experiments: 0,
        particles: [0; BARRIER_COUNT],
        energy_used: 0,
        vrf_seed: [0; 32],
        randomness_requested_ts: 0,
        randomness: [0; 64],
        positions_settled: 0,
        successes: [0; BARRIER_COUNT],
        total_nominal: 0,
        tokens_allocated: 0,
        settled_ts: 0,
        claims: 0,
        tokens_claimed: 0,
        swept: false,
    });

    emit!(CycleOpened {
        cycle_id: id,
        open_ts,
        close_ts,
        energy_per_cycle: p.energy_per_cycle,
        emission_budget: budget,
    });
    Ok(())
}

// ---------------------------------------------------------------- close

#[derive(Accounts)]
#[instruction(cycle_id: u64)]
pub struct CloseCycle<'info> {
    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [CYCLE_SEED, &cycle_id.to_le_bytes()], bump = cycle.bump)]
    pub cycle: Account<'info, Cycle>,
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

/// VRF seed for a cycle. It mixes in the newest slot hash at close time, so it
/// cannot be known (by participants or by VRF operators) while deployments are
/// open, and the cranker cannot grind it.
pub fn vrf_seed_for(cycle_key: &Pubkey, cycle_id: u64, slot: u64, slot_hash: &[u8; 32]) -> [u8; 32] {
    let mut seed = hashv(&[
        VRF_SEED_DOMAIN,
        crate::ID.as_ref(),
        cycle_key.as_ref(),
        &cycle_id.to_le_bytes(),
        &slot.to_le_bytes(),
        slot_hash,
    ])
    .to_bytes();
    if seed == [0u8; 32] {
        seed[0] = 1; // ORAO rejects the all-zero seed
    }
    seed
}

/// Permissionless once the deployment window has ended. Empty cycles settle
/// immediately; otherwise the VRF seed is fixed and the cycle becomes Closed.
pub fn close_cycle(ctx: Context<CloseCycle>, cycle_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let cycle_key = ctx.accounts.cycle.key();
    let cycle = &mut ctx.accounts.cycle;
    require!(cycle.status == CycleStatus::Open, TunnelError::CycleNotOpen);
    require!(now >= cycle.close_ts, TunnelError::CycleStillOpen);
    cycle.closed_ts = now;

    if cycle.participants == 0 {
        let protocol = &mut ctx.accounts.protocol;
        protocol.reserve_available = protocol
            .reserve_available
            .checked_add(cycle.emission_budget)
            .ok_or(TunnelError::MathOverflow)?;
        protocol.cycles_settled = protocol.cycles_settled.saturating_add(1);
        cycle.status = CycleStatus::Settled;
        cycle.outcome = CycleOutcome::Empty;
        cycle.settled_ts = now;
        emit!(CycleFinalized {
            cycle_id,
            outcome: 4,
            successes: [0; BARRIER_COUNT],
            total_nominal: 0,
            emission_budget: cycle.emission_budget,
            tokens_allocated: 0,
            returned_to_reserve: cycle.emission_budget,
        });
        return Ok(());
    }

    let (slot, hash) = latest_slot_hash(&ctx.accounts.slot_hashes.to_account_info())?;
    let seed = vrf_seed_for(&cycle_key, cycle_id, slot, &hash);
    cycle.vrf_seed = seed;
    cycle.status = CycleStatus::Closed;
    emit!(CycleClosed {
        cycle_id,
        vrf_seed: seed,
        participants: cycle.participants,
        experiments: cycle.experiments,
        particles: cycle.particles,
        energy_used: cycle.energy_used,
        closed_ts: now,
    });
    Ok(())
}

// ---------------------------------------------------------------- request VRF

#[derive(Accounts)]
#[instruction(cycle_id: u64)]
pub struct RequestRandomness<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [CYCLE_SEED, &cycle_id.to_le_bytes()], bump = cycle.bump)]
    pub cycle: Account<'info, Cycle>,
    /// CHECK: ORAO randomness request PDA for this cycle's seed. ORAO creates it.
    #[account(
        mut,
        seeds = [RANDOMNESS_ACCOUNT_SEED, cycle.vrf_seed.as_ref()],
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

/// Permissionless. Requests ORAO VRF randomness for the cycle's fixed seed;
/// the cranker pays ORAO's fee. If someone already requested this exact seed
/// directly from ORAO, no CPI is needed: the output depends only on the seed.
pub fn request_randomness(ctx: Context<RequestRandomness>, cycle_id: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(ctx.accounts.cycle.status == CycleStatus::Closed, TunnelError::CycleNotClosed);
    let seed = ctx.accounts.cycle.vrf_seed;

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

    let cycle = &mut ctx.accounts.cycle;
    cycle.randomness_requested_ts = now;
    cycle.status = CycleStatus::AwaitingRandomness;
    emit!(RandomnessRequested { cycle_id, vrf_seed: seed, requested_ts: now });
    Ok(())
}

// ---------------------------------------------------------------- reveal

#[derive(Accounts)]
#[instruction(cycle_id: u64)]
pub struct RevealRandomness<'info> {
    #[account(mut, seeds = [CYCLE_SEED, &cycle_id.to_le_bytes()], bump = cycle.bump)]
    pub cycle: Account<'info, Cycle>,
    /// CHECK: must be ORAO's request PDA for this cycle's seed and owned by ORAO.
    #[account(
        seeds = [RANDOMNESS_ACCOUNT_SEED, cycle.vrf_seed.as_ref()],
        bump,
        seeds::program = orao_solana_vrf::ID,
        owner = orao_solana_vrf::ID @ TunnelError::RandomnessAccountMismatch,
    )]
    pub vrf_request: UncheckedAccount<'info>,
}

/// Permissionless. Copies ORAO's fulfilled 64-byte randomness into the cycle.
/// Accepted from `Closed` too, in case the seed was requested directly at ORAO.
pub fn reveal_randomness(ctx: Context<RevealRandomness>, cycle_id: u64) -> Result<()> {
    let cycle = &mut ctx.accounts.cycle;
    require!(
        matches!(cycle.status, CycleStatus::Closed | CycleStatus::AwaitingRandomness),
        TunnelError::NotAwaitingRandomness
    );
    let info = ctx.accounts.vrf_request.to_account_info();
    let data = info.try_borrow_data()?;
    let account = RandomnessAccountData::try_deserialize(&mut &data[..])?;
    require!(account.seed() == &cycle.vrf_seed, TunnelError::RandomnessAccountMismatch);
    let randomness = account
        .fulfilled_randomness()
        .ok_or(TunnelError::RandomnessNotFulfilled)?;
    cycle.randomness = *randomness;
    cycle.status = CycleStatus::Resolving;
    emit!(RandomnessRevealed { cycle_id, randomness: *randomness });
    Ok(())
}

// ---------------------------------------------------------------- void

#[derive(Accounts)]
#[instruction(cycle_id: u64)]
pub struct VoidCycle<'info> {
    #[account(mut, seeds = [PROTOCOL_SEED], bump = protocol.bump)]
    pub protocol: Account<'info, Protocol>,
    #[account(mut, seeds = [CYCLE_SEED, &cycle_id.to_le_bytes()], bump = cycle.bump)]
    pub cycle: Account<'info, Cycle>,
    /// CHECK: ORAO request PDA for the cycle's seed (may not exist). Checked so
    /// that a cycle whose randomness is already public can only be revealed.
    #[account(seeds = [RANDOMNESS_ACCOUNT_SEED, cycle.vrf_seed.as_ref()], bump, seeds::program = orao_solana_vrf::ID)]
    pub vrf_request: UncheckedAccount<'info>,
}

/// Permissionless liveness escape hatch. If a cycle stalls before randomness
/// is revealed for longer than its snapshotted timeout, it is voided: no
/// particle has an outcome, nobody is rewarded, the budget returns to the
/// reserve and positions can be closed to recover their rent.
///
/// Refused while fulfilled randomness exists onchain, so a known (but
/// unrevealed) result can never be discarded.
pub fn void_cycle(ctx: Context<VoidCycle>, cycle_id: u64) -> Result<()> {
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
    let cycle = &mut ctx.accounts.cycle;
    let timeout = cycle.randomness_timeout_secs as i64;
    let reason = match cycle.status {
        CycleStatus::Open if cycle.participants > 0 && now > cycle.close_ts + timeout => 0u8,
        CycleStatus::Closed if now > cycle.closed_ts + timeout => 0u8,
        CycleStatus::AwaitingRandomness if now > cycle.randomness_requested_ts + timeout => 1u8,
        _ => return err!(TunnelError::RecoveryNotAvailable),
    };
    let protocol = &mut ctx.accounts.protocol;
    protocol.reserve_available = protocol
        .reserve_available
        .checked_add(cycle.emission_budget)
        .ok_or(TunnelError::MathOverflow)?;
    protocol.cycles_settled = protocol.cycles_settled.saturating_add(1);
    cycle.status = CycleStatus::Void;
    cycle.outcome = CycleOutcome::Void;
    cycle.settled_ts = now;
    emit!(CycleVoided { cycle_id, reason });
    emit!(CycleFinalized {
        cycle_id,
        outcome: 3,
        successes: [0; BARRIER_COUNT],
        total_nominal: 0,
        emission_budget: cycle.emission_budget,
        tokens_allocated: 0,
        returned_to_reserve: cycle.emission_budget,
    });
    Ok(())
}
