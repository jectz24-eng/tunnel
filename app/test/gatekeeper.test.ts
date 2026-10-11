import { ComputeBudgetProgram, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { TUNNEL_PROGRAM_ID, TunnelInstructions } from "@tunnel/sdk";
import { describe, expect, it } from "vitest";
import { checkDeployTransaction } from "@/server/gatekeeper";

const ix = new TunnelInstructions();
const wallet = Keypair.generate().publicKey;
const gk = Keypair.generate().publicKey;
const blockhash = Keypair.generate().publicKey.toBase58();

const tx = (...ixs: Parameters<Transaction["add"]>) => new Transaction({ feePayer: wallet, blockhash, lastValidBlockHeight: 1 }).add(...ixs);
const deploy = (owner = wallet, gatekeeper = gk) => ix.deployParticles({ owner, cycleId: 7n, barrier: 1, level: 2, count: 5, gatekeeper });

describe("gatekeeper co-signing checks", () => {
  it("accepts exactly one well-formed deployment by the signed-in wallet", () => {
    const r = checkDeployTransaction(tx(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), deploy()), wallet, gk, TUNNEL_PROGRAM_ID);
    expect(r).toEqual({ ok: true, cycleId: 7n, count: 5 });
  });

  it("refuses another wallet's deployment, other fee payers and extra instructions", () => {
    const other = Keypair.generate().publicKey;
    expect(checkDeployTransaction(tx(deploy(other)), wallet, gk, TUNNEL_PROGRAM_ID).ok).toBe(false);
    const t = tx(deploy());
    t.feePayer = other;
    expect(checkDeployTransaction(t, wallet, gk, TUNNEL_PROGRAM_ID).ok).toBe(false);
    const drain = SystemProgram.transfer({ fromPubkey: wallet, toPubkey: other, lamports: 1 });
    expect(checkDeployTransaction(tx(deploy(), drain), wallet, gk, TUNNEL_PROGRAM_ID).ok).toBe(false);
    expect(checkDeployTransaction(tx(deploy(), deploy()), wallet, gk, TUNNEL_PROGRAM_ID).ok).toBe(false);
  });

  it("refuses a different gatekeeper account or a non-deploy instruction", () => {
    expect(checkDeployTransaction(tx(deploy(wallet, Keypair.generate().publicKey)), wallet, gk, TUNNEL_PROGRAM_ID).ok).toBe(false);
    const claim = ix.claim({ owner: wallet, cycleId: 1n, tunnelMint: Keypair.generate().publicKey, expectsTokens: false })[0];
    expect(checkDeployTransaction(tx(claim), wallet, gk, TUNNEL_PROGRAM_ID)).toMatchObject({ ok: false, error: "not a deploy_particles instruction" });
  });
});
