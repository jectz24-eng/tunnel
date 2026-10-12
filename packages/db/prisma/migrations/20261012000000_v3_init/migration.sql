-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "ProtocolConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "params" JSONB NOT NULL,
    "odds" JSONB NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "tunnelMint" TEXT,
    "rewardWallet" TEXT,
    "reserveFundedTotal" BIGINT NOT NULL DEFAULT 0,
    "rewardWalletTokens" BIGINT,
    "rewardWalletLamports" BIGINT,
    "lastSlot" BIGINT,
    "engineHeartbeat" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProtocolConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "wallet" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("wallet")
);

-- CreateTable
CREATE TABLE "Cycle" (
    "id" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "openTs" TIMESTAMP(3) NOT NULL,
    "closeTs" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "energyPerCycle" INTEGER NOT NULL,
    "barriers" JSONB NOT NULL,
    "levels" JSONB NOT NULL,
    "odds" JSONB NOT NULL,
    "emissionBudget" BIGINT NOT NULL,
    "seedCommitment" TEXT NOT NULL,
    "serverSeed" TEXT NOT NULL,
    "entropySlot" BIGINT NOT NULL,
    "entropySlotUsed" BIGINT,
    "entropyBlockhash" TEXT,
    "randomness" TEXT,
    "participants" INTEGER NOT NULL DEFAULT 0,
    "experiments" INTEGER NOT NULL DEFAULT 0,
    "particles" BIGINT[] DEFAULT ARRAY[0, 0, 0]::BIGINT[],
    "energyUsed" BIGINT NOT NULL DEFAULT 0,
    "successes" BIGINT[] DEFAULT ARRAY[0, 0, 0]::BIGINT[],
    "totalNominal" BIGINT NOT NULL DEFAULT 0,
    "tokensAllocated" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "cycleId" BIGINT NOT NULL,
    "wallet" TEXT NOT NULL,
    "particles" INTEGER[],
    "successes" INTEGER[],
    "energyUsed" INTEGER NOT NULL,
    "experiments" INTEGER NOT NULL,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "nominalReward" BIGINT NOT NULL DEFAULT 0,
    "payout" BIGINT,
    "payoutId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("cycleId","wallet")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" BIGSERIAL NOT NULL,
    "cycleId" BIGINT NOT NULL,
    "wallet" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "barrier" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "firstIndex" INTEGER NOT NULL,
    "energyCost" INTEGER NOT NULL,
    "heightMilli" INTEGER NOT NULL,
    "widthMilli" INTEGER NOT NULL,
    "energyBps" INTEGER NOT NULL,
    "transmissionPpb" INTEGER NOT NULL,
    "nominalReward" BIGINT NOT NULL,
    "message" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "successes" INTEGER,
    "outcomeBits" TEXT,
    "rewardTokens" BIGINT,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" BIGSERIAL NOT NULL,
    "wallet" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "message" TEXT NOT NULL,
    "messageSignature" TEXT NOT NULL,
    "txSignature" TEXT,
    "lastValidBlockHeight" BIGINT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocolEvent" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "cycleId" BIGINT,
    "wallet" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtocolEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletStats" (
    "owner" TEXT NOT NULL,
    "cyclesPlayed" INTEGER NOT NULL,
    "experiments" INTEGER NOT NULL,
    "particles" BIGINT NOT NULL,
    "successes" BIGINT NOT NULL,
    "failures" BIGINT NOT NULL,
    "energyUsed" BIGINT NOT NULL,
    "tokensEarned" BIGINT NOT NULL,
    "tokensClaimed" BIGINT NOT NULL,
    "bestCycleTokens" BIGINT NOT NULL,
    "longestStreak" INTEGER NOT NULL,
    "currentStreak" INTEGER NOT NULL,
    "claimableCycles" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletStats_pkey" PRIMARY KEY ("owner")
);

-- CreateTable
CREATE TABLE "EngineAction" (
    "id" BIGSERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "cycleId" BIGINT,
    "target" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "UsedNonce" (
    "nonce" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsedNonce_pkey" PRIMARY KEY ("nonce")
);

-- CreateIndex
CREATE INDEX "User_lastActivityAt_idx" ON "User"("lastActivityAt");

-- CreateIndex
CREATE INDEX "Cycle_status_idx" ON "Cycle"("status");

-- CreateIndex
CREATE INDEX "Cycle_openTs_idx" ON "Cycle"("openTs");

-- CreateIndex
CREATE INDEX "Position_wallet_idx" ON "Position"("wallet");

-- CreateIndex
CREATE INDEX "Position_payoutId_idx" ON "Position"("payoutId");

-- CreateIndex
CREATE UNIQUE INDEX "Experiment_signature_key" ON "Experiment"("signature");

-- CreateIndex
CREATE INDEX "Experiment_wallet_id_idx" ON "Experiment"("wallet", "id");

-- CreateIndex
CREATE INDEX "Experiment_cycleId_idx" ON "Experiment"("cycleId");

-- CreateIndex
CREATE INDEX "Experiment_status_idx" ON "Experiment"("status");

-- CreateIndex
CREATE INDEX "Experiment_barrier_idx" ON "Experiment"("barrier");

-- CreateIndex
CREATE UNIQUE INDEX "Experiment_cycleId_wallet_seq_key" ON "Experiment"("cycleId", "wallet", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_messageSignature_key" ON "Payout"("messageSignature");

-- CreateIndex
CREATE INDEX "Payout_wallet_idx" ON "Payout"("wallet");

-- CreateIndex
CREATE INDEX "Payout_status_idx" ON "Payout"("status");

-- CreateIndex
CREATE INDEX "ProtocolEvent_name_id_idx" ON "ProtocolEvent"("name", "id");

-- CreateIndex
CREATE INDEX "ProtocolEvent_cycleId_idx" ON "ProtocolEvent"("cycleId");

-- CreateIndex
CREATE INDEX "ProtocolEvent_wallet_idx" ON "ProtocolEvent"("wallet");

-- CreateIndex
CREATE INDEX "WalletStats_tokensEarned_idx" ON "WalletStats"("tokensEarned");

-- CreateIndex
CREATE INDEX "WalletStats_successes_idx" ON "WalletStats"("successes");

-- CreateIndex
CREATE INDEX "WalletStats_particles_idx" ON "WalletStats"("particles");

-- CreateIndex
CREATE INDEX "WalletStats_bestCycleTokens_idx" ON "WalletStats"("bestCycleTokens");

-- CreateIndex
CREATE INDEX "WalletStats_longestStreak_idx" ON "WalletStats"("longestStreak");

-- CreateIndex
CREATE INDEX "WalletStats_cyclesPlayed_idx" ON "WalletStats"("cyclesPlayed");

-- CreateIndex
CREATE INDEX "EngineAction_createdAt_idx" ON "EngineAction"("createdAt");

-- CreateIndex
CREATE INDEX "EngineAction_status_createdAt_idx" ON "EngineAction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RateLimit_windowEnd_idx" ON "RateLimit"("windowEnd");

-- CreateIndex
CREATE INDEX "UsedNonce_createdAt_idx" ON "UsedNonce"("createdAt");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domain constraints (not expressible in the Prisma schema).
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_barrier_range" CHECK ("barrier" BETWEEN 0 AND 2);
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_level_range" CHECK ("level" BETWEEN 0 AND 4);
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_count_positive" CHECK ("count" > 0 AND "energyCost" > 0);
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_probability_range" CHECK ("transmissionPpb" BETWEEN 0 AND 1000000000);
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_successes_range" CHECK ("successes" IS NULL OR "successes" BETWEEN 0 AND "count");
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_status_values" CHECK ("status" IN ('pending', 'settled', 'void', 'claimed'));
ALTER TABLE "Cycle" ADD CONSTRAINT "Cycle_status_values" CHECK ("status" IN ('open', 'closed', 'settled', 'void'));
ALTER TABLE "Cycle" ADD CONSTRAINT "Cycle_allocation" CHECK ("tokensAllocated" <= "emissionBudget");
ALTER TABLE "Position" ADD CONSTRAINT "Position_nonnegative" CHECK ("energyUsed" >= 0 AND "nominalReward" >= 0 AND ("payout" IS NULL OR "payout" >= 0));
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_status_values" CHECK ("status" IN ('requested', 'sending', 'confirmed', 'failed'));
-- At most one unfinished payout per wallet: claims cannot be double-requested.
CREATE UNIQUE INDEX "Payout_one_open_per_wallet" ON "Payout" ("wallet") WHERE "status" IN ('requested', 'sending');
