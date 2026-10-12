/**
 * Operator CLI (talks to the database directly; run where DATABASE_URL is set).
 *
 *   npm run admin -- status
 *   npm run admin -- pause | resume
 *   npm run admin -- cycle-secs 600
 *   npm run admin -- emission 20000        # whole $TUNNEL per cycle (before decay)
 */
import { loadConfig, reserveAvailable, setParams, setPaused } from "../packages/core/src";
import { getDb } from "../packages/db/src";
import { TUNNEL_UNIT, formatSol, formatTunnel } from "../packages/sdk/src";

const db = getDb();
const [cmd, value] = process.argv.slice(2);
const actor = "cli";

async function main() {
  switch (cmd) {
    case "pause":
    case "resume":
      await setPaused(db, cmd === "pause", actor);
      break;
    case "cycle-secs": {
      const c = await loadConfig(db);
      await setParams(db, { ...c.params, cycleDurationSecs: Number(value) }, actor);
      break;
    }
    case "emission": {
      const c = await loadConfig(db);
      if (!/^\d+$/.test(value ?? "")) throw new Error("emission takes whole $TUNNEL");
      await setParams(db, { ...c.params, initialEmissionPerCycle: BigInt(value) * TUNNEL_UNIT }, actor);
      break;
    }
    case "status":
    case undefined:
      break;
    default:
      throw new Error(`unknown command ${cmd}`);
  }
  const c = await loadConfig(db);
  const open = await db.cycle.findFirst({ where: { status: "open" }, orderBy: { id: "desc" } });
  const pendingPayouts = await db.payout.count({ where: { status: { in: ["requested", "sending"] } } });
  console.log({
    mining: c.paused ? "PAUSED" : "running",
    cycleDurationSecs: c.params.cycleDurationSecs,
    emissionPerCycle: formatTunnel(c.params.initialEmissionPerCycle),
    reserveFunded: formatTunnel(c.reserveFundedTotal),
    reserveUnallocated: formatTunnel(await reserveAvailable(db, c.reserveFundedTotal)),
    rewardWallet: c.rewardWallet,
    rewardWalletTokens: c.rewardWalletTokens != null ? formatTunnel(c.rewardWalletTokens) : null,
    rewardWalletSol: c.rewardWalletLamports != null ? formatSol(c.rewardWalletLamports) : null,
    engineHeartbeat: c.engineHeartbeat,
    openCycle: open ? { id: open.id.toString(), closes: open.closeTs, participants: open.participants } : null,
    pendingPayouts,
  });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
