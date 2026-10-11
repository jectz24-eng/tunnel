/**
 * Full integration run on devnet (live ORAO VRF network) or localnet (cloned
 * ORAO program + scripts/local-vrf-fulfiller.ts):
 *
 *   two fresh wallets → experiments on different barriers and energy levels
 *   (energy allowance enforced) → cycle closes → ORAO randomness requested and
 *   fulfilled → reveal → settle → finalize → every particle outcome and the
 *   odds table verified independently → claims ($TUNNEL or rent-only) →
 *   balances asserted → duplicate claims rejected.
 *
 * Every transaction signature is printed with an explorer link and written to
 * docs/<CLUSTER>_RUN.md. Requires the program deployed + initialized + funded,
 * and an operator wallet with SOL (devnet: KEYPAIR_PATH; localnet: keys/).
 * It cranks cycles itself, so it does not depend on the keeper running (but
 * tolerates one running concurrently).
 *
 *   npx tsx scripts/e2e-run.ts
 *   SOLANA_RPC_URL=http://127.0.0.1:8899 npx tsx scripts/e2e-run.ts
 */
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, SystemProgram, type PublicKey } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BARRIER_META,
  IDL,
  LEVEL_LABELS,
  TunnelInstructions,
  computePayout,
  fetchCycle,
  fetchCyclePositions,
  fetchOraoRandomness,
  fetchOraoTreasury,
  fetchPosition,
  fetchProtocol,
  formatPpb,
  formatTunnel,
  isGatekeeperEnabled,
  parseEvents,
  positionPda,
  verifyCycle,
} from "../packages/sdk/src";
import { ROOT, connection, explorer, guardCluster, loadKeypair, sendIxs } from "./lib";
import { localKey } from "./local-setup";

const BENIGN = /CycleNotOpen|CycleNotClosed|NotAwaitingRandomness|PositionAlreadySettled|NotResolving|CycleScheduleConflict|already in use/;

const log: string[] = [];
function record(step: string, sig: string, cluster: string) {
  log.push(`- ${step}: [\`${sig.slice(0, 16)}…\`](${explorer(sig, cluster)})`);
  console.log(`${step}\n  ${explorer(sig, cluster)}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Error text plus logs, with `Custom: <code>` mapped to its IDL error name (confirm-time failures carry only the code). */
const logsOf = (e: unknown) => {
  const text = String(e) + JSON.stringify((e as { transactionMessage?: string }).transactionMessage ?? "") + ((e as { logs?: string[] }).logs ?? []).join("\n");
  const code = /"Custom":(\d+)/.exec(text)?.[1];
  const name = code ? IDL.errors?.find((x) => x.code === Number(code))?.name : undefined;
  return name ? `${text} ${name}` : text;
};

async function main() {
  const conn = connection();
  const cluster = await guardCluster(conn);
  if (cluster !== "devnet" && cluster !== "localnet") throw new Error("e2e-run only runs against devnet or localnet");
  const operator = cluster === "localnet" ? localKey("operator") : loadKeypair();
  const tunnel = new TunnelInstructions();
  const protocol = await fetchProtocol(conn, tunnel.programId);
  if (!protocol) throw new Error(`program not initialized on ${cluster} (docs/DEPLOYMENT.md)`);

  let gatekeeper: Keypair | null = null;
  if (isGatekeeperEnabled(protocol)) {
    const path = process.env.GATEKEEPER_KEYPAIR ?? (cluster === "localnet" ? join(ROOT, "keys", "localnet-gatekeeper.json") : "");
    if (!path || !existsSync(path)) throw new Error("the protocol requires a gatekeeper co-signature; set GATEKEEPER_KEYPAIR");
    gatekeeper = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  }

  /** Crank steps race with a running keeper; "already done" errors are fine. */
  const crank = async (step: string, ixs: Parameters<typeof sendIxs>[2]) => {
    try {
      record(step, await sendIxs(conn, operator, ixs), cluster);
    } catch (e) {
      if (!BENIGN.test(logsOf(e))) throw e;
      console.log(`${step}: already done by the keeper`);
    }
  };
  const deploy = (owner: Keypair, cycleId: bigint, barrier: number, level: number, count: number) =>
    sendIxs(conn, owner, [tunnel.deployParticles({ owner: owner.publicKey, cycleId, barrier, level, count, gatekeeper: gatekeeper?.publicKey })], gatekeeper ? [gatekeeper] : []);
  const chainNow = async () => (await conn.getBlockTime(await conn.getSlot("confirmed"))) ?? Math.floor(Date.now() / 1000);

  // 1. fund two fresh test wallets from the operator: they only need network fees + refundable rent
  const users = [Keypair.generate(), Keypair.generate()];
  record(
    "fund test wallets (0.05 SOL each, for fees and refundable rent)",
    await sendIxs(conn, operator, users.map((u) => SystemProgram.transfer({ fromPubkey: operator.publicKey, toPubkey: u.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }))),
    cluster,
  );

  // 2. find (or open) a cycle accepting particles with ≥ 20 s left
  let cycleId: bigint | null = null;
  for (let tries = 0; tries < 200 && cycleId == null; tries++) {
    const p = (await fetchProtocol(conn, tunnel.programId))!;
    const now = await chainNow();
    for (const id of [p.nextCycleId - 1n, p.nextCycleId - 2n].filter((x) => x >= 0n)) {
      const c = await fetchCycle(conn, id, tunnel.programId);
      if (c && c.status === "open" && c.openTs <= now && c.closeTs - now >= 20) cycleId = id;
    }
    if (cycleId == null && now >= p.lastCycleOpenTs) await crank(`open_cycle #${p.nextCycleId}`, [tunnel.openCycle(operator.publicKey, p.nextCycleId)]);
    if (cycleId == null) await sleep(3000);
  }
  if (cycleId == null) throw new Error("no open cycle became available");
  let c = (await fetchCycle(conn, cycleId, tunnel.programId))!;
  console.log(`using cycle #${cycleId} (closes in ${c.closeTs - (await chainNow())} s)`);

  // 3. experiments: A → Low/E3 ×10 then High/E5 ×5 (=55 energy); B → Medium/E1 ×20 then Medium/E1 ×10
  const plan: [number, number, number, number][] = [
    [0, 0, 2, 10],
    [0, 2, 4, 5],
    [1, 1, 0, 20],
    [1, 1, 0, 10],
  ];
  for (const [u, b, l, n] of plan) {
    record(`user ${"AB"[u]} deploys ${n} × ${BARRIER_META[b].name} at ${LEVEL_LABELS[l]} (${formatPpb(c.odds.transmissionPpb[b][l])})`, await deploy(users[u], cycleId, b, l, n), cluster);
  }
  // Energy allowance: A has used 55 of 100; 10 × E5 (= 50) must be refused.
  try {
    await deploy(users[0], cycleId, 0, 4, 10);
    throw new Error("an over-allowance deployment was accepted — this must never happen");
  } catch (e) {
    if (!/EnergyExhausted/.test(logsOf(e))) throw e;
    console.log("over-allowance deployment correctly rejected (EnergyExhausted)");
  }

  // 4. late deployment must be rejected; then close
  while ((await chainNow()) < c.closeTs) await sleep(2000);
  try {
    await deploy(users[0], cycleId, 0, 0, 1);
    throw new Error("late deployment was accepted — this must never happen");
  } catch (e) {
    if (!/CycleExpired|CycleNotOpen/.test(logsOf(e))) throw e;
    console.log("late deployment correctly rejected");
  }
  c = (await fetchCycle(conn, cycleId, tunnel.programId))!;
  if (c.status === "open") await crank(`close_cycle #${cycleId}`, [tunnel.closeCycle(cycleId)]);

  // 5. request ORAO randomness and wait for fulfillment
  c = (await fetchCycle(conn, cycleId, tunnel.programId))!;
  if (c.status === "closed") {
    const vrfTreasury = await fetchOraoTreasury(conn);
    await crank("request_randomness (ORAO VRF)", [tunnel.requestRandomness({ cranker: operator.publicKey, cycleId, vrfSeed: c.vrfSeed, vrfTreasury })]);
  }
  const t0 = Date.now();
  while (!(await fetchOraoRandomness(conn, c.vrfSeed)).fulfilled) {
    if (Date.now() - t0 > 300_000) throw new Error("ORAO did not fulfil within 5 minutes");
    await sleep(2000);
  }
  console.log(`ORAO fulfilled after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  c = (await fetchCycle(conn, cycleId, tunnel.programId))!;
  if (c.status === "closed" || c.status === "awaitingRandomness") await crank("reveal_randomness", [tunnel.revealRandomness(cycleId, c.vrfSeed)]);

  // 6. settle + finalize
  for (const p of await fetchCyclePositions(conn, cycleId, tunnel.programId)) {
    if (!p.settled) {
      await crank(`settle_position ${p.owner.toBase58().slice(0, 6)}…`, [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        tunnel.settlePosition(cycleId, p.owner),
      ]);
    }
  }
  for (let i = 0; i < 20 && (await fetchCycle(conn, cycleId, tunnel.programId))!.status === "resolving"; i++) {
    const cc = (await fetchCycle(conn, cycleId, tunnel.programId))!;
    if (cc.positionsSettled === cc.participants) await crank("finalize_cycle", [tunnel.finalizeCycle(cycleId)]);
    else await sleep(1500);
  }
  c = (await fetchCycle(conn, cycleId, tunnel.programId))!;

  // 7. independent verification of every particle and of the odds table
  const v = verifyCycle(c, await fetchCyclePositions(conn, cycleId, tunnel.programId));
  if (!v.allMatch) throw new Error("independent verification FAILED");
  console.log(`verified ${v.positions.length} positions and the physics-derived odds; outcome ${c.outcome}; successes ${c.successes.join("/")}`);

  // 8. claims, with balance assertions and a duplicate-claim attempt
  const results: string[] = [];
  for (const [i, u] of users.entries()) {
    const pos = (await fetchPosition(conn, cycleId, u.publicKey, tunnel.programId))!;
    const expected = computePayout({ outcome: c.outcome, totalNominal: c.totalNominal, emissionBudget: c.emissionBudget, positionNominal: pos.nominalReward });
    const ata: PublicKey = getAssociatedTokenAddressSync(protocol.tunnelMint, u.publicKey);
    const deposit = await conn.getBalance(positionPda(cycleId, u.publicKey, tunnel.programId));
    const sig = await sendIxs(conn, u, tunnel.claim({ owner: u.publicKey, cycleId, tunnelMint: protocol.tunnelMint, expectsTokens: expected > 0n }));
    record(`claim (user ${"AB"[i]})`, sig, cluster);
    const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const ev = parseEvents(tunnel.programId, tx!.meta!.logMessages!).find((e) => e.name === "RewardClaimed")!;
    const paid = BigInt(ev.data.tokens.toString());
    if (paid !== expected) throw new Error(`claim mismatch for user ${"AB"[i]}`);
    if (expected > 0n && (await getAccount(conn, ata)).amount !== expected) throw new Error("token balance mismatch");
    if (await conn.getAccountInfo(positionPda(cycleId, u.publicKey, tunnel.programId))) throw new Error("position not closed after claim");
    try {
      await sendIxs(conn, u, tunnel.claim({ owner: u.publicKey, cycleId, tunnelMint: protocol.tunnelMint, expectsTokens: false }));
      throw new Error("duplicate claim succeeded — this must never happen");
    } catch (e) {
      if (/must never happen/.test(String(e))) throw e;
    }
    const tunneled = pos.successes.flat().reduce((a, b) => a + b, 0);
    const total = pos.particles.flat().reduce((a, b) => a + b, 0);
    results.push(
      `- user ${"AB"[i]}: ${total} particles, ${pos.energyUsed}/100 energy, **${tunneled} tunneled**, paid **${formatTunnel(paid)} $TUNNEL** (matches SDK), ` +
        `position deposit of ${(deposit / LAMPORTS_PER_SOL).toFixed(6)} SOL returned, duplicate claim rejected`,
    );
  }

  const where =
    cluster === "devnet"
      ? "Solana devnet with the live ORAO VRF network"
      : "a local solana-test-validator with the real ORAO VRF program cloned from devnet; fulfillment signed by a local authority key (scripts/local-vrf-fulfiller.ts)";
  const md = `# ${cluster === "devnet" ? "Devnet" : "Localnet"} integration run

Run at ${new Date().toISOString()} against ${where}.

Program \`${tunnel.programId.toBase58()}\` · cycle **#${cycleId}** · outcome **${c.outcome}** · tunnels Low/Medium/High = ${c.successes.join(" / ")} · budget ${formatTunnel(c.emissionBudget)} · nominal ${formatTunnel(c.totalNominal)}${gatekeeper ? " · gatekeeper co-signing **on**" : ""}

## Results
${results.join("\n")}
- every particle outcome independently recomputed from onchain randomness, and every odds-table entry recomputed from the barrier physics: **all match**
- deployment beyond the per-cycle energy allowance: **rejected**
- late deployment after \`close_ts\`: **rejected**

## Transactions
${log.join("\n")}
`;
  const out = `${cluster.toUpperCase()}_RUN.md`;
  writeFileSync(join(ROOT, "docs", out), md);
  console.log(`wrote docs/${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
