"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { DEFAULT_PARAMS, TUNNEL_UNIT, VOLATILITY, formatTunnel } from "@tunnel/sdk";
import { AnimatePresence, motion } from "motion/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBalances } from "@/lib/chain";
import { PRACTICE_START, useCasino, useLiveGame, usePracticeGame, type BetView, type GameEngine } from "@/lib/game";
import { useQuality, particleBudget } from "@/lib/quality";
import { play } from "@/lib/sound";
import type { ChamberApi, ChamberPhase } from "../three/Chamber";
import { StaticAccelerator } from "../three/StaticAccelerator";
import { Arrow, Badge, Button, Dot, PanelHeader, cx } from "../ui";
import { useWalletAuth } from "../WalletAuth";
import { WalletPicker } from "../WalletButton";
import { BetPanel, type BetConfig } from "./BetPanel";
import { FundsDialog } from "./FundsDialog";
import { FairnessPanel, HistoryPanel, LastResult, LiveBets } from "./Panels";

const Chamber = dynamic(() => import("../three/Chamber"), { ssr: false });

const PHASE_LABEL: Record<ChamberPhase, string> = {
  idle: "",
  charging: "CHARGING PARTICLE",
  accelerating: "APPROACHING THE BARRIER",
  tunneled: "TUNNELED THROUGH",
  reflected: "REFLECTED",
  done: "",
};

const physicsOf = (vol: number) => {
  const b = DEFAULT_PARAMS.barriers[vol];
  const v0 = b.heightMilli / 1000;
  return { v0, a: b.widthMilli / 1000, e: v0 * 0.5 };
};

export function LiveGame() {
  const game = useLiveGame();
  return <GameApp game={game} />;
}

export function PracticeGame() {
  const game = usePracticeGame();
  return <GameApp game={game} onReset={game.reset} />;
}

function GameApp({ game, onReset }: { game: GameEngine; onReset?: () => void }) {
  const q = useQuality();
  const live = game.mode === "live";
  const unit = live ? "$TUNNEL" : "credits";
  const { publicKey } = useWallet();
  const auth = useWalletAuth();
  const casino = useCasino();
  const onchain = useBalances(live ? (publicKey ?? null) : null);
  const [config, setConfig] = useState<BetConfig>({ volatility: 0, amount: 10n * TUNNEL_UNIT, count: 5 });
  const [firing, setFiring] = useState(false);
  const [phase, setPhase] = useState<ChamberPhase>("idle");
  const [last, setLast] = useState<BetView | null>(null);
  const [progress, setProgress] = useState<{ done: number; hits: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cinematic, setCinematic] = useState(false);
  const [picker, setPicker] = useState(false);
  const [funds, setFunds] = useState<"deposit" | "withdraw" | null>(null);
  const [gate, setGate] = useState(false);
  const chamber = useRef<ChamberApi>(null);
  const v = VOLATILITY[config.volatility];
  const stake = config.amount * BigInt(config.count);

  useEffect(() => {
    if (!live) return;
    try {
      setGate(localStorage.getItem("tunnel:18plus") !== "yes");
    } catch {
      setGate(true);
    }
  }, [live]);

  const onPhase = useCallback((p: ChamberPhase) => {
    setPhase(p);
    if (p === "accelerating") play("launch");
    if (p === "tunneled") play("tunnel");
    if (p === "reflected") play("reflect");
    if (p === "charging") play("barrier");
  }, []);

  const fire = async () => {
    if (game.status === "connect") return setPicker(true);
    if (game.status === "signin") return void auth.signIn();
    if (game.status !== "ready" || firing) return;
    setError(null);
    setFiring(true);
    play("charge");
    const r = await game.fire(config.volatility, config.amount, config.count);
    if (!r.ok) {
      setError(r.error);
      setFiring(false);
      return;
    }
    const bet = r.bet;
    const phys = physicsOf(bet.volatility);
    const color = VOLATILITY[bet.volatility].color;
    setLast(null);
    setProgress({ done: 0, hits: 0, total: bet.count });
    if (chamber.current) {
      let hits = 0;
      for (let i = 0; i < bet.hits.length; i++) {
        const lead = i === 0 && cinematic;
        await chamber.current.play({ tunnel: bet.hits[i], color, ...phys, fast: !lead });
        if (bet.hits[i]) {
          hits++;
          if (!lead && i % 2 === 0) play("tick");
        }
        setProgress({ done: i + 1, hits, total: bet.count });
      }
      await new Promise((res) => setTimeout(res, 1_500));
    }
    setProgress(null);
    setLast(bet);
    setFiring(false);
    play(bet.payout > bet.stake ? "tunnel" : "reflect");
  };

  const insufficient = game.balance != null && stake > game.balance;
  const buttonLabel =
    game.status === "connect"
      ? "Connect wallet to play"
      : game.status === "signin"
        ? auth.status === "signing"
          ? "Sign the message in your wallet…"
          : "Sign in to play"
        : game.status === "offline"
          ? "Accelerator offline"
          : game.status === "paused"
            ? "Accelerator paused"
            : game.status === "loading"
              ? "Loading…"
              : firing
                ? "Firing…"
                : insufficient
                  ? live
                    ? "Deposit to fire"
                    : "Not enough credits"
                  : null;

  const hud =
    firing && phase !== "idle" && phase !== "done" && cinematic
      ? PHASE_LABEL[phase]
      : progress
        ? `FIRING · ${progress.done}/${progress.total} · ${progress.hits} TUNNELED`
        : last
          ? last.payout > last.stake
            ? `${last.wins} TUNNELED · +${formatTunnel(last.payout - last.stake)} ${unit.toUpperCase()}`
            : last.wins > 0
              ? `${last.wins} TUNNELED · ${formatTunnel(last.payout)} RETURNED`
              : "ALL REFLECTED · RECALIBRATE AND FIRE AGAIN"
          : `READY · ${v.short} BARRIER ARMED`;
  const hudTone = last && !progress && last.payout > last.stake ? "text-flare" : last && !progress && last.wins === 0 ? "text-amber" : "text-cyan";

  return (
    <div className="mx-auto max-w-[1600px] px-3 pb-10 pt-4 sm:px-6">
      {!live && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-violet/30 bg-violet/[0.06] px-4 py-3 text-[13px]">
          <Badge tone="violet">Practice</Badge>
          <span className="text-fg-2">Free credits, the same barriers, odds and draws as the live accelerator. Nothing here is real $TUNNEL.</span>
          <Link href="/accelerator" className="ml-auto font-mono text-[12px] text-cyan hover:underline">
            Go live →
          </Link>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[350px_minmax(0,1fr)_320px]">
        {/* chamber */}
        <section id="chamber" className="panel brackets relative order-1 min-h-[360px] overflow-hidden sm:min-h-[460px] lg:order-2 lg:min-h-[600px]" aria-label="Particle accelerator">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_45%,#0B1424_0%,#05070B_75%)]" />
          {q.webgl ? (
            <Chamber apiRef={chamber} onPhase={onPhase} dpr={q.dpr} reducedMotion={q.reducedMotion} particles={particleBudget(q.tier, 160)} barrierColor={v.color} className="absolute inset-0" />
          ) : q.webgl === false ? (
            <StaticAccelerator className="absolute inset-0 m-auto h-2/3 w-5/6" />
          ) : null}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4 sm:p-5">
            <div>
              <div className="font-mono text-[10px] tracking-[0.22em] text-faint">TUNNEL / {live ? "ACCELERATOR" : "LABORATORY · PRACTICE"}</div>
              <AnimatePresence mode="wait">
                <motion.div key={hud} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className={cx("mt-2 font-mono text-[13px] tracking-[0.16em] sm:text-[15px]", hudTone)} role="status" aria-live="polite">
                  {hud}
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="text-right">
              <div className="font-mono text-[10px] tracking-[0.22em] text-faint">BALANCE</div>
              <div className="mt-1 font-mono text-lg tabular">{game.balance != null ? formatTunnel(game.balance) : "—"}</div>
              <div className="font-mono text-[11px] text-muted">{unit}</div>
            </div>
          </div>
          {progress && (
            <div className="pointer-events-none absolute inset-x-4 bottom-4 sm:inset-x-5">
              <div className="h-1 overflow-hidden rounded-full bg-line">
                <div className="h-full bg-[linear-gradient(90deg,#2864FF,#EAFBFF)] transition-[width]" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            </div>
          )}
        </section>

        {/* bet configuration */}
        <section className="panel order-2 overflow-hidden lg:order-1 lg:row-span-2" aria-label="Bet configuration">
          <PanelHeader index="01" title="Configure" right={<Badge tone={live ? "cyan" : "violet"}>{live ? "Live" : "Practice"}</Badge>} />
          <BetPanel config={config} onChange={setConfig} minBet={game.minBet} maxBet={game.maxBet} unit={unit} disabled={firing} />
          <div className="border-t border-line-soft p-5">
            <Button
              variant="energy"
              size="lg"
              className="w-full font-mono uppercase"
              disabled={firing || game.status === "offline" || game.status === "paused" || game.status === "loading" || (game.status === "ready" && insufficient && !live)}
              onClick={game.status === "ready" && insufficient && live ? () => setFunds("deposit") : fire}
            >
              {buttonLabel ?? (
                <>
                  Fire {config.count} particle{config.count === 1 ? "" : "s"} · {formatTunnel(stake)} <Arrow />
                </>
              )}
            </Button>
            <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 text-[11px] text-muted">
              <input type="checkbox" checked={cinematic} onChange={(e) => setCinematic(e.target.checked)} className="accent-cyan" />
              Full cinematic on the first particle
            </label>
            {error && <p className="mt-2 text-center text-[12px] text-red">{error}</p>}
            {auth.error && game.status === "signin" && <p className="mt-2 text-center text-[11px] text-red">{auth.error}</p>}
          </div>
        </section>

        {/* balance + fairness */}
        <div className="order-3 grid gap-4 lg:col-start-2 xl:col-start-3 xl:row-start-1 xl:content-start">
          <section className="panel overflow-hidden" aria-label="Balance">
            <PanelHeader index="02" title={live ? "Vault" : "Practice credits"} right={<span className="flex items-center gap-1.5 font-mono text-[10px] text-faint"><Dot color={game.status === "ready" ? "#00D9FF" : "#4c5a69"} pulse={game.status === "ready"} /> {game.status === "ready" ? "online" : game.status}</span>} />
            <div className="px-5 py-5">
              <div className="label">Balance</div>
              <div className="mt-1 font-mono text-[28px] tabular leading-none">
                {game.balance != null ? formatTunnel(game.balance) : "—"} <span className="text-sm text-muted">{unit}</span>
              </div>
              {live && publicKey && (
                <div className="mt-2 font-mono text-[11px] text-faint">in wallet: {onchain.data?.tunnel != null ? formatTunnel(onchain.data.tunnel) : "—"} $TUNNEL</div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2">
                {live ? (
                  <>
                    <Button variant="energy" size="sm" disabled={game.status !== "ready" && game.status !== "paused"} onClick={() => setFunds("deposit")}>
                      Deposit
                    </Button>
                    <Button variant="secondary" size="sm" disabled={!game.balance} onClick={() => setFunds("withdraw")}>
                      Withdraw
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" size="sm" className="col-span-2" onClick={() => onReset?.()}>
                    Reset to {formatTunnel(PRACTICE_START, 0)} credits
                  </Button>
                )}
              </div>
            </div>
          </section>
          <section className="panel overflow-hidden" aria-label="Provably fair">
            <PanelHeader index="03" title="Provably fair" />
            <FairnessPanel game={game} />
          </section>
        </div>

        {/* results */}
        <div className="order-4 grid gap-4 lg:col-start-2 xl:col-span-2 xl:col-start-2 xl:grid-cols-2">
          <section className="panel overflow-hidden" aria-label="Your bets">
            <PanelHeader index="04" title="Your shots" />
            {last && <LastResult bet={last} unit={unit} />}
            <HistoryPanel game={game} unit={unit} />
          </section>
          {live ? (
            <section className="panel overflow-hidden" aria-label="Live bets">
              <PanelHeader index="05" title="Live from the accelerator" right={<span className="font-mono text-[10px] text-faint">{casino.data ? `${casino.data.totals.bets.toLocaleString()} shots` : ""}</span>} />
              <LiveBets unit={unit} />
            </section>
          ) : (
            <section className="panel overflow-hidden p-6" aria-label="Strategy notes">
              <div className="eyebrow">Lab notes</div>
              <ul className="mt-4 space-y-3 text-[13.5px] leading-relaxed text-fg-2">
                <li>
                  <span className="text-cyan">Low</span> barriers tunnel often and pay {formatTunnelX(0)}. Steady sessions, smaller swings.
                </li>
                <li>
                  <span className="text-ion">Medium</span> barriers land one in five and pay {formatTunnelX(1)}.
                </li>
                <li>
                  <span className="text-violet">High</span> barriers are long shots that pay {formatTunnelX(2)}. Expect long dry runs.
                </li>
                <li>More particles per shot smooth out results; bigger energy per particle raises the stakes on every one of them.</li>
                <li>Practice results use the exact same draw function as the live accelerator, so what you learn here carries over.</li>
              </ul>
            </section>
          )}
        </div>
      </div>

      {live && (
        <>
          <FundsDialog open={!!funds} kind={funds ?? "deposit"} onClose={() => setFunds(null)} balance={game.balance} depositAddress={casino.data?.depositAddress ?? null} tunnelMint={casino.data?.tunnelMint ?? null} />
          <AgeGate open={gate} onAccept={() => setGate(false)} />
        </>
      )}
      <WalletPicker open={picker} onClose={() => setPicker(false)} />
    </div>
  );
}

const formatTunnelX = (i: number) => `${(VOLATILITY[i].multiplierBps / 10_000).toString()}×`;

function AgeGate({ open, onAccept }: { open: boolean; onAccept: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div role="dialog" aria-modal="true" aria-labelledby="gate-title" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="panel brackets w-full max-w-md p-6">
            <div className="eyebrow">Before you enter</div>
            <h2 id="gate-title" className="mt-2 text-xl font-semibold tracking-tight">
              The accelerator is for adults only
            </h2>
            <p className="mt-3 text-[13.5px] leading-relaxed text-fg-2">
              By entering you confirm you are at least 18 years old and that playing games of chance with digital assets is legal where you live. Only play with what you can
              afford to lose.
            </p>
            <div className="mt-6 flex gap-2">
              <Link href="/laboratory" className="inline-flex h-10 items-center rounded-lg px-4 text-sm text-fg-2 hover:text-fg">
                Practice instead
              </Link>
              <Button
                variant="energy"
                className="ml-auto font-mono uppercase"
                onClick={() => {
                  try {
                    localStorage.setItem("tunnel:18plus", "yes");
                  } catch {
                    /* storage unavailable */
                  }
                  onAccept();
                }}
              >
                I am 18+ · Enter
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
