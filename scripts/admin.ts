/**
 * Admin CLI. Every action is an onchain instruction signed by the admin key.
 *
 *   npm run admin -- status
 *   npm run admin -- pause | unpause
 *   npm run admin -- set-gatekeeper <pubkey> | disable-gatekeeper
 *   npm run admin -- propose-admin <pubkey> | accept-admin
 *   npm run admin -- set-cycle-duration <seconds>
 *   npm run admin -- set-params '<json ProtocolParams with string bigints>'
 *
 * Parameter changes only apply to cycles opened afterwards, and the program
 * re-derives the odds table from the physics model on every change.
 */
import { PublicKey } from "@solana/web3.js";
import { TunnelInstructions, fetchProtocol, formatPpb, formatTunnel, isGatekeeperEnabled, type ProtocolParams } from "../packages/sdk/src";
import { PHYSICS_CU, connection, explorer, guardCluster, loadKeypair, sendIxs } from "./lib";

const toJson = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));

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
      gatekeeper: isGatekeeperEnabled(p) ? p.gatekeeper.toBase58() : "disabled",
      mint: p.tunnelMint.toBase58(),
      paused: p.paused,
      nextCycleId: p.nextCycleId.toString(),
      reserveAvailable: formatTunnel(p.reserveAvailable),
      totalTokensAllocated: formatTunnel(p.totalTokensAllocated),
      totalTokensClaimed: formatTunnel(p.totalTokensClaimed),
      params: toJson(p.params),
      odds: p.odds.transmissionPpb.map((row) => row.map(formatPpb).join(" ")),
    });
    return;
  }

  const admin = loadKeypair();
  let cu: number | undefined;
  const ix = (() => {
    switch (cmd) {
      case "pause":
        return tunnel.setPaused(admin.publicKey, true);
      case "unpause":
        return tunnel.setPaused(admin.publicKey, false);
      case "set-gatekeeper":
        return tunnel.setGatekeeper(admin.publicKey, new PublicKey(value));
      case "disable-gatekeeper":
        return tunnel.setGatekeeper(admin.publicKey, PublicKey.default);
      case "propose-admin":
        return tunnel.proposeAdmin(admin.publicKey, new PublicKey(value));
      case "accept-admin":
        return tunnel.acceptAdmin(admin.publicKey);
      case "set-cycle-duration":
        cu = PHYSICS_CU;
        return tunnel.updateParams(admin.publicKey, { ...p.params, cycleDurationSecs: Number(value) });
      case "set-params": {
        const raw = JSON.parse(value);
        const params: ProtocolParams = {
          ...raw,
          rewardPerEnergy: BigInt(raw.rewardPerEnergy),
          initialEmissionPerCycle: BigInt(raw.initialEmissionPerCycle),
        };
        cu = PHYSICS_CU;
        return tunnel.updateParams(admin.publicKey, params);
      }
      default:
        throw new Error(`unknown command ${cmd}`);
    }
  })();
  const sig = await sendIxs(conn, admin, [ix], [], cu);
  console.log(`${cmd} ok\n  ${explorer(sig, cluster)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
