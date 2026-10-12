/**
 * Deployments: a wallet signs a human-readable message (free; no
 * transaction) committing particles to a [barrier][energy level] cell of the
 * open cycle. The server verifies the signature, then — in one transaction
 * holding the cycle row lock — checks the window, the energy allowance and
 * records the experiment. Outcomes stay unknown to everyone until the cycle's
 * entropy block exists, which is after the window closes.
 */
import { BARRIER_COUNT, ENERGY_LEVELS, isFresh, oddsFromJson, parseDeploymentMessage, type BarrierConfig, type EnergyLevel, type OddsTableJson } from "@tunnel/sdk";
import type { Db } from "./config";
import { loadConfig } from "./config";
import { ENTROPY_GUARD_SLOTS } from "./cycles";
import { ProtocolError } from "./errors";
import { isAddress, verifySignature } from "./signature";

export const MAX_PARTICLES_PER_DEPLOY = 100;

export interface DeployResult {
  experimentId: bigint;
  cycleId: bigint;
  seq: number;
  barrier: number;
  level: number;
  count: number;
  firstIndex: number;
  energyCost: number;
  energyUsed: number;
  energyPerCycle: number;
  transmissionPpb: number;
  rewardPerSuccess: bigint;
}

type LockedCycle = { id: bigint; status: string; closeTs: Date; entropySlot: bigint; energyPerCycle: number; barriers: unknown; levels: unknown; odds: unknown };

export async function deploy(db: Db, input: { message: string; signature: string }, now = new Date()): Promise<DeployResult> {
  if (typeof input?.message !== "string" || typeof input?.signature !== "string" || input.message.length > 2_000) {
    throw new ProtocolError("bad_request", "Expected { message, signature }.");
  }
  const intent = parseDeploymentMessage(input.message);
  if (!intent) throw new ProtocolError("bad_message", "The signed message is not a valid TUNNEL deployment.");
  if (!isAddress(intent.wallet)) throw new ProtocolError("bad_message", "Invalid wallet address.");
  if (!(intent.barrier >= 0 && intent.barrier < BARRIER_COUNT && intent.level >= 0 && intent.level < ENERGY_LEVELS)) {
    throw new ProtocolError("bad_message", "Unknown barrier or energy level.");
  }
  if (!(Number.isInteger(intent.count) && intent.count >= 1 && intent.count <= MAX_PARTICLES_PER_DEPLOY)) {
    throw new ProtocolError("bad_message", `Particles must be between 1 and ${MAX_PARTICLES_PER_DEPLOY}.`);
  }
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(intent.nonce)) throw new ProtocolError("bad_message", "Invalid nonce.");
  if (!isFresh(intent.issuedAt, now.getTime())) throw new ProtocolError("stale_message", "This signed request has expired. Please sign again.");
  verifySignature(input.message, input.signature, intent.wallet);

  try {
    return await db.$transaction(async (tx) => {
      // Replay protection: each nonce (and each signature) is accepted once.
      await tx.usedNonce.create({ data: { nonce: intent.nonce, wallet: intent.wallet } });

      const cfg = await loadConfig(tx);
      if (cfg.paused) throw new ProtocolError("paused", "Mining is paused.", 409);

      const [cycle] = await tx.$queryRaw<LockedCycle[]>`
        SELECT "id", "status", "closeTs", "entropySlot", "energyPerCycle", "barriers", "levels", "odds"
        FROM "Cycle" WHERE "id" = ${intent.cycleId} FOR UPDATE`;
      if (!cycle) throw new ProtocolError("no_cycle", "That cycle does not exist.", 404);
      if (cycle.status !== "open" || cycle.closeTs.getTime() <= now.getTime()) {
        throw new ProtocolError("cycle_closed", "This cycle's deployment window has closed. Deploy into the next one.", 409);
      }
      if (cfg.lastSlot != null && cfg.lastSlot >= cycle.entropySlot - ENTROPY_GUARD_SLOTS) {
        throw new ProtocolError("cycle_closed", "This cycle is closing. Deploy into the next one.", 409);
      }

      const barrier = (cycle.barriers as BarrierConfig[])[intent.barrier];
      const level = (cycle.levels as EnergyLevel[])[intent.level];
      const odds = oddsFromJson(cycle.odds as OddsTableJson);
      const energyCost = level.cost * intent.count;

      await tx.user.upsert({ where: { wallet: intent.wallet }, create: { wallet: intent.wallet }, update: { lastActivityAt: now } });
      const existing = await tx.position.findUnique({ where: { cycleId_wallet: { cycleId: cycle.id, wallet: intent.wallet } } });
      const energyUsed = (existing?.energyUsed ?? 0) + energyCost;
      if (energyUsed > cycle.energyPerCycle) {
        const left = cycle.energyPerCycle - (existing?.energyUsed ?? 0);
        throw new ProtocolError("energy", `Not enough energy: this needs ${energyCost}, you have ${left} left this cycle.`, 409);
      }

      const cell = intent.barrier * 5 + intent.level;
      const particles = existing?.particles ?? Array(15).fill(0);
      const firstIndex = particles[cell];
      const seq = existing?.experiments ?? 0;
      const nextParticles = particles.map((n, i) => (i === cell ? n + intent.count : n));
      if (existing) {
        await tx.position.update({
          where: { cycleId_wallet: { cycleId: cycle.id, wallet: intent.wallet } },
          data: { particles: nextParticles, energyUsed, experiments: seq + 1 },
        });
      } else {
        await tx.position.create({
          data: { cycleId: cycle.id, wallet: intent.wallet, particles: nextParticles, successes: Array(15).fill(0), energyUsed, experiments: 1 },
        });
      }

      const transmissionPpb = odds.transmissionPpb[intent.barrier][intent.level];
      const rewardPerSuccess = odds.reward[intent.barrier][intent.level];
      const exp = await tx.experiment.create({
        data: {
          cycleId: cycle.id,
          wallet: intent.wallet,
          seq,
          barrier: intent.barrier,
          level: intent.level,
          count: intent.count,
          firstIndex,
          energyCost,
          heightMilli: barrier.heightMilli,
          widthMilli: barrier.widthMilli,
          energyBps: level.energyBps,
          transmissionPpb,
          nominalReward: rewardPerSuccess,
          message: input.message,
          signature: input.signature,
          nonce: intent.nonce,
          createdAt: now,
        },
      });

      const particlesByBarrier = [0, 1, 2].map((b) => (b === intent.barrier ? 1n : 0n) * BigInt(intent.count));
      await tx.$executeRaw`
        UPDATE "Cycle" SET
          "participants" = "participants" + ${existing ? 0 : 1},
          "experiments" = "experiments" + 1,
          "particles" = ARRAY["particles"[1] + ${particlesByBarrier[0]}, "particles"[2] + ${particlesByBarrier[1]}, "particles"[3] + ${particlesByBarrier[2]}]::bigint[],
          "energyUsed" = "energyUsed" + ${energyCost},
          "updatedAt" = ${now}
        WHERE "id" = ${cycle.id}`;
      await tx.protocolEvent.create({
        data: {
          name: "ParticlesDeployed",
          cycleId: cycle.id,
          wallet: intent.wallet,
          data: { experiment: seq, barrier: intent.barrier, level: intent.level, count: intent.count, energyCost, energyUsed, transmissionPpb },
        },
      });

      return {
        experimentId: exp.id,
        cycleId: cycle.id,
        seq,
        barrier: intent.barrier,
        level: intent.level,
        count: intent.count,
        firstIndex,
        energyCost,
        energyUsed,
        energyPerCycle: cycle.energyPerCycle,
        transmissionPpb,
        rewardPerSuccess,
      };
    });
  } catch (e) {
    throw uniqueToReplay(e);
  }
}

/** Maps a unique-constraint violation (nonce or signature reuse) to a clean error. */
export function uniqueToReplay(e: unknown): unknown {
  const code = (e as { code?: string })?.code;
  if (code === "P2002" || /Unique constraint|duplicate key/i.test(String((e as Error)?.message ?? ""))) {
    return new ProtocolError("replay", "This signed request was already used. Please sign a new one.", 409);
  }
  return e;
}
