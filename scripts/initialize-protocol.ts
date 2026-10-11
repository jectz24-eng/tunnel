/**
 * Initializes the deployed TUNNEL program (must be run by its upgrade authority).
 *
 *   npm run setup:protocol
 *   npm run setup:protocol -- --gatekeeper <pubkey>   # require co-signed deployments (rate limiting)
 *   npm run setup:protocol -- --cycle-secs 600        # override the cycle length
 *
 * The program derives every tunneling probability from the barrier physics in
 * DEFAULT_PARAMS; the resulting odds table is printed for review.
 */
import { PublicKey } from "@solana/web3.js";
import { DEFAULT_PARAMS, TunnelInstructions, deriveOdds, fetchProtocol, formatPpb, formatTunnel, protocolPda, rewardVaultPda } from "../packages/sdk/src";
import { PHYSICS_CU, arg, connection, explorer, guardCluster, loadKeypair, readDeployment, sendIxs, writeDeployment } from "./lib";

async function main() {
  const conn = connection();
  const cluster = await guardCluster(conn);
  const admin = loadKeypair();
  const dep = readDeployment(cluster);
  if (!dep.tunnelMint) throw new Error("run `npm run setup:token` first");
  const gatekeeper = arg("gatekeeper") ? new PublicKey(arg("gatekeeper")!) : PublicKey.default;
  const params = { ...DEFAULT_PARAMS, cycleDurationSecs: Number(arg("cycle-secs") ?? DEFAULT_PARAMS.cycleDurationSecs) };
  const tunnel = new TunnelInstructions();

  if (await fetchProtocol(conn, tunnel.programId)) {
    console.log("protocol already initialized");
    return;
  }
  const odds = deriveOdds(params);
  console.log("odds the program will derive ([barrier][level] probability · reward per success):");
  odds.transmissionPpb.forEach((row, b) => console.log(`  barrier ${b}: ` + row.map((p, l) => `${formatPpb(p)} · ${formatTunnel(odds.reward[b][l])}`).join("  |  ")));

  const sig = await sendIxs(conn, admin, [tunnel.initialize({ admin: admin.publicKey, tunnelMint: new PublicKey(dep.tunnelMint), gatekeeper, params })], [], PHYSICS_CU);
  console.log(`initialized\n  ${explorer(sig, cluster)}`);
  writeDeployment(cluster, {
    programId: tunnel.programId.toBase58(),
    protocol: protocolPda(tunnel.programId).toBase58(),
    rewardVault: rewardVaultPda(tunnel.programId).toBase58(),
    gatekeeper: gatekeeper.toBase58(),
    admin: admin.publicKey.toBase58(),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
