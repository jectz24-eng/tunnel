/**
 * Initializes the deployed TUNNEL program (must be run by its upgrade authority).
 *
 *   npm run setup:protocol -- --treasury <pubkey>
 */
import { PublicKey } from "@solana/web3.js";
import { DEFAULT_PARAMS, TunnelInstructions, fetchProtocol, protocolPda, rewardVaultPda } from "../packages/sdk/src";
import { arg, connection, explorer, guardCluster, loadKeypair, readDeployment, sendIxs, writeDeployment } from "./lib";

async function main() {
  const conn = connection();
  const cluster = await guardCluster(conn);
  const admin = loadKeypair();
  const dep = readDeployment(cluster);
  if (!dep.tunnelMint) throw new Error("run `npm run setup:token` first");
  const treasuryArg = arg("treasury");
  if (!treasuryArg) throw new Error("--treasury <pubkey> is required (a wallet you control, ideally a multisig)");
  const treasury = new PublicKey(treasuryArg);
  const tunnel = new TunnelInstructions();

  if (await fetchProtocol(conn, tunnel.programId)) {
    console.log("protocol already initialized");
    return;
  }
  const sig = await sendIxs(conn, admin, [
    tunnel.initialize({ admin: admin.publicKey, tunnelMint: new PublicKey(dep.tunnelMint), treasury, params: DEFAULT_PARAMS }),
  ]);
  console.log(`initialized\n  ${explorer(sig, cluster)}`);
  writeDeployment(cluster, {
    programId: tunnel.programId.toBase58(),
    protocol: protocolPda(tunnel.programId).toBase58(),
    rewardVault: rewardVaultPda(tunnel.programId).toBase58(),
    treasury: treasury.toBase58(),
    admin: admin.publicKey.toBase58(),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
