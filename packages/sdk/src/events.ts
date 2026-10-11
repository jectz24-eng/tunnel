import { EventParser } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import { coder } from "./accounts";

export type TunnelEventName =
  | "ProtocolInitialized"
  | "ParamsUpdated"
  | "PauseChanged"
  | "GatekeeperChanged"
  | "AdminProposed"
  | "AdminAccepted"
  | "ReserveFunded"
  | "CycleOpened"
  | "ParticlesDeployed"
  | "CycleClosed"
  | "RandomnessRequested"
  | "RandomnessRevealed"
  | "PositionSettled"
  | "CycleFinalized"
  | "CycleVoided"
  | "RewardClaimed"
  | "CycleSwept";

export interface ParsedEvent {
  name: TunnelEventName;
  /** Position of the event within its transaction's logs. */
  index: number;
  /** Raw decoded fields (snake_case, BN for 64-bit ints, PublicKey for keys). */
  data: Record<string, any>;
}

/** Decodes TUNNEL events (`Program data:` lines) from a transaction's log messages. */
export function parseEvents(programId: PublicKey, logs: string[]): ParsedEvent[] {
  const parser = new EventParser(programId, coder);
  const out: ParsedEvent[] = [];
  let index = 0;
  for (const e of parser.parseLogs(logs)) {
    out.push({ name: e.name as TunnelEventName, index: index++, data: e.data as Record<string, any> });
  }
  return out;
}

/** Converts BN / PublicKey / number arrays in decoded events into JSON-safe values. */
export function normaliseEventData(v: any): any {
  if (v === null || v === undefined) return v;
  if (typeof v === "object" && typeof v.toBase58 === "function") return v.toBase58();
  if (typeof v === "object" && v.constructor?.name === "BN") return v.toString();
  if (Array.isArray(v)) return v.map(normaliseEventData);
  if (typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 1 && typeof v[keys[0]] === "object" && Object.keys(v[keys[0]]).length === 0) return keys[0];
    return Object.fromEntries(keys.map((k) => [k, normaliseEventData(v[k])]));
  }
  return v;
}
