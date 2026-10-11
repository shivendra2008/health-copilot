"use client";

import { ArrowDown, ArrowUp, CheckCircle2, CircleDashed } from "lucide-react";
import { tr, useI18n } from "@/lib/i18n";
import type { Interpretation } from "@/lib/types";
import { cn } from "@/lib/utils";

const decimals = (n: number | null | undefined) => (n == null ? 0 : (String(n).split(".")[1]?.length ?? 0));

/**
 * How far a value is outside the PRINTED range, e.g. "0.8 below the lower limit".
 * Derived arithmetic only — returns null when anything needed is missing.
 */
export function gapText(status: Interpretation, value: number | null, low: number | null, high: number | null, unit?: string | null) {
  if (value == null) return null;
  let gap: number | null = null;
  if (status === "above_range" && high != null) gap = value - high;
  else if (status === "below_range" && low != null) gap = low - value;
  if (gap == null || gap <= 0) return null;
  const dp = Math.min(2, Math.max(decimals(value), decimals(low), decimals(high)));
  // "0.2 % above" reads like a relative change; for % units the gap is in percentage points.
  const u = unit?.trim() === "%" ? ` ${tr("compare.points")}` : unit ? ` ${unit}` : "";
  return tr(status === "above_range" ? "compare.above" : "compare.below", { gap: `${gap.toFixed(dp)}${u}` });
}

/** Plain status: High / Low / In range / Not compared — always icon + text, never colour alone. */
export function StatusPill({ status, className }: { status: Interpretation; className?: string }) {
  const { t } = useI18n();
  const m = {
    above_range: { icon: ArrowUp, cls: "bg-warn-bg text-warn" },
    below_range: { icon: ArrowDown, cls: "bg-warn-bg text-warn" },
    within_range: { icon: CheckCircle2, cls: "bg-ok-bg text-ok" },
    unverified: { icon: CircleDashed, cls: "bg-unverified-bg text-unverified" },
  }[status];
  const Icon = m.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", m.cls, className)}>
      <Icon className="size-3.5" />
      {t(`interp.short.${status}`)}
    </span>
  );
}

/** "Yours" vs "Expected" side by side. Expected is shown exactly as printed on the report. */
export function YoursVsExpected({
  value,
  unit,
  expected,
  status,
  size = "md",
}: {
  value: string;
  unit: string | null;
  expected: string | null;
  status: Interpretation;
  size?: "md" | "lg";
}) {
  const { t } = useI18n();
  const out = status === "above_range" || status === "below_range";
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
      <div className={cn("bg-card px-3 py-2", out && "bg-warn-bg/50")}>
        <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{t("compare.yours")}</p>
        <p className={cn("mt-0.5 font-semibold tabular-nums", size === "lg" ? "text-2xl" : "text-base", out && "text-warn")}>
          {value}
          {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
        </p>
      </div>
      <div className="bg-card px-3 py-2">
        <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{t("compare.expected")}</p>
        <p className={cn("mt-0.5 font-medium tabular-nums", size === "lg" ? "text-lg" : "text-sm", !expected && "text-muted-foreground")}>
          {expected ?? t("compare.notPrinted")}
          {expected && unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
        </p>
      </div>
    </div>
  );
}
