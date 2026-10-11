import { PublicKey } from "@solana/web3.js";
import programIdJson from "./program-id.json";

export const TUNNEL_PROGRAM_ID = new PublicKey(programIdJson.programId);

/** ORAO VRF v2 ("classic") program — same address on devnet and mainnet. */
export const ORAO_VRF_PROGRAM_ID = new PublicKey("VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y");
export const ORAO_CONFIG_SEED = "orao-vrf-network-configuration";
export const ORAO_RANDOMNESS_SEED = "orao-vrf-randomness-request";

export const SEEDS = {
  protocol: "protocol",
  rewardVault: "reward_vault",
  cycle: "cycle",
  position: "position",
} as const;

export const PARTICLE_DOMAIN = "TUNNEL/particle/v2";
export const BPS = 10_000n;
export const BARRIER_COUNT = 3;
export const ENERGY_LEVELS = 5;
export const TUNNEL_DECIMALS = 6;
export const TUNNEL_UNIT = 10n ** BigInt(TUNNEL_DECIMALS);
export const LAMPORTS_PER_SOL = 1_000_000_000n;

export interface BarrierConfig {
  /** V₀ × 1000 (normalized units, ħ²/2m = 1). */
  heightMilli: number;
  /** a × 1000. */
  widthMilli: number;
  rewardPremiumBps: number;
}

export interface EnergyLevel {
  /** Particle energy as a fraction of barrier height, in bps. */
  energyBps: number;
  /** Energy units drawn from the per-cycle allowance per particle. */
  cost: number;
}

export interface ProtocolParams {
  barriers: [BarrierConfig, BarrierConfig, BarrierConfig];
  levels: EnergyLevel[];
  energyPerCycle: number;
  rewardPerEnergy: bigint;
  cycleDurationSecs: number;
  randomnessTimeoutSecs: number;
  initialEmissionPerCycle: bigint;
  emissionDecayBps: number;
  emissionEpochCycles: number;
}

export interface OddsTable {
  /** [barrier][level] tunneling probability, parts per billion. */
  transmissionPpb: number[][];
  /** [barrier][level] nominal $TUNNEL base units per successful particle. */
  reward: bigint[][];
}

/**
 * Launch configuration. Barrier heights and widths are physical inputs; the
 * program derives every probability from them and calibrates rewards so the
 * expected reward per energy unit is `rewardPerEnergy × premium`.
 *
 * Emission: 20,000 $TUNNEL budgeted per 10-minute cycle, ×0.995 every 144
 * cycles (one day). The schedule sums to ~576M, below the reserve; the
 * program additionally caps every cycle at the reserve actually funded.
 */
export const DEFAULT_PARAMS: ProtocolParams = {
  barriers: [
    { heightMilli: 1_000, widthMilli: 900, rewardPremiumBps: 9_500 },
    { heightMilli: 2_000, widthMilli: 1_300, rewardPremiumBps: 10_000 },
    { heightMilli: 4_000, widthMilli: 1_500, rewardPremiumBps: 10_500 },
  ],
  levels: [
    { energyBps: 2_000, cost: 1 },
    { energyBps: 3_500, cost: 2 },
    { energyBps: 5_000, cost: 3 },
    { energyBps: 6_500, cost: 4 },
    { energyBps: 8_000, cost: 5 },
  ],
  energyPerCycle: 100,
  rewardPerEnergy: 1n * TUNNEL_UNIT,
  cycleDurationSecs: 600,
  randomnessTimeoutSecs: 900,
  initialEmissionPerCycle: 20_000n * TUNNEL_UNIT,
  emissionDecayBps: 9_950,
  emissionEpochCycles: 144,
};

/**
 * Token supply figures are PLACEHOLDERS until the project owner supplies the
 * real tokenomics. The site reads the actual mint supply and reserve balance
 * from chain and labels these values as placeholders wherever they appear.
 */
export const PLACEHOLDER_TOKENOMICS = {
  isPlaceholder: true,
  totalSupply: 1_000_000_000n * TUNNEL_UNIT,
  miningReserve: 600_000_000n * TUNNEL_UNIT,
} as const;

/**
 * `color` is the brand hue (chamber, accents). `chart` is the same hue stepped
 * for chart marks on the dark panel surface.
 */
export const BARRIER_META = [
  { numeral: "I", key: "low", name: "Low Barrier", short: "LOW", color: "#00D9FF", chart: "#19B8D6" },
  { numeral: "II", key: "medium", name: "Medium Barrier", short: "MEDIUM", color: "#2864FF", chart: "#4E7BFF" },
  { numeral: "III", key: "high", name: "High Barrier", short: "HIGH", color: "#885BFF", chart: "#A47DFF" },
] as const;

export const LEVEL_LABELS = ["E1", "E2", "E3", "E4", "E5"] as const;

/** Serialized sizes (incl. 8-byte discriminator) — used for rent estimates. */
export const ACCOUNT_SIZES = {
  // owner 32 + cycle_id 8 + bump 1 + particles 30 + energy_used 2 + experiments 2 + settled 1 + successes 30 + nominal 8 + claimed 1 + tokens_paid 8
  position: 8 + 123,
  tokenAccount: 165,
} as const;
