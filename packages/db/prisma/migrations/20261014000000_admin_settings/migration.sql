-- RPC endpoints set from the admin page (the mint already lives in "tunnelMint").
ALTER TABLE "ProtocolConfig" ADD COLUMN "engineRpcUrl" TEXT,
  ADD COLUMN "publicRpcUrl" TEXT;
