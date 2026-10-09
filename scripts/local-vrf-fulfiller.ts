/**
 * LOCALNET ONLY: plays the role of the ORAO fulfillment network. It watches
 * TUNNEL rounds whose randomness was requested and fulfils them through the
 * real (cloned) ORAO program, signing each seed with the local authority key —
 * the same signature check ORAO performs on devnet/mainnet.
 *
 *   SOLANA_RPC_URL=http://127.0.0.1:8899 npx tsx scripts/local-vrf-fulfiller.ts
 */
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { FulfillBuilder, Orao } from "@orao-network/solana-vrf";
import nacl from "tweetnacl";
import { TunnelInstructions, fetchOraoRandomness, fetchProtocol, fetchRounds, toHex } from "../packages/sdk/src";
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
        for (let i = p.nextRoundId - 20n; i < p.nextRoundId; i++) if (i >= 0n) ids.push(i);
        for (const r of await fetchRounds(conn, ids, programId)) {
          if (!r || (r.status !== "closed" && r.status !== "awaitingRandomness")) continue;
          const req = await fetchOraoRandomness(conn, r.vrfSeed);
          if (!req.exists || req.fulfilled) continue;
          const sig = nacl.sign.detached(r.vrfSeed, authority.secretKey);
          await new FulfillBuilder(vrf, r.vrfSeed).withComputeUnitPrice(0n).rpc(authority.publicKey, sig);
          console.log(`fulfilled round #${r.id} seed ${toHex(r.vrfSeed).slice(0, 16)}…`);
        }
      }
    } catch (e) {
      console.error("fulfil loop error:", String(e).slice(0, 200));
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main();
