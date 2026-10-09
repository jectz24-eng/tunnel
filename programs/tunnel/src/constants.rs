//! Protocol-wide constants and PDA seeds.

pub const PROTOCOL_SEED: &[u8] = b"protocol";
pub const REWARD_VAULT_SEED: &[u8] = b"reward_vault";
pub const ROUND_SEED: &[u8] = b"round";
pub const ROUND_VAULT_SEED: &[u8] = b"round_vault";
pub const POSITION_SEED: &[u8] = b"position";
pub const TREASURY_VAULT_SEED: &[u8] = b"treasury_vault";

/// Domain separator for per-particle outcome hashes. Bumping the version
/// changes every outcome, so it is part of the verification spec.
pub const PARTICLE_DOMAIN: &[u8] = b"TUNNEL/particle/v1";
/// Domain separator for VRF seeds requested at round close.
pub const VRF_SEED_DOMAIN: &[u8] = b"TUNNEL/vrf-seed/v1";

pub const BARRIER_COUNT: usize = 3;
pub const BPS_DENOMINATOR: u64 = 10_000;

// ---- Parameter bounds (enforced on every params update) ----
pub const MAX_PROTOCOL_FEE_BPS: u16 = 1_000; // 10% hard cap
pub const MIN_TRANSMISSION_BPS: u16 = 1;
pub const MAX_TRANSMISSION_BPS: u16 = 9_999;
pub const MIN_REWARD_WEIGHT: u16 = 1;
pub const MAX_REWARD_WEIGHT: u16 = 1_000;
pub const MIN_PARTICLE_COST_LAMPORTS: u64 = 1_000_000; // 0.001 SOL
pub const MIN_ROUND_DURATION_SECS: u32 = 30;
pub const MAX_ROUND_DURATION_SECS: u32 = 3_600;
/// Upper bound keeps `settle_position` inside the compute budget
/// (one SHA-256 syscall per particle).
pub const MAX_PARTICLES_PER_POSITION_LIMIT: u16 = 250;
pub const MIN_RANDOMNESS_TIMEOUT_SECS: u32 = 120;
pub const MAX_RANDOMNESS_TIMEOUT_SECS: u32 = 86_400;
pub const MAX_EMISSION_DECAY_BPS: u16 = 10_000;
