/**
 * Moves $TUNNEL from the operator wallet into the program's reward vault.
 * Tokens in the vault can only ever leave through user claims.
 *
 *   npm run setup:fund                      # the full 600,000,000 mining reserve
 *   npm run setup:fund -- --amount 1000000  # whole $TUNNEL
 */
import { PublicKey } from "@solana/web3.js";
import { TUNNEL_DECIMALS, TUNNEL_MINING_RESERVE, TunnelInstructions, fetchProtocol, formatTunnel } from "../packages/sdk/src";
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
  const amount = whole ? BigInt(whole) * 10n ** BigInt(TUNNEL_DECIMALS) : TUNNEL_MINING_RESERVE;
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
