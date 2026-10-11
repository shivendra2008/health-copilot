"use client";

import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Eye,
  FileText,
  FlaskConical,
  HeartPulse,
  Info,
  Loader2,
  Pencil,
  Pill,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Syringe,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { CorrectedBadge, StatusBadge } from "@/components/app/badges";
import { gapText, StatusPill, YoursVsExpected } from "@/components/app/comparison";
import { DeleteDocumentButton } from "@/components/app/delete-dialog";
import { DOC_ICON } from "@/components/app/doc-icon";
import { FailedPanel, ProcessingPanel } from "@/components/app/doc-states";
import { DocumentViewer } from "@/components/app/document-viewer";
import { RangeBar } from "@/components/app/range-bar";
import { Segmented } from "@/components/app/segmented";
import { SourcePanel } from "@/components/app/source-panel";
import { Disclaimer, ErrorState, ListSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentPoll } from "@/hooks/use-document-poll";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, isProcessing } from "@/lib/format";
import { LANG_LABELS, useI18n } from "@/lib/i18n";
import type { Derived, DocumentMeta, Extraction, ExtractionHistoryItem, LabResult, Lang, Summary } from "@/lib/types";
import { cn } from "@/lib/utils";


const isOut = (s?: string) => s === "above_range" || s === "below_range";

/** Find the AI's plain-language explanation for a test name (names vary: "Hb" vs "Hemoglobin (Hb)"). */
function termFor(terms: Summary["term_explanations"] | undefined, name: string): string | undefined {
  if (!terms?.length) return undefined;
  const n = name.toLowerCase().trim();
  const hit =
    terms.find((x) => x.term.toLowerCase().trim() === n) ??
    terms.find((x) => {
      const t = x.term.toLowerCase();
      return t.includes(n) || n.includes(t);
    });
  return hit?.explanation;
}

function SectionTitle({ icon: Icon, title, hint, action }: { icon: React.ComponentType<{ className?: string }>; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Icon className="size-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ----------------------------------------------------------------------------- header */

function ReportHeader({
  doc,
  ex,
  onViewOriginal,
  onDeleted,
}: {
  doc: DocumentMeta;
  ex: Extraction | undefined;
  onViewOriginal: () => void;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const Icon = DOC_ICON[doc.doc_type];
  const ready = doc.status === "needs_review" || doc.status === "confirmed";
  const title = doc.source_facility ?? t(`doctype.${doc.doc_type}`);

  let stats: { label: string; value: number; tone?: "warn" }[] = [];
  let matched = 0;
  let aiCount = 0;
  let edited = 0;
  if (ex) {
    const d = ex.data;
    const outside = ex.derived.filter((x) => isOut(x.status)).length;
    stats = [
      { label: "Lab results", value: d.lab_results.length },
      { label: "Outside printed range", value: outside, tone: outside > 0 ? "warn" : undefined },
      { label: "Medicines", value: d.medications.length },
      { label: "Diagnoses stated", value: d.conditions.length },
    ];
    const sections = ["lab_results", "medications", "conditions", "procedures", "follow_ups", "findings"] as const;
    const items = sections.flatMap((sec) =>
      (d[sec] as { key?: string | null; user_corrected?: boolean; origin?: string }[]).map((i) => ({ sec, ...i })),
    );
    const unmatched = new Set(ex.issues.filter((i) => i.code === "source_not_found" || i.code === "value_not_in_source").map((i) => i.path));
    edited = items.filter((i) => i.user_corrected || i.origin === "user").length;
    const aiItems = items.filter((i) => !(i.user_corrected || i.origin === "user"));
    aiCount = aiItems.length;
    matched = aiItems.filter((i) => !unmatched.has(`${i.sec}.${i.key}`)).length;
  }

  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="flex min-w-0 gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Icon className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t(`doctype.${doc.doc_type}`)} · {formatDate(doc.document_date) ?? t("common.unknownDate")}
            </p>
            <h1 className="mt-1 truncate text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {doc.source_clinician ? `${doc.source_clinician} · ` : ""}
              {doc.file_name}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <StatusBadge status={doc.status} />
          <Button variant="outline" size="sm" onClick={onViewOriginal} className="xl:hidden">
            <Eye /> View original
          </Button>
          {ready && (
            <Button asChild variant={doc.status === "needs_review" ? "default" : "outline"} size="sm">
              <Link href={`/records/${doc.id}/review`}>
                {doc.status === "needs_review" ? <ClipboardCheck /> : <Pencil />}
                {doc.status === "needs_review" ? t("review.title") : "Edit values"}
              </Link>
            </Button>
          )}
          <DeleteDocumentButton id={doc.id} name={doc.file_name} onDeleted={onDeleted} />
        </div>
      </div>

      {stats.length > 0 && (
        <>
          <div className="grid grid-cols-2 border-t sm:grid-cols-4">
            {stats.map((s, i) => (
              <div key={s.label} className={cn("px-5 py-4 sm:px-6", i % 2 === 1 && "border-l", i >= 2 && "border-t sm:border-t-0", i >= 1 && "sm:border-l")}>
                <p className={cn("text-2xl font-semibold tabular-nums", s.tone === "warn" && "text-warn")}>{s.value}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
          {aiCount > 0 && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground sm:px-6">
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                <ShieldCheck className="size-3.5 text-ok" />
                {matched} of {aiCount} values matched to the document text
              </span>
              {edited > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Pencil className="size-3" /> {edited} edited by you
                </span>
              )}
              {ex?.status === "confirmed" && ex.confirmed_at && <span>Saved to your record {formatDate(ex.confirmed_at)}</span>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------------------- plain-language summary */

function PlainWords({
  ex,
  docId,
  view,
  setView,
  onUpdated,
}: {
  ex: Extraction;
  docId: string;
  view: Lang;
  setView: (l: Lang) => void;
  onUpdated: (e: Extraction) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<Lang | null>(null);
  const summary = ex.summary?.[view];

  async function generate(l: Lang) {
    setBusy(l);
    try {
      onUpdated(await api<Extraction>(`/api/v1/documents/${docId}/summary`, { method: "POST", json: { language: l } }));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  function choose(l: Lang) {
    setView(l);
    if (!ex.summary?.[l] && !busy) generate(l);
  }

  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-col gap-3 border-b bg-brand-50/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Sparkles className="size-4" />
          </span>
          <div>
            <h2 className="text-base font-semibold tracking-tight">In plain words</h2>
            <p className="text-xs text-muted-foreground">Written by AI from the values on this page. Not a diagnosis.</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Segmented
            label="Explanation language"
            size="sm"
            value={view}
            onChange={choose}
            options={(Object.keys(LANG_LABELS) as Lang[]).map((l) => ({ value: l, label: LANG_LABELS[l] }))}
          />
          {summary && (
            <Button size="icon-sm" variant="ghost" onClick={() => generate(view)} disabled={busy !== null} aria-label="Rewrite explanation" title="Rewrite">
              {busy === view ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            </Button>
          )}
        </div>
      </div>

      <div className="px-5 py-5 sm:px-6" lang={view} aria-live="polite">
        {!summary ? (
          busy === view ? (
            <div className="space-y-3" aria-busy="true">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Writing your explanation in {LANG_LABELS[view]}. This can take up to a minute.
              </p>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 py-2">
              <p className="text-sm text-muted-foreground">
                Get a short, plain-language explanation of this document in {LANG_LABELS[view]}.
              </p>
              <Button onClick={() => generate(view)} disabled={busy !== null}>
                <Sparkles /> {t("report.generate")}
              </Button>
            </div>
          )
        ) : (
          <div className="space-y-5">
            <p className="text-[15px] leading-7 text-foreground">{summary.overview}</p>
            {summary.key_findings.length > 0 && (
              <ul className="space-y-2.5">
                {summary.key_findings.map((f, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-6">
                    <CheckCircle2 className="mt-1 size-4 shrink-0 text-brand-600" />
                    <span>{f.statement}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground">
              {summary.model} · {formatDateTime(summary.generated_at)}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------------- results */

function OutsideRange({ items, terms }: { items: { r: LabResult; d: Derived }[]; terms?: Summary["term_explanations"] }) {
  if (!items.length) return null;
  return (
    <section>
      <SectionTitle
        icon={HeartPulse}
        title="Worth discussing with your doctor"
        hint="These values are outside the reference range printed on this report. That alone isn't a diagnosis."
      />
      <div className="grid gap-3 md:grid-cols-2">
        {items.map(({ r, d }) => {
          const expl = termFor(terms, r.test_name);
          return (
            <div key={r.key} className="surface flex flex-col gap-3 border-l-[3px] border-l-warn p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{r.test_name}</p>
                <StatusPill status={d.status} />
              </div>
              <YoursVsExpected value={r.value} unit={r.unit} expected={r.reference_range} status={d.status} size="lg" />
              {gapText(d.status, d.value_num, d.ref_low, d.ref_high, r.unit) && (
                <p className="text-sm font-medium text-warn">
                  {d.status === "above_range" ? "↑" : "↓"} {gapText(d.status, d.value_num, d.ref_low, d.ref_high, r.unit)}
                </p>
              )}
              <RangeBar value={d.value_num} low={d.ref_low} high={d.ref_high} status={d.status} unit={r.unit} />
              {expl && <p className="border-t pt-3 text-sm leading-6 text-muted-foreground">{expl}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ResultsList({ ex, terms }: { ex: Extraction; terms?: Summary["term_explanations"] }) {
  const { t } = useI18n();
  const derived = new Map(ex.derived.map((d) => [d.key, d]));
  const groups = new Map<string, LabResult[]>();
  ex.data.lab_results.forEach((r) => {
    const g = r.category?.trim() || "Results";
    groups.set(g, [...(groups.get(g) ?? []), r]);
  });
  if (!ex.data.lab_results.length) return null;
  return (
    <section>
      <SectionTitle icon={FlaskConical} title="All results" hint="Exactly as printed on the report, compared with its own reference range." />
      <div className="space-y-3">
        {[...groups.entries()].map(([group, rows]) => (
          <div key={group} className="surface overflow-hidden">
            <div className="flex items-center justify-between border-b bg-muted/30 px-5 py-2.5">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group}</h3>
              <span className="text-xs text-muted-foreground">{rows.length}</span>
            </div>
            <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,1fr)] gap-x-4 border-b px-5 py-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase sm:grid">
              <span>Test</span>
              <span>{t("compare.yours")}</span>
              <span>{t("compare.expected")}</span>
              <span className="text-right">Result</span>
            </div>
            <ul className="divide-y">
              {rows.map((r) => {
                const d = derived.get(r.key!);
                const expl = termFor(terms, r.test_name);
                const out = isOut(d?.status);
                const gap = d ? gapText(d.status, d.value_num, d.ref_low, d.ref_high, r.unit) : null;
                return (
                  <li key={r.key} className="grid gap-x-4 gap-y-2 px-5 py-4 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,1fr)] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{r.test_name}</p>
                        {r.user_corrected && <CorrectedBadge />}
                      </div>
                      {expl && (
                        <details className="group mt-1">
                          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-brand-600 hover:underline [&::-webkit-details-marker]:hidden">
                            <Info className="size-3" /> What is this?
                          </summary>
                          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{expl}</p>
                        </details>
                      )}
                    </div>
                    <div className="flex items-baseline gap-2 sm:block">
                      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase sm:hidden">{t("compare.yours")}</p>
                      <p className={cn("tabular-nums", out && "text-warn")}>
                        <span className="text-lg font-semibold">{r.value}</span>
                        {r.unit && <span className="ml-1 text-xs text-muted-foreground">{r.unit}</span>}
                      </p>
                    </div>
                    <div className="flex items-baseline gap-2 sm:block">
                      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase sm:hidden">{t("compare.expected")}</p>
                      <p className="text-sm tabular-nums">
                        {r.reference_range ?? <span className="text-muted-foreground">Not printed</span>}
                        {r.reference_range && r.unit && <span className="ml-1 text-xs text-muted-foreground">{r.unit}</span>}
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-1 sm:items-end">
                      <StatusPill status={d?.status ?? "unverified"} />
                      {gap && <p className="text-[11px] text-warn sm:text-right">{gap}</p>}
                    </div>
                    {d && d.value_num != null && (d.ref_low != null || d.ref_high != null) && (
                      <RangeBar
                        className="sm:col-span-2 sm:col-start-2"
                        value={d.value_num}
                        low={d.ref_low}
                        high={d.ref_high}
                        status={d.status}
                        unit={r.unit}
                        showLabels={false}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Medicines({ ex }: { ex: Extraction }) {
  const meds = ex.data.medications;
  if (!meds.length) return null;
  return (
    <section>
      <SectionTitle icon={Pill} title="Medicines" hint="As written on the prescription. Never change a medicine or dose without your doctor." />
      <div className="grid gap-3 md:grid-cols-2">
        {meds.map((m) => (
          <div key={m.key} className="surface p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">
                {m.name}
                {m.strength && <span className="ml-1.5 font-normal text-muted-foreground">{m.strength}</span>}
              </p>
              {m.user_corrected && <CorrectedBadge />}
            </div>
            {[m.dosage, m.frequency, m.duration, m.route].some(Boolean) ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {[
                  ["Dose", m.dosage],
                  ["How often", m.frequency],
                  ["For", m.duration],
                  ["Route", m.route],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <span key={k} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
                      <span className="text-muted-foreground">{k}</span>
                      <span className="font-medium">{v}</span>
                    </span>
                  ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No dosage instructions written.</p>
            )}
            {m.instructions && <p className="mt-2 text-sm text-muted-foreground">{m.instructions}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

function AlsoInDocument({ ex }: { ex: Extraction }) {
  const d = ex.data;
  const groups = [
    { icon: Stethoscope, title: "Diagnoses stated", items: d.conditions.map((c) => ({ k: c.key, main: c.description, sub: c.status })) },
    { icon: Syringe, title: "Procedures", items: d.procedures.map((p) => ({ k: p.key, main: p.name, sub: formatDate(p.date) })) },
    { icon: CalendarClock, title: "Follow-up", items: d.follow_ups.map((f) => ({ k: f.key, main: f.instruction, sub: formatDate(f.date) })) },
    { icon: FileText, title: "Doctor's notes", items: d.findings.map((f) => ({ k: f.key, main: f.text, sub: null })) },
  ].filter((g) => g.items.length);
  if (!groups.length) return null;
  return (
    <section>
      <SectionTitle icon={ClipboardCheck} title="Also in this document" hint="Recorded exactly as written by the clinician." />
      <div className="grid gap-3 md:grid-cols-2">
        {groups.map(({ icon: Icon, title, items }) => (
          <div key={title} className="surface p-4">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <Icon className="size-3.5" /> {title}
            </p>
            <ul className="space-y-1.5">
              {items.map((i) => (
                <li key={i.k} className="text-sm leading-6">
                  {i.main}
                  {i.sub && <span className="ml-2 text-xs text-muted-foreground">{i.sub}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function DoctorQuestions({ summary, view }: { summary?: Summary; view: Lang }) {
  if (!summary?.questions_for_clinician.length) return null;
  const qs = summary.questions_for_clinician;
  return (
    <section className="surface p-5 sm:p-6" lang={view}>
      <SectionTitle
        icon={Stethoscope}
        title="Questions to ask your doctor"
        hint="Suggested by AI to help you prepare for your next visit."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(qs.map((q, i) => `${i + 1}. ${q}`).join("\n"));
                toast.success("Questions copied");
              } catch {
                toast.error("Couldn't copy. Select the text instead.");
              }
            }}
          >
            <Copy /> Copy
          </Button>
        }
      />
      <ol className="space-y-2">
        {qs.map((q, i) => (
          <li key={i} className="flex gap-3 rounded-lg bg-muted/50 px-3.5 py-2.5 text-sm leading-6">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-card text-xs font-semibold text-brand-700 ring-1 ring-border">
              {i + 1}
            </span>
            <span>{q}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Glossary({ summary, ex, view }: { summary?: Summary; ex: Extraction; view: Lang }) {
  if (!summary) return null;
  const used = new Set(ex.data.lab_results.map((r) => termFor(summary.term_explanations, r.test_name)).filter(Boolean));
  const rest = summary.term_explanations.filter((x) => !used.has(x.explanation));
  if (!rest.length) return null;
  return (
    <section className="surface p-5 sm:p-6" lang={view}>
      <SectionTitle icon={Info} title="Medical terms explained" />
      <dl className="divide-y">
        {rest.map((x) => (
          <div key={x.term} className="py-3 first:pt-0 last:pb-0">
            <dt className="text-sm font-medium">{x.term}</dt>
            <dd className="mt-0.5 text-sm leading-6 text-muted-foreground">{x.explanation}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ----------------------------------------------------------------------------- side rail */

function RecordDetails({ doc, ex, history }: { doc: DocumentMeta; ex: Extraction; history?: ExtractionHistoryItem[] }) {
  return (
    <section className="surface p-4 text-sm">
      <h3 className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">About this record</h3>
      <dl className="space-y-2">
        {[
          ["Read using", doc.text_method === "native" ? "Digital PDF text" : doc.text_method === "ocr" ? "OCR (scanned)" : doc.text_method ? "Digital text + OCR" : "—"],
          ...(doc.ocr_confidence != null ? [["OCR confidence", `${Math.round(doc.ocr_confidence * 100)}%`]] : []),
          ["Pages", String(doc.page_count ?? 1)],
          ["Extracted by", ex.model ?? "—"],
          ["Uploaded", formatDate(doc.created_at) ?? "—"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="truncate text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {history && history.length > 0 && (
        <details className="mt-4 border-t pt-3">
          <summary className="cursor-pointer text-xs font-medium text-brand-600">Version history ({history.length})</summary>
          <ul className="mt-2 space-y-1.5 text-xs">
            {history.map((h) => (
              <li key={h.id} className="flex justify-between gap-2">
                <span>
                  v{h.version} · {formatDateTime(h.created_at)}
                </span>
                <span className="capitalize text-muted-foreground">{h.status.replace("_", " ")}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">The original AI output of every version is kept. Your edits are stored separately.</p>
        </details>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------------------- page */

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t, lang } = useI18n();
  const [view, setView] = useState<Lang>(lang);
  const [showOriginal, setShowOriginal] = useState(false);
  const { data: doc, error, mutate: mutateDoc } = useDocumentPoll(id);
  const ready = doc && (doc.status === "needs_review" || doc.status === "confirmed");
  const { data: ex, error: exError, mutate: mutateEx } = useSWR<Extraction>(ready ? `/api/v1/documents/${id}/extraction` : null);
  const { data: history } = useSWR<ExtractionHistoryItem[]>(ready ? `/api/v1/documents/${id}/extractions` : null);

  if (error) return <ErrorState error={error} onRetry={() => mutateDoc()} />;
  if (!doc) return <ListSkeleton rows={6} />;

  const summary = ex?.summary?.[view] ?? undefined;
  const terms = summary?.term_explanations ?? Object.values(ex?.summary ?? {}).find(Boolean)?.term_explanations;
  const derived = new Map(ex?.derived.map((d) => [d.key, d]));
  const outside = (ex?.data.lab_results ?? [])
    .map((r) => ({ r, d: derived.get(r.key!)! }))
    .filter((x) => x.d && isOut(x.d.status));

  return (
    <>
      <Link href="/records" className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> {t("nav.records")}
      </Link>

      <div className="space-y-6">
        <ReportHeader doc={doc} ex={ex} onViewOriginal={() => setShowOriginal(true)} onDeleted={() => router.replace("/records")} />

        {isProcessing(doc.status) ? (
          <ProcessingPanel doc={doc} />
        ) : doc.status === "failed" ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <FailedPanel doc={doc} onRetried={() => mutateDoc()} />
            <DocumentViewer id={id} className="h-[60vh]" />
          </div>
        ) : exError ? (
          <ErrorState error={exError} onRetry={() => mutateEx()} />
        ) : !ex ? (
          <ListSkeleton rows={6} />
        ) : (
          <>
            {doc.status === "needs_review" && (
              <div className="flex flex-col gap-3 rounded-xl border border-warn/30 bg-warn-bg/70 px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <strong className="font-semibold">Not saved to your record yet.</strong> Check the values against the original, then confirm.
                </span>
                <Button asChild size="sm">
                  <Link href={`/records/${id}/review`}>
                    <ClipboardCheck /> {t("review.title")}
                  </Link>
                </Button>
              </div>
            )}

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0 space-y-8">
                <PlainWords ex={ex} docId={id} view={view} setView={setView} onUpdated={(e) => mutateEx(e, { revalidate: false })} />
                <OutsideRange items={outside} terms={terms} />
                <ResultsList ex={ex} terms={terms} />
                <Medicines ex={ex} />
                <AlsoInDocument ex={ex} />
                <DoctorQuestions summary={summary} view={view} />
                <Glossary summary={summary} ex={ex} view={view} />
                <div className="xl:hidden">
                  <RecordDetails doc={doc} ex={ex} history={history} />
                </div>
                <Disclaimer />
              </div>

              <aside className="hidden xl:block">
                <div className="sticky top-6 space-y-4">
                  <div className="surface overflow-hidden">
                    <div className="flex items-center justify-between border-b px-4 py-2.5">
                      <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Original document</span>
                      <Button variant="ghost" size="xs" onClick={() => setShowOriginal(true)}>
                        <Eye /> Expand
                      </Button>
                    </div>
                    <DocumentViewer id={id} bare className="h-[420px]" />
                  </div>
                  <RecordDetails doc={doc} ex={ex} history={history} />
                </div>
              </aside>
            </div>
          </>
        )}
      </div>

      <Sheet open={showOriginal} onOpenChange={setShowOriginal}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl">
          <SheetTitle className="border-b px-5 py-3.5 text-sm">Original document</SheetTitle>
          <div className="min-h-0 flex-1 p-3">{showOriginal && <SourcePanel id={id} highlight={null} className="h-full" />}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
