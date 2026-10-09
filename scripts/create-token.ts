/**
 * Creates the $TUNNEL SPL mint (6 decimals) and mints the fixed 1,000,000,000
 * supply to the operator wallet.
 *
 *   npm run setup:token                 # devnet (default RPC)
 *   npm run setup:token -- --revoke     # also revoke mint authority (fixes supply forever)
 *
 * Only the 600M mining reserve has a defined destination (fund-reserve.ts).
 * The other 400M stay in the operator wallet, UNALLOCATED, until the owner
 * approves final tokenomics.
 */
import { AuthorityType, createMint, getOrCreateAssociatedTokenAccount, mintTo, setAuthority } from "@solana/spl-token";
import { TUNNEL_DECIMALS, TUNNEL_TOTAL_SUPPLY } from "../packages/sdk/src";
import { connection, explorer, guardCluster, loadKeypair, readDeployment, writeDeployment } from "./lib";

async function main() {
  const conn = connection();
  const cluster = await guardCluster(conn);
  const payer = loadKeypair();
  if (readDeployment(cluster).tunnelMint) throw new Error(`a $TUNNEL mint is already recorded for ${cluster}`);

  const mint = await createMint(conn, payer, payer.publicKey, null, TUNNEL_DECIMALS);
  console.log(`mint: ${mint.toBase58()}`);
  const ata = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
  const sig = await mintTo(conn, payer, mint, ata.address, payer, TUNNEL_TOTAL_SUPPLY);
  console.log(`minted 1,000,000,000 $TUNNEL → ${ata.address.toBase58()}\n  ${explorer(sig, cluster)}`);

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
