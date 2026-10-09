"use client";

import { useState, type ReactNode } from "react";
import { cx } from "./ui";

/** Shared chart chrome: title, legend, and a table view so no value is color-only. */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: { label: string; color: string }[];
  table: { columns: string[]; rows: (string | number)[][] };
  children: ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section className={cx("panel overflow-hidden", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="text-[14px] font-medium">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-4">
          {legend && legend.length > 1 && (
            <ul className="flex flex-wrap gap-3" aria-label="Legend">
              {legend.map((l) => (
                <li key={l.label} className="flex items-center gap-1.5 text-[11.5px] text-fg-2">
                  <span className="size-2 rounded-[2px]" style={{ background: l.color }} />
                  {l.label}
                </li>
              ))}
            </ul>
          )}
          <div className="flex rounded-md border border-line-soft p-0.5" role="tablist" aria-label="View">
            {(["chart", "table"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cx("rounded px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider", view === v ? "bg-panel-2 text-fg" : "text-muted hover:text-fg")}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="px-2 pb-3 pt-3">
        {view === "chart" ? (
          children
        ) : (
          <div className="max-h-[260px] overflow-auto px-3">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-panel">
                <tr>
                  {table.columns.map((c) => (
                    <th key={c} className="label py-2 pr-4 text-left font-normal">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono tabular text-fg-2">
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-t border-line-soft">
                    {r.map((c, j) => (
                      <td key={j} className="py-1.5 pr-4">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/** Recessive axis / grid styling shared by all Recharts charts. */
export const axisProps = {
  stroke: "#1C2936",
  tick: { fill: "#8392A5", fontSize: 10.5, fontFamily: "var(--font-mono)" },
  tickLine: false,
  axisLine: { stroke: "#1C2936" },
} as const;

export const gridProps = { stroke: "#141E29", vertical: false } as const;

export function ChartTooltip({ active, payload, label, format }: { active?: boolean; payload?: any[]; label?: any; format?: (v: number, name: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-bg-2/95 px-3 py-2 shadow-xl backdrop-blur">
      <div className="mb-1 font-mono text-[10.5px] text-muted">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-[12px]">
          <span className="size-2 rounded-[2px]" style={{ background: p.color ?? p.fill }} />
          <span className="text-muted">{p.name}</span>
          <span className="ml-auto pl-3 font-mono tabular text-fg">{format ? format(Number(p.value), p.name) : p.value}</span>
        </div>
      ))}
    </div>
  );
}
