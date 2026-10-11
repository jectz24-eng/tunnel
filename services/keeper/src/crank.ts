/**
 * Permissionless cycle crank. Opens cycles on schedule and drives every cycle
 * through close → request → reveal → settle → finalize → sweep. Anyone can run
 * this (it only calls permissionless instructions); the program validates
 * every step, so the crank has no power over outcomes or rewards. Its key only
 * pays rent for new cycles and ORAO request fees.
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
  fetchCyclePositions,
  fetchCycles,
  fetchOraoRandomness,
  fetchOraoTreasury,
  fetchProtocol,
  type CycleAccount,
} from "@tunnel/sdk";
import { log } from "./log";
import { planCycleAction, shouldOpenCycle, type CycleAction } from "./planner";
import { anchorErrorName, withRetry } from "./retry";

/** Races with other crankers are expected and harmless: the step already happened. */
export const BENIGN_ERRORS = [
  "CycleNotOpen",
  "CycleNotClosed",
  "NotAwaitingRandomness",
  "PositionAlreadySettled",
  "NotResolving",
  "AlreadySwept",
  "CycleScheduleConflict",
];

export class Crank {
  private readonly ix: TunnelInstructions;
  private oraoTreasury: PublicKey | null = null;
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

    if (shouldOpenCycle(protocol, now)) {
      await this.send("open", protocol.nextCycleId, [this.ix.openCycle(this.keeper.publicKey, protocol.nextCycleId)]);
    }

    const ids: bigint[] = [];
    for (let i = protocol.nextCycleId - BigInt(this.scanWindow); i < protocol.nextCycleId; i++) if (i >= 0n) ids.push(i);
    const cycles = (await fetchCycles(this.connection, ids, this.ix.programId)).filter((c): c is CycleAccount => !!c);

    for (const cycle of cycles) {
      if ((cycle.status === "settled" || cycle.status === "void") && (cycle.swept || cycle.claims < cycle.participants)) continue;
      let randomnessFulfilled: boolean | undefined;
      let unsettledOwners: string[] | undefined;
      if (cycle.status === "closed" || cycle.status === "awaitingRandomness") {
        randomnessFulfilled = (await fetchOraoRandomness(this.connection, cycle.vrfSeed)).fulfilled;
      }
      if (cycle.status === "resolving") {
        const positions = await fetchCyclePositions(this.connection, cycle.id, this.ix.programId);
        unsettledOwners = positions.filter((p) => !p.settled).map((p) => p.owner.toBase58());
      }
      await this.execute(cycle, planCycleAction({ cycle, now, randomnessFulfilled, unsettledOwners }));
    }
    this.lastTickAt = Date.now();
    this.lastError = null;
  }

  private async execute(cycle: CycleAccount, action: CycleAction) {
    const id = cycle.id;
    switch (action.kind) {
      case "close":
        return this.send("close", id, [this.ix.closeCycle(id)]);
      case "request":
        this.oraoTreasury ??= await fetchOraoTreasury(this.connection);
        return this.send("request", id, [
          this.ix.requestRandomness({ cranker: this.keeper.publicKey, cycleId: id, vrfSeed: cycle.vrfSeed, vrfTreasury: this.oraoTreasury }),
        ]);
      case "reveal":
        return this.send("reveal", id, [this.ix.revealRandomness(id, cycle.vrfSeed)]);
      case "void":
        return this.send("void", id, [this.ix.voidCycle(id, cycle.vrfSeed)]);
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
        return this.send("finalize", id, [this.ix.finalizeCycle(id)]);
      case "sweep":
        return this.send("sweep", id, [this.ix.sweepCycle(id)]);
      default:
        return;
    }
  }

  private async send(kind: string, cycleId: bigint, ixs: TransactionInstruction[], target?: string) {
    let attempts = 0;
    try {
      const sig = await withRetry(
        async (a) => {
          attempts = a;
          return sendAndConfirmTransaction(this.connection, new Transaction().add(...ixs), [this.keeper], { commitment: "confirmed" });
        },
        { onRetry: (e, a, d) => log.warn({ kind, cycleId: String(cycleId), attempt: a, delayMs: d, err: String(e) }, "retrying crank tx") },
      );
      log.info({ kind, cycleId: String(cycleId), sig }, "crank");
      await this.record({ kind, cycleId, target, signature: sig, status: "ok", attempts });
    } catch (e) {
      const name = anchorErrorName(e);
      const benign = !!name && BENIGN_ERRORS.includes(name);
      log[benign ? "debug" : "error"]({ kind, cycleId: String(cycleId), err: name ?? String(e) }, "crank tx failed");
      if (!benign) this.lastError = `${kind} #${cycleId}: ${name ?? String(e)}`;
      await this.record({ kind, cycleId, target, status: benign ? "skipped" : "failed", error: name ?? String(e).slice(0, 500), attempts });
    }
  }

  private async record(row: { kind: string; cycleId: bigint; target?: string; signature?: string; status: string; error?: string; attempts: number }) {
    if (!this.db) return;
    await this.db.keeperAction.create({ data: row }).catch(() => undefined);
  }
}
