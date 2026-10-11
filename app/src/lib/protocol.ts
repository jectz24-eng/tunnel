"use client";

import { DEFAULT_PARAMS, deriveOdds, type BarrierConfig, type EnergyLevel, type OddsTable } from "@tunnel/sdk";
import { useMemo } from "react";
import { useProtocol } from "./chain";

export interface ProtocolConfigView {
  barriers: BarrierConfig[];
  levels: EnergyLevel[];
  odds: OddsTable;
  energyPerCycle: number;
  cycleDurationSecs: number;
  /** "chain" = read from the deployed Protocol account; "launch" = the default parameters (program not reachable/initialized). */
  source: "chain" | "launch";
  loading: boolean;
}

const LAUNCH_ODDS = deriveOdds(DEFAULT_PARAMS);

/**
 * Barrier configuration and odds for display. Values come from the onchain
 * Protocol account; until it is reachable the UI shows the launch parameters
 * and labels them as such (never as live values).
 */
export function useProtocolConfig(): ProtocolConfigView {
  const protocol = useProtocol();
  return useMemo(() => {
    const p = protocol.data;
    if (p) {
      return {
        barriers: p.params.barriers,
        levels: p.params.levels,
        odds: p.odds,
        energyPerCycle: p.params.energyPerCycle,
        cycleDurationSecs: p.params.cycleDurationSecs,
        source: "chain",
        loading: false,
      };
    }
    return {
      barriers: DEFAULT_PARAMS.barriers,
      levels: DEFAULT_PARAMS.levels,
      odds: LAUNCH_ODDS,
      energyPerCycle: DEFAULT_PARAMS.energyPerCycle,
      cycleDurationSecs: DEFAULT_PARAMS.cycleDurationSecs,
      source: "launch",
      loading: protocol.loading && protocol.data === undefined,
    };
  }, [protocol.data, protocol.loading]);
}

/** Physical values of a barrier/level for physics components (normalized units). */
export function physicsOf(b: BarrierConfig, l: EnergyLevel) {
  const v0 = b.heightMilli / 1000;
  return { v0, a: b.widthMilli / 1000, e: (v0 * l.energyBps) / 10_000 };
}
