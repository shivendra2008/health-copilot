"use client";

import type { Interpretation } from "@/lib/types";
import { cn } from "@/lib/utils";

const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString("en-IN") : `${+n.toFixed(2)}`);

/**
 * Where a value sits relative to the reference range PRINTED on the report.
 * Renders nothing when the value isn't a plain number or no range was printed —
 * we never invent a range.
 */
export function RangeBar({
  value,
  low,
  high,
  status,
  unit,
  showLabels = true,
  className,
}: {
  value: number | string | null | undefined;
  low: number | string | null | undefined;
  high: number | string | null | undefined;
  status: Interpretation;
  unit?: string | null;
  showLabels?: boolean;
  className?: string;
}) {
  const v = value == null ? null : Number(value);
  const lo = low == null ? null : Number(low);
  const hi = high == null ? null : Number(high);
  if (v == null || Number.isNaN(v) || (lo == null && hi == null)) return null;

  let min: number, max: number;
  if (lo != null && hi != null) {
    const span = hi - lo || Math.abs(hi) || 1;
    min = Math.min(lo - span * 0.5, v - span * 0.1);
    max = Math.max(hi + span * 0.5, v + span * 0.1);
  } else if (hi != null) {
    min = Math.min(0, v);
    max = Math.max(hi * 1.5, v * 1.15);
  } else {
    min = Math.min(lo! * 0.5, v * 0.85);
    max = Math.max(lo! * 1.6, v * 1.15);
  }
  if (lo != null && lo >= 0 && min < 0) min = 0;
  const pct = (n: number) => Math.min(100, Math.max(0, ((n - min) / (max - min || 1)) * 100));
  const bandStart = pct(lo ?? min);
  const bandEnd = pct(hi ?? max);
  const out = status === "above_range" || status === "below_range";
  const label = `Value ${fmt(v)}${unit ? ` ${unit}` : ""}; printed range ${lo != null ? fmt(lo) : "—"} to ${hi != null ? fmt(hi) : "—"}`;

  return (
    <div className={cn("w-full min-w-[96px]", className)} role="img" aria-label={label}>
      <div className="relative h-1.5 rounded-full bg-muted">
        <div className="absolute inset-y-0 rounded-full bg-ok/25" style={{ left: `${bandStart}%`, width: `${Math.max(bandEnd - bandStart, 1)}%` }} />
        <div
          className={cn(
            "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card",
            out ? "bg-warn" : status === "within_range" ? "bg-ok" : "bg-unverified",
          )}
          style={{ left: `${pct(v)}%` }}
        />
      </div>
      {showLabels && (
        <div className="relative mt-1 h-3.5 text-[10px] leading-none text-muted-foreground tabular-nums">
          {lo != null && (
            <span className="absolute -translate-x-1/2" style={{ left: `${bandStart}%` }}>
              {fmt(lo)}
            </span>
          )}
          {hi != null && (
            <span className="absolute -translate-x-1/2" style={{ left: `${bandEnd}%` }}>
              {fmt(hi)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
