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
    "roundId" BIGINT,
    "owner" TEXT,
    "data" JSONB NOT NULL,
    "commitment" TEXT NOT NULL DEFAULT 'confirmed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Round" (
    "id" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "openTs" TIMESTAMP(3) NOT NULL,
    "closeTs" TIMESTAMP(3) NOT NULL,
    "barrierBps" INTEGER[],
    "barrierWeights" INTEGER[],
    "particleCostLamports" BIGINT NOT NULL,
    "protocolFeeBps" INTEGER NOT NULL,
    "emissionBudget" BIGINT NOT NULL,
    "particles" BIGINT[],
    "totalLamports" BIGINT NOT NULL,
    "participants" INTEGER NOT NULL,
    "vrfSeed" TEXT,
    "randomness" TEXT,
    "successes" BIGINT[],
    "totalSuccessWeight" BIGINT NOT NULL,
    "feeLamports" BIGINT NOT NULL,
    "distributableLamports" BIGINT NOT NULL,
    "tokensAllocated" BIGINT NOT NULL DEFAULT 0,
    "claims" INTEGER NOT NULL,
    "settledAt" TIMESTAMP(3),
    "swept" BOOLEAN NOT NULL DEFAULT false,
    "reconciledSlot" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "roundId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "particles" INTEGER[],
    "lamports" BIGINT NOT NULL,
    "settled" BOOLEAN NOT NULL,
    "successes" INTEGER[],
    "successWeight" BIGINT NOT NULL,
    "claimed" BOOLEAN NOT NULL,
    "lamportsPaid" BIGINT NOT NULL,
    "tokensPaid" BIGINT NOT NULL,
    "expectedLamports" BIGINT,
    "expectedTokens" BIGINT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("roundId","owner")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "signature" TEXT NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "roundId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "barrier" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "lamports" BIGINT NOT NULL,
    "blockTime" TIMESTAMP(3),
    "slot" BIGINT NOT NULL,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("signature","eventIndex")
);

-- CreateTable
CREATE TABLE "Claim" (
    "signature" TEXT NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "roundId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "lamports" BIGINT NOT NULL,
    "tokens" BIGINT NOT NULL,
    "outcome" INTEGER NOT NULL,
    "blockTime" TIMESTAMP(3),
    "slot" BIGINT NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("signature","eventIndex")
);

-- CreateTable
CREATE TABLE "WalletStats" (
    "owner" TEXT NOT NULL,
    "roundsPlayed" INTEGER NOT NULL,
    "particles" BIGINT NOT NULL,
    "successes" BIGINT NOT NULL,
    "failures" BIGINT NOT NULL,
    "lamportsCommitted" BIGINT NOT NULL,
    "lamportsReceived" BIGINT NOT NULL,
    "tokensMined" BIGINT NOT NULL,
    "claimableRounds" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletStats_pkey" PRIMARY KEY ("owner")
);

-- CreateTable
CREATE TABLE "ProtocolState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "address" TEXT NOT NULL,
    "admin" TEXT NOT NULL,
    "treasury" TEXT NOT NULL,
    "tunnelMint" TEXT NOT NULL,
    "rewardVault" TEXT NOT NULL,
    "paused" BOOLEAN NOT NULL,
    "params" JSONB NOT NULL,
    "nextRoundId" BIGINT NOT NULL,
    "reserveAvailable" BIGINT NOT NULL,
    "reserveFundedTotal" BIGINT NOT NULL,
    "totalLamportsCommitted" BIGINT NOT NULL,
    "totalParticles" BIGINT NOT NULL,
    "totalSuccesses" BIGINT NOT NULL,
    "totalTokensAllocated" BIGINT NOT NULL,
    "totalFeesLamports" BIGINT NOT NULL,
    "roundsSettled" BIGINT NOT NULL,
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
    "roundId" BIGINT,
    "target" TEXT,
    "signature" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeeperAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IndexedEvent_name_id_idx" ON "IndexedEvent"("name", "id");

-- CreateIndex
CREATE INDEX "IndexedEvent_roundId_idx" ON "IndexedEvent"("roundId");

-- CreateIndex
CREATE INDEX "IndexedEvent_owner_idx" ON "IndexedEvent"("owner");

-- CreateIndex
CREATE UNIQUE INDEX "IndexedEvent_signature_eventIndex_key" ON "IndexedEvent"("signature", "eventIndex");

-- CreateIndex
CREATE INDEX "Round_status_idx" ON "Round"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Position_address_key" ON "Position"("address");

-- CreateIndex
CREATE INDEX "Position_owner_idx" ON "Position"("owner");

-- CreateIndex
CREATE INDEX "Deposit_roundId_idx" ON "Deposit"("roundId");

-- CreateIndex
CREATE INDEX "Deposit_owner_idx" ON "Deposit"("owner");

-- CreateIndex
CREATE INDEX "Deposit_slot_idx" ON "Deposit"("slot");

-- CreateIndex
CREATE INDEX "Claim_owner_idx" ON "Claim"("owner");

-- CreateIndex
CREATE INDEX "Claim_roundId_idx" ON "Claim"("roundId");

-- CreateIndex
CREATE INDEX "WalletStats_tokensMined_idx" ON "WalletStats"("tokensMined");

-- CreateIndex
CREATE INDEX "WalletStats_successes_idx" ON "WalletStats"("successes");

-- CreateIndex
CREATE INDEX "WalletStats_lamportsReceived_idx" ON "WalletStats"("lamportsReceived");

-- CreateIndex
CREATE INDEX "KeeperAction_createdAt_idx" ON "KeeperAction"("createdAt");

-- CreateIndex
CREATE INDEX "KeeperAction_roundId_idx" ON "KeeperAction"("roundId");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

