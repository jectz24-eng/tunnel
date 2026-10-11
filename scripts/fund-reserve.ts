/**
 * Moves $TUNNEL from the operator wallet into the program's reward vault.
 * Tokens in the vault can only ever leave through user claims.
 *
 *   npm run setup:fund                      # the placeholder emissions reserve (600,000,000)
 *   npm run setup:fund -- --amount 1000000  # whole $TUNNEL
 */
import { PublicKey } from "@solana/web3.js";
import { PLACEHOLDER_TOKENOMICS, TUNNEL_UNIT, TunnelInstructions, fetchProtocol, formatTunnel } from "../packages/sdk/src";
import { arg, connection, explorer, guardCluster, loadKeypair, readDeployment, sendIxs } from "./lib";

async function main() {
  const conn = connection();
  const cluster = await guardCluster(conn);
  const funder = loadKeypair();
  const dep = readDeployment(cluster);
  const tunnel = new TunnelInstructions();
  const protocol = await fetchProtocol(conn, tunnel.programId);
  if (!protocol) throw new Error("protocol not initialized");

  const whole = arg("amount");
  const amount = whole ? BigInt(whole) * TUNNEL_UNIT : PLACEHOLDER_TOKENOMICS.miningReserve;
  const sig = await sendIxs(conn, funder, [
    tunnel.fundReserve({ funder: funder.publicKey, tunnelMint: protocol.tunnelMint, funderTokenAccount: new PublicKey(dep.operatorTokenAccount), amount }),
  ]);
  const after = (await fetchProtocol(conn, tunnel.programId))!;
  console.log(`funded ${formatTunnel(amount)} $TUNNEL; reserve available ${formatTunnel(after.reserveAvailable)}\n  ${explorer(sig, cluster)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
