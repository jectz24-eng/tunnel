/**
 * Generates src/idl/tunnel.json from a hand-maintained description of the
 * Rust program, computing Anchor discriminators exactly like `anchor build`.
 *
 * This exists so the TypeScript side can be developed before the Solana
 * toolchain is available. Once `anchor build` runs, `npm run idl:sync` (repo
 * root) diffs the generated IDL against target/idl/tunnel.json and replaces it.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const disc = (s: string) => [...createHash("sha256").update(s).digest().subarray(0, 8)];

type T = string | { array: [T, number] } | { option: T } | { defined: { name: string } };
const def = (name: string): T => ({ defined: { name } });
const arr = (t: T, n: number): T => ({ array: [t, n] });
type Field = [string, T];
const fields = (f: Field[]) => f.map(([name, type]) => ({ name, type }));

const programId: string = JSON.parse(readFileSync(join(here, "../src/program-id.json"), "utf8")).programId;

const types: Record<string, Field[] | string[]> = {
  BarrierParams: [["transmission_bps", "u16"], ["reward_weight", "u16"]],
  ProtocolParams: [
    ["barriers", arr(def("BarrierParams"), 3)],
    ["particle_cost_lamports", "u64"],
    ["round_duration_secs", "u32"],
    ["protocol_fee_bps", "u16"],
    ["max_particles_per_position", "u16"],
    ["randomness_timeout_secs", "u32"],
    ["initial_emission_per_round", "u64"],
    ["emission_decay_bps", "u16"],
    ["emission_epoch_rounds", "u32"],
  ],
  RoundStatus: ["Open", "Closed", "AwaitingRandomness", "Resolving", "Settled", "Failed"],
  RoundOutcome: ["Pending", "Rewards", "NoSuccessRefund", "FullRefund", "Empty"],
};

const accounts: Record<string, Field[]> = {
  Position: [
    ["owner", "pubkey"], ["round_id", "u64"], ["bump", "u8"],
    ["particles", arr("u16", 3)], ["lamports", "u64"], ["settled", "bool"],
    ["successes", arr("u16", 3)], ["success_weight", "u64"], ["claimed", "bool"],
    ["lamports_paid", "u64"], ["tokens_paid", "u64"],
  ],
  Protocol: [
    ["admin", "pubkey"], ["pending_admin", { option: "pubkey" }], ["treasury", "pubkey"],
    ["tunnel_mint", "pubkey"], ["reward_vault", "pubkey"], ["params", def("ProtocolParams")],
    ["paused", "bool"], ["next_round_id", "u64"], ["last_round_open_ts", "i64"],
    ["last_round_close_ts", "i64"], ["reserve_available", "u64"], ["reserve_funded_total", "u64"],
    ["total_lamports_committed", "u64"], ["total_particles", "u64"], ["total_successes", "u64"],
    ["total_tokens_allocated", "u64"], ["total_fees_lamports", "u64"], ["rounds_settled", "u64"],
    ["bump", "u8"], ["reward_vault_bump", "u8"],
  ],
  Round: [
    ["id", "u64"], ["status", def("RoundStatus")], ["outcome", def("RoundOutcome")],
    ["bump", "u8"], ["vault_bump", "u8"], ["open_ts", "i64"], ["close_ts", "i64"], ["closed_ts", "i64"],
    ["barriers", arr(def("BarrierParams"), 3)], ["particle_cost_lamports", "u64"],
    ["protocol_fee_bps", "u16"], ["max_particles_per_position", "u16"],
    ["randomness_timeout_secs", "u32"], ["emission_budget", "u64"],
    ["particles", arr("u64", 3)], ["total_lamports", "u64"], ["participants", "u32"],
    ["vrf_seed", arr("u8", 32)], ["randomness_requested_ts", "i64"], ["randomness", arr("u8", 64)],
    ["positions_settled", "u32"], ["successes", arr("u64", 3)], ["total_success_weight", "u64"],
    ["fee_lamports", "u64"], ["distributable_lamports", "u64"], ["settled_ts", "i64"],
    ["claims", "u32"], ["lamports_claimed", "u64"], ["tokens_claimed", "u64"], ["swept", "bool"],
  ],
  RoundVault: [["round_id", "u64"], ["bump", "u8"]],
  TreasuryVault: [["bump", "u8"]],
};

const events: Record<string, Field[]> = {
  AdminAccepted: [["admin", "pubkey"]],
  AdminProposed: [["pending_admin", "pubkey"]],
  FeesWithdrawn: [["treasury", "pubkey"], ["lamports", "u64"]],
  ParamsUpdated: [["params", def("ProtocolParams")]],
  ParticlesDeployed: [
    ["round_id", "u64"], ["owner", "pubkey"], ["barrier", "u8"], ["count", "u16"], ["lamports", "u64"],
    ["position_particles", arr("u16", 3)], ["round_total_lamports", "u64"],
  ],
  PauseChanged: [["paused", "bool"]],
  PositionSettled: [
    ["round_id", "u64"], ["owner", "pubkey"], ["particles", arr("u16", 3)],
    ["successes", arr("u16", 3)], ["success_weight", "u64"],
  ],
  ProtocolInitialized: [
    ["admin", "pubkey"], ["treasury", "pubkey"], ["tunnel_mint", "pubkey"],
    ["reward_vault", "pubkey"], ["params", def("ProtocolParams")],
  ],
  RandomnessRequested: [["round_id", "u64"], ["vrf_seed", arr("u8", 32)], ["requested_ts", "i64"]],
  RandomnessRevealed: [["round_id", "u64"], ["randomness", arr("u8", 64)]],
  ReserveFunded: [["funder", "pubkey"], ["amount", "u64"], ["reserve_available", "u64"]],
  RewardClaimed: [["round_id", "u64"], ["owner", "pubkey"], ["lamports", "u64"], ["tokens", "u64"], ["outcome", "u8"]],
  RoundClosed: [
    ["round_id", "u64"], ["vrf_seed", arr("u8", 32)], ["participants", "u32"], ["total_lamports", "u64"],
    ["particles", arr("u64", 3)], ["closed_ts", "i64"],
  ],
  RoundFailed: [["round_id", "u64"], ["reason", "u8"]],
  RoundFinalized: [
    ["round_id", "u64"], ["outcome", "u8"], ["total_lamports", "u64"], ["fee_lamports", "u64"],
    ["distributable_lamports", "u64"], ["successes", arr("u64", 3)], ["total_success_weight", "u64"],
    ["emission_budget", "u64"], ["tokens_allocated", "u64"],
  ],
  RoundOpened: [
    ["round_id", "u64"], ["open_ts", "i64"], ["close_ts", "i64"], ["barriers", arr(def("BarrierParams"), 3)],
    ["particle_cost_lamports", "u64"], ["protocol_fee_bps", "u16"], ["emission_budget", "u64"],
  ],
  RoundSwept: [["round_id", "u64"], ["lamports_to_treasury", "u64"], ["tokens_returned_to_reserve", "u64"]],
  TreasuryChanged: [["treasury", "pubkey"]],
};

// [name, writable, signer]
type Acc = [string, boolean?, boolean?];
const ix: Record<string, { accounts: Acc[]; args: Field[] }> = {
  accept_admin: { accounts: [["new_admin", false, true], ["protocol", true]], args: [] },
  claim: {
    accounts: [
      ["owner", true, true], ["protocol"], ["round", true], ["round_vault", true], ["position", true],
      ["tunnel_mint"], ["reward_vault", true], ["owner_token_account", true], ["token_program"],
      ["associated_token_program"], ["system_program"],
    ],
    args: [["round_id", "u64"]],
  },
  close_round: {
    accounts: [["protocol", true], ["round", true], ["slot_hashes"]],
    args: [["round_id", "u64"]],
  },
  deploy_particles: {
    accounts: [
      ["owner", true, true], ["protocol", true], ["round", true], ["round_vault", true],
      ["position", true], ["system_program"],
    ],
    args: [["round_id", "u64"], ["barrier", "u8"], ["count", "u16"]],
  },
  finalize_round: {
    accounts: [["protocol", true], ["round", true], ["round_vault", true], ["treasury_vault", true]],
    args: [["round_id", "u64"]],
  },
  fund_reserve: {
    accounts: [
      ["funder", false, true], ["protocol", true], ["tunnel_mint"], ["reward_vault", true],
      ["funder_token_account", true], ["token_program"],
    ],
    args: [["amount", "u64"]],
  },
  initialize: {
    accounts: [
      ["admin", true, true], ["protocol", true], ["tunnel_mint"], ["reward_vault", true], ["treasury_vault", true],
      ["program"], ["program_data"], ["token_program"], ["system_program"],
    ],
    args: [["treasury", "pubkey"], ["params", def("ProtocolParams")]],
  },
  open_round: {
    accounts: [["payer", true, true], ["protocol", true], ["round", true], ["round_vault", true], ["system_program"]],
    args: [],
  },
  propose_admin: { accounts: [["admin", false, true], ["protocol", true]], args: [["new_admin", "pubkey"]] },
  recover_round: { accounts: [["protocol", true], ["round", true], ["vrf_request"]], args: [["round_id", "u64"]] },
  request_randomness: {
    accounts: [
      ["cranker", true, true], ["round", true], ["vrf_request", true], ["vrf_config", true],
      ["vrf_treasury", true], ["vrf_program"], ["system_program"],
    ],
    args: [["round_id", "u64"]],
  },
  reveal_randomness: { accounts: [["round", true], ["vrf_request"]], args: [["round_id", "u64"]] },
  set_paused: { accounts: [["admin", false, true], ["protocol", true]], args: [["paused", "bool"]] },
  set_treasury: { accounts: [["admin", false, true], ["protocol", true]], args: [["treasury", "pubkey"]] },
  settle_position: { accounts: [["round", true], ["position", true]], args: [["round_id", "u64"]] },
  sweep_round: {
    accounts: [["protocol", true], ["round", true], ["round_vault", true], ["treasury_vault", true]],
    args: [["round_id", "u64"]],
  },
  withdraw_fees: { accounts: [["protocol"], ["treasury_vault", true], ["treasury", true]], args: [] },
  update_params: { accounts: [["admin", false, true], ["protocol", true]], args: [["params", def("ProtocolParams")]] },
};

// Parse error variants + messages straight from the Rust source so codes never drift.
const errorsRs = readFileSync(join(here, "../../../programs/tunnel/src/errors.rs"), "utf8");
const errors = [...errorsRs.matchAll(/#\[msg\("([^"]+)"\)\]\s+(\w+),/g)].map((m, i) => ({
  code: 6000 + i,
  name: m[2],
  msg: m[1],
}));

const sortByName = <V>(r: Record<string, V>) => Object.entries(r).sort(([a], [b]) => a.localeCompare(b));

const idl = {
  address: programId,
  metadata: { name: "tunnel", version: "0.1.0", spec: "0.1.0", description: "TUNNEL — quantum-inspired mining protocol on Solana" },
  instructions: sortByName(ix).map(([name, d]) => ({
    name,
    discriminator: disc(`global:${name}`),
    accounts: d.accounts.map(([n, w, s]) => ({ name: n, ...(w ? { writable: true } : {}), ...(s ? { signer: true } : {}) })),
    args: fields(d.args),
  })),
  accounts: sortByName(accounts).map(([name]) => ({ name, discriminator: disc(`account:${name}`) })),
  events: sortByName(events).map(([name]) => ({ name, discriminator: disc(`event:${name}`) })),
  errors,
  types: [
    ...sortByName({ ...types, ...accounts, ...events }).map(([name, f]) =>
      typeof (f as unknown[])[0] === "string"
        ? { name, type: { kind: "enum", variants: (f as string[]).map((v) => ({ name: v })) } }
        : { name, type: { kind: "struct", fields: fields(f as Field[]) } },
    ),
  ],
};

mkdirSync(join(here, "../src/idl"), { recursive: true });
writeFileSync(join(here, "../src/idl/tunnel.json"), JSON.stringify(idl, null, 2) + "\n");
console.log(`IDL written: ${idl.instructions.length} instructions, ${errors.length} errors, program ${programId}`);
