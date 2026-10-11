-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "IndexedEvent" (
    "id" BIGSERIAL NOT NULL,
    "signature" TEXT NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "slot" BIGINT NOT NULL,
    "blockTime" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "cycleId" BIGINT,
    "owner" TEXT,
    "data" JSONB NOT NULL,
    "commitment" TEXT NOT NULL DEFAULT 'confirmed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexedEvent_pkey" PRIMARY KEY ("id")
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
    "address" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "openTs" TIMESTAMP(3) NOT NULL,
    "closeTs" TIMESTAMP(3) NOT NULL,
    "energyPerCycle" INTEGER NOT NULL,
    "barriers" JSONB NOT NULL,
    "levels" JSONB NOT NULL,
    "odds" JSONB NOT NULL,
    "emissionBudget" BIGINT NOT NULL,
    "participants" INTEGER NOT NULL,
    "experiments" INTEGER NOT NULL,
    "particles" BIGINT[],
    "energyUsed" BIGINT NOT NULL,
    "vrfSeed" TEXT,
    "randomness" TEXT,
    "successes" BIGINT[],
    "totalNominal" BIGINT NOT NULL,
    "tokensAllocated" BIGINT NOT NULL,
    "claims" INTEGER NOT NULL,
    "tokensClaimed" BIGINT NOT NULL,
    "settledAt" TIMESTAMP(3),
    "swept" BOOLEAN NOT NULL DEFAULT false,
    "reconciledSlot" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "cycleId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "particles" INTEGER[],
    "successes" INTEGER[],
    "energyUsed" INTEGER NOT NULL,
    "experiments" INTEGER NOT NULL,
    "settled" BOOLEAN NOT NULL,
    "nominalReward" BIGINT NOT NULL,
    "claimed" BOOLEAN NOT NULL,
    "tokensPaid" BIGINT NOT NULL,
    "expectedTokens" BIGINT,
    "claimSignature" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("cycleId","owner")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "cycleId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "signature" TEXT NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "slot" BIGINT NOT NULL,
    "blockTime" TIMESTAMP(3),
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
    "status" TEXT NOT NULL DEFAULT 'pending',
    "successes" INTEGER,
    "outcomeBits" TEXT,
    "rewardTokens" BIGINT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("cycleId","owner","seq")
);

-- CreateTable
CREATE TABLE "Claim" (
    "signature" TEXT NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "cycleId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "tokens" BIGINT NOT NULL,
    "outcome" INTEGER NOT NULL,
    "blockTime" TIMESTAMP(3),
    "slot" BIGINT NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("signature","eventIndex")
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
CREATE TABLE "ProtocolState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "address" TEXT NOT NULL,
    "admin" TEXT NOT NULL,
    "gatekeeper" TEXT NOT NULL,
    "tunnelMint" TEXT NOT NULL,
    "rewardVault" TEXT NOT NULL,
    "paused" BOOLEAN NOT NULL,
    "params" JSONB NOT NULL,
    "odds" JSONB NOT NULL,
    "nextCycleId" BIGINT NOT NULL,
    "reserveAvailable" BIGINT NOT NULL,
    "reserveFundedTotal" BIGINT NOT NULL,
    "totalExperiments" BIGINT NOT NULL,
    "totalParticles" BIGINT NOT NULL,
    "totalEnergy" BIGINT NOT NULL,
    "totalSuccesses" BIGINT NOT NULL,
    "totalTokensAllocated" BIGINT NOT NULL,
    "totalTokensClaimed" BIGINT NOT NULL,
    "cyclesSettled" BIGINT NOT NULL,
    "slot" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProtocolState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCursor" (
    "id" TEXT NOT NULL,
    "lastSignature" TEXT,
    "lastSlot" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeeperAction" (
    "id" BIGSERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "cycleId" BIGINT,
    "target" TEXT,
    "signature" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeeperAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "IndexedEvent_name_id_idx" ON "IndexedEvent"("name", "id");

-- CreateIndex
CREATE INDEX "IndexedEvent_cycleId_idx" ON "IndexedEvent"("cycleId");

-- CreateIndex
CREATE INDEX "IndexedEvent_owner_idx" ON "IndexedEvent"("owner");

-- CreateIndex
CREATE UNIQUE INDEX "IndexedEvent_signature_eventIndex_key" ON "IndexedEvent"("signature", "eventIndex");

-- CreateIndex
CREATE INDEX "User_lastActivityAt_idx" ON "User"("lastActivityAt");

-- CreateIndex
CREATE INDEX "Cycle_status_idx" ON "Cycle"("status");

-- CreateIndex
CREATE INDEX "Cycle_openTs_idx" ON "Cycle"("openTs");

-- CreateIndex
CREATE INDEX "Position_owner_idx" ON "Position"("owner");

-- CreateIndex
CREATE INDEX "Experiment_owner_slot_idx" ON "Experiment"("owner", "slot");

-- CreateIndex
CREATE INDEX "Experiment_slot_idx" ON "Experiment"("slot");

-- CreateIndex
CREATE INDEX "Experiment_status_idx" ON "Experiment"("status");

-- CreateIndex
CREATE INDEX "Experiment_barrier_idx" ON "Experiment"("barrier");

-- CreateIndex
CREATE UNIQUE INDEX "Experiment_signature_eventIndex_key" ON "Experiment"("signature", "eventIndex");

-- CreateIndex
CREATE INDEX "Claim_owner_idx" ON "Claim"("owner");

-- CreateIndex
CREATE INDEX "Claim_cycleId_idx" ON "Claim"("cycleId");

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
CREATE INDEX "KeeperAction_createdAt_idx" ON "KeeperAction"("createdAt");

-- CreateIndex
CREATE INDEX "KeeperAction_cycleId_idx" ON "KeeperAction"("cycleId");

-- CreateIndex
CREATE INDEX "KeeperAction_status_createdAt_idx" ON "KeeperAction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RateLimit_windowEnd_idx" ON "RateLimit"("windowEnd");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domain constraints (not expressible in the Prisma schema). The chain is the
-- authority; these catch indexer bugs before bad rows reach the UI.
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_barrier_range" CHECK ("barrier" BETWEEN 0 AND 2);
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_level_range" CHECK ("level" BETWEEN 0 AND 4);
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_count_positive" CHECK ("count" > 0 AND "energyCost" > 0);
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_probability_range" CHECK ("transmissionPpb" BETWEEN 0 AND 1000000000);
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_successes_range" CHECK ("successes" IS NULL OR "successes" BETWEEN 0 AND "count");
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_status_values" CHECK ("status" IN ('pending', 'awaiting_randomness', 'settled', 'void', 'claimed'));
ALTER TABLE "Position" ADD CONSTRAINT "Position_amounts_nonnegative" CHECK ("energyUsed" >= 0 AND "nominalReward" >= 0 AND "tokensPaid" >= 0);
ALTER TABLE "Cycle" ADD CONSTRAINT "Cycle_claims_within_allocation" CHECK ("tokensClaimed" <= "tokensAllocated" AND "tokensAllocated" <= "emissionBudget");
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_tokens_nonnegative" CHECK ("tokens" >= 0);
