import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Panel({ className, children, brackets, ...rest }: ComponentProps<"section"> & { brackets?: boolean }) {
  return (
    <section className={cx("panel", brackets && "brackets", className)} {...rest}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, right, className, index }: { title: ReactNode; right?: ReactNode; className?: string; index?: string }) {
  return (
    <div className={cx("flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3", className)}>
      <h2 className="label flex items-center gap-2">
        {index && <span className="text-faint">{index}</span>}
        {title}
      </h2>
      {right}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "energy";

const buttonClass: Record<ButtonVariant, string> = {
  primary:
    "bg-fg text-bg hover:bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_10px_30px_-10px_rgba(0,217,255,0.45)] disabled:bg-fg/25 disabled:text-bg/70 disabled:shadow-none",
  energy:
    "text-bg bg-[linear-gradient(100deg,#00D9FF,#7FE9FF_45%,#00D9FF)] bg-[length:200%_100%] hover:bg-[position:100%_0] shadow-[0_0_0_1px_rgba(0,217,255,0.4),0_12px_36px_-10px_rgba(0,217,255,0.7)] disabled:opacity-40 disabled:shadow-none transition-[background-position,opacity] duration-500",
  secondary: "bg-panel-2/70 text-fg border border-line hover:border-muted/50 hover:bg-panel-2 disabled:text-faint",
  ghost: "text-fg-2 hover:text-fg hover:bg-panel-2 disabled:text-faint",
  danger: "bg-red/10 text-red border border-red/30 hover:bg-red/15",
};

const sizeClass = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[14px] tracking-[0.06em]",
} as const;

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: keyof typeof sizeClass }) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-colors duration-150 disabled:cursor-not-allowed",
        sizeClass[size],
        buttonClass[variant],
        className,
      )}
      {...rest}
    />
  );
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
}: { href: string; variant?: ButtonVariant; size?: keyof typeof sizeClass; className?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cx("inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-colors duration-150", sizeClass[size], buttonClass[variant], className)}
    >
      {children}
    </Link>
  );
}

export function Arrow({ className }: { className?: string }) {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true" className={className}>
      <path d="M0 5h12M8.5 1.2 12.3 5 8.5 8.8" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  );
}

export function Stat({
  label,
  value,
  sub,
  className,
  accent,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
  accent?: string;
}) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="label truncate">{label}</div>
      <div className="mt-2 truncate font-mono text-[19px] font-medium tabular tracking-tight text-fg xl:text-[21px]" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub && <div className="mt-1 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

export type Tone = "neutral" | "cyan" | "ion" | "violet" | "flare" | "amber" | "red";

const tones: Record<Tone, string> = {
  neutral: "border-line text-fg-2 bg-panel-2",
  cyan: "border-cyan/25 text-cyan bg-cyan/[0.06]",
  ion: "border-ion/35 text-[#7EA0FF] bg-ion/[0.08]",
  violet: "border-violet/30 text-[#B49BFF] bg-violet/[0.08]",
  flare: "border-flare/25 text-flare bg-flare/[0.06]",
  amber: "border-amber/25 text-amber bg-amber/[0.06]",
  red: "border-red/25 text-red bg-red/[0.06]",
};

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 font-mono text-[10.5px] tracking-[0.08em] uppercase", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return <span className={cx("inline-block size-1.5 shrink-0 rounded-full", pulse && "pulse-dot")} style={{ background: color, boxShadow: `0 0 8px ${color}` }} />;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono tabular", className)}>{children}</span>;
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={cx("inline-flex items-center gap-1 text-cyan underline-offset-4 hover:underline", className)}>
      {children}
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="opacity-70">
        <path d="M3 1h6v6M9 1 1 9" stroke="currentColor" strokeWidth="1.2" fill="none" />
      </svg>
    </a>
  );
}

export function Empty({ title, children, className }: { title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center", className)}>
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" className="mb-2 text-faint">
        <circle cx="14" cy="14" r="12" stroke="currentColor" strokeDasharray="2 3" fill="none" />
        <path d="M6 14h5M17 14h5" stroke="currentColor" />
        <rect x="12.5" y="8" width="3" height="12" rx="1" fill="currentColor" opacity="0.5" />
      </svg>
      <div className="text-sm text-fg-2">{title}</div>
      {children && <div className="max-w-sm text-xs leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function SectionHeading({ eyebrow, title, children, className, align = "left" }: { eyebrow?: string; title: ReactNode; children?: ReactNode; className?: string; align?: "left" | "center" }) {
  return (
    <div className={cx("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow && <div className="eyebrow mb-4">{eyebrow}</div>}
      <h2 className="text-[30px] font-semibold leading-[1.02] tracking-[-0.03em] text-fg sm:text-[44px]">{title}</h2>
      {children && <p className="mt-4 text-[15px] leading-relaxed text-muted sm:text-base">{children}</p>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children, right }: { eyebrow: string; title: ReactNode; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="relative overflow-hidden border-b border-line-soft">
      <div className="grid-backdrop pointer-events-none absolute inset-0 opacity-60" />
      <div className="relative mx-auto flex max-w-[1400px] flex-col gap-6 px-4 pb-10 pt-14 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="eyebrow mb-4">{eyebrow}</div>
          <h1 className="display text-[40px] sm:text-[60px]">{title}</h1>
          {children && <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted sm:text-base">{children}</p>}
        </div>
        {right}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cx("inline-block animate-pulse rounded bg-panel-2", className)} />;
}

/** Shows a value, a skeleton while loading, or an em dash when unavailable. */
export function Val({ v, loading, className }: { v: ReactNode | null | undefined; loading?: boolean; className?: string }) {
  if (loading) return <Skeleton className={cx("h-[0.9em] w-20 align-middle", className)} />;
  if (v === null || v === undefined || v === "") return <span className="text-faint">—</span>;
  return <>{v}</>;
}

/** Notice for data that comes from the indexer when it is not running. */
export function Unavailable({ what = "Indexed data", className }: { what?: string; className?: string }) {
  return (
    <div className={cx("flex items-center gap-2 rounded-lg border border-line-soft bg-bg-2/60 px-3 py-2 text-xs text-muted", className)}>
      <Dot color="#F0A64B" />
      {what} unavailable: the indexer is not running or not configured. Onchain values on this page are still live.
    </div>
  );
}
