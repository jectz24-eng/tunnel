/**
 * Permissionless round crank. Opens rounds on schedule and drives every round
 * through close → request → reveal → settle → finalize → sweep. Anyone can run
 * this (it only calls permissionless instructions); the program validates
 * every step, so the crank has no power over outcomes or funds. Its key only
 * pays rent for new rounds and ORAO request fees.
 */
import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  type Connection,
  type Keypair,
  type TransactionInstruction,
} from "@solana/web3.js";
import type { PrismaClient } from "@tunnel/db";
import {
  TunnelInstructions,
  fetchOraoRandomness,
  fetchOraoTreasury,
  fetchProtocol,
  fetchRoundPositions,
  fetchRounds,
  treasuryVaultPda,
  type RoundAccount,
} from "@tunnel/sdk";
import { log } from "./log";
import { planRoundAction, shouldOpenRound, type RoundAction } from "./planner";
import { anchorErrorName, withRetry } from "./retry";

export class Crank {
  private readonly ix: TunnelInstructions;
  private oraoTreasury: PublicKey | null = null;
  private ticks = 0;
  lastTickAt = 0;
  lastError: string | null = null;

  constructor(
    private readonly connection: Connection,
    private readonly db: PrismaClient | null,
    private readonly keeper: Keypair,
    programId: PublicKey,
    private readonly scanWindow: number,
    private readonly settleBatch: number,
  ) {
    this.ix = new TunnelInstructions(programId);
  }

  /** Chain clock (the program compares against `Clock::unix_timestamp`, not our wall clock). */
  private async chainNow(): Promise<number> {
    const slot = await this.connection.getSlot("confirmed");
    return (await this.connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
  }

  async tick() {
    const protocol = await fetchProtocol(this.connection, this.ix.programId);
    if (!protocol) {
      this.lastError = "protocol not initialized on this cluster";
      return;
    }
    const now = await this.chainNow();

    if (shouldOpenRound(protocol, now)) {
      await this.send("open", protocol.nextRoundId, [this.ix.openRound(this.keeper.publicKey, protocol.nextRoundId)]);
    }

    const ids: bigint[] = [];
    for (let i = protocol.nextRoundId - BigInt(this.scanWindow); i < protocol.nextRoundId; i++) if (i >= 0n) ids.push(i);
    const rounds = (await fetchRounds(this.connection, ids, this.ix.programId)).filter((r): r is RoundAccount => !!r);

    for (const round of rounds) {
      if ((round.status === "settled" || round.status === "failed") && (round.swept || round.claims < round.participants)) continue;
      let randomnessFulfilled: boolean | undefined;
      let unsettledOwners: string[] | undefined;
      if (round.status === "closed" || round.status === "awaitingRandomness") {
        randomnessFulfilled = (await fetchOraoRandomness(this.connection, round.vrfSeed)).fulfilled;
      }
      if (round.status === "resolving") {
        const positions = await fetchRoundPositions(this.connection, round.id, this.ix.programId);
        unsettledOwners = positions.filter((p) => !p.settled).map((p) => p.owner.toBase58());
      }
      const action = planRoundAction({ round, now, randomnessFulfilled, unsettledOwners });
      await this.execute(round, action);
    }

    // Forward accumulated fees to the treasury once they exceed the threshold.
    if (++this.ticks % 150 === 0) {
      const vault = await this.connection.getBalance(treasuryVaultPda(this.ix.programId));
      if (vault > 100_000_000) await this.send("withdraw_fees", 0n, [this.ix.withdrawFees(protocol.treasury)]);
    }
    this.lastTickAt = Date.now();
    this.lastError = null;
  }

  private async execute(round: RoundAccount, action: RoundAction) {
    const id = round.id;
    switch (action.kind) {
      case "close":
        return this.send("close", id, [this.ix.closeRound(id)]);
      case "request":
        this.oraoTreasury ??= await fetchOraoTreasury(this.connection);
        return this.send("request", id, [
          this.ix.requestRandomness({ cranker: this.keeper.publicKey, roundId: id, vrfSeed: round.vrfSeed, vrfTreasury: this.oraoTreasury }),
        ]);
      case "reveal":
        return this.send("reveal", id, [this.ix.revealRandomness(id, round.vrfSeed)]);
      case "recover":
        return this.send("recover", id, [this.ix.recoverRound(id, round.vrfSeed)]);
      case "settle": {
        for (let i = 0; i < action.owners.length; i += this.settleBatch) {
          const batch = action.owners.slice(i, i + this.settleBatch);
          await this.send(
            "settle",
            id,
            [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...batch.map((o) => this.ix.settlePosition(id, new PublicKey(o)))],
            batch.join(","),
          );
        }
        return;
      }
      case "finalize":
        return this.send("finalize", id, [this.ix.finalizeRound(id)]);
      case "sweep":
        return this.send("sweep", id, [this.ix.sweepRound(id)]);
      default:
        return;
    }
  }

  private async send(kind: string, roundId: bigint, ixs: TransactionInstruction[], target?: string) {
    let attempts = 0;
    try {
      const sig = await withRetry(
        async (a) => {
          attempts = a;
          return sendAndConfirmTransaction(this.connection, new Transaction().add(...ixs), [this.keeper], { commitment: "confirmed" });
        },
        { onRetry: (e, a, d) => log.warn({ kind, roundId: String(roundId), attempt: a, delayMs: d, err: String(e) }, "retrying crank tx") },
      );
      log.info({ kind, roundId: String(roundId), sig }, "crank");
      await this.record({ kind, roundId, target, signature: sig, status: "ok", attempts });
    } catch (e) {
      const name = anchorErrorName(e);
      // Races with other crankers are expected and harmless: the step already happened.
      const benign = ["RoundNotOpen", "RoundNotClosed", "NotAwaitingRandomness", "PositionAlreadySettled", "NotResolving", "AlreadySwept", "RoundScheduleConflict"];
      const level = name && benign.includes(name) ? "debug" : "error";
      log[level]({ kind, roundId: String(roundId), err: name ?? String(e) }, "crank tx failed");
      if (level === "error") this.lastError = `${kind} #${roundId}: ${name ?? String(e)}`;
      await this.record({ kind, roundId, target, status: name && benign.includes(name) ? "skipped" : "failed", error: name ?? String(e).slice(0, 500), attempts });
    }
  }

  private async record(row: { kind: string; roundId: bigint; target?: string; signature?: string; status: string; error?: string; attempts: number }) {
    if (!this.db) return;
    await this.db.keeperAction.create({ data: row }).catch(() => undefined);
  }
}
