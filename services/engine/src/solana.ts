import type { Connection } from "@solana/web3.js";

/**
 * A cycle's entropy: the blockhash of the first produced (finalized) slot at
 * or after `entropySlot`. Slots can be skipped, so the first one that has a
 * block is used. Any observer gets the same answer from any RPC.
 */
export async function entropyBlock(conn: Connection, entropySlot: bigint): Promise<{ slot: bigint; blockhash: string } | null> {
  const finalized = BigInt(await conn.getSlot("finalized"));
  if (finalized < entropySlot) return null;
  const start = Number(entropySlot);
  const end = Math.min(Number(finalized), start + 500);
  const slots = await conn.getBlocks(start, end, "finalized");
  if (slots.length === 0) return null;
  const slot = slots[0];
  const block = await conn.getBlock(slot, { commitment: "finalized", maxSupportedTransactionVersion: 0, transactionDetails: "none", rewards: false });
  if (!block) return null;
  return { slot: BigInt(slot), blockhash: block.blockhash };
}
