/**
 * Provable fairness without a smart contract.
 *
 * For every cycle the server:
 *  1. generates a secret 32-byte seed and publishes `commitment = sha256(DOMAIN ‖ seed)`
 *     together with an `entropySlot`: a Solana slot that will be produced only
 *     after the deployment window closes;
 *  2. after close, reads the blockhash of the first produced slot ≥ entropySlot;
 *  3. derives `randomness = sha512(DOMAIN ‖ seed ‖ blockhash ‖ cycle_id_le)`
 *     and settles every particle with `particleDraw` (math.ts);
 *  4. reveals the seed.
 *
 * Why this is fair: the seed is fixed before anyone deploys (it is committed),
 * so the server cannot change it to favour anyone; the blockhash does not
 * exist until after deployments close, so nobody — the server included —
 * can know any outcome while deployments are open. Anyone can recheck the
 * commitment, fetch the blockhash from any Solana RPC, and recompute every
 * particle.
 *
 * Trust that remains: the server could refuse to settle a cycle (it would
 * then be voided) and it holds the reward wallet. See docs/SECURITY.md.
 */
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { decodeBase58, fromHex, toHex, u64le } from "./bytes";
import { BARRIER_META, LEVEL_LABELS } from "./constants";

const enc = new TextEncoder();
export const SEED_COMMIT_DOMAIN = "TUNNEL/seed-commit/v3";
export const RANDOMNESS_DOMAIN = "TUNNEL/cycle-randomness/v3";

export function commitSeed(seed: Uint8Array): string {
  if (seed.length !== 32) throw new Error("seed must be 32 bytes");
  return toHex(sha256.create().update(enc.encode(SEED_COMMIT_DOMAIN)).update(seed).digest());
}

/** 64 bytes of cycle randomness from the revealed seed and the post-close Solana blockhash (base58). */
export function deriveRandomness(seed: Uint8Array, blockhash: string, cycleId: bigint): Uint8Array {
  const bh = decodeBase58(blockhash);
  if (seed.length !== 32 || bh.length !== 32) throw new Error("seed and blockhash must be 32 bytes");
  return sha512.create().update(enc.encode(RANDOMNESS_DOMAIN)).update(seed).update(bh).update(u64le(cycleId)).digest();
}

export interface FairnessCheck {
  commitmentMatches: boolean;
  randomnessMatches: boolean;
}

/** Re-derives a settled cycle's randomness from public inputs and compares with what the server published. */
export function verifyCycleFairness(c: { id: bigint; seedCommitment: string; serverSeed: string; entropyBlockhash: string; randomness: string }): FairnessCheck {
  const seed = fromHex(c.serverSeed);
  return {
    commitmentMatches: commitSeed(seed) === c.seedCommitment,
    randomnessMatches: toHex(deriveRandomness(seed, c.entropyBlockhash, c.id)) === c.randomness,
  };
}

// ---------------------------------------------------------------- signed messages

/** Signed messages must be fresh: accepted for this long after `Issued`. */
export const MESSAGE_TTL_MS = 5 * 60_000;

export interface DeploymentIntent {
  wallet: string;
  cycleId: bigint;
  barrier: number;
  level: number;
  count: number;
  nonce: string;
  issuedAt: string;
}

/**
 * The exact text a wallet signs to deploy particles. Human-readable so the
 * wallet shows what is being approved. Signing is free: no transaction.
 */
export function deploymentMessage(d: DeploymentIntent): string {
  return [
    "TUNNEL — deploy particles",
    "",
    "Signing this message is free. It is not a transaction and moves no funds.",
    "",
    `Wallet: ${d.wallet}`,
    `Cycle: ${d.cycleId}`,
    `Barrier: ${BARRIER_META[d.barrier]?.short ?? d.barrier} (${d.barrier})`,
    `Energy level: ${LEVEL_LABELS[d.level] ?? d.level} (${d.level})`,
    `Particles: ${d.count}`,
    `Nonce: ${d.nonce}`,
    `Issued: ${d.issuedAt}`,
  ].join("\n");
}

export function parseDeploymentMessage(msg: string): DeploymentIntent | null {
  const get = (k: string) => new RegExp(`^${k}: (.+)$`, "m").exec(msg)?.[1];
  const wallet = get("Wallet");
  const cycle = get("Cycle");
  const barrier = /\((\d)\)$/.exec(get("Barrier") ?? "")?.[1];
  const level = /\((\d)\)$/.exec(get("Energy level") ?? "")?.[1];
  const count = get("Particles");
  const nonce = get("Nonce");
  const issuedAt = get("Issued");
  if (!wallet || !cycle || !/^\d+$/.test(cycle) || barrier == null || level == null || !count || !/^\d+$/.test(count) || !nonce || !issuedAt) return null;
  const d: DeploymentIntent = { wallet, cycleId: BigInt(cycle), barrier: Number(barrier), level: Number(level), count: Number(count), nonce, issuedAt };
  // The message must be exactly the canonical rendering (no extra or altered lines).
  return deploymentMessage(d) === msg ? d : null;
}

export interface ClaimIntent {
  wallet: string;
  nonce: string;
  issuedAt: string;
}

/** The exact text a wallet signs to request a payout of everything it can claim. */
export function claimMessage(c: ClaimIntent): string {
  return [
    "TUNNEL — claim rewards",
    "",
    "Signing this message is free. TUNNEL will send your claimable $TUNNEL to this wallet.",
    "",
    `Wallet: ${c.wallet}`,
    `Nonce: ${c.nonce}`,
    `Issued: ${c.issuedAt}`,
  ].join("\n");
}

export function parseClaimMessage(msg: string): ClaimIntent | null {
  const get = (k: string) => new RegExp(`^${k}: (.+)$`, "m").exec(msg)?.[1];
  const c = { wallet: get("Wallet") ?? "", nonce: get("Nonce") ?? "", issuedAt: get("Issued") ?? "" };
  if (!c.wallet || !c.nonce || !c.issuedAt) return null;
  return claimMessage(c) === msg ? c : null;
}

export function isFresh(issuedAt: string, now = Date.now()): boolean {
  const t = Date.parse(issuedAt);
  return Number.isFinite(t) && now - t <= MESSAGE_TTL_MS && t - now <= 30_000;
}
