import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { depositOf } from "../src/deposits";

const MINT = "Mint1111111111111111111111111111111111111";
const HOUSE = "House111111111111111111111111111111111111";
const ALICE = "A1ice111111111111111111111111111111111111";

const bal = (owner: string, amount: string, mint = MINT) => ({ accountIndex: 0, mint, owner, uiTokenAmount: { amount, decimals: 6, uiAmount: null, uiAmountString: "" } });
const tx = (pre: ReturnType<typeof bal>[], post: ReturnType<typeof bal>[], err: unknown = null) =>
  ({ meta: { err, preTokenBalances: pre, postTokenBalances: post } }) as unknown as ParsedTransactionWithMeta;

describe("deposit detection", () => {
  it("credits the wallet that sent $TUNNEL to the house", () => {
    expect(depositOf(tx([bal(ALICE, "5000000"), bal(HOUSE, "100")], [bal(ALICE, "3000000"), bal(HOUSE, "2000100")]), HOUSE, MINT)).toEqual({ wallet: ALICE, amount: 2_000_000n });
  });

  it("handles a first deposit that creates the house account", () => {
    expect(depositOf(tx([bal(ALICE, "5000000")], [bal(ALICE, "0"), bal(HOUSE, "5000000")]), HOUSE, MINT)).toEqual({ wallet: ALICE, amount: 5_000_000n });
  });

  it("ignores payouts, failed transactions and other tokens", () => {
    expect(depositOf(tx([bal(HOUSE, "9"), bal(ALICE, "0")], [bal(HOUSE, "4"), bal(ALICE, "5")]), HOUSE, MINT)).toBeNull();
    expect(depositOf(tx([bal(ALICE, "5"), bal(HOUSE, "0")], [bal(ALICE, "0"), bal(HOUSE, "5")], { InstructionError: [0, "x"] }), HOUSE, MINT)).toBeNull();
    expect(depositOf(tx([bal(ALICE, "5", "Other"), bal(HOUSE, "0", "Other")], [bal(ALICE, "0", "Other"), bal(HOUSE, "5", "Other")]), HOUSE, MINT)).toBeNull();
  });
});
