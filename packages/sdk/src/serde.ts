/**
 * JSON forms of ProtocolParams and OddsTable (bigints as decimal strings) for
 * storage in the database and transport over the API.
 */
import type { OddsTable, ProtocolParams } from "./constants";

export interface ProtocolParamsJson extends Omit<ProtocolParams, "rewardPerEnergy" | "initialEmissionPerCycle"> {
  rewardPerEnergy: string;
  initialEmissionPerCycle: string;
}

export interface OddsTableJson {
  transmissionPpb: number[][];
  reward: string[][];
}

export const paramsToJson = (p: ProtocolParams): ProtocolParamsJson => ({
  ...p,
  rewardPerEnergy: p.rewardPerEnergy.toString(),
  initialEmissionPerCycle: p.initialEmissionPerCycle.toString(),
});

export const paramsFromJson = (j: ProtocolParamsJson): ProtocolParams => ({
  ...j,
  rewardPerEnergy: BigInt(j.rewardPerEnergy),
  initialEmissionPerCycle: BigInt(j.initialEmissionPerCycle),
});

export const oddsToJson = (o: OddsTable): OddsTableJson => ({
  transmissionPpb: o.transmissionPpb,
  reward: o.reward.map((r) => r.map(String)),
});

export const oddsFromJson = (j: OddsTableJson): OddsTable => ({
  transmissionPpb: j.transmissionPpb,
  reward: j.reward.map((r) => r.map((v) => BigInt(v))),
});

/** Flattened [barrier][level] cell index used by Position.particles / successes. */
export const cellIndex = (barrier: number, level: number) => barrier * 5 + level;

/** Flat 15-element array → [barrier][level]. */
export const unflatten = <T>(flat: T[]): T[][] => [flat.slice(0, 5), flat.slice(5, 10), flat.slice(10, 15)];
