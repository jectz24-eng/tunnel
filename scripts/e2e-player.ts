/**
 * End-to-end player test against a running TUNNEL site and a real Solana cluster.
 * Plays exactly like a user: wallet sign-in, on-chain deposit, shots, seed
 * reveal + verification of every shot, withdrawal confirmed on-chain.
 *
 *   BASE_URL=http://localhost:3001 SOLANA_RPC_URL=https://api.devnet.solana.com \
 *   PLAYER_KEYPAIR=keys/devnet-player.json npx tsx scripts/e2e-player.ts [--deposit 100] [--confirm-mainnet]
 *
 * The player wallet needs a little SOL (fees) and the deposit amount in $TUNNEL.
 */
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { TUNNEL_DECIMALS, TUNNEL_UNIT, VOLATILITY, encodeBase58, formatTunnel, hashServerSeed, resolveBet, tunnelToPlain, withdrawalMessage } from "../packages/sdk/src";
import { arg, connection, explorer, guardCluster, loadKeypair } from "./lib";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const conn = connection();
const cluster = await guardCluster(conn);
const player = loadKeypair(process.env.PLAYER_KEYPAIR);
const wallet = player.publicKey.toBase58();
const depositWhole = BigInt(arg("deposit") ?? "100");
let cookie = "";
const ok = (cond: unknown, what: string) => {
  if (!cond) throw new Error(`FAILED: ${what}`);
  console.log(`  ✓ ${what}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json: json as any };
}
const me = async () => (await api("/api/casino/me")).json.data;

console.log(`player ${wallet} on ${cluster} via ${BASE}`);

// 1. Accelerator state
const state = (await api("/api/casino")).json.data;
ok(state?.bettingOpen, "accelerator is open");
const mint = new PublicKey(state.tunnelMint);
const house = new PublicKey(state.depositAddress);
const program = (await conn.getAccountInfo(mint))!.owner;

// 2. Sign in with Solana (free message)
const { json: nonce } = await api(`/api/auth/nonce?address=${wallet}`);
const sig = nacl.sign.detached(new TextEncoder().encode(nonce.message), player.secretKey);
const verify = await api("/api/auth/verify", { address: wallet, message: nonce.message, signature: Array.from(sig) });
ok(verify.status === 200 && cookie, "signed in with a wallet signature");

// 3. Deposit on-chain
const before = BigInt((await me()).balance);
const playerAta = getAssociatedTokenAddressSync(mint, player.publicKey, false, program);
const houseAta = getAssociatedTokenAddressSync(mint, house, false, program);
const walletTokensBefore = BigInt((await conn.getTokenAccountBalance(playerAta)).value.amount);
const amount = depositWhole * TUNNEL_UNIT;
ok(walletTokensBefore >= amount, `wallet holds ${formatTunnel(walletTokensBefore)} $TUNNEL`);
const tx = new Transaction().add(
  createAssociatedTokenAccountIdempotentInstruction(player.publicKey, houseAta, house, mint, program),
  createTransferCheckedInstruction(playerAta, mint, houseAta, player.publicKey, amount, TUNNEL_DECIMALS, [], program),
);
const depSig = await conn.sendTransaction(tx, [player]);
await conn.confirmTransaction({ signature: depSig, ...(await conn.getLatestBlockhash()) }, "confirmed");
console.log(`  deposit sent ${explorer(depSig, cluster)}`);
let credited = before;
const t0 = Date.now();
while (Date.now() - t0 < 120_000 && credited < before + amount) {
  await sleep(3_000);
  credited = BigInt((await me()).balance);
}
ok(credited === before + amount, `deposit of ${depositWhole} $TUNNEL credited after ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// 4. Shots
let balance = credited;
const bets: { id: string; volatility: number; amount: bigint; count: number; hits: boolean[]; payout: bigint; nonce: number }[] = [];
for (const [volatility, whole, count] of [
  [0, 1n, 10],
  [1, 2n, 5],
  [2, 1n, 8],
  [0, 3n, 3],
  [1, 1n, 12],
] as const) {
  const r = await api("/api/casino/bet", { volatility, amount: (whole * TUNNEL_UNIT).toString(), count });
  ok(r.status === 200, `${VOLATILITY[volatility].short} shot: ${count} × ${whole} → ${r.json.bet?.wins}/${count} tunneled, paid ${formatTunnel(BigInt(r.json.bet?.payout ?? 0))}`);
  const stake = whole * TUNNEL_UNIT * BigInt(count);
  const payout = BigInt(r.json.bet.payout);
  ok(BigInt(r.json.balance) === balance - stake + payout, "balance = previous − stake + payout");
  balance = BigInt(r.json.balance);
  bets.push({ id: r.json.bet.id, volatility, amount: whole * TUNNEL_UNIT, count, hits: r.json.hits, payout, nonce: r.json.bet.nonce });
}
const over = await api("/api/casino/bet", { volatility: 0, amount: (balance + TUNNEL_UNIT).toString(), count: 1 });
ok(over.status >= 400, `over-balance bet refused (${over.json.code})`);

// 5. Reveal the seed and verify every shot independently
const rot = await api("/api/casino/seed", {});
const seed = rot.json.revealed;
ok(hashServerSeed(seed.serverSeed) === seed.serverSeedHash, "revealed server seed matches the hash shown before betting");
for (const b of bets) {
  const out = resolveBet({ serverSeed: seed.serverSeed, clientSeed: seed.clientSeed, nonce: b.nonce, volatility: b.volatility, amount: b.amount, count: b.count });
  ok(JSON.stringify(out.hits) === JSON.stringify(b.hits) && out.payout === b.payout, `shot #${b.id} recomputes exactly`);
}

// 6. Withdraw half the balance and confirm it on-chain
const out = balance / 2n;
const msg = withdrawalMessage({ wallet, amount: tunnelToPlain(out), nonce: encodeBase58(nacl.randomBytes(16)), issuedAt: new Date().toISOString() });
const w = await api("/api/casino/withdraw", { message: msg, signature: encodeBase58(nacl.sign.detached(new TextEncoder().encode(msg), player.secretKey)) });
ok(w.status === 200, `withdrawal of ${formatTunnel(out)} $TUNNEL requested`);
let wd: any = null;
const t1 = Date.now();
while (Date.now() - t1 < 180_000) {
  await sleep(3_000);
  wd = (await me()).withdrawals.find((x: any) => String(x.id) === String(w.json.withdrawal.payoutId));
  if (wd?.status === "confirmed" || wd?.status === "failed") break;
}
ok(wd?.status === "confirmed", `withdrawal confirmed on-chain after ${((Date.now() - t1) / 1000).toFixed(0)} s ${wd?.txSignature ? explorer(wd.txSignature, cluster) : ""}`);
const parsed = await conn.getParsedTransaction(wd.txSignature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
const received = (parsed?.meta?.postTokenBalances ?? []).find((b) => b.owner === wallet && b.mint === mint.toBase58());
const pre = (parsed?.meta?.preTokenBalances ?? []).find((b) => b.owner === wallet && b.mint === mint.toBase58());
ok(received && BigInt(received.uiTokenAmount.amount) - BigInt(pre?.uiTokenAmount.amount ?? "0") === out, "the player's wallet received exactly the withdrawn amount");
ok(BigInt((await me()).balance) === balance - out, "remaining balance is correct");
console.log("\nALL CHECKS PASSED");
process.exit(0);
