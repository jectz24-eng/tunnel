import { Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BN } from "@coral-xyz/anchor";
import { ACCOUNT_DISCRIMINATORS, IDL, coder, decodeCycle, decodePosition, decodeProtocol } from "../src/accounts";
import { ACCOUNT_SIZES, DEFAULT_PARAMS, TUNNEL_PROGRAM_ID } from "../src/constants";
import { TunnelInstructions, encodeParams } from "../src/client";
import { deriveOdds } from "../src/math";
import { cyclePda, positionPda } from "../src/pda";

const read = (p: string) => readFileSync(join(__dirname, "../../../programs/tunnel/src", p), "utf8");

describe("IDL (compiler-generated)", () => {
  it("uses the program id declared in lib.rs", () => {
    const declared = /declare_id!\("(\w+)"\)/.exec(read("lib.rs"))![1];
    expect(IDL.address).toBe(declared);
    expect(TUNNEL_PROGRAM_ID.toBase58()).toBe(declared);
  });

  it("is in sync with every #[program] instruction and Accounts struct", () => {
    const lib = read("lib.rs");
    const src = ["admin", "cycle", "deploy", "settle", "claim"].map((f) => read(`instructions/${f}.rs`)).join("\n");
    const structs = new Map<string, string[]>();
    for (const m of src.matchAll(/pub struct (\w+)<'info> \{([\s\S]*?)\n\}/g)) {
      structs.set(m[1], [...m[2].matchAll(/pub (\w+): /g)].map((f) => f[1]));
    }
    const fns = [...lib.matchAll(/pub fn (\w+)\(ctx: Context<(\w+)>/g)];
    expect(IDL.instructions.map((i) => i.name).sort()).toEqual(fns.map((m) => m[1]).sort());
    for (const m of fns) {
      const ix = IDL.instructions.find((i) => i.name === m[1])!;
      expect(ix.accounts.map((a) => a.name), m[1]).toEqual(structs.get(m[2]));
    }
  });

  it("has an error for every Rust error variant, in order", () => {
    const variants = [...read("errors.rs").matchAll(/^\s+(\w+),$/gm)].map((m) => m[1]);
    expect(IDL.errors!.map((e) => e.name)).toEqual(variants);
  });
});

describe("account coding", () => {
  const owner = Keypair.generate().publicKey;

  it("round-trips a Position and matches the documented size", async () => {
    const raw = {
      owner,
      cycle_id: new BN(42),
      bump: 254,
      particles: [[3, 0, 0, 0, 1], [0, 2, 0, 0, 0], [0, 0, 0, 0, 7]],
      energy_used: 30,
      experiments: 3,
      settled: true,
      successes: [[2, 0, 0, 0, 1], [0, 0, 0, 0, 0], [0, 0, 0, 0, 1]],
      nominal_reward: new BN("123456789"),
      claimed: false,
      tokens_paid: new BN(0),
    };
    const data = await coder.accounts.encode("Position", raw);
    expect(data.length).toBe(ACCOUNT_SIZES.position);
    const p = decodePosition(positionPda(42n, owner), data);
    expect(p.cycleId).toBe(42n);
    expect(p.particles[2][4]).toBe(7);
    expect(p.successes[0]).toEqual([2, 0, 0, 0, 1]);
    expect(p.nominalReward).toBe(123456789n);
    expect([...data.subarray(0, 8)]).toEqual([...ACCOUNT_DISCRIMINATORS.Position]);
  });

  it("round-trips Protocol and Cycle with odds tables", async () => {
    const odds = deriveOdds(DEFAULT_PARAMS);
    const rawOdds = { transmission_ppb: odds.transmissionPpb, reward: odds.reward.map((r) => r.map((v) => new BN(v.toString()))) };
    const params = encodeParams(DEFAULT_PARAMS);
    const protocol = await coder.accounts.encode("Protocol", {
      admin: owner,
      pending_admin: null,
      gatekeeper: PublicKey.default,
      tunnel_mint: owner,
      reward_vault: owner,
      params,
      odds: rawOdds,
      paused: false,
      next_cycle_id: new BN(5),
      last_cycle_open_ts: new BN(100),
      last_cycle_close_ts: new BN(700),
      reserve_available: new BN("600000000000000"),
      reserve_funded_total: new BN("600000000000000"),
      total_experiments: new BN(9),
      total_particles: new BN(90),
      total_energy: new BN(300),
      total_successes: new BN(12),
      total_tokens_allocated: new BN(1000),
      total_tokens_claimed: new BN(500),
      cycles_settled: new BN(4),
      bump: 255,
      reward_vault_bump: 254,
    });
    const p = decodeProtocol(owner, protocol);
    expect(p.params).toEqual(DEFAULT_PARAMS);
    expect(p.odds).toEqual(odds);
    expect(p.nextCycleId).toBe(5n);

    const cycle = await coder.accounts.encode("Cycle", {
      id: new BN(5),
      status: { AwaitingRandomness: {} },
      outcome: { NoTunnels: {} },
      bump: 1,
      open_ts: new BN(1),
      close_ts: new BN(2),
      closed_ts: new BN(3),
      barriers: params.barriers,
      levels: params.levels,
      odds: rawOdds,
      energy_per_cycle: 100,
      randomness_timeout_secs: 900,
      emission_budget: new BN(77),
      participants: 2,
      experiments: 3,
      particles: [new BN(1), new BN(2), new BN(3)],
      energy_used: new BN(40),
      vrf_seed: Array(32).fill(9),
      randomness_requested_ts: new BN(4),
      randomness: Array(64).fill(8),
      positions_settled: 0,
      successes: [new BN(0), new BN(0), new BN(0)],
      total_nominal: new BN(0),
      tokens_allocated: new BN(0),
      settled_ts: new BN(0),
      claims: 0,
      tokens_claimed: new BN(0),
      swept: false,
    });
    const c = decodeCycle(cyclePda(5n), cycle);
    expect(c.status).toBe("awaitingRandomness");
    expect(c.outcome).toBe("noTunnels");
    expect(c.odds.reward[2][0]).toBe(odds.reward[2][0]);
    expect(c.vrfSeed[0]).toBe(9);
  });
});

describe("instruction builders", () => {
  const ix = new TunnelInstructions();
  const owner = Keypair.generate().publicKey;

  it("encodes an absent gatekeeper as the program id (Anchor optional account)", () => {
    const i = ix.deployParticles({ owner, cycleId: 3n, barrier: 2, level: 4, count: 5 });
    expect(i.keys[4].pubkey.equals(TUNNEL_PROGRAM_ID)).toBe(true);
    expect(i.keys[4].isSigner).toBe(false);
    const gk = Keypair.generate().publicKey;
    const j = ix.deployParticles({ owner, cycleId: 3n, barrier: 2, level: 4, count: 5, gatekeeper: gk });
    expect(j.keys[4].pubkey.equals(gk)).toBe(true);
    expect(j.keys[4].isSigner).toBe(true);
    const args = coder.instruction.decode(j.data)!.data as Record<string, any>;
    expect([args.barrier, args.level, args.count, args.cycle_id.toString()]).toEqual([2, 4, 5, "3"]);
  });

  it("creates the token account only when a payout is expected", () => {
    const mint = Keypair.generate().publicKey;
    expect(ix.claim({ owner, cycleId: 1n, tunnelMint: mint, expectsTokens: false })).toHaveLength(1);
    const withTokens = ix.claim({ owner, cycleId: 1n, tunnelMint: mint, expectsTokens: true });
    expect(withTokens).toHaveLength(2);
    expect(withTokens[1].keys[6].pubkey.equals(TUNNEL_PROGRAM_ID)).toBe(false);
  });
});
