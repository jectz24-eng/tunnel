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
    #[msg("Particle count must be greater than zero")]
    ZeroParticles,
    #[msg("Position particle limit exceeded for this round")]
    PositionLimitExceeded,
    #[msg("Round is not open for deposits")]
    RoundNotOpen,
    #[msg("Round has not started yet")]
    RoundNotStarted,
    #[msg("Round deposit window has ended")]
    RoundExpired,
    #[msg("Round deposit window is still running")]
    RoundStillOpen,
    #[msg("The next round cannot be scheduled yet")]
    RoundScheduleConflict,
    #[msg("Round is not awaiting randomness")]
    NotAwaitingRandomness,
    #[msg("Round is not closed")]
    RoundNotClosed,
    #[msg("Slot hashes sysvar is unavailable or malformed")]
    SlotHashesUnavailable,
    #[msg("Randomness has not been fulfilled yet")]
    RandomnessNotFulfilled,
    #[msg("Randomness account does not match the round request")]
    RandomnessAccountMismatch,
    #[msg("Round is not resolving")]
    NotResolving,
    #[msg("Position has already been settled")]
    PositionAlreadySettled,
    #[msg("Not every position has been settled")]
    PositionsPending,
    #[msg("Round is not settled")]
    RoundNotSettled,
    #[msg("Position has already been claimed")]
    AlreadyClaimed,
    #[msg("Position is not settled")]
    PositionNotSettled,
    #[msg("Round cannot be recovered yet")]
    RecoveryNotAvailable,
    #[msg("Round has outstanding claims")]
    ClaimsOutstanding,
    #[msg("Round has already been swept")]
    AlreadySwept,
    #[msg("Escrow balance is insufficient")]
    InsufficientEscrow,
    #[msg("Reward reserve is insufficient")]
    InsufficientReserve,
    #[msg("Treasury account does not match protocol configuration")]
    TreasuryMismatch,
    #[msg("No pending admin, or signer is not the pending admin")]
    NotPendingAdmin,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Account does not belong to this round")]
    RoundMismatch,
    #[msg("Randomness is available; reveal it instead of recovering")]
    RandomnessAvailable,
}
