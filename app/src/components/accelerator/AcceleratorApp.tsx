"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { BARRIER_META, TunnelInstructions, fetchCycle, fetchPosition, isGatekeeperEnabled, type CycleAccount } from "@tunnel/sdk";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { splitCycles, useChainClock, useCycles, useOwnerPositions, usePosition, usePositionRent } from "@/lib/chain";
import { appConfig } from "@/lib/config";
import { displayStatus, formatCountdown } from "@/lib/cycle";
import { physicsOf, useProtocolConfig } from "@/lib/protocol";
import { useQuality, particleBudget } from "@/lib/quality";
import { markRevealed, planReveal, wasRevealed, type RevealPlan } from "@/lib/reveal";
import { play } from "@/lib/sound";
import { useActivity } from "@/lib/stream";
import { useSendTx } from "@/lib/tx";
import type { ChamberApi, ChamberPhase } from "../three/Chamber";
import { StaticAccelerator } from "../three/StaticAccelerator";
import { Arrow, Badge, Button, Dot, PanelHeader, cx } from "../ui";
import { WalletPicker } from "../WalletButton";
import { useWalletAuth } from "../WalletAuth";
import { ClaimsPanel } from "./ClaimsPanel";
import { ConfigPanel, type Config } from "./ConfigPanel";
import { DeployDialog } from "./DeployDialog";
import { ResultCard } from "./ResultCard";
import { TelemetryPanel } from "./TelemetryPanel";

const Chamber = dynamic(() => import("../three/Chamber"), { ssr: false });
const ix = new TunnelInstructions(appConfig.programId);

const PHASE_LABEL: Record<ChamberPhase, string> = {
  idle: "",
  charging: "INITIALIZING PARTICLE",
  accelerating: "APPROACHING POTENTIAL BARRIER",
  tunneled: "TUNNELING SUCCESSFUL",
  reflected: "PARTICLE REFLECTED",
  done: "",
};

export function AcceleratorApp() {
  const q = useQuality();
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const auth = useWalletAuth();
  const { now } = useChainClock(250);
  const cycles = useCycles(4);
  const protocol = cycles.protocol.data;
  const { current, upcoming, recent } = splitCycles(cycles.data, now);
  const latest = recent[0] ?? null;
  const cfg = useProtocolConfig();
  const position = usePosition(current?.id);
  const ownerPositions = useOwnerPositions();
  const rent = usePositionRent();
  const activity = useActivity(40);
  const { send, state: tx, reset } = useSendTx();

  const [config, setConfig] = useState<Config>({ barrier: 1, level: 2, count: 5 });
  const [dialog, setDialog] = useState(false);
  const [picker, setPicker] = useState(false);
  const [phase, setPhase] = useState<ChamberPhase>("idle");
  const [revealing, setRevealing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; tunneled: number; total: number } | null>(null);
  const [result, setResult] = useState<{ plan: RevealPlan; cycle: CycleAccount } | null>(null);
  const [lastDeploy, setLastDeploy] = useState<{ cycleId: bigint; signature: string } | null>(null);
  const chamber = useRef<ChamberApi>(null);

  // Snapshot odds come from the cycle the user would deploy into (else the protocol's current params).
  const odds = current?.odds ?? cfg.odds;
  const barriers = current?.barriers ?? cfg.barriers;
  const levels = current?.levels ?? cfg.levels;
  const energyPerCycle = current?.energyPerCycle ?? cfg.energyPerCycle;
  const energyLeft = publicKey && current ? energyPerCycle - (position.data?.energyUsed ?? 0) : null;
  const cosign = !!protocol && isGatekeeperEnabled(protocol);
  const canDeploy = !!current && !!protocol && !protocol.paused && appConfig.depositsEnabled && (energyLeft == null || energyLeft >= levels[config.level].cost);
  const barrierColor = BARRIER_META[config.barrier].color;

  // ---------------------------------------------------------------- watched cycle (the latest one this wallet joined)
  const watched = useMemo(() => {
    const open = (ownerPositions.data ?? []).filter((p) => !p.claimed);
    const ids = open.map((p) => p.cycleId);
    if (lastDeploy) ids.push(lastDeploy.cycleId);
    return ids.length ? ids.reduce((a, b) => (a > b ? a : b)) : null;
  }, [ownerPositions.data, lastDeploy]);
  const watchedCycle = recent.find((c) => c.id === watched) ?? null;
  const watchedPosition = (ownerPositions.data ?? []).find((p) => p.cycleId === watched) ?? (current && watched === current.id ? position.data : null);

  // Queue particles in the storage ring until their cycle settles.
  useEffect(() => {
    const p = watchedPosition;
    if (!p || p.settled || revealing) {
      if (!revealing) chamber.current?.setQueued(0);
      return;
    }
    const colors: string[] = [];
    p.particles.forEach((row, b) => row.forEach((n) => colors.push(...Array(Math.min(n, 40)).fill(BARRIER_META[b].color))));
    chamber.current?.setQueued(colors.length, colors);
  }, [watchedPosition, revealing]);

  // ---------------------------------------------------------------- reveal (only after onchain settlement)
  const runReveal = useCallback(
    async (cycleId: bigint) => {
      if (!publicKey || revealing) return;
      const [c, p] = await Promise.all([fetchCycle(connection, cycleId, appConfig.programId), fetchPosition(connection, cycleId, publicKey, appConfig.programId)]);
      if (!c || !p) return;
      const plan = planReveal(c, p);
      if (!plan || !chamber.current) return;
      setRevealing(true);
      setResult(null);
      document.getElementById("chamber")?.scrollIntoView({ behavior: "smooth", block: "center" });
      chamber.current.setQueued(0);
      setProgress({ done: 0, tunneled: 0, total: plan.total });
      const lead = plan.particles[0];
      const phys = physicsOf(c.barriers[lead.barrier], c.levels[lead.level]);
      play("charge");
      await chamber.current.play({ tunnel: lead.success, color: BARRIER_META[lead.barrier].color, ...phys });
      let tunneled = lead.success ? 1 : 0;
      setProgress({ done: 1, tunneled, total: plan.total });
      for (let i = 1; i < plan.particles.length; i++) {
        const pt = plan.particles[i];
        const ph = physicsOf(c.barriers[pt.barrier], c.levels[pt.level]);
        await chamber.current.play({ tunnel: pt.success, color: BARRIER_META[pt.barrier].color, ...ph, fast: true });
        if (pt.success) tunneled++;
        if (i % 3 === 0 || i === plan.particles.length - 1) setProgress({ done: i + 1, tunneled, total: plan.total });
        if (pt.success && i % 4 === 0) play("tick");
      }
      await new Promise((r) => setTimeout(r, plan.total > 1 ? 1500 : 200));
      markRevealed(cycleId);
      setResult({ plan, cycle: c });
      setProgress(null);
      setRevealing(false);
      play(plan.successes > 0 ? "tunnel" : "reflect");
    },
    [connection, publicKey, revealing],
  );

  useEffect(() => {
    if (!watchedCycle || !watchedPosition || revealing || result?.cycle.id === watchedCycle.id) return;
    const ready = watchedPosition.settled && (watchedCycle.status === "settled" || watchedCycle.status === "resolving");
    if (ready && !wasRevealed(watchedCycle.id)) void runReveal(watchedCycle.id);
  }, [watchedCycle, watchedPosition, revealing, result, runReveal]);

  const onPhase = useCallback((p: ChamberPhase) => {
    setPhase(p);
    if (p === "accelerating") play("launch");
    if (p === "tunneled") play("tunnel");
    if (p === "reflected") play("reflect");
    if (p === "charging") play("barrier");
  }, []);

  // ---------------------------------------------------------------- deploy
  const startDeploy = async () => {
    if (!publicKey) return setPicker(true);
    if (cosign && auth.status !== "verified") {
      await auth.signIn();
      return;
    }
    reset();
    setDialog(true);
  };

  const confirmDeploy = async () => {
    if (!publicKey || !current) return;
    const left = energyLeft ?? energyPerCycle;
    const count = Math.min(config.count, Math.floor(left / levels[config.level].cost));
    if (count < 1) return;
    const sig = await send([ix.deployParticles({ owner: publicKey, cycleId: current.id, barrier: config.barrier, level: config.level, count, gatekeeper: cosign ? protocol!.gatekeeper : null })], {
      cosign,
    });
    if (!sig) return;
    setLastDeploy({ cycleId: current.id, signature: sig });
    setDialog(false);
    setResult(null);
    chamber.current?.inject(barrierColor, count);
    play("charge");
  };

  // ---------------------------------------------------------------- status label for the chamber HUD
  const watchStatus = watchedCycle ? displayStatus(watchedCycle, now) : null;
  const hud =
    revealing && phase !== "idle" && phase !== "done"
      ? PHASE_LABEL[phase]
      : watchedPosition && !watchedPosition.settled
        ? watchStatus === "OPEN"
          ? "PARTICLES IN STORAGE RING · AWAITING CYCLE CLOSE"
          : watchStatus === "AWAITING RANDOMNESS"
            ? "REQUESTING VERIFIABLE RANDOMNESS · ORAO VRF"
            : watchStatus === "RESOLVING"
              ? "RANDOMNESS REVEALED · SETTLING POSITIONS"
              : watchStatus === "VOID"
                ? "CYCLE VOIDED · NO OUTCOMES"
                : "CYCLE CLOSED · FIXING VRF SEED"
        : result
          ? result.plan.successes > 0
            ? "TUNNELING SUCCESSFUL"
            : "PARTICLE REFLECTED"
          : "READY · CONFIGURE YOUR PARTICLES";
  const hudTone = hud.includes("SUCCESS") ? "text-flare" : hud.includes("REFLECTED") ? "text-amber" : "text-cyan";
  const ambient = !revealing && !(watchedPosition && !watchedPosition.settled);

  return (
    <div className="mx-auto max-w-[1600px] px-3 pb-10 pt-4 sm:px-6">
      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[350px_minmax(0,1fr)_320px]">
        {/* chamber */}
        <section id="chamber" className="panel brackets relative order-1 min-h-[360px] overflow-hidden sm:min-h-[460px] lg:order-2 lg:min-h-[640px]" aria-label="Particle acceleration chamber">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_45%,#0B1424_0%,#05070B_75%)]" />
          {q.webgl ? (
            <Chamber apiRef={chamber} onPhase={onPhase} dpr={q.dpr} reducedMotion={q.reducedMotion} particles={particleBudget(q.tier, 160)} barrierColor={barrierColor} className="absolute inset-0" />
          ) : q.webgl === false ? (
            <StaticAccelerator className="absolute inset-0 m-auto h-2/3 w-5/6" />
          ) : null}
          {/* HUD */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4 sm:p-5">
            <div>
              <div className="font-mono text-[10px] tracking-[0.22em] text-faint">TUNNEL / ACCELERATOR</div>
              <AnimatePresence mode="wait">
                <motion.div key={hud} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className={cx("mt-2 font-mono text-[13px] tracking-[0.16em] sm:text-[15px]", hudTone)} role="status" aria-live="polite">
                  {hud}
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="text-right">
              <div className="font-mono text-[10px] tracking-[0.22em] text-faint">CYCLE</div>
              <div className="mt-1 font-mono text-lg tabular">{current ? `#${current.id}` : "—"}</div>
              <div className="font-mono text-[13px] tabular text-cyan">{current ? formatCountdown(current.closeTs - now) : upcoming ? `T−${formatCountdown(upcoming.openTs - now)}` : ""}</div>
            </div>
          </div>
          {progress && (
            <div className="pointer-events-none absolute inset-x-4 bottom-4 sm:inset-x-5">
              <div className="flex justify-between font-mono text-[11px] tracking-[0.1em] text-muted">
                <span>
                  PARTICLE {progress.done} / {progress.total}
                </span>
                <span className="text-flare">{progress.tunneled} TUNNELED</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
                <div className="h-full bg-[linear-gradient(90deg,#2864FF,#EAFBFF)] transition-[width]" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            </div>
          )}
          {ambient && !progress && (
            <div className="pointer-events-none absolute bottom-4 left-4 font-mono text-[10px] tracking-[0.14em] text-faint sm:left-5">AMBIENT PARTICLES ARE A VISUAL EFFECT · OUTCOMES APPEAR ONLY AFTER ONCHAIN SETTLEMENT</div>
          )}
        </section>

        {/* configuration */}
        <section className="panel order-2 overflow-hidden lg:order-1 lg:row-span-2" aria-label="Particle configuration">
          <PanelHeader index="01" title="Configuration" right={<Badge tone={current ? "cyan" : "neutral"}>{current ? "Live odds" : cfg.source === "chain" ? "Next cycle" : "Launch params"}</Badge>} />
          <ConfigPanel config={config} onChange={setConfig} barriers={barriers} levels={levels} odds={odds} energyLeft={energyLeft} energyPerCycle={energyPerCycle} disabled={revealing} />
          <div className="border-t border-line-soft p-5">
            <Button variant="energy" size="lg" className="w-full font-mono uppercase" disabled={(!canDeploy && !!publicKey) || revealing || tx.phase === "signing"} onClick={startDeploy}>
              {!publicKey ? (
                "Connect wallet to deploy"
              ) : cosign && auth.status !== "verified" ? (
                auth.status === "signing" ? "Sign the message in your wallet…" : "Verify wallet to deploy"
              ) : (
                <>
                  Deploy particles <Arrow />
                </>
              )}
            </Button>
            <p className="mt-3 text-center text-[11px] leading-relaxed text-faint">
              {!current
                ? "No cycle is accepting particles right now; the next one opens shortly."
                : energyLeft === 0
                  ? "You have used all your energy this cycle. It refills next cycle."
                  : "Free to mine · network fee + refundable deposit only · outcome after the cycle settles"}
            </p>
            {auth.error && <p className="mt-2 text-center text-[11px] text-red">{auth.error}</p>}
          </div>
        </section>

        {/* telemetry */}
        <section className="panel order-3 overflow-hidden lg:col-start-2 xl:col-start-3 xl:row-start-1" aria-label="Telemetry">
          <PanelHeader index="02" title="Telemetry" right={<span className="flex items-center gap-1.5 font-mono text-[10px] text-faint"><Dot color={activity.live ? "#00D9FF" : "#4c5a69"} pulse={activity.live} /> onchain</span>} />
          <TelemetryPanel
            protocol={protocol}
            current={current}
            upcoming={upcoming}
            latest={latest}
            now={now}
            loading={cycles.protocol.loading && protocol === undefined}
            barrier={barriers[config.barrier]}
            level={levels[config.level]}
            barrierIndex={config.barrier}
            activity={activity}
          />
        </section>

        {/* result + claims */}
        <div className="order-4 grid gap-4 lg:col-start-2 xl:col-span-2 xl:col-start-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <AnimatePresence>
            {result && (
              <ResultCard
                plan={result.plan}
                cycle={result.cycle}
                deploySignature={lastDeploy?.cycleId === result.cycle.id ? lastDeploy.signature : null}
                onRunAgain={() => {
                  setResult(null);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                onReplay={() => runReveal(result.cycle.id)}
              />
            )}
          </AnimatePresence>
          <section id="claims" className={cx("panel scroll-mt-24 overflow-hidden", !result && "xl:col-span-2")} aria-label="Claims">
            <PanelHeader index="03" title="Your positions & claims" />
            <ClaimsPanel onReplay={(id) => void runReveal(id)} />
          </section>
        </div>
      </div>

      <DeployDialog
        open={dialog}
        onClose={() => setDialog(false)}
        onConfirm={confirmDeploy}
        config={{ ...config, count: Math.min(config.count, Math.max(1, Math.floor((energyLeft ?? energyPerCycle) / levels[config.level].cost))) }}
        odds={odds}
        cycleId={current?.id ?? null}
        closesIn={current ? formatCountdown(current.closeTs - now) : "—"}
        newPosition={!position.data}
        rentLamports={rent.data ?? null}
        cosign={cosign}
        tx={tx}
        energyCost={Math.min(config.count, Math.max(1, Math.floor((energyLeft ?? energyPerCycle) / levels[config.level].cost))) * levels[config.level].cost}
      />
      <WalletPicker open={picker} onClose={() => setPicker(false)} />
    </div>
  );
}
