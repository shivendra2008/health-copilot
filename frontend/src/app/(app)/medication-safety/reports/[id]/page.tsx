"use client";

import { ArrowLeft, ExternalLink, Loader2, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { SafetyDisclaimer, SeverityBadge } from "@/components/app/med-safety";
import { Segmented } from "@/components/app/segmented";
import { ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { hasKey, LANG_LABELS, useI18n, type TKey } from "@/lib/i18n";
import type { ExplainResult, Lang, SafetyFinding, SafetyReport, Severity } from "@/lib/types";
import { cn } from "@/lib/utils";

const BASE = "/api/v1/medication-safety";
const SEVERITIES: Severity[] = ["critical", "high", "moderate", "low", "info"];
const LANGS: Lang[] = ["en", "hi", "mr", "te"];

function Finding({ f }: { f: SafetyFinding }) {
  const { t } = useI18n();
  const ev = f.evidence;
  return (
    <article
      className={cn("surface space-y-3 p-4", f.severity === "critical" && "border-danger/60", f.severity === "high" && "border-danger/30")}
      aria-label={f.title}
    >
      <header className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={f.severity} />
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{t(`ms.fstatus.${f.status}` as TKey)}</span>
      </header>
      <h3 className="text-base font-semibold">{f.title}</h3>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("ms.f.why")}</dt>
          <dd className="mt-0.5">{f.explanation}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("ms.f.medicines")}</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {f.medicines.map((m) => (
              <span key={m.id} className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                {m.label}
              </span>
            ))}
          </dd>
        </div>
        {ev && (
          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("ms.f.evidence")}</dt>
            <dd className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
              <p>
                {t("ms.f.rule", { id: ev.rule_id })} · {hasKey(`ms.f.review.${ev.review_status}`) ? t(`ms.f.review.${ev.review_status}` as TKey) : ev.review_status} ·{" "}
                {t("ms.f.curated", { date: formatDate(ev.curated_on) ?? ev.curated_on })}
              </p>
              <p>{ev.source.citation}</p>
              {ev.computed_daily_mg != null && ev.limit_mg != null && <p className="font-medium text-foreground">{t("ms.f.daily", { total: ev.computed_daily_mg, limit: ev.limit_mg })}</p>}
            </dd>
          </div>
        )}
        <div className="rounded-lg bg-brand-50/70 px-3 py-2">
          <dt className="text-xs font-semibold tracking-wide text-brand-700 uppercase">{t("ms.f.next")}</dt>
          <dd className="mt-0.5">{t(`ms.next.${f.next_step}` as TKey)}</dd>
        </div>
      </dl>
    </article>
  );
}

function Explain({ report }: { report: SafetyReport }) {
  const { t, lang } = useI18n();
  const [target, setTarget] = useState<Lang>(lang);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<ExplainResult | null>(null);

  async function run() {
    setBusy(true);
    try {
      setOut(await api<ExplainResult>(`${BASE}/reports/${report.id}/explain`, { method: "POST", json: { language: target } }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface space-y-3 p-5" aria-labelledby="ms-explain">
      <h2 id="ms-explain" className="flex items-center gap-2 text-sm font-semibold">
        <Sparkles className="size-4 text-brand-600" /> {t("ms.explain.title")}
      </h2>
      <p className="text-xs text-muted-foreground">{t("ms.explain.hint")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Lang> size="sm" label={t("ms.explain.title")} value={target} onChange={(l) => { setTarget(l); setOut(null); }} options={LANGS.map((l) => ({ value: l, label: LANG_LABELS[l] }))} />
        <Button size="sm" onClick={run} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {t("ms.explain.button")}
        </Button>
      </div>
      {out && (
        <div aria-live="polite" className="space-y-2">
          <p className="rounded-lg bg-muted/60 px-4 py-3 text-sm leading-relaxed whitespace-pre-line">{out.content}</p>
          <p className="text-xs text-muted-foreground">{t(out.generated_by === "assistant" ? "ms.explain.byAssistant" : "ms.explain.plain")}</p>
        </div>
      )}
    </section>
  );
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const router = useRouter();
  const { data: r, error, mutate } = useSWR<SafetyReport>(`${BASE}/reports/${id}`);

  async function remove() {
    if (!window.confirm(t("ms.rep.deleteConfirm"))) return;
    try {
      await api(`${BASE}/reports/${id}`, { method: "DELETE" });
      router.replace("/medication-safety");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const back = (
    <Link href="/medication-safety" className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3.5" /> {t("ms.back")}
    </Link>
  );
  if (error) return <>{back}<ErrorState error={error} onRetry={() => mutate()} /></>;
  if (!r) return <>{back}<ListSkeleton rows={4} /></>;

  const docId = r.document_id;
  return (
    <>
      {back}
      <PageHeader
        title={t("ms.rep.title")}
        subtitle={`${t(r.source_type === "document" ? "ms.rep.sourceDoc" : "ms.rep.sourceCurrent")} · ${formatDateTime(r.created_at)}`}
        actions={
          <>
            {docId && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/records/${docId}`}>
                  <ExternalLink /> {t("ms.rx.source")}
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={remove}>
              <Trash2 /> {t("ms.rep.delete")}
            </Button>
          </>
        }
      />
      <SafetyDisclaimer className="mb-4" />
      <p className="mb-6 text-xs text-muted-foreground">
        {t("ms.rep.versions", { r: r.ruleset_version, c: r.catalogue_version })} · {r.ruleset_label}
      </p>

      <div className="space-y-8">
        <section aria-labelledby="ms-findings" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="ms-findings" className="text-base font-semibold">
              {t("ms.rep.findings")}
            </h2>
            {SEVERITIES.filter((s) => r.summary.by_severity[s]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <SeverityBadge severity={s} />
                <span className="text-xs tabular-nums text-muted-foreground">×{r.summary.by_severity[s]}</span>
              </span>
            ))}
          </div>
          {r.findings.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-5 text-sm">{t("ms.rep.noFindings")}</p>
          ) : (
            r.findings.map((f) => <Finding key={f.id} f={f} />)
          )}
        </section>

        {r.unresolved.length > 0 && (
          <section aria-labelledby="ms-unres" className="space-y-2">
            <h2 id="ms-unres" className="text-sm font-semibold">
              {t("ms.rep.unresolved")}
            </h2>
            <ul className="space-y-1.5 text-sm">
              {r.unresolved.map((u) => (
                <li key={u.medicine.id} className="rounded-lg bg-warn-bg/50 px-3 py-2">
                  <span className="font-medium">{u.medicine.label}</span> ·{" "}
                  <span className="text-muted-foreground">{hasKey(`ms.reason.${u.reason}`) ? t(`ms.reason.${u.reason}` as TKey) : u.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {r.missing_information.length > 0 && (
          <section aria-labelledby="ms-missing" className="space-y-2">
            <h2 id="ms-missing" className="text-sm font-semibold">
              {t("ms.rep.missing")}
            </h2>
            <ul className="space-y-1.5 text-sm">
              {r.missing_information.map((m, i) => (
                <li key={i} className="rounded-lg bg-muted/60 px-3 py-2">
                  {m.medicine && <span className="font-medium">{m.medicine.label}: </span>}
                  {m.missing.map((k) => (hasKey(`ms.missing.${k}`) ? t(`ms.missing.${k}` as TKey) : k)).join(", ")}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="ms-checked" className="space-y-2">
          <h2 id="ms-checked" className="text-sm font-semibold">
            {t("ms.rep.checked")}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {r.medication_snapshot.map((m) => (
              <li key={m.id} className="surface px-3 py-2 text-sm">
                <p className="font-medium">
                  {m.name}
                  {m.strength ? <span className="ml-1.5 font-normal text-muted-foreground">{m.strength}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">{[m.dosage, m.frequency].filter(Boolean).join(" · ")}</p>
                {m.document_id && (
                  <Link href={`/records/${m.document_id}`} className="text-xs font-medium text-brand-700 hover:underline">
                    {t("ms.rx.source")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>

        <Explain report={r} />

        <section aria-labelledby="ms-limits" className="space-y-2">
          <h2 id="ms-limits" className="text-sm font-semibold">
            {t("ms.rep.limits")}
          </h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {r.limitations.map((k) => (
              <li key={k}>{hasKey(`ms.lim.${k}`) ? t(`ms.lim.${k}` as TKey) : k}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{r.catalogue_label}</p>
        </section>
      </div>
    </>
  );
}
