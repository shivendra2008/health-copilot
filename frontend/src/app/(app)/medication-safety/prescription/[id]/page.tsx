"use client";

import { ArrowLeft, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { MedCard, needsAttention } from "@/components/app/med-editor";
import { CheckStateBadge, SafetyDisclaimer, type CheckState } from "@/components/app/med-safety";
import { ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { ConfirmedMedication, DocumentMeta, Page, SafetyReport, SafetyReportListItem } from "@/lib/types";

const BASE = "/api/v1/medication-safety";

export default function PrescriptionCheckPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const router = useRouter();
  const [includeCurrent, setIncludeCurrent] = useState(false);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const doc = useSWR<DocumentMeta>(`/api/v1/documents/${id}`);
  const confirmed = doc.data?.status === "confirmed";
  // Copies the document's confirmed medicines into the editable list (idempotent). Current-use starts as "not sure".
  const seed = useSWR(confirmed ? ["seed", id] : null, () => api(`${BASE}/confirmed-medications/from-document/${id}`, { method: "POST" }), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
  });
  const list = useSWR<{ items: ConfirmedMedication[] }>(seed.data ? `${BASE}/confirmed-medications?document_id=${id}` : null);
  const reports = useSWR<Page<SafetyReportListItem> & { items: (SafetyReportListItem & { created_at: string })[] }>(
    `${BASE}/reports?document_id=${id}&limit=1`,
  );

  const meds = list.data?.items ?? [];
  const attention = meds.filter(needsAttention).length;
  const latest = reports.data?.items[0];
  const newestEdit = meds.reduce((a, m) => (m.updated_at > a ? m.updated_at : a), "");
  const state: CheckState = checking
    ? "checking"
    : failure
      ? "failed"
      : attention > 0
        ? "needsConfirmation"
        : latest && latest.created_at >= newestEdit
          ? "ready"
          : "notChecked";

  async function runCheck() {
    setChecking(true);
    setFailure(null);
    try {
      const r = await api<SafetyReport>(`${BASE}/check`, {
        method: "POST",
        json: { source_type: "document", document_id: id, include_current: includeCurrent },
      });
      router.push(`/medication-safety/reports/${r.id}`);
    } catch (e) {
      setFailure(e);
      setChecking(false);
    }
  }

  const loadError = doc.error ?? seed.error ?? list.error;
  return (
    <>
      <Link href="/medication-safety" className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> {t("ms.back")}
      </Link>
      <PageHeader
        title={t("ms.rx.title")}
        subtitle={doc.data?.file_name}
        actions={
          <>
            <CheckStateBadge state={state} />
            <Button asChild variant="outline" size="sm">
              <Link href={`/records/${id}`}>
                <ExternalLink /> {t("ms.rx.source")}
              </Link>
            </Button>
          </>
        }
      />
      <SafetyDisclaimer className="mb-6" />

      {loadError ? (
        <ErrorState error={loadError} onRetry={() => { doc.mutate(); seed.mutate(); list.mutate(); }} />
      ) : !doc.data ? (
        <ListSkeleton rows={3} />
      ) : !confirmed ? (
        <div className="flex flex-col gap-3 rounded-xl border border-warn/30 bg-warn-bg/70 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span>{t("ms.rx.notConfirmed")}</span>
          <Button asChild size="sm">
            <Link href={`/records/${id}/review`}>{t("ms.rx.reviewLink")}</Link>
          </Button>
        </div>
      ) : !list.data ? (
        <ListSkeleton rows={3} />
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">{t("ms.rx.intro")}</p>
          {attention > 0 && (
            <p role="status" className="rounded-lg border border-warn/30 bg-warn-bg/60 px-4 py-2.5 text-sm">
              {t("ms.rx.needsAttention", { n: attention })}
            </p>
          )}
          <div className="space-y-4">
            {meds.map((m) => (
              <MedCard key={`${m.id}:${m.updated_at}`} med={m} onChanged={() => list.mutate()} />
            ))}
          </div>

          <div className="surface flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-2.5 text-sm">
              <Switch checked={includeCurrent} onCheckedChange={setIncludeCurrent} />
              {t("ms.rx.includeCurrent")}
            </label>
            <div className="flex flex-wrap items-center gap-3">
              {latest && (
                <Link href={`/medication-safety/reports/${latest.id}`} className="text-xs font-medium text-brand-700 hover:underline">
                  {t("ms.rx.lastReport")} · {formatDateTime(latest.created_at)}
                </Link>
              )}
              <Button onClick={runCheck} disabled={checking || meds.length === 0}>
                {checking ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {t("ms.check")}
              </Button>
            </div>
          </div>
          {failure != null && <ErrorState error={failure} onRetry={runCheck} />}
        </div>
      )}
    </>
  );
}
