import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Panel({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cx("panel", className)} {...rest}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, right, className }: { title: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3", className)}>
      <h2 className="label">{title}</h2>
      {right}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonClass: Record<ButtonVariant, string> = {
  primary:
    "bg-fg text-bg hover:bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_24px_-8px_rgba(49,217,245,0.35)] disabled:bg-fg/30 disabled:text-bg/70 disabled:shadow-none",
  secondary: "bg-panel-2 text-fg border border-line hover:border-muted/50 disabled:text-faint",
  ghost: "text-fg-2 hover:text-fg hover:bg-panel-2 disabled:text-faint",
  danger: "bg-red/10 text-red border border-red/30 hover:bg-red/15",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-colors duration-150 disabled:cursor-not-allowed",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-[15px]",
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
}: { href: string; variant?: ButtonVariant; size?: "sm" | "md" | "lg"; className?: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-colors duration-150",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-[15px]",
        buttonClass[variant],
        className,
      )}
    >
      {children}
    </Link>
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

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "cyan" | "green" | "red" | "violet" | "amber" | "blue"; className?: string }) {
  const tones = {
    neutral: "border-line text-fg-2 bg-panel-2",
    cyan: "border-cyan/25 text-cyan bg-cyan/[0.06]",
    blue: "border-blue/30 text-[#86a6ff] bg-blue/[0.07]",
    green: "border-green/25 text-green bg-green/[0.06]",
    red: "border-red/25 text-red bg-red/[0.06]",
    violet: "border-violet/25 text-violet bg-violet/[0.07]",
    amber: "border-amber/25 text-amber bg-amber/[0.06]",
  } as const;
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-md border px-2 font-mono text-[10.5px] tracking-[0.08em] uppercase", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return <span className={cx("inline-block size-1.5 rounded-full", pulse && "pulse-dot")} style={{ background: color, boxShadow: `0 0 8px ${color}` }} />;
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono tabular", className)}>{children}</span>;
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={cx("inline-flex items-center gap-1 text-cyan hover:underline underline-offset-4", className)}>
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
      <div className="text-sm text-fg-2">{title}</div>
      {children && <div className="max-w-sm text-xs leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function SectionHeading({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      {eyebrow && <div className="label mb-3 text-cyan">{eyebrow}</div>}
      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-fg sm:text-[34px]">{title}</h1>
      {children && <p className="mt-3 text-[15px] leading-relaxed text-muted">{children}</p>}
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
