/**
 * Creates the $TUNNEL SPL mint (6 decimals) and mints the supply to the operator wallet.
 *
 *   npm run setup:token                              # devnet (default RPC), placeholder supply
 *   npm run setup:token -- --supply 1000000000       # whole $TUNNEL
 *   npm run setup:token -- --revoke                  # also revoke mint authority (fixes supply forever)
 *
 * The default supply is a PLACEHOLDER (PLACEHOLDER_TOKENOMICS) until the
 * project owner supplies final tokenomics. Only the emissions reserve has a
 * defined destination (fund-reserve.ts); the rest stays in the operator
 * wallet, unallocated.
 */
import { AuthorityType, createMint, getOrCreateAssociatedTokenAccount, mintTo, setAuthority } from "@solana/spl-token";
import { PLACEHOLDER_TOKENOMICS, TUNNEL_DECIMALS, TUNNEL_UNIT, formatTunnel } from "../packages/sdk/src";
import { arg, connection, explorer, guardCluster, loadKeypair, readDeployment, writeDeployment } from "./lib";

async function main() {
  const conn = connection();
  const cluster = await guardCluster(conn);
  const payer = loadKeypair();
  if (readDeployment(cluster).tunnelMint) throw new Error(`a $TUNNEL mint is already recorded for ${cluster}`);

  const mint = await createMint(conn, payer, payer.publicKey, null, TUNNEL_DECIMALS);
  console.log(`mint: ${mint.toBase58()}`);
  const ata = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
  const supply = arg("supply") ? BigInt(arg("supply")!) * TUNNEL_UNIT : PLACEHOLDER_TOKENOMICS.totalSupply;
  const sig = await mintTo(conn, payer, mint, ata.address, payer, supply);
  console.log(`minted ${formatTunnel(supply)} $TUNNEL${arg("supply") ? "" : " (PLACEHOLDER supply)"} → ${ata.address.toBase58()}\n  ${explorer(sig, cluster)}`);

  if (process.argv.includes("--revoke")) {
    const s = await setAuthority(conn, payer, mint, payer, AuthorityType.MintTokens, null);
    console.log(`mint authority revoked — supply is fixed\n  ${explorer(s, cluster)}`);
  } else {
    console.log("mint authority retained by operator (pass --revoke to fix supply permanently)");
  }
  writeDeployment(cluster, { tunnelMint: mint.toBase58(), operatorTokenAccount: ata.address.toBase58() });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
