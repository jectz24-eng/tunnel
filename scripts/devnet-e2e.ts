/**
 * Full devnet integration run against the REAL ORAO VRF network:
 *
 *   two fresh wallets → deploy particles on different barriers → wait for the
 *   round to close → request ORAO randomness → wait for real fulfillment →
 *   reveal → settle → finalize → independently verify every outcome → claim
 *   SOL + $TUNNEL → assert balances → attempt a duplicate claim (must fail).
 *
 * Every transaction signature is printed with an explorer link and written to
 * docs/DEVNET_RUN.md. Requires the program deployed + initialized + funded on
 * devnet, and an operator wallet with devnet SOL (KEEPER/KEYPAIR_PATH).
 * It cranks rounds itself, so it does not depend on the keeper running (but
 * tolerates one running concurrently).
 *
 *   npx tsx scripts/devnet-e2e.ts
 */
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  TunnelInstructions,
  computePayout,
  fetchOraoRandomness,
  fetchOraoTreasury,
  fetchPosition,
  fetchProtocol,
  fetchRound,
  fetchRoundPositions,
  formatSol,
  formatTunnel,
  parseEvents,
  positionPda,
  verifyRound,
} from "../packages/sdk/src";
import { ROOT, connection, explorer, guardCluster, loadKeypair, sendIxs } from "./lib";

const log: string[] = [];
function record(step: string, sig: string, cluster: string) {
  const line = `- ${step}: [\`${sig.slice(0, 16)}…\`](${explorer(sig, cluster)})`;
  log.push(line);
  console.log(`${step}\n  ${explorer(sig, cluster)}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const conn = connection();
  const cluster = await guardCluster(conn);
  if (cluster !== "devnet") throw new Error("devnet-e2e only runs against devnet");
  const operator = loadKeypair();
  const tunnel = new TunnelInstructions();
  const protocol = await fetchProtocol(conn, tunnel.programId);
  if (!protocol) throw new Error("program not initialized on devnet (docs/DEPLOYMENT.md)");

  const chainNow = async () => (await conn.getBlockTime(await conn.getSlot("confirmed"))) ?? Math.floor(Date.now() / 1000);

  // 1. fund two fresh test wallets from the operator (avoids faucet rate limits)
  const users = [Keypair.generate(), Keypair.generate()];
  const fund = new Transaction().add(...users.map((u) => SystemProgram.transfer({ fromPubkey: operator.publicKey, toPubkey: u.publicKey, lamports: 0.3 * LAMPORTS_PER_SOL })));
  record("fund test wallets (0.3 SOL each)", await sendIxs(conn, operator, fund.instructions), cluster);

  // 2. find (or open) a round that is accepting deposits with ≥ 20 s left
  let roundId: bigint | null = null;
  for (let tries = 0; tries < 40 && roundId == null; tries++) {
    const p = (await fetchProtocol(conn, tunnel.programId))!;
    const now = await chainNow();
    for (const id of [p.nextRoundId - 1n, p.nextRoundId - 2n].filter((x) => x >= 0n)) {
      const r = await fetchRound(conn, id, tunnel.programId);
      if (r && r.status === "open" && r.openTs <= now && r.closeTs - now >= 20) roundId = id;
    }
    if (roundId == null && now >= p.lastRoundOpenTs) {
      try {
        record(`open_round #${p.nextRoundId}`, await sendIxs(conn, operator, [tunnel.openRound(operator.publicKey, p.nextRoundId)]), cluster);
      } catch (e) {
        console.log("open_round raced with another cranker:", String(e).slice(0, 120));
      }
    }
    if (roundId == null) await sleep(3000);
  }
  if (roundId == null) throw new Error("no open round became available");
  console.log(`using round #${roundId}`);

  // 3. deposits: user A → 10 × Barrier I, user B → 4 × Barrier II + 2 × Barrier III
  record(`user A deploys 10 particles on Barrier I`, await sendIxs(conn, users[0], [tunnel.deployParticles({ owner: users[0].publicKey, roundId, barrier: 0, count: 10 })]), cluster);
  record(
    `user B deploys 4 on Barrier II + 2 on Barrier III`,
    await sendIxs(conn, users[1], [
      tunnel.deployParticles({ owner: users[1].publicKey, roundId, barrier: 1, count: 4 }),
      tunnel.deployParticles({ owner: users[1].publicKey, roundId, barrier: 2, count: 2 }),
    ]),
    cluster,
  );

  // 4. late deposit must be rejected; then close
  let r = (await fetchRound(conn, roundId, tunnel.programId))!;
  while ((await chainNow()) < r.closeTs) await sleep(2000);
  try {
    await sendIxs(conn, users[0], [tunnel.deployParticles({ owner: users[0].publicKey, roundId, barrier: 0, count: 1 })]);
    throw new Error("late deposit was accepted — this must never happen");
  } catch (e) {
    if (!/RoundExpired|RoundNotOpen/.test(String(e) + ((e as any).logs ?? []).join("\n"))) throw e;
    console.log("late deposit correctly rejected");
  }
  r = (await fetchRound(conn, roundId, tunnel.programId))!;
  if (r.status === "open") record(`close_round #${roundId}`, await sendIxs(conn, operator, [tunnel.closeRound(roundId)]), cluster);

  // 5. request ORAO randomness and wait for the real network to fulfil it
  r = (await fetchRound(conn, roundId, tunnel.programId))!;
  if (r.status === "closed") {
    const vrfTreasury = await fetchOraoTreasury(conn);
    record("request_randomness (ORAO VRF)", await sendIxs(conn, operator, [tunnel.requestRandomness({ cranker: operator.publicKey, roundId, vrfSeed: r.vrfSeed, vrfTreasury })]), cluster);
  }
  const t0 = Date.now();
  while (!(await fetchOraoRandomness(conn, r.vrfSeed)).fulfilled) {
    if (Date.now() - t0 > 300_000) throw new Error("ORAO did not fulfil within 5 minutes");
    await sleep(2000);
  }
  console.log(`ORAO fulfilled after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  r = (await fetchRound(conn, roundId, tunnel.programId))!;
  if (r.status === "closed" || r.status === "awaitingRandomness") record("reveal_randomness", await sendIxs(conn, operator, [tunnel.revealRandomness(roundId, r.vrfSeed)]), cluster);

  // 6. settle + finalize
  for (const p of await fetchRoundPositions(conn, roundId, tunnel.programId)) {
    if (!p.settled) record(`settle_position ${p.owner.toBase58().slice(0, 6)}…`, await sendIxs(conn, operator, [tunnel.settlePosition(roundId, p.owner)]), cluster);
  }
  r = (await fetchRound(conn, roundId, tunnel.programId))!;
  if (r.status === "resolving") record("finalize_round", await sendIxs(conn, operator, [tunnel.finalizeRound(roundId)]), cluster);
  r = (await fetchRound(conn, roundId, tunnel.programId))!;

  // 7. independent verification of every particle (only our positions are guaranteed unclaimed)
  const v = verifyRound(r, await fetchRoundPositions(conn, roundId, tunnel.programId));
  if (!v.allMatch) throw new Error("independent verification FAILED");
  console.log(`verified ${v.positions.length} positions; outcome ${r.outcome}; successes ${r.successes.join("/")}`);

  // 8. claims, with balance assertions and a duplicate-claim attempt
  const results: string[] = [];
  for (const [i, u] of users.entries()) {
    const pos = (await fetchPosition(conn, roundId, u.publicKey, tunnel.programId))!;
    const expected = computePayout({
      outcome: r.outcome,
      distributableLamports: r.distributableLamports,
      totalLamports: r.totalLamports,
      totalSuccessWeight: r.totalSuccessWeight,
      emissionBudget: r.emissionBudget,
      positionLamports: pos.lamports,
      positionSuccessWeight: pos.successWeight,
    })!;
    const ata = getAssociatedTokenAddressSync(protocol.tunnelMint, u.publicKey);
    const sig = await sendIxs(conn, u, [tunnel.claim({ owner: u.publicKey, roundId, tunnelMint: protocol.tunnelMint })]);
    record(`claim (user ${"AB"[i]})`, sig, cluster);
    const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const ev = parseEvents(tunnel.programId, tx!.meta!.logMessages!).find((e) => e.name === "RewardClaimed")!;
    const paidSol = BigInt(ev.data.lamports.toString());
    const paidTok = BigInt(ev.data.tokens.toString());
    if (paidSol !== expected.lamports || paidTok !== expected.tokens) throw new Error(`claim mismatch for user ${"AB"[i]}`);
    const tokBal = (await getAccount(conn, ata)).amount;
    if (tokBal !== expected.tokens) throw new Error("token balance mismatch");
    if (await conn.getAccountInfo(positionPda(roundId, u.publicKey, tunnel.programId))) throw new Error("position not closed after claim");
    try {
      await sendIxs(conn, u, [tunnel.claim({ owner: u.publicKey, roundId, tunnelMint: protocol.tunnelMint })]);
      throw new Error("duplicate claim succeeded — this must never happen");
    } catch (e) {
      if (/must never happen/.test(String(e))) throw e;
    }
    results.push(`- user ${"AB"[i]}: particles ${pos.particles.join("/")}, tunnelled ${pos.successes.join("/")}, paid **${formatSol(paidSol)} SOL** + **${formatTunnel(paidTok)} $TUNNEL** (matches SDK), duplicate claim rejected`);
  }

  const md = `# Devnet integration run

Run at ${new Date().toISOString()} against Solana devnet with the live ORAO VRF network.

Program \`${tunnel.programId.toBase58()}\` · round **#${roundId}** · outcome **${r.outcome}** · successes I/II/III = ${r.successes.join(" / ")}

## Results
${results.join("\n")}
- every particle outcome independently recomputed from onchain randomness: **all match**
- late deposit after \`close_ts\`: **rejected**

## Transactions
${log.join("\n")}
`;
  writeFileSync(join(ROOT, "docs", "DEVNET_RUN.md"), md);
  console.log("\nwrote docs/DEVNET_RUN.md");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
