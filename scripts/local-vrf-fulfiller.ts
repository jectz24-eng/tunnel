/**
 * LOCALNET ONLY: plays the role of the ORAO fulfillment network. It watches
 * TUNNEL cycles whose randomness was requested and fulfils them through the
 * real (cloned) ORAO program, signing each seed with the local authority key —
 * the same signature check ORAO performs on devnet/mainnet.
 *
 *   SOLANA_RPC_URL=http://127.0.0.1:8899 npx tsx scripts/local-vrf-fulfiller.ts
 */
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { FulfillBuilder, Orao } from "@orao-network/solana-vrf";
import nacl from "tweetnacl";
import { TunnelInstructions, fetchCycles, fetchOraoRandomness, fetchProtocol, toHex } from "../packages/sdk/src";
import { connection, guardCluster } from "./lib";
import { localKey } from "./local-setup";

async function main() {
  const conn = connection();
  if ((await guardCluster(conn)) !== "localnet") throw new Error("the local fulfiller must never run against a public cluster");
  const authority = localKey("vrf-authority");
  const vrf = new Orao(new AnchorProvider(conn, new Wallet(authority), { commitment: "confirmed" }));
  const programId = new TunnelInstructions().programId;
  console.log(`local VRF fulfiller running as ${authority.publicKey.toBase58()}`);

  for (;;) {
    try {
      const p = await fetchProtocol(conn, programId);
      if (p) {
        const ids: bigint[] = [];
        for (let i = p.nextCycleId - 20n; i < p.nextCycleId; i++) if (i >= 0n) ids.push(i);
        for (const c of await fetchCycles(conn, ids, programId)) {
          if (!c || (c.status !== "closed" && c.status !== "awaitingRandomness")) continue;
          const req = await fetchOraoRandomness(conn, c.vrfSeed);
          if (!req.exists || req.fulfilled) continue;
          const sig = nacl.sign.detached(c.vrfSeed, authority.secretKey);
          await new FulfillBuilder(vrf, c.vrfSeed).withComputeUnitPrice(0n).rpc(authority.publicKey, sig);
          console.log(`fulfilled cycle #${c.id} seed ${toHex(c.vrfSeed).slice(0, 16)}…`);
        }
      }
    } catch (e) {
      console.error("fulfil loop error:", String(e).slice(0, 200));
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main();
