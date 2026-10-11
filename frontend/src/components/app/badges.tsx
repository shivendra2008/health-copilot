"use client";

import { AlertCircle, ArrowDown, ArrowUp, CheckCircle2, CircleDashed, Clock, Loader2, Pencil } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { DocStatus, DocType, Interpretation } from "@/lib/types";
import { cn } from "@/lib/utils";

const pill = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export function StatusBadge({ status }: { status: DocStatus }) {
  const { t } = useI18n();
  const map: Record<DocStatus, { cls: string; icon: React.ReactNode }> = {
    uploaded: { cls: "bg-muted text-muted-foreground", icon: <Clock className="size-3" /> },
    extracting_text: { cls: "bg-brand-50 text-brand-700", icon: <Loader2 className="size-3 animate-spin" /> },
    analyzing: { cls: "bg-brand-50 text-brand-700", icon: <Loader2 className="size-3 animate-spin" /> },
    needs_review: { cls: "bg-warn-bg text-warn", icon: <AlertCircle className="size-3" /> },
    confirmed: { cls: "bg-ok-bg text-ok", icon: <CheckCircle2 className="size-3" /> },
    failed: { cls: "bg-danger-bg text-danger", icon: <AlertCircle className="size-3" /> },
  };
  const m = map[status];
  return (
    <span className={cn(pill, m.cls)}>
      {m.icon}
      {t(`status.${status}`)}
    </span>
  );
}

export function InterpBadge({ value, compact = false }: { value: Interpretation; compact?: boolean }) {
  const { t } = useI18n();
  const map: Record<Interpretation, { cls: string; icon: React.ReactNode }> = {
    within_range: { cls: "bg-ok-bg text-ok", icon: <CheckCircle2 className="size-3" /> },
    above_range: { cls: "bg-warn-bg text-warn", icon: <ArrowUp className="size-3" /> },
    below_range: { cls: "bg-warn-bg text-warn", icon: <ArrowDown className="size-3" /> },
    unverified: { cls: "bg-unverified-bg text-unverified border border-dashed border-unverified/40", icon: <CircleDashed className="size-3" /> },
  };
  const m = map[value];
  return (
    <span className={cn(pill, m.cls)} title={t(`interp.${value}`)}>
      {m.icon}
      {!compact && t(`interp.${value}`)}
    </span>
  );
}

export function CorrectedBadge() {
  return (
    <span className={cn(pill, "bg-secondary text-secondary-foreground")} title="Edited by you; original AI value preserved">
      <Pencil className="size-3" /> Edited
    </span>
  );
}

export function DocTypeLabel({ type }: { type: DocType }) {
  const { t } = useI18n();
  return <span>{t(`doctype.${type}`)}</span>;
}
