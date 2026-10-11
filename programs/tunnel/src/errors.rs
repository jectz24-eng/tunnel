use anchor_lang::prelude::*;

#[error_code]
pub enum TunnelError {
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Protocol is paused")]
    Paused,
    #[msg("Signer is not the protocol admin")]
    Unauthorized,
    #[msg("Invalid protocol parameters")]
    InvalidParams,
    #[msg("Invalid barrier index")]
    InvalidBarrier,
    #[msg("Invalid energy level")]
    InvalidLevel,
    #[msg("Particle count must be greater than zero")]
    ZeroParticles,
    #[msg("Not enough particle energy left in this cycle")]
    EnergyExhausted,
    #[msg("Cycle is not open for deployments")]
    CycleNotOpen,
    #[msg("Cycle has not started yet")]
    CycleNotStarted,
    #[msg("Cycle deployment window has ended")]
    CycleExpired,
    #[msg("Cycle deployment window is still running")]
    CycleStillOpen,
    #[msg("The next cycle cannot be scheduled yet")]
    CycleScheduleConflict,
    #[msg("Cycle is not awaiting randomness")]
    NotAwaitingRandomness,
    #[msg("Cycle is not closed")]
    CycleNotClosed,
    #[msg("Slot hashes sysvar is unavailable or malformed")]
    SlotHashesUnavailable,
    #[msg("Randomness has not been fulfilled yet")]
    RandomnessNotFulfilled,
    #[msg("Randomness account does not match the cycle request")]
    RandomnessAccountMismatch,
    #[msg("Cycle is not resolving")]
    NotResolving,
    #[msg("Position has already been settled")]
    PositionAlreadySettled,
    #[msg("Not every position has been settled")]
    PositionsPending,
    #[msg("Cycle is not settled")]
    CycleNotSettled,
    #[msg("Position has already been claimed")]
    AlreadyClaimed,
    #[msg("Position is not settled")]
    PositionNotSettled,
    #[msg("Cycle cannot be voided yet")]
    RecoveryNotAvailable,
    #[msg("Cycle has outstanding claims")]
    ClaimsOutstanding,
    #[msg("Cycle has already been swept")]
    AlreadySwept,
    #[msg("Reward reserve is insufficient")]
    InsufficientReserve,
    #[msg("No pending admin, or signer is not the pending admin")]
    NotPendingAdmin,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Account does not belong to this cycle")]
    CycleMismatch,
    #[msg("Randomness is available; reveal it instead of voiding the cycle")]
    RandomnessAvailable,
    #[msg("This deployment must be co-signed by the protocol gatekeeper")]
    GatekeeperRequired,
    #[msg("A $TUNNEL token account is required to receive a non-zero reward")]
    TokenAccountRequired,
}
