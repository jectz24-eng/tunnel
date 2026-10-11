import "server-only";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { BARRIER_COUNT, ENERGY_LEVELS, IDL, coder, positionPda } from "@tunnel/sdk";

const deployDef = IDL.instructions.find((i) => i.name === "deploy_particles")!;
const DEPLOY_DISCRIMINATOR = Buffer.from(deployDef.discriminator);

export type CosignCheck = { ok: true; cycleId: bigint; count: number } | { ok: false; error: string };

/**
 * Validates a wallet-built deployment transaction before the gatekeeper
 * co-signs it. The gatekeeper signs *only* a transaction that:
 *  - is paid for by the signed-in wallet,
 *  - contains exactly one TUNNEL `deploy_particles` instruction (plus optional
 *    compute-budget instructions) whose owner is that wallet and whose
 *    gatekeeper account is this key,
 *  - has well-formed arguments.
 * Anything else is refused, so the co-signature cannot be reused for other
 * instructions or other wallets.
 */
export function checkDeployTransaction(tx: Transaction, wallet: PublicKey, gatekeeper: PublicKey, programId: PublicKey): CosignCheck {
  if (!tx.feePayer?.equals(wallet)) return { ok: false, error: "fee payer must be the signed-in wallet" };
  const program = tx.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
  if (program.length !== 1) return { ok: false, error: "transaction must contain exactly one deployment" };
  const ix = program[0];
  if (!ix.programId.equals(programId)) return { ok: false, error: "unexpected program" };
  if (!Buffer.from(ix.data.subarray(0, 8)).equals(DEPLOY_DISCRIMINATOR)) return { ok: false, error: "not a deploy_particles instruction" };
  const decoded = coder.instruction.decode(Buffer.from(ix.data));
  if (!decoded || decoded.name !== "deploy_particles") return { ok: false, error: "malformed instruction data" };
  const args = decoded.data as { cycle_id: { toString(): string }; barrier: number; level: number; count: number };
  const cycleId = BigInt(args.cycle_id.toString());
  if (args.barrier >= BARRIER_COUNT || args.level >= ENERGY_LEVELS || args.count < 1 || args.count > 250) return { ok: false, error: "invalid arguments" };
  const names = deployDef.accounts.map((a) => (a as { name: string }).name);
  const key = (name: string) => ix.keys[names.indexOf(name)]?.pubkey;
  if (!key("owner")?.equals(wallet)) return { ok: false, error: "deployment owner must be the signed-in wallet" };
  if (!key("gatekeeper")?.equals(gatekeeper)) return { ok: false, error: "gatekeeper account mismatch" };
  if (!key("position")?.equals(positionPda(cycleId, wallet, programId))) return { ok: false, error: "position account mismatch" };
  return { ok: true, cycleId, count: args.count };
}
