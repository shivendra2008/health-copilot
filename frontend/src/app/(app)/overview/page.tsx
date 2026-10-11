"use client";

import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileText,
  FlaskConical,
  MessageSquareText,
  Pencil,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import useSWR from "swr";
import { InterpBadge, StatusBadge } from "@/components/app/badges";
import { Disclaimer, EmptyState, ErrorState, PageHeader } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { formatDate, relativeTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Dashboard } from "@/lib/types";

const ACTIVITY: Record<string, { label: string; icon: React.ReactNode }> = {
  "document.uploaded": { label: "Document uploaded", icon: <Upload className="size-3.5" /> },
  "document.processed": { label: "Extraction ready for review", icon: <FileText className="size-3.5" /> },
  "extraction.corrected": { label: "Values corrected", icon: <Pencil className="size-3.5" /> },
  "extraction.confirmed": { label: "Results confirmed", icon: <CheckCircle2 className="size-3.5" /> },
  "document.process_failed": { label: "Processing failed", icon: <XCircle className="size-3.5" /> },
  "document.deleted": { label: "Document deleted", icon: <Trash2 className="size-3.5" /> },
};

function Stat({ label, value, href, tone }: { label: string; value: number; href: string; tone?: "warn" }) {
  return (
    <Link href={href} className="surface group flex flex-col gap-1 p-4 transition-colors hover:border-brand-600/40">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className={`text-2xl font-semibold tabular-nums ${tone === "warn" && value > 0 ? "text-warn" : ""}`}>{value}</span>
    </Link>
  );
}

export default function OverviewPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { data, error, isLoading, mutate } = useSWR<Dashboard>("/api/v1/dashboard", {
    refreshInterval: (d) => (d && d.stats.processing > 0 ? 4000 : 0),
  });
  const firstName = (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0];

  return (
    <>
      <PageHeader
        title={`${t("overview.welcome")}${firstName ? `, ${firstName}` : ""}`}
        subtitle={t("overview.subtitle")}
        actions={
          <Button asChild>
            <Link href="/upload">
              <Upload /> {t("common.upload")}
            </Link>
          </Button>
        }
      />

      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[84px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : data.stats.total_documents === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={t("overview.emptyTitle")}
          body={t("overview.emptyBody")}
          action={
            <Button asChild>
              <Link href="/upload">
                <Upload /> {t("common.upload")}
              </Link>
            </Button>
          }
          className="py-16"
        />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("overview.totalRecords")} value={data.stats.total_documents} href="/records" />
            <Stat label={t("overview.confirmed")} value={data.stats.confirmed_documents} href="/records" />
            <Stat label={t("overview.pending")} value={data.stats.pending_review} href="/records" tone="warn" />
            <Stat label={t("overview.outOfRange")} value={data.stats.out_of_range} href="/lab-results" tone="warn" />
          </div>

          {(data.stats.pending_review > 0 || data.stats.processing > 0 || data.stats.failed > 0) && (
            <div className="surface flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 text-sm">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-warn" />
                <span>
                  {data.stats.pending_review > 0 && <>{data.stats.pending_review} document(s) waiting for your review. </>}
                  {data.stats.processing > 0 && <>{data.stats.processing} processing. </>}
                  {data.stats.failed > 0 && <>{data.stats.failed} failed and can be retried.</>}
                </span>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/records">
                  {t("records.title")} <ArrowRight />
                </Link>
              </Button>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <section className="surface">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-sm font-semibold">{t("overview.recentDocs")}</h2>
                <Link href="/records" className="text-xs font-medium text-brand-600 hover:underline">
                  {t("common.viewAll")}
                </Link>
              </div>
              <ul className="divide-y">
                {data.recent_documents.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={d.status === "needs_review" ? `/records/${d.id}/review` : `/records/${d.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                        <FileText className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.file_name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {t(`doctype.${d.doc_type}`)} · {formatDate(d.document_date) ?? `Uploaded ${formatDate(d.created_at)}`}
                          {d.source_facility ? ` · ${d.source_facility}` : ""}
                        </span>
                      </span>
                      <StatusBadge status={d.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section className="surface">
              <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold">{t("overview.attention")}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("overview.attentionHint")}</p>
              </div>
              {data.attention.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No confirmed values outside their printed reference ranges.
                </p>
              ) : (
                <ul className="divide-y">
                  {data.attention.map((o) => (
                    <li key={o.id}>
                      <Link href={`/records/${o.document_id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{o.test_name}</span>
                          <span className="block text-xs text-muted-foreground">
                            <span className="font-medium text-foreground tabular-nums">
                              {o.value_text} {o.unit}
                            </span>{" "}
                            · ref {o.reference_range_text ?? "—"} · {formatDate(o.effective_date)}
                          </span>
                        </span>
                        <InterpBadge value={o.interpretation} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
            <section className="surface p-4">
              <h2 className="mb-3 text-sm font-semibold">{t("overview.quick")}</h2>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { href: "/records", icon: ClipboardList, label: t("nav.records"), meta: `${data.stats.total_documents}` },
                  { href: "/lab-results", icon: FlaskConical, label: t("nav.labs"), meta: `${data.stats.lab_results}` },
                  { href: "/timeline", icon: Activity, label: t("nav.timeline"), meta: "" },
                  { href: "/assistant", icon: MessageSquareText, label: t("nav.assistant"), meta: "" },
                ].map(({ href, icon: Icon, label, meta }) => (
                  <Link key={href} href={href} className="flex items-center gap-2 rounded-lg border p-3 text-sm font-medium hover:bg-muted/60">
                    <Icon className="size-4 text-brand-600" />
                    <span className="flex-1 truncate">{label}</span>
                    {meta && <span className="text-xs text-muted-foreground tabular-nums">{meta}</span>}
                  </Link>
                ))}
              </div>
            </section>

            <section className="surface">
              <h2 className="border-b px-4 py-3 text-sm font-semibold">{t("overview.activity")}</h2>
              {data.activity.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <ul className="divide-y">
                  {data.activity.map((a, i) => {
                    const m = ACTIVITY[a.action] ?? { label: a.action, icon: <Activity className="size-3.5" /> };
                    return (
                      <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <span className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground">{m.icon}</span>
                        <span className="flex-1">{m.label}</span>
                        <span className="text-xs text-muted-foreground">{relativeTime(a.created_at)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
          <Disclaimer />
        </div>
      )}
    </>
  );
}
