import type { PrismaClient } from "@tunnel/db";
import {
  DEFAULT_PARAMS,
  deriveOdds,
  oddsFromJson,
  oddsToJson,
  paramsFromJson,
  paramsToJson,
  type OddsTable,
  type OddsTableJson,
  type ProtocolParams,
  type ProtocolParamsJson,
} from "@tunnel/sdk";
import { ProtocolError } from "./errors";

export type Db = PrismaClient;
/** A Prisma client or an interactive-transaction client. */
export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

export interface LoadedConfig {
  params: ProtocolParams;
  odds: OddsTable;
  paused: boolean;
  tunnelMint: string | null;
  rewardWallet: string | null;
  reserveFundedTotal: bigint;
  rewardWalletTokens: bigint | null;
  rewardWalletLamports: bigint | null;
  lastSlot: bigint | null;
  engineHeartbeat: Date | null;
}

/**
 * Creates the configuration row on first run. Mining starts PAUSED: an
 * operator has to fund the reward wallet and unpause explicitly.
 */
export async function ensureConfig(db: Tx): Promise<void> {
  await db.protocolConfig.upsert({
    where: { id: 1 },
    create: { id: 1, params: paramsToJson(DEFAULT_PARAMS) as object, odds: oddsToJson(deriveOdds(DEFAULT_PARAMS)) as object, paused: true },
    update: {},
  });
}

export async function loadConfig(db: Tx): Promise<LoadedConfig> {
  await ensureConfig(db);
  const c = (await db.protocolConfig.findUnique({ where: { id: 1 } }))!;
  return {
    params: paramsFromJson(c.params as unknown as ProtocolParamsJson),
    odds: oddsFromJson(c.odds as unknown as OddsTableJson),
    paused: c.paused,
    tunnelMint: c.tunnelMint,
    rewardWallet: c.rewardWallet,
    reserveFundedTotal: c.reserveFundedTotal,
    rewardWalletTokens: c.rewardWalletTokens,
    rewardWalletLamports: c.rewardWalletLamports,
    lastSlot: c.lastSlot,
    engineHeartbeat: c.engineHeartbeat,
  };
}

/** Validates bounds and re-derives the odds from the physics before storing. Applies to cycles opened afterwards. */
export async function setParams(db: Db, params: ProtocolParams, actor: string): Promise<OddsTable> {
  if (params.barriers.length !== 3 || params.levels.length !== 5) throw new ProtocolError("bad_params", "Need 3 barriers and 5 energy levels.");
  if (!(params.energyPerCycle >= 1 && params.energyPerCycle <= 10_000)) throw new ProtocolError("bad_params", "energyPerCycle out of range.");
  if (!(params.cycleDurationSecs >= 60 && params.cycleDurationSecs <= 86_400)) throw new ProtocolError("bad_params", "cycleDurationSecs out of range.");
  if (!(params.emissionDecayBps > 0 && params.emissionDecayBps <= 10_000)) throw new ProtocolError("bad_params", "emissionDecayBps out of range.");
  if (!(params.emissionEpochCycles >= 1)) throw new ProtocolError("bad_params", "emissionEpochCycles must be ≥ 1.");
  if (params.rewardPerEnergy <= 0n || params.initialEmissionPerCycle < 0n) throw new ProtocolError("bad_params", "Rewards must be positive.");
  for (const l of params.levels) {
    if (!(l.cost >= 1 && l.cost <= params.energyPerCycle)) throw new ProtocolError("bad_params", "Level cost out of range.");
    if (!(l.energyBps > 0 && l.energyBps < 10_000)) throw new ProtocolError("bad_params", "Level energy must be below the barrier.");
  }
  let odds: OddsTable;
  try {
    odds = deriveOdds(params);
  } catch (e) {
    throw new ProtocolError("bad_params", String((e as Error).message));
  }
  await db.$transaction([
    db.protocolConfig.update({ where: { id: 1 }, data: { params: paramsToJson(params) as object, odds: oddsToJson(odds) as object } }),
    db.protocolEvent.create({ data: { name: "ParamsUpdated", wallet: actor, data: { params: paramsToJson(params), odds: oddsToJson(odds) } as object } }),
  ]);
  return odds;
}

export async function setPaused(db: Db, paused: boolean, actor: string): Promise<void> {
  await ensureConfig(db);
  await db.$transaction([
    db.protocolConfig.update({ where: { id: 1 }, data: { paused } }),
    db.protocolEvent.create({ data: { name: paused ? "MiningPaused" : "MiningResumed", wallet: actor, data: {} } }),
  ]);
}

/** Records $TUNNEL deposited into the reward wallet for mining (after the transfer has confirmed). */
export async function recordReserveFunding(db: Db, amount: bigint, txSignature: string, actor: string): Promise<void> {
  if (amount <= 0n) throw new ProtocolError("bad_amount", "Amount must be positive.");
  await ensureConfig(db);
  await db.$transaction([
    db.protocolConfig.update({ where: { id: 1 }, data: { reserveFundedTotal: { increment: amount } } }),
    db.protocolEvent.create({ data: { name: "ReserveFunded", wallet: actor, data: { amount: amount.toString(), txSignature } } }),
  ]);
}
