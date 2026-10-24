"use client";

import { AlertOctagon, CircleDashed, Info, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { formatDate } from "@/lib/format";
import { hasKey, useI18n, type TKey } from "@/lib/i18n";
import type { SafetyFinding, Severity } from "@/lib/types";
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

/** One finding, written to answer: what is it, why does it matter, which medicines, what do I do. */
export function FindingCard({ f }: { f: SafetyFinding }) {
  const { t } = useI18n();
  const ev = f.evidence;
  return (
    <article
      className={cn("surface space-y-3 p-4", f.severity === "critical" && "border-danger/60", f.severity === "high" && "border-danger/30")}
      aria-label={f.title}
    >
      <header className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={f.severity} />
        {f.status === "needs_confirmation" && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{t("ms.fstatus.needs_confirmation")}</span>
        )}
      </header>
      <h3 className="text-base font-semibold">{f.title}</h3>
      <div className="flex flex-wrap gap-1.5">
        {f.medicines.map((m) => (
          <span key={m.id} className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
            {m.label}
          </span>
        ))}
      </div>
      <p className="text-sm leading-relaxed">{f.explanation}</p>
      {ev?.computed_daily_mg != null && ev.limit_mg != null && (
        <p className="text-sm font-medium">{t("ms.f.daily", { total: ev.computed_daily_mg.toLocaleString(), limit: ev.limit_mg.toLocaleString() })}</p>
      )}
      <div className="rounded-lg bg-brand-50/70 px-3 py-2 text-sm">
        <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">{t("ms.f.next")}</p>
        <p className="mt-0.5">{t(`ms.next.${f.next_step}` as TKey)}</p>
      </div>
      {ev && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium hover:text-foreground">{t("ms.f.source")}</summary>
          <div className="mt-1.5 space-y-0.5">
            <p>
              {t("ms.f.rule", { id: ev.rule_id })} · {hasKey(`ms.f.review.${ev.review_status}`) ? t(`ms.f.review.${ev.review_status}` as TKey) : ev.review_status} ·{" "}
              {t("ms.f.curated", { date: formatDate(ev.curated_on) ?? ev.curated_on })}
            </p>
            <p>{ev.source.citation}</p>
          </div>
        </details>
      )}
    </article>
  );
}
