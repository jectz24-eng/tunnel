-- Reward-wallet key set from /admin, sealed so only the engine can open it.
ALTER TABLE "ProtocolConfig" ADD COLUMN "sealPublicKey" TEXT,
  ADD COLUMN "sealedRewardWallet" TEXT,
  ADD COLUMN "sealedRewardWalletAddress" TEXT;
