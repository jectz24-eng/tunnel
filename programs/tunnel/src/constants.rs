//! Protocol-wide constants and PDA seeds.

pub const PROTOCOL_SEED: &[u8] = b"protocol";
pub const REWARD_VAULT_SEED: &[u8] = b"reward_vault";
pub const CYCLE_SEED: &[u8] = b"cycle";
pub const POSITION_SEED: &[u8] = b"position";

/// Domain separator for per-particle outcome hashes. Bumping the version
/// changes every outcome, so it is part of the verification spec.
pub const PARTICLE_DOMAIN: &[u8] = b"TUNNEL/particle/v2";
/// Domain separator for VRF seeds requested at cycle close.
pub const VRF_SEED_DOMAIN: &[u8] = b"TUNNEL/vrf-seed/v2";

pub const BARRIER_COUNT: usize = 3;
pub const ENERGY_LEVELS: usize = 5;
pub const BPS_DENOMINATOR: u64 = 10_000;
/// Transmission probabilities are stored in parts per billion.
pub const PPB: u64 = 1_000_000_000;

// ---- Parameter bounds (enforced on every params update) ----
// Physics inputs are fixed-point thousandths of the normalized units in
// which ħ²/2m = 1 (see `physics.rs`). The bounds keep κa ≤ ~22, so sinh never
// overflows, and keep every derived probability inside [MIN_PPB, MAX_PPB].
pub const MIN_HEIGHT_MILLI: u32 = 100; // V₀ ≥ 0.1
pub const MAX_HEIGHT_MILLI: u32 = 20_000; // V₀ ≤ 20
pub const MIN_WIDTH_MILLI: u32 = 100; // a ≥ 0.1
pub const MAX_WIDTH_MILLI: u32 = 5_000; // a ≤ 5
/// Particle energy as a fraction of barrier height: strictly sub-barrier,
/// so every success is genuine tunneling (E < V₀).
pub const MIN_ENERGY_BPS: u16 = 500;
pub const MAX_ENERGY_BPS: u16 = 9_500;
pub const MIN_TRANSMISSION_PPB: u32 = 100_000; // 0.01%
pub const MAX_TRANSMISSION_PPB: u32 = 990_000_000; // 99%
pub const MIN_PREMIUM_BPS: u16 = 5_000;
pub const MAX_PREMIUM_BPS: u16 = 15_000;
pub const MAX_LEVEL_COST: u16 = 100;
/// Upper bound on energy per wallet per cycle. With a minimum particle cost
/// of 1 this also bounds particles per position, which keeps
/// `settle_position` inside the compute budget (one SHA-256 per particle).
pub const MAX_ENERGY_PER_CYCLE: u16 = 250;
pub const MIN_CYCLE_DURATION_SECS: u32 = 30;
pub const MAX_CYCLE_DURATION_SECS: u32 = 86_400;
pub const MIN_RANDOMNESS_TIMEOUT_SECS: u32 = 120;
pub const MAX_RANDOMNESS_TIMEOUT_SECS: u32 = 86_400;
pub const MAX_EMISSION_DECAY_BPS: u16 = 10_000;
