"use client";

import { AlertTriangle, Info, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingHint } from "./loaders";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("neu-inset flex flex-col items-center justify-center rounded-3xl! px-6 py-14 text-center", className)}>
      <div className="neu-sm mb-4 flex size-14 items-center justify-center rounded-full! text-brand-600 [&_svg]:size-6">{icon}</div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const { t } = useI18n();
  return (
    <div role="alert" className={cn("flex flex-col items-center rounded-2xl border border-danger/20 bg-danger-bg/60 px-6 py-8 text-center", className)}>
      <AlertTriangle className="mb-2 size-5 text-danger" />
      <p className="text-sm font-medium text-foreground">{t("state.loadFailed")}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw /> {t("common.retry")}
        </Button>
      )}
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div className="space-y-2" aria-busy="true" aria-label={t("common.loading")}>
      <LoadingHint className="py-3" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-2xl bg-muted" />
      ))}
    </div>
  );
}

export function Disclaimer({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <p className={cn("flex items-start gap-2 text-xs leading-relaxed text-muted-foreground", className)}>
      <Info className="mt-0.5 size-3.5 shrink-0" />
      {t("disclaimer.short")}
    </p>
  );
}

export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (o: number) => void }) {
  const { t } = useI18n();
  if (total <= limit) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
      <span>
        {t("state.range", { from: offset + 1, to: Math.min(offset + limit, total), total })}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
          {t("common.prev")}
        </Button>
        <Button variant="outline" size="sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
          {t("common.next")}
        </Button>
      </div>
    </div>
  );
}
