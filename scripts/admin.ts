/**
 * Admin CLI. Every action is an onchain instruction signed by the admin key.
 *
 *   npm run admin -- status
 *   npm run admin -- pause | unpause
 *   npm run admin -- set-treasury <pubkey>
 *   npm run admin -- propose-admin <pubkey>
 *   npm run admin -- set-params '<json ProtocolParams with string bigints>'
 *
 * Parameter changes only apply to rounds opened afterwards.
 */
import { PublicKey } from "@solana/web3.js";
import { TunnelInstructions, fetchProtocol, formatSol, formatTunnel, type ProtocolParams } from "../packages/sdk/src";
import { connection, explorer, guardCluster, loadKeypair, sendIxs } from "./lib";

async function main() {
  const conn = connection();
  const cluster = await guardCluster(conn);
  const tunnel = new TunnelInstructions();
  const [cmd, value] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const p = await fetchProtocol(conn, tunnel.programId);
  if (!p) throw new Error("protocol not initialized");

  if (!cmd || cmd === "status") {
    console.log({
      admin: p.admin.toBase58(),
      pendingAdmin: p.pendingAdmin?.toBase58() ?? null,
      treasury: p.treasury.toBase58(),
      mint: p.tunnelMint.toBase58(),
      paused: p.paused,
      nextRoundId: p.nextRoundId.toString(),
      reserveAvailable: formatTunnel(p.reserveAvailable),
      totalCommittedSol: formatSol(p.totalLamportsCommitted),
      params: JSON.parse(JSON.stringify(p.params, (_, v) => (typeof v === "bigint" ? v.toString() : v))),
    });
    return;
  }

  const admin = loadKeypair();
  const ix = (() => {
    switch (cmd) {
      case "pause":
        return tunnel.setPaused(admin.publicKey, true);
      case "unpause":
        return tunnel.setPaused(admin.publicKey, false);
      case "set-treasury":
        return tunnel.setTreasury(admin.publicKey, new PublicKey(value));
      case "propose-admin":
        return tunnel.proposeAdmin(admin.publicKey, new PublicKey(value));
      case "accept-admin":
        return tunnel.acceptAdmin(admin.publicKey);
      case "set-params": {
        const raw = JSON.parse(value);
        const params: ProtocolParams = {
          ...raw,
          particleCostLamports: BigInt(raw.particleCostLamports),
          initialEmissionPerRound: BigInt(raw.initialEmissionPerRound),
        };
        return tunnel.updateParams(admin.publicKey, params);
      }
      default:
        throw new Error(`unknown command ${cmd}`);
    }
  })();
  const sig = await sendIxs(conn, admin, [ix]);
  console.log(`${cmd} ok\n  ${explorer(sig, cluster)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
