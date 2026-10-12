import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { encodeBase58, toHex } from "../src/bytes";
import {
  claimMessage,
  commitSeed,
  deploymentMessage,
  deriveRandomness,
  isFresh,
  parseClaimMessage,
  parseDeploymentMessage,
  verifyCycleFairness,
} from "../src/fairness";

const seed = Uint8Array.from({ length: 32 }, (_, i) => i);
const blockhash = encodeBase58(new Uint8Array(32).fill(7));

describe("seed commitment and randomness", () => {
  it("match independent Python hashlib vectors", () => {
    expect(commitSeed(seed)).toBe("bd66390f4df452e59b75896f50b1ad083c3c07f1a04e31bbdc0243018a262605");
    expect(toHex(deriveRandomness(seed, blockhash, 42n))).toBe(
      "c60ef7952cf545f74f3817a39a8d3740f2ed782c91ec295c85ae9baffbaa5eac4129d466919bea602fd65d53abeae45552dc7b22d9a83bc0711a594c9ea355ff",
    );
  });

  it("depend on the seed, the blockhash and the cycle", () => {
    const base = toHex(deriveRandomness(seed, blockhash, 42n));
    expect(toHex(deriveRandomness(seed, blockhash, 43n))).not.toBe(base);
    expect(toHex(deriveRandomness(seed, encodeBase58(new Uint8Array(32).fill(8)), 42n))).not.toBe(base);
    expect(toHex(deriveRandomness(new Uint8Array(32).fill(1), blockhash, 42n))).not.toBe(base);
  });

  it("verifyCycleFairness catches a swapped seed or randomness", () => {
    const good = { id: 42n, seedCommitment: commitSeed(seed), serverSeed: toHex(seed), entropyBlockhash: blockhash, randomness: toHex(deriveRandomness(seed, blockhash, 42n)) };
    expect(verifyCycleFairness(good)).toEqual({ commitmentMatches: true, randomnessMatches: true });
    expect(verifyCycleFairness({ ...good, serverSeed: toHex(new Uint8Array(32).fill(9)) }).commitmentMatches).toBe(false);
    expect(verifyCycleFairness({ ...good, randomness: "00".repeat(64) }).randomnessMatches).toBe(false);
  });
});

describe("signed messages", () => {
  const wallet = Keypair.generate().publicKey.toBase58();

  it("deployment messages round-trip; only the canonical text parses (signatures cover the rest)", () => {
    const d = { wallet, cycleId: 12n, barrier: 2, level: 4, count: 7, nonce: "abc123", issuedAt: new Date().toISOString() };
    const msg = deploymentMessage(d);
    expect(parseDeploymentMessage(msg)).toEqual(d);
    // An edited message is a *different* intent; the wallet signature (checked by the server) is what rejects tampering.
    expect(parseDeploymentMessage(msg.replace("Particles: 7", "Particles: 70"))?.count).toBe(70);
    expect(parseDeploymentMessage(msg.replace("Particles: 7", "Particles:  7"))).toBeNull();
    expect(parseDeploymentMessage(msg + "\nextra")).toBeNull();
    expect(msg).toContain("not a transaction");
  });

  it("claim messages round-trip", () => {
    const c = { wallet, nonce: "n1", issuedAt: new Date().toISOString() };
    expect(parseClaimMessage(claimMessage(c))).toEqual(c);
    expect(parseClaimMessage(claimMessage(c).replace("Nonce:", "Nonce :"))).toBeNull();
  });

  it("freshness window", () => {
    const now = Date.now();
    expect(isFresh(new Date(now - 60_000).toISOString(), now)).toBe(true);
    expect(isFresh(new Date(now - 10 * 60_000).toISOString(), now)).toBe(false);
    expect(isFresh(new Date(now + 5 * 60_000).toISOString(), now)).toBe(false);
    expect(isFresh("garbage", now)).toBe(false);
  });
});
