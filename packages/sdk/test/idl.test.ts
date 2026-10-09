import { Keypair, PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IDL, coder, decodePosition, decodeRound, encodeBase58 } from "../src/accounts";
import { DEFAULT_PARAMS, TUNNEL_PROGRAM_ID } from "../src/constants";
import { TunnelInstructions } from "../src/client";
import { positionPda, roundPda } from "../src/pda";
import { BN } from "@coral-xyz/anchor";

const disc = (s: string) => [...createHash("sha256").update(s).digest().subarray(0, 8)];

describe("IDL", () => {
  it("uses the program id declared in lib.rs", () => {
    const lib = readFileSync(join(__dirname, "../../../programs/tunnel/src/lib.rs"), "utf8");
    const declared = /declare_id!\("(\w+)"\)/.exec(lib)![1];
    expect(IDL.address).toBe(declared);
    expect(TUNNEL_PROGRAM_ID.toBase58()).toBe(declared);
  });

  it("declares every #[program] instruction of lib.rs with Anchor discriminators", () => {
    const lib = readFileSync(join(__dirname, "../../../programs/tunnel/src/lib.rs"), "utf8");
    const names = [...lib.matchAll(/pub fn (\w+)\(ctx/g)].map((m) => m[1]).sort();
    expect(IDL.instructions.map((i) => i.name).sort()).toEqual(names);
    for (const ix of IDL.instructions) expect(ix.discriminator).toEqual(disc(`global:${ix.name}`));
  });

  it("matches every Accounts struct field of the Rust instructions", () => {
    const src = ["admin", "round", "deposit", "settle", "claim"]
      .map((f) => readFileSync(join(__dirname, `../../../programs/tunnel/src/instructions/${f}.rs`), "utf8"))
      .join("\n");
    const structs = new Map<string, string[]>();
    for (const m of src.matchAll(/pub struct (\w+)<'info> \{([\s\S]*?)\n\}/g)) {
      structs.set(m[1], [...m[2].matchAll(/pub (\w+): /g)].map((f) => f[1]));
    }
    const lib = readFileSync(join(__dirname, "../../../programs/tunnel/src/lib.rs"), "utf8");
    for (const m of lib.matchAll(/pub fn (\w+)\(ctx: Context<(\w+)>/g)) {
      const ix = IDL.instructions.find((i) => i.name === m[1])!;
      expect(ix.accounts.map((a) => a.name), m[1]).toEqual(structs.get(m[2]));
    }
  });

  it("has an error for every Rust error variant, in order", () => {
    const errs = readFileSync(join(__dirname, "../../../programs/tunnel/src/errors.rs"), "utf8");
    const variants = [...errs.matchAll(/^\s+(\w+),$/gm)].map((m) => m[1]);
    expect(IDL.errors!.map((e) => e.name)).toEqual(variants);
  });

  it("round-trips a Round account through the coder", async () => {
    const id = 12n;
    const raw = {
      id: new BN(12), status: { Resolving: {} }, outcome: { Pending: {} }, bump: 254, vault_bump: 253,
      open_ts: new BN(1000), close_ts: new BN(1060), closed_ts: new BN(1061),
      barriers: DEFAULT_PARAMS.barriers.map((b) => ({ transmission_bps: b.transmissionBps, reward_weight: b.rewardWeight })),
      particle_cost_lamports: new BN(10_000_000), protocol_fee_bps: 500, max_particles_per_position: 200,
      randomness_timeout_secs: 600, emission_budget: new BN(416_000_000), particles: [new BN(3), new BN(2), new BN(1)],
      total_lamports: new BN(60_000_000), participants: 2, vrf_seed: Array(32).fill(9), randomness_requested_ts: new BN(1062),
      randomness: Array(64).fill(7), positions_settled: 1, successes: [new BN(2), new BN(0), new BN(0)],
      total_success_weight: new BN(2), fee_lamports: new BN(0), distributable_lamports: new BN(0), settled_ts: new BN(0),
      claims: 0, lamports_claimed: new BN(0), tokens_claimed: new BN(0), swept: false,
    };
    const data = await coder.accounts.encode("Round", raw);
    const r = decodeRound(roundPda(id), data);
    expect(r.id).toBe(12n);
    expect(r.status).toBe("resolving");
    expect(r.closedTs).toBe(1061);
    expect(r.particles).toEqual([3n, 2n, 1n]);
    expect(r.barriers[2]).toEqual({ transmissionBps: 1000, rewardWeight: 5 });
    expect(r.randomness[0]).toBe(7);
  });

  it("encodes the Position owner at byte offset 8 and round id at 40 (used by getProgramAccounts filters)", async () => {
    const owner = Keypair.generate().publicKey;
    const data = await coder.accounts.encode("Position", {
      owner, round_id: new BN(77), bump: 1, particles: [1, 2, 3], lamports: new BN(60_000_000), settled: false,
      successes: [0, 0, 0], success_weight: new BN(0), claimed: false, lamports_paid: new BN(0), tokens_paid: new BN(0),
    });
    expect(new PublicKey(data.subarray(8, 40)).equals(owner)).toBe(true);
    expect(data.readBigUInt64LE(40)).toBe(77n);
    const p = decodePosition(positionPda(77n, owner), data);
    expect(p.particles).toEqual([1, 2, 3]);
  });

  it("builds deploy_particles with the args the program expects", () => {
    const owner = Keypair.generate().publicKey;
    const ix = new TunnelInstructions().deployParticles({ owner, roundId: 5n, barrier: 2, count: 7 });
    expect([...ix.data.subarray(0, 8)]).toEqual(disc("global:deploy_particles"));
    expect(ix.data.readBigUInt64LE(8)).toBe(5n);
    expect(ix.data[16]).toBe(2);
    expect(ix.data.readUInt16LE(17)).toBe(7);
    expect(ix.data.length).toBe(19);
    expect(ix.keys[0]).toMatchObject({ pubkey: owner, isSigner: true, isWritable: true });
    expect(ix.keys[4].pubkey.equals(positionPda(5n, owner))).toBe(true);
  });

  it("encodes base58 like web3.js", () => {
    const k = Keypair.generate().publicKey;
    expect(encodeBase58(k.toBytes())).toBe(k.toBase58());
    expect(encodeBase58(Uint8Array.of(0, 0, 1))).toBe("112");
  });
});
