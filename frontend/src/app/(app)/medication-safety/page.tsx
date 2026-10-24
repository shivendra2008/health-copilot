"use client";

import { ChevronRight, ClipboardList, Loader2, Pill, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { SafetyDisclaimer, SeverityBadge } from "@/components/app/med-safety";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { ConfirmedMedication, DocumentMeta, Page, SafetyReport, SafetyReportListItem, Severity } from "@/lib/types";

const BASE = "/api/v1/medication-safety";
const SEVERITIES: Severity[] = ["critical", "high", "moderate", "low", "info"];

export default function MedicationSafetyPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const current = useSWR<{ items: ConfirmedMedication[] }>(`${BASE}/confirmed-medications?current_only=true`);
  const rx = useSWR<Page<DocumentMeta>>("/api/v1/documents?doc_type=prescription&status=confirmed&limit=50");
  const reports = useSWR<Page<SafetyReportListItem>>(`${BASE}/reports?limit=8`);

  async function checkCurrent() {
    setChecking(true);
    try {
      const r = await api<SafetyReport>(`${BASE}/check`, { method: "POST", json: { source_type: "current_list" } });
      router.push(`/medication-safety/reports/${r.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setChecking(false);
    }
  }

  const nCurrent = current.data?.items.length ?? 0;
  return (
    <>
      <PageHeader title={t("ms.title")} subtitle={t("ms.subtitle")} />
      <SafetyDisclaimer className="mb-6" />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface space-y-3 p-5" aria-labelledby="ms-current">
          <h2 id="ms-current" className="flex items-center gap-2 text-sm font-semibold">
            <Pill className="size-4 text-brand-600" /> {t("ms.hub.current")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("ms.hub.currentHint")}</p>
          {current.error ? (
            <ErrorState error={current.error} onRetry={() => current.mutate()} />
          ) : !current.data ? (
            <ListSkeleton rows={2} />
          ) : (
            <>
              <ul className="flex flex-wrap gap-1.5">
                {current.data.items.map((m) => (
                  <li key={m.id} className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                    {m.name}
                    {m.strength ? ` ${m.strength}` : ""}
                  </li>
                ))}
              </ul>
              {nCurrent === 0 && <p className="text-sm text-muted-foreground">{t("ms.cur.noneCurrent")}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild variant="outline" size="sm">
                  <Link href="/medication-safety/current">{t("ms.hub.manage")}</Link>
                </Button>
                <Button size="sm" disabled={nCurrent === 0 || checking} onClick={checkCurrent}>
                  {checking ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {t("ms.hub.checkCurrent")}
                </Button>
              </div>
            </>
          )}
        </section>

        <section className="surface space-y-3 p-5" aria-labelledby="ms-rx">
          <h2 id="ms-rx" className="flex items-center gap-2 text-sm font-semibold">
            <ClipboardList className="size-4 text-brand-600" /> {t("ms.hub.rx")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("ms.hub.rxHint")}</p>
          {rx.error ? (
            <ErrorState error={rx.error} onRetry={() => rx.mutate()} />
          ) : !rx.data ? (
            <ListSkeleton rows={2} />
          ) : rx.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("ms.hub.noRx")}</p>
          ) : (
            <ul className="divide-y">
              {rx.data.items.map((d) => (
                <li key={d.id}>
                  <Link href={`/medication-safety/prescription/${d.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-brand-700">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{d.file_name}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(d.document_date) ?? formatDate(d.created_at)}</span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-700">
                      {t("ms.hub.review")} <ChevronRight className="size-3.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-8" aria-labelledby="ms-reports">
        <h2 id="ms-reports" className="mb-3 text-sm font-semibold">
          {t("ms.hub.reports")}
        </h2>
        {reports.error ? (
          <ErrorState error={reports.error} onRetry={() => reports.mutate()} />
        ) : !reports.data ? (
          <ListSkeleton rows={2} />
        ) : reports.data.items.length === 0 ? (
          <EmptyState icon={<ShieldCheck />} title={t("ms.hub.noReports")} />
        ) : (
          <ul className="space-y-2">
            {reports.data.items.map((r) => (
              <li key={r.id}>
                <Link href={`/medication-safety/reports/${r.id}`} className="surface flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:border-brand-600/40">
                  <span className="font-medium">{t(r.source_type === "document" ? "ms.rep.sourceDoc" : "ms.rep.sourceCurrent")}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {SEVERITIES.filter((s) => r.summary.by_severity?.[s]).map((s) => (
                      <span key={s} className="inline-flex items-center gap-1">
                        <SeverityBadge severity={s} />
                        <span className="text-xs tabular-nums text-muted-foreground">×{r.summary.by_severity[s]}</span>
                      </span>
                    ))}
                    <span className="text-xs text-muted-foreground">{formatDateTime(r.created_at)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
