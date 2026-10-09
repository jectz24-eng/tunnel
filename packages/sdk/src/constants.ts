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
  round: "round",
  roundVault: "round_vault",
  position: "position",
  treasuryVault: "treasury_vault",
} as const;

export const PARTICLE_DOMAIN = "TUNNEL/particle/v1";
export const BPS = 10_000n;
export const BARRIER_COUNT = 3;
export const TUNNEL_DECIMALS = 6;
export const TUNNEL_TOTAL_SUPPLY = 1_000_000_000n * 10n ** BigInt(TUNNEL_DECIMALS);
export const TUNNEL_MINING_RESERVE = 600_000_000n * 10n ** BigInt(TUNNEL_DECIMALS);
export const LAMPORTS_PER_SOL = 1_000_000_000n;

export interface BarrierParams {
  transmissionBps: number;
  rewardWeight: number;
}

export interface ProtocolParams {
  barriers: [BarrierParams, BarrierParams, BarrierParams];
  particleCostLamports: bigint;
  roundDurationSecs: number;
  protocolFeeBps: number;
  maxParticlesPerPosition: number;
  randomnessTimeoutSecs: number;
  initialEmissionPerRound: bigint;
  emissionDecayBps: number;
  emissionEpochRounds: number;
}

/**
 * Launch configuration from the spec. Barrier odds and weights are protocol
 * configuration, not physical measurements. Emission: 416 $TUNNEL per round,
 * ×0.999 every 1,440 rounds (~1 day at 60 s rounds). The geometric series
 * sums to ~599M, so the 600M reserve is never exceeded by the schedule; the
 * program additionally caps every round at the reserve actually funded.
 */
export const DEFAULT_PARAMS: ProtocolParams = {
  barriers: [
    { transmissionBps: 6500, rewardWeight: 1 },
    { transmissionBps: 3000, rewardWeight: 2 },
    { transmissionBps: 1000, rewardWeight: 5 },
  ],
  particleCostLamports: 10_000_000n, // 0.01 SOL
  roundDurationSecs: 60,
  protocolFeeBps: 500, // 5%
  maxParticlesPerPosition: 200,
  randomnessTimeoutSecs: 600,
  initialEmissionPerRound: 416n * 10n ** BigInt(TUNNEL_DECIMALS),
  emissionDecayBps: 9990,
  emissionEpochRounds: 1440,
};

/**
 * `color` is the brand hue (chamber, accents). `chart` is the same hue stepped
 * to pass the CVD / lightness checks on the dark panel surface (#0D131B):
 * validated with the dataviz palette validator, worst protan ΔE 8.4.
 */
export const BARRIER_META = [
  { numeral: "I", name: "Low Energy", color: "#31D9F5", chart: "#1E9DB5" },
  { numeral: "II", name: "Medium Energy", color: "#4378FF", chart: "#4A6CFA" },
  { numeral: "III", name: "High Energy", color: "#9B75FF", chart: "#C26ED4" },
] as const;

/** Serialized sizes (incl. 8-byte discriminator) — used for rent estimates. */
export const ACCOUNT_SIZES = {
  // owner 32 + round_id 8 + bump 1 + particles 6 + lamports 8 + settled 1 + successes 6 + success_weight 8 + claimed 1 + lamports_paid 8 + tokens_paid 8
  position: 8 + 87,
  tokenAccount: 165,
} as const;
