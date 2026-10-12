-- Instant $TUNNEL betting: balances, seeds, bets, deposits, limits.
ALTER TABLE "ProtocolConfig" ADD COLUMN "minBet" BIGINT NOT NULL DEFAULT 1000000,
  ADD COLUMN "maxBet" BIGINT NOT NULL DEFAULT 1000000000,
  ADD COLUMN "maxWinBps" INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN "bettingPaused" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "depositCursor" TEXT;

ALTER TABLE "Payout" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'claim';
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_kind_values" CHECK ("kind" IN ('claim', 'withdrawal'));

CREATE TABLE "Account" (
    "wallet" TEXT NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "deposited" BIGINT NOT NULL DEFAULT 0,
    "withdrawn" BIGINT NOT NULL DEFAULT 0,
    "wagered" BIGINT NOT NULL DEFAULT 0,
    "returned" BIGINT NOT NULL DEFAULT 0,
    "bets" INTEGER NOT NULL DEFAULT 0,
    "particles" INTEGER NOT NULL DEFAULT 0,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "biggestWin" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("wallet"),
    CONSTRAINT "Account_balance_nonnegative" CHECK ("balance" >= 0)
);
CREATE INDEX "Account_wagered_idx" ON "Account"("wagered");
CREATE INDEX "Account_biggestWin_idx" ON "Account"("biggestWin");
CREATE INDEX "Account_returned_idx" ON "Account"("returned");

CREATE TABLE "SeedPair" (
    "id" BIGSERIAL NOT NULL,
    "wallet" TEXT NOT NULL,
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revealedAt" TIMESTAMP(3),
    CONSTRAINT "SeedPair_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SeedPair_wallet_active_idx" ON "SeedPair"("wallet", "active");
CREATE UNIQUE INDEX "SeedPair_one_active_per_wallet" ON "SeedPair" ("wallet") WHERE "active";

CREATE TABLE "Bet" (
    "id" BIGSERIAL NOT NULL,
    "wallet" TEXT NOT NULL,
    "seedPairId" BIGINT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "volatility" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "count" INTEGER NOT NULL,
    "winPpb" INTEGER NOT NULL,
    "multiplierBps" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "payout" BIGINT NOT NULL,
    "outcomeBits" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Bet_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Bet_values" CHECK ("amount" > 0 AND "count" BETWEEN 1 AND 100 AND "volatility" BETWEEN 0 AND 2 AND "wins" BETWEEN 0 AND "count" AND "payout" >= 0)
);
CREATE UNIQUE INDEX "Bet_seedPairId_nonce_key" ON "Bet"("seedPairId", "nonce");
CREATE INDEX "Bet_wallet_id_idx" ON "Bet"("wallet", "id");
CREATE INDEX "Bet_payout_idx" ON "Bet"("payout");
CREATE INDEX "Bet_createdAt_idx" ON "Bet"("createdAt");

CREATE TABLE "Deposit" (
    "id" BIGSERIAL NOT NULL,
    "wallet" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "txSignature" TEXT NOT NULL,
    "slot" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Deposit_amount_positive" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "Deposit_txSignature_key" ON "Deposit"("txSignature");
CREATE INDEX "Deposit_wallet_idx" ON "Deposit"("wallet");
