import { PublicKey } from "@solana/web3.js";
import { ORAO_CONFIG_SEED, ORAO_RANDOMNESS_SEED, ORAO_VRF_PROGRAM_ID, SEEDS, TUNNEL_PROGRAM_ID } from "./constants";

const enc = (s: string) => new TextEncoder().encode(s);

export function u64le(n: bigint | number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}

export const protocolPda = (programId = TUNNEL_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([enc(SEEDS.protocol)], programId)[0];

export const rewardVaultPda = (programId = TUNNEL_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([enc(SEEDS.rewardVault)], programId)[0];

export const treasuryVaultPda = (programId = TUNNEL_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([enc(SEEDS.treasuryVault)], programId)[0];

export const roundPda = (roundId: bigint | number, programId = TUNNEL_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([enc(SEEDS.round), u64le(roundId)], programId)[0];

export const roundVaultPda = (roundId: bigint | number, programId = TUNNEL_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([enc(SEEDS.roundVault), u64le(roundId)], programId)[0];

export const positionPda = (roundId: bigint | number, owner: PublicKey, programId = TUNNEL_PROGRAM_ID) =>
  PublicKey.findProgramAddressSync([enc(SEEDS.position), u64le(roundId), owner.toBytes()], programId)[0];

export const oraoNetworkStatePda = () =>
  PublicKey.findProgramAddressSync([enc(ORAO_CONFIG_SEED)], ORAO_VRF_PROGRAM_ID)[0];

export const oraoRandomnessPda = (seed: Uint8Array) =>
  PublicKey.findProgramAddressSync([enc(ORAO_RANDOMNESS_SEED), seed], ORAO_VRF_PROGRAM_ID)[0];
