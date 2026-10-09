import { LAMPORTS_PER_SOL, TUNNEL_DECIMALS } from "./constants";

function fixed(value: bigint, decimals: number, maxFraction: number): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  const wholeStr = whole.toLocaleString("en-US");
  return `${neg ? "−" : ""}${wholeStr}${frac ? "." + frac : ""}`;
}

/** Lamports → "1.2345" (no float rounding). */
export const formatSol = (lamports: bigint, maxFraction = 4) => fixed(lamports, 9, maxFraction);
/** $TUNNEL base units → "416.5". */
export const formatTunnel = (units: bigint, maxFraction = 2) => fixed(units, TUNNEL_DECIMALS, maxFraction);
export const formatBps = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

export function parseSolToLamports(input: string): bigint | null {
  const m = /^\s*(\d+)(?:\.(\d{0,9}))?\s*$/.exec(input);
  if (!m) return null;
  return BigInt(m[1]) * LAMPORTS_PER_SOL + BigInt((m[2] ?? "").padEnd(9, "0") || "0");
}

export const shortKey = (key: string, n = 4) => (key.length <= n * 2 + 1 ? key : `${key.slice(0, n)}…${key.slice(-n)}`);

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
