"use client";

import { ArrowLeft, Bot, Calculator, ClipboardCheck, FileText, Loader2, Pencil, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { CorrectedBadge, InterpBadge, StatusBadge } from "@/components/app/badges";
import { DeleteDocumentButton } from "@/components/app/delete-dialog";
import { FailedPanel, ProcessingPanel } from "@/components/app/doc-states";
import { DocumentViewer } from "@/components/app/document-viewer";
import { Disclaimer, ErrorState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentPoll } from "@/hooks/use-document-poll";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, isProcessing } from "@/lib/format";
import { LANG_LABELS, useI18n } from "@/lib/i18n";
import type { Extraction, ExtractionHistoryItem, Lang, Summary } from "@/lib/types";

function SourceTag({ kind }: { kind: "source" | "derived" | "ai" }) {
  const m = {
    source: { icon: FileText, label: "From document", cls: "text-foreground bg-muted" },
    derived: { icon: Calculator, label: "Calculated", cls: "text-brand-700 bg-brand-50" },
    ai: { icon: Bot, label: "AI explanation", cls: "text-unverified bg-unverified-bg" },
  }[kind];
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase ${m.cls}`}>
      <Icon className="size-3" /> {m.label}
    </span>
  );
}

function SummaryPanel({ ex, docId, onUpdated }: { ex: Extraction; docId: string; onUpdated: (e: Extraction) => void }) {
  const { t, lang } = useI18n();
  const [view, setView] = useState<Lang>(lang);
  const [busy, setBusy] = useState(false);
  const summary: Summary | undefined = ex.summary?.[view];
  const outOfRange = ex.derived.filter((d) => d.status === "above_range" || d.status === "below_range");

  async function generate() {
    setBusy(true);
    try {
      const updated = await api<Extraction>(`/api/v1/documents/${docId}/summary`, { method: "POST", json: { language: view } });
      onUpdated(updated);
      toast.success("Summary generated");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-brand-600" /> {t("report.summary")}
        </h2>
        <div className="flex items-center gap-2">
          <select aria-label="Summary language" value={view} onChange={(e) => setView(e.target.value as Lang)} className="h-8 rounded-lg border bg-card px-2 text-xs">
            {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
              <option key={l} value={l}>
                {LANG_LABELS[l]}
                {ex.summary?.[l] ? "" : " (not generated)"}
              </option>
            ))}
          </select>
          <Button size="sm" variant={summary ? "outline" : "default"} onClick={generate} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : summary ? <RefreshCw /> : <Sparkles />}
            {summary ? "Regenerate" : t("report.generate")}
          </Button>
        </div>
      </div>
      <div className="space-y-5 p-4" lang={view}>
        {outOfRange.length > 0 && (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase">Outside printed reference range</h3>
              <SourceTag kind="derived" />
            </div>
            <ul className="space-y-1.5">
              {outOfRange.map((d) => (
                <li key={d.key} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{d.test_name}</span>
                  <span className="tabular-nums">
                    {d.value} {d.unit}
                  </span>
                  <span className="text-muted-foreground">(range {d.reference_range})</span>
                  <InterpBadge value={d.status} />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Compared by software against the range printed on this report. Being outside a range is not a diagnosis.
            </p>
          </div>
        )}

        {!summary ? (
          <p className="text-sm text-muted-foreground">
            {busy ? "Generating a plain-language summary from the extracted values…" : "No AI summary in this language yet. Generate one from the confirmed values."}
          </p>
        ) : (
          <>
            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase">What this document contains</h3>
                <SourceTag kind="ai" />
              </div>
              <p className="text-sm leading-relaxed">{summary.overview}</p>
            </div>
            {summary.key_findings.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase">Recorded findings</h3>
                  <SourceTag kind="ai" />
                </div>
                <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
                  {summary.key_findings.map((f, i) => (
                    <li key={i}>
                      {f.statement}
                      {f.related_item && <span className="ml-1 text-xs text-muted-foreground">— {f.related_item}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {summary.term_explanations.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase">Terms explained</h3>
                  <SourceTag kind="ai" />
                </div>
                <dl className="grid gap-2 sm:grid-cols-2">
                  {summary.term_explanations.map((x, i) => (
                    <div key={i} className="rounded-lg bg-muted/60 p-3">
                      <dt className="text-sm font-medium">{x.term}</dt>
                      <dd className="mt-0.5 text-sm text-muted-foreground">{x.explanation}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {summary.questions_for_clinician.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase">Questions you could ask your clinician</h3>
                  <SourceTag kind="ai" />
                </div>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {summary.questions_for_clinician.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Generated {formatDateTime(summary.generated_at)} by {summary.model} from the extracted values only.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const { data: doc, error, mutate: mutateDoc } = useDocumentPoll(id);
  const ready = doc && (doc.status === "needs_review" || doc.status === "confirmed");
  const { data: ex, error: exError, mutate: mutateEx } = useSWR<Extraction>(ready ? `/api/v1/documents/${id}/extraction` : null);
  const { data: history } = useSWR<ExtractionHistoryItem[]>(ready ? `/api/v1/documents/${id}/extractions` : null);

  if (error) return <ErrorState error={error} onRetry={() => mutateDoc()} />;
  if (!doc) return <ListSkeleton rows={6} />;

  const derived = new Map(ex?.derived.map((d) => [d.key, d.status]));
  const terms = new Map(
    Object.values(ex?.summary ?? {})
      .find((s) => s)
      ?.term_explanations.map((x) => [x.term.toLowerCase(), x.explanation]) ?? [],
  );
  const d = ex?.data;

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link href="/records" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> {t("nav.records")}
          </Link>
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{doc.file_name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(`doctype.${doc.doc_type}`)} · {formatDate(doc.document_date) ?? t("common.unknownDate")}
            {doc.source_facility && ` · ${doc.source_facility}`}
            {doc.source_clinician && ` · ${doc.source_clinician}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={doc.status} />
          {ready && (
            <Button asChild variant={doc.status === "needs_review" ? "default" : "outline"} size="sm">
              <Link href={`/records/${id}/review`}>
                {doc.status === "needs_review" ? <ClipboardCheck /> : <Pencil />}
                {doc.status === "needs_review" ? t("review.title") : "Edit values"}
              </Link>
            </Button>
          )}
          <DeleteDocumentButton id={id} name={doc.file_name} variant="button" onDeleted={() => router.replace("/records")} />
        </div>
      </div>

      {isProcessing(doc.status) ? (
        <ProcessingPanel doc={doc} />
      ) : doc.status === "failed" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <FailedPanel doc={doc} onRetried={() => mutateDoc()} />
          <DocumentViewer id={id} className="h-[60vh]" />
        </div>
      ) : exError ? (
        <ErrorState error={exError} onRetry={() => mutateEx()} />
      ) : !ex || !d ? (
        <ListSkeleton rows={6} />
      ) : (
        <>
          {doc.status === "needs_review" && (
            <div className="mb-5 flex flex-col gap-2 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span>These values are not in your health record yet. Review and confirm them first.</span>
              <Button asChild size="sm">
                <Link href={`/records/${id}/review`}>{t("review.title")}</Link>
              </Button>
            </div>
          )}
          <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="xl:sticky xl:top-6 xl:h-[calc(100vh-7rem)]">
              <DocumentViewer id={id} className="h-[60vh] xl:h-full" />
            </div>
            <div className="min-w-0 space-y-6">
              <SummaryPanel ex={ex} docId={id} onUpdated={(e) => mutateEx(e, { revalidate: false })} />

              <Tabs defaultValue={d.lab_results.length ? "labs" : d.medications.length ? "meds" : "other"}>
                <TabsList>
                  <TabsTrigger value="labs">Lab results ({d.lab_results.length})</TabsTrigger>
                  <TabsTrigger value="meds">Medications ({d.medications.length})</TabsTrigger>
                  <TabsTrigger value="other">Other ({d.conditions.length + d.procedures.length + d.follow_ups.length + d.findings.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="labs" className="mt-3">
                  {d.lab_results.length === 0 ? (
                    <p className="surface p-6 text-center text-sm text-muted-foreground">No lab results in this document.</p>
                  ) : (
                    <div className="surface overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                          <tr>
                            <th className="px-4 py-2 font-medium">Test</th>
                            <th className="px-4 py-2 font-medium">Value</th>
                            <th className="px-4 py-2 font-medium">Reference range</th>
                            <th className="px-4 py-2 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {d.lab_results.map((r) => {
                            const expl = terms.get(r.test_name.toLowerCase());
                            return (
                              <tr key={r.key} className="align-top">
                                <td className="px-4 py-3">
                                  <div className="font-medium">{r.test_name}</div>
                                  {r.category && <div className="text-xs text-muted-foreground">{r.category}</div>}
                                  {expl && (
                                    <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                                      <Bot className="mr-1 inline size-3" />
                                      {expl}
                                    </p>
                                  )}
                                  {r.source_text && (
                                    <p className="mt-1 max-w-xs truncate font-mono text-[11px] text-muted-foreground" title={r.source_text}>
                                      “{r.source_text}”
                                    </p>
                                  )}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                                  <span className="font-medium">{r.value}</span> {r.unit}
                                  {r.flag && <span className="ml-1 text-xs text-muted-foreground">[{r.flag}]</span>}
                                  {r.user_corrected && (
                                    <div className="mt-1">
                                      <CorrectedBadge />
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums">{r.reference_range ?? "—"}</td>
                                <td className="px-4 py-3">
                                  <InterpBadge value={derived.get(r.key!) ?? "unverified"} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="meds" className="mt-3">
                  {d.medications.length === 0 ? (
                    <p className="surface p-6 text-center text-sm text-muted-foreground">No medications in this document.</p>
                  ) : (
                    <ul className="surface divide-y">
                      {d.medications.map((m) => (
                        <li key={m.key} className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{m.name}</span>
                            {m.strength && <span className="text-sm text-muted-foreground">{m.strength}</span>}
                            {m.user_corrected && <CorrectedBadge />}
                          </div>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {[m.dosage, m.frequency, m.duration, m.route, m.instructions].filter(Boolean).join(" · ") || "No dosage instructions documented"}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">Shown exactly as documented. Never change a medicine or dose without your clinician.</p>
                </TabsContent>

                <TabsContent value="other" className="mt-3 space-y-4">
                  {[
                    { title: "Diagnoses stated in the document", items: d.conditions.map((c) => ({ k: c.key, main: c.description, sub: c.status })) },
                    { title: "Procedures", items: d.procedures.map((p) => ({ k: p.key, main: p.name, sub: formatDate(p.date) })) },
                    { title: "Follow-up", items: d.follow_ups.map((f) => ({ k: f.key, main: f.instruction, sub: formatDate(f.date) })) },
                    { title: "Clinical observations", items: d.findings.map((f) => ({ k: f.key, main: f.text, sub: null })) },
                  ].map((g) =>
                    g.items.length ? (
                      <section key={g.title} className="surface">
                        <h3 className="border-b px-4 py-2.5 text-sm font-semibold">{g.title}</h3>
                        <ul className="divide-y">
                          {g.items.map((i) => (
                            <li key={i.k} className="px-4 py-2.5 text-sm">
                              {i.main}
                              {i.sub && <span className="ml-2 text-muted-foreground">{i.sub}</span>}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null,
                  )}
                  {d.conditions.length + d.procedures.length + d.follow_ups.length + d.findings.length === 0 && (
                    <p className="surface p-6 text-center text-sm text-muted-foreground">Nothing else was recorded in this document.</p>
                  )}
                </TabsContent>
              </Tabs>

              {history && history.length > 0 && (
                <section className="surface">
                  <h2 className="border-b px-4 py-3 text-sm font-semibold">{t("report.history")}</h2>
                  <ul className="divide-y text-sm">
                    {history.map((h) => (
                      <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                        <span>
                          Version {h.version} <span className="text-muted-foreground">· {h.model ?? "unknown model"}</span>
                        </span>
                        <span className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>Extracted {formatDateTime(h.created_at)}</span>
                          {h.corrected_at && <span>Corrected {formatDateTime(h.corrected_at)}</span>}
                          <span className="rounded bg-muted px-1.5 py-0.5 capitalize">{h.status.replace("_", " ")}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
                    The original AI output of every version is preserved. Values you edit are stored separately and marked “Edited”.
                  </p>
                </section>
              )}
              <Disclaimer />
            </div>
          </div>
        </>
      )}
    </>
  );
}
