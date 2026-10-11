/**
 * One-shot LOCALNET bootstrap (validator from scripts/local-validator.sh must be running):
 *   - airdrops local SOL to the operator and keeper
 *   - initialises a local ORAO VRF network state whose fulfillment authority is
 *     keys/localnet-vrf-authority.json (served by scripts/local-vrf-fulfiller.ts)
 *   - creates $TUNNEL (placeholder supply), initialises the protocol, funds the reserve
 *
 *   SOLANA_RPC_URL=http://127.0.0.1:8899 npx tsx scripts/local-setup.ts [--cycle-secs 120] [--gatekeeper]
 *
 * `--gatekeeper` creates keys/localnet-gatekeeper.json and requires every
 * deployment to be co-signed by it (the app's /api/gatekeeper route signs
 * after rate-limit checks when GATEKEEPER_KEYPAIR points at that file).
 */
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";
import { InitBuilder, Orao, networkStateAccountAddress } from "@orao-network/solana-vrf";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, type Connection } from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PARAMS, PLACEHOLDER_TOKENOMICS, TUNNEL_DECIMALS, TunnelInstructions, fetchProtocol, protocolPda, rewardVaultPda } from "../packages/sdk/src";
import { PHYSICS_CU, ROOT, arg, connection, guardCluster, sendIxs, writeDeployment } from "./lib";

export function localKey(name: string): Keypair {
  const dir = join(ROOT, "keys");
  const p = join(dir, `localnet-${name}.json`);
  if (!existsSync(p)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(p, JSON.stringify(Array.from(Keypair.generate().secretKey)));
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

async function airdrop(conn: Connection, to: PublicKey, sol: number) {
  const sig = await conn.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  const bh = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
}

async function main() {
  const conn = connection();
  const cluster = await guardCluster(conn);
  if (cluster !== "localnet") throw new Error("local-setup only runs against a local validator");
  const operator = localKey("operator");
  const keeper = localKey("keeper");
  const vrfAuthority = localKey("vrf-authority");
  const vrfTreasury = localKey("vrf-treasury");
  const gatekeeper = process.argv.includes("--gatekeeper") ? localKey("gatekeeper") : null;

  for (const k of [operator, keeper, vrfAuthority, vrfTreasury]) await airdrop(conn, k.publicKey, 100);
  console.log(`operator ${operator.publicKey.toBase58()} · keeper ${keeper.publicKey.toBase58()}`);

  // Local ORAO network: the real ORAO program (cloned), our own fulfillment key.
  const vrf = new Orao(new AnchorProvider(conn, new Wallet(operator), { commitment: "confirmed" }));
  if (!(await conn.getAccountInfo(networkStateAccountAddress()))) {
    await new InitBuilder(vrf, operator.publicKey, vrfTreasury.publicKey, [vrfAuthority.publicKey], new BN(1_000_000)).rpc();
    console.log("ORAO local network state initialised (fee 0.001 SOL)");
  }

  const tunnel = new TunnelInstructions();
  if (await fetchProtocol(conn, tunnel.programId)) {
    console.log("protocol already initialised — nothing else to do");
    return;
  }
  const mint = await createMint(conn, operator, operator.publicKey, null, TUNNEL_DECIMALS);
  const ata = await getOrCreateAssociatedTokenAccount(conn, operator, mint, operator.publicKey);
  await mintTo(conn, operator, mint, ata.address, operator, PLACEHOLDER_TOKENOMICS.totalSupply);
  console.log(`$TUNNEL mint ${mint.toBase58()} (placeholder supply minted to operator)`);

  const params = { ...DEFAULT_PARAMS, cycleDurationSecs: Number(arg("cycle-secs") ?? 120) };
  await sendIxs(
    conn,
    operator,
    [tunnel.initialize({ admin: operator.publicKey, tunnelMint: mint, gatekeeper: gatekeeper?.publicKey ?? PublicKey.default, params })],
    [],
    PHYSICS_CU,
  );
  await sendIxs(conn, operator, [
    tunnel.fundReserve({ funder: operator.publicKey, tunnelMint: mint, funderTokenAccount: ata.address, amount: PLACEHOLDER_TOKENOMICS.miningReserve }),
  ]);
  console.log(`protocol initialised (cycle ${params.cycleDurationSecs}s${gatekeeper ? ", gatekeeper on" : ""}); placeholder reserve funded`);

  writeDeployment("localnet", {
    programId: tunnel.programId.toBase58(),
    protocol: protocolPda().toBase58(),
    rewardVault: rewardVaultPda().toBase58(),
    tunnelMint: mint.toBase58(),
    operatorTokenAccount: ata.address.toBase58(),
    admin: operator.publicKey.toBase58(),
    keeper: keeper.publicKey.toBase58(),
    gatekeeper: (gatekeeper?.publicKey ?? PublicKey.default).toBase58(),
    vrfFulfillmentAuthority: vrfAuthority.publicKey.toBase58(),
  });
}

if (process.argv[1]?.endsWith("local-setup.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
