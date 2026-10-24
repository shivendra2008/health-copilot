"use client";

import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDashed, Info, Loader2, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { useI18n, type TKey } from "@/lib/i18n";
import type { Severity } from "@/lib/types";
import { cn } from "@/lib/utils";

const pill = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

/** Severity is always conveyed by an icon AND a word, never by colour alone. */
export function SeverityBadge({ severity }: { severity: Severity }) {
  const { t } = useI18n();
  const map: Record<Severity, { cls: string; icon: React.ReactNode }> = {
    critical: { cls: "bg-danger text-white", icon: <AlertOctagon className="size-3" /> },
    high: { cls: "bg-danger-bg text-danger border border-danger/30", icon: <ShieldAlert className="size-3" /> },
    moderate: { cls: "bg-warn-bg text-warn border border-warn/30", icon: <TriangleAlert className="size-3" /> },
    low: { cls: "bg-brand-50 text-brand-700", icon: <Info className="size-3" /> },
    info: { cls: "bg-unverified-bg text-unverified border border-dashed border-unverified/40", icon: <CircleDashed className="size-3" /> },
  };
  const m = map[severity];
  return (
    <span className={cn(pill, m.cls)}>
      {m.icon}
      {t(`ms.sev.${severity}` as TKey)}
    </span>
  );
}

export type CheckState = "notChecked" | "needsConfirmation" | "checking" | "ready" | "failed";

export function CheckStateBadge({ state }: { state: CheckState }) {
  const { t } = useI18n();
  const map: Record<CheckState, { cls: string; icon: React.ReactNode; key: TKey }> = {
    notChecked: { cls: "bg-muted text-muted-foreground", icon: <CircleDashed className="size-3" />, key: "ms.state.notChecked" },
    needsConfirmation: { cls: "bg-warn-bg text-warn", icon: <AlertTriangle className="size-3" />, key: "ms.state.needsConfirmation" },
    checking: { cls: "bg-brand-50 text-brand-700", icon: <Loader2 className="size-3 animate-spin" />, key: "ms.state.checking" },
    ready: { cls: "bg-ok-bg text-ok", icon: <CheckCircle2 className="size-3" />, key: "ms.state.ready" },
    failed: { cls: "bg-danger-bg text-danger", icon: <AlertTriangle className="size-3" />, key: "ms.state.failed" },
  };
  const m = map[state];
  return (
    <span className={cn(pill, m.cls)} role="status">
      {m.icon}
      {t(m.key)}
    </span>
  );
}

export function SafetyDisclaimer({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <div className={cn("space-y-1.5 rounded-xl border border-warn/30 bg-warn-bg/60 px-4 py-3 text-xs leading-relaxed", className)}>
      <p className="flex items-start gap-2 font-medium text-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        {t("ms.disclaimer")}
      </p>
      <p className="pl-5.5 text-muted-foreground">{t("ms.demoNotice")}</p>
    </div>
  );
}
