"use client";

import { AlertCircle, AlertTriangle, ArrowLeft, Check, CheckCircle2, Info, Loader2, LocateFixed, Pencil, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { StatusBadge } from "@/components/app/badges";
import { StatusPill } from "@/components/app/comparison";
import { Segmented } from "@/components/app/segmented";
import { FailedPanel, ProcessingPanel } from "@/components/app/doc-states";
import { SourcePanel } from "@/components/app/source-panel";
import { Disclaimer, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDocumentPoll } from "@/hooks/use-document-poll";
import { api, errorMessage } from "@/lib/api";
import { formatDate, isProcessing } from "@/lib/format";
import { hasKey, useI18n, type TKey } from "@/lib/i18n";
import type { DocType, Extraction, ExtractionData, Issue } from "@/lib/types";
import { cn } from "@/lib/utils";

type SectionKey = "lab_results" | "medications" | "conditions" | "procedures" | "follow_ups" | "findings";
type Field = { name: string; label: TKey; required?: boolean; wide?: boolean; placeholder?: string };

const SECTIONS: { key: SectionKey; title: TKey; fields: Field[]; blank: Record<string, unknown> }[] = [
  {
    key: "lab_results",
    title: "rev.sec.labs",
    fields: [
      { name: "test_name", label: "rev.f.test", required: true, wide: true },
      { name: "value", label: "rev.f.value", required: true },
      { name: "unit", label: "rev.f.unit" },
      { name: "reference_range", label: "rev.f.range" },
      { name: "flag", label: "rev.f.flag" },
      { name: "category", label: "rev.f.panel", wide: true },
    ],
    blank: { test_name: "", value: "", unit: null, reference_range: null, flag: null, category: null, source_text: "", confidence: "high" },
  },
  {
    key: "medications",
    title: "rev.sec.meds",
    fields: [
      { name: "name", label: "rev.f.medicine", required: true, wide: true },
      { name: "strength", label: "rev.f.strength" },
      { name: "dosage", label: "rev.f.dosage" },
      { name: "frequency", label: "rev.f.frequency" },
      { name: "duration", label: "rev.f.duration" },
      { name: "route", label: "rev.f.route" },
      { name: "instructions", label: "rev.f.instructions", wide: true },
    ],
    blank: { name: "", strength: null, dosage: null, frequency: null, duration: null, route: null, instructions: null, source_text: "", confidence: "high" },
  },
  {
    key: "conditions",
    title: "rev.sec.conditions",
    fields: [
      { name: "description", label: "rev.f.diagnosis", required: true, wide: true },
      { name: "status", label: "rev.f.status" },
    ],
    blank: { description: "", status: null, source_text: "", confidence: "high" },
  },
  {
    key: "procedures",
    title: "rev.sec.procedures",
    fields: [
      { name: "name", label: "rev.f.procedure", required: true, wide: true },
      { name: "date", label: "rev.f.date", placeholder: "2026-03-12" },
    ],
    blank: { name: "", date: null, source_text: "", confidence: "high" },
  },
  {
    key: "follow_ups",
    title: "rev.sec.followups",
    fields: [
      { name: "instruction", label: "rev.f.instruction", required: true, wide: true },
      { name: "date", label: "rev.f.date", placeholder: "2026-04-12" },
    ],
    blank: { instruction: "", date: null, source_text: "" },
  },
  {
    key: "findings",
    title: "rev.sec.findings",
    fields: [{ name: "text", label: "rev.f.observation", required: true, wide: true }],
    blank: { text: "", source_text: "", confidence: "high" },
  },
];

const DOC_TYPES: DocType[] = ["lab_report", "prescription", "diagnostic_report", "discharge_summary", "other"];

function IssueLine({ issue }: { issue: Issue }) {
  const { t } = useI18n();
  const key = `issue.${issue.code}`;
  const Icon = issue.severity === "error" ? AlertCircle : issue.severity === "warning" ? AlertTriangle : Info;
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-xs",
        issue.severity === "error" ? "text-danger" : issue.severity === "warning" ? "text-warn" : "text-muted-foreground",
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      {hasKey(key) ? t(key) : issue.message}
    </p>
  );
}

const nullIfBlank = (v: string) => (v.trim() === "" ? null : v);

// Which items the user has ticked as "looks right" — a per-browser review aid, not part of the record.
const checkedKey = (extractionId: string) => `hc.checked.${extractionId}`;
function readChecked(extractionId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(checkedKey(extractionId)) ?? "[]");
  } catch {
    return [];
  }
}

type Row = { sec: SectionKey; idx: number; it: Record<string, unknown>; key?: string; id: string };

/** One-line, read-only summary of an item. Medical text is shown exactly as extracted. */
function rowSummary(sec: SectionKey, it: Record<string, unknown>) {
  const v = (k: string) => (typeof it[k] === "string" && (it[k] as string).trim() ? (it[k] as string) : null);
  switch (sec) {
    case "lab_results":
      return { title: v("test_name") ?? "—", value: [v("value"), v("unit")].filter(Boolean).join(" ") || null, meta: v("reference_range") };
    case "medications":
      return { title: [v("name"), v("strength")].filter(Boolean).join(" ") || "—", value: null, meta: [v("dosage"), v("frequency"), v("duration"), v("route")].filter(Boolean).join(" · ") || null };
    case "conditions":
      return { title: v("description") ?? "—", value: null, meta: v("status") };
    case "procedures":
      return { title: v("name") ?? "—", value: null, meta: formatDate(v("date")) };
    case "follow_ups":
      return { title: v("instruction") ?? "—", value: null, meta: formatDate(v("date")) };
    default:
      return { title: v("text") ?? "—", value: null, meta: null };
  }
}

const ADD_LABEL: Record<SectionKey, TKey> = {
  lab_results: "rev.f.test",
  medications: "rev.f.medicine",
  conditions: "rev.f.diagnosis",
  procedures: "rev.f.procedure",
  follow_ups: "tl.followUp",
  findings: "rev.f.observation",
};

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const { data: doc, error: docError, mutate: mutateDoc } = useDocumentPoll(id);
  const ready = doc && (doc.status === "needs_review" || doc.status === "confirmed");
  const { data: ex, error: exError, mutate: mutateEx } = useSWR<Extraction>(ready ? `/api/v1/documents/${id}/extraction` : null);

  const [draft, setDraft] = useState<ExtractionData | null>(null);
  const [checkedMap, setCheckedMap] = useState<Record<string, string[]>>({});
  const [active, setActive] = useState<{ key: string; source: string; label: string } | null>(null);
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [editDoc, setEditDoc] = useState(false);
  const [filter, setFilter] = useState<"all" | "attention" | "unchecked">("all");
  const data = draft ?? ex?.data ?? null;
  const dirty = draft !== null;
  const [saving, setSaving] = useState<"save" | "confirm" | null>(null);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const issuesByPath = useMemo(() => {
    const m = new Map<string, Issue[]>();
    ex?.issues.forEach((i) => m.set(i.path, [...(m.get(i.path) ?? []), i]));
    return m;
  }, [ex]);
  const aiByKey = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    if (ex) SECTIONS.forEach((s) => (ex.ai_output[s.key] as unknown as Record<string, unknown>[]).forEach((i) => m.set(i.key as string, i)));
    return m;
  }, [ex]);
  const derivedByKey = useMemo(() => new Map(ex?.derived.map((d) => [d.key, d.status]) ?? []), [ex]);

  if (docError) return <ErrorState error={docError} onRetry={() => mutateDoc()} />;
  if (!doc) return <ListSkeleton rows={6} />;

  const header = (
    <PageHeader
      title={t("review.title")}
      subtitle={t("review.subtitle")}
      actions={
        <>
          <Button variant="ghost" asChild>
            <Link href={`/records/${id}`}>
              <ArrowLeft /> {t("rev.back")}
            </Link>
          </Button>
          <StatusBadge status={doc.status} />
        </>
      }
    />
  );

  if (isProcessing(doc.status))
    return (
      <>
        {header}
        <ProcessingPanel doc={doc} />
      </>
    );
  if (doc.status === "failed")
    return (
      <>
        {header}
        <FailedPanel doc={doc} onRetried={() => mutateDoc()} />
      </>
    );
  if (exError) return <ErrorState error={exError} onRetry={() => mutateEx()} />;
  if (!ex || !data) return <ListSkeleton rows={6} />;

  const set = (patch: Partial<ExtractionData>) => setDraft({ ...data, ...patch });
  const setItem = (section: SectionKey, idx: number, field: string, value: string) => {
    const list = [...(data[section] as unknown as Record<string, unknown>[])];
    const isRequired = SECTIONS.find((s) => s.key === section)!.fields.find((f) => f.name === field)?.required;
    list[idx] = { ...list[idx], [field]: isRequired ? value : nullIfBlank(value) };
    set({ [section]: list } as Partial<ExtractionData>);
  };
  const addItem = (section: SectionKey) => {
    const blank = SECTIONS.find((s) => s.key === section)!.blank;
    set({ [section]: [...(data[section] as unknown[]), { ...blank, origin: "user" }] } as Partial<ExtractionData>);
    setFilter("all");
  };
  const removeItem = (section: SectionKey, idx: number) =>
    set({ [section]: (data[section] as unknown[]).filter((_, i) => i !== idx) } as Partial<ExtractionData>);
  const toggleEdit = (rowId: string, on?: boolean) =>
    setEditing((prev) => {
      const next = new Set(prev);
      if (on ?? !next.has(rowId)) next.add(rowId);
      else next.delete(rowId);
      return next;
    });

  const requiredMissing = (sec: SectionKey, it: Record<string, unknown>) =>
    SECTIONS.find((s) => s.key === sec)!.fields.some((f) => f.required && !String(it[f.name] ?? "").trim());
  const missingRequired = SECTIONS.some((s) => (data[s.key] as unknown as Record<string, unknown>[]).some((it) => requiredMissing(s.key, it)));
  const blocking = ex.issues.filter((i) => i.severity === "error");
  const checked = new Set(checkedMap[ex.id] ?? readChecked(ex.id));
  const setChecked = (keys: Set<string>) => {
    const arr = [...keys];
    setCheckedMap((m) => ({ ...m, [ex.id]: arr }));
    try {
      localStorage.setItem(checkedKey(ex.id), JSON.stringify(arr));
    } catch {
      /* storage unavailable */
    }
  };

  const rowsBySection = new Map<SectionKey, Row[]>(
    SECTIONS.map((sec) => [
      sec.key,
      (data[sec.key] as unknown as Record<string, unknown>[]).map((it, idx) => {
        const key = it.key as string | undefined;
        return { sec: sec.key, idx, it, key, id: key ?? `new-${sec.key}-${idx}` };
      }),
    ]),
  );
  const allRows = [...rowsBySection.values()].flat();
  const isDone = (r: Row) => !r.key || r.it.origin === "user" || checked.has(r.key);
  const flaggedPaths = new Set(ex.issues.filter((i) => i.severity !== "info").map((i) => i.path));
  const needsAttention = (r: Row) => (r.key ? flaggedPaths.has(`${r.sec}.${r.key}`) : false) || requiredMissing(r.sec, r.it);
  const doneCount = allRows.filter(isDone).length;
  const attentionCount = allRows.filter(needsAttention).length;
  const visible = (r: Row) => filter === "all" || (filter === "attention" ? needsAttention(r) : !isDone(r));
  const markClean = () => {
    const next = new Set(checked);
    allRows.forEach((r) => r.key && !needsAttention(r) && next.add(r.key));
    setChecked(next);
  };

  const docIssues = issuesByPath.get("document") ?? [];
  const docFieldIssue = docIssues.some((i) => i.field === "document_date" || i.field === "document_type");
  const showDocFields = editDoc || docFieldIssue;
  const generalDocIssues = docIssues.filter((i) => i.field !== "document_date" && i.field !== "document_type");

  async function save(): Promise<Extraction | null> {
    try {
      const updated = await api<Extraction>(`/api/v1/documents/${id}/extraction`, { method: "PATCH", json: { data } });
      await mutateEx(updated, { revalidate: false });
      setDraft(null);
      setEditing(new Set());
      return updated;
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    }
  }

  async function onSave() {
    setSaving("save");
    const r = await save();
    if (r) toast.success(t("rev.saved"), { description: r.issues.some((i) => i.severity === "error") ? t("rev.stillFix") : undefined });
    setSaving(null);
  }

  async function onConfirm() {
    setSaving("confirm");
    try {
      let current = ex!;
      if (dirty) {
        const r = await save();
        if (!r) return;
        current = r;
      }
      if (current.issues.some((i) => i.severity === "error")) {
        toast.error(t("error.unresolved_issues"));
        return;
      }
      const res = await api<{ records: Record<string, number> }>(`/api/v1/documents/${id}/confirm`, { method: "POST" });
      toast.success(t("rev.confirmed"), {
        description: t("rev.confirmedBody", { r: res.records.observations, m: res.records.medications, e: res.records.timeline_events }),
      });
      await mutateDoc();
      router.push(`/records/${id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(null);
    }
  }

  const progress = allRows.length ? doneCount / allRows.length : 1;

  // A render helper, not a component: defining a component inside render would remount rows
  // (and drop input focus) on every keystroke.
  function renderRow(r: Row) {
    const sec = SECTIONS.find((s) => s.key === r.sec)!;
    const issues = r.key ? (issuesByPath.get(`${r.sec}.${r.key}`) ?? []) : [];
    const sum = rowSummary(r.sec, r.it);
    const orig = r.key ? aiByKey.get(r.key) : undefined;
    const source = typeof r.it.source_text === "string" ? r.it.source_text : "";
    const isEditing = editing.has(r.id) || !r.key;
    const done = isDone(r);
    const attention = needsAttention(r);
    const isActive = !!r.key && active?.key === r.key;
    const status = r.sec === "lab_results" && r.key && !dirty ? derivedByKey.get(r.key) : undefined;
    const select = () => r.key && source && setActive({ key: r.key, source, label: sum.title });

    return (
      <li
        key={r.id}
        className={cn(
          "relative transition-colors",
          isActive && "bg-brand-50/50",
          attention && !isEditing && "bg-warn-bg/40",
        )}
      >
        {(isActive || attention) && (
          <span aria-hidden className={cn("absolute inset-y-2 left-0 w-[3px] rounded-r", attention ? "bg-warn" : "bg-brand-600")} />
        )}
        <div className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
          <button
            type="button"
            onClick={select}
            disabled={!source}
            title={source ? t("rev.showSource") : undefined}
            className="min-w-0 flex-1 text-left disabled:cursor-default"
          >
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <span className="font-medium">{sum.title}</span>
              {sum.value && <span className="font-semibold text-foreground tabular-nums">{sum.value}</span>}
              {r.it.user_corrected === true && <span className="text-[11px] text-brand-700">· {t("badge.edited")}</span>}
              {r.it.origin === "user" && <span className="text-[11px] text-brand-700">· {t("rev.addedByYou")}</span>}
            </div>
            {sum.meta && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {r.sec === "lab_results" ? `${t("compare.expected")} ${sum.meta}` : sum.meta}
              </p>
            )}
            {!isEditing && issues.filter((i) => i.severity !== "info").map((i, n) => (
              <div key={n} className="mt-1.5">
                <IssueLine issue={i} />
              </div>
            ))}
          </button>
          <div className="flex shrink-0 items-center gap-1.5">
            {status && <StatusPill status={status} className="hidden sm:inline-flex" />}
            {r.key && r.it.origin !== "user" && (
              <button
                type="button"
                aria-pressed={done}
                aria-label={done ? t("rev.unmark") : t("rev.markRight")}
                title={done ? t("rev.unmark") : t("rev.markRight")}
                onClick={() => {
                  const next = new Set(checked);
                  if (done) next.delete(r.key!);
                  else next.add(r.key!);
                  setChecked(next);
                }}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full transition-colors",
                  done ? "bg-ok text-white" : "neu-sm rounded-full! text-muted-foreground hover:text-ok",
                )}
              >
                <Check className="size-4" />
              </button>
            )}
            {r.key && (
              <Button
                variant={isEditing ? "secondary" : "ghost"}
                size="icon-sm"
                aria-label={t("rev.edit")}
                title={t("rev.edit")}
                aria-expanded={isEditing}
                onClick={() => toggleEdit(r.id)}
              >
                <Pencil />
              </Button>
            )}
          </div>
        </div>

        {isEditing && (
          <div className="mx-4 mb-4 rounded-xl bg-[var(--neu-well)] p-4 sm:mx-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {sec.fields.map((f) => {
                const val = (r.it[f.name] as string | null) ?? "";
                const origVal = orig ? ((orig[f.name] as string | null) ?? "") : null;
                const changed = origVal !== null && origVal !== val;
                const fid = `${r.id}-${f.name}`;
                return (
                  <div key={f.name} className={cn("min-w-0 space-y-1", f.wide && "col-span-2")}>
                    <Label htmlFor={fid} className="text-xs text-muted-foreground">
                      {t(f.label)}
                      {f.required && <span aria-hidden="true"> *</span>}
                    </Label>
                    <Input
                      id={fid}
                      value={val}
                      placeholder={f.placeholder}
                      required={f.required}
                      aria-invalid={(f.required && !val.trim()) || issues.some((i) => i.field === f.name && i.severity === "error")}
                      onChange={(e) => setItem(r.sec, r.idx, f.name, e.target.value)}
                      className={cn("h-9 border-border bg-card shadow-none", changed && "border-brand-600/60")}
                    />
                    {changed && (
                      <p className="truncate text-[11px] text-muted-foreground" title={t("rev.origTitle", { v: origVal || t("rev.empty") })}>
                        {t("rev.originally")} <span className="line-through">{origVal || t("rev.empty")}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {issues.length > 0 && (
              <div className="mt-3 space-y-1">
                {issues.map((i, n) => (
                  <IssueLine key={n} issue={i} />
                ))}
              </div>
            )}
            {source && (
              <button
                type="button"
                onClick={select}
                className="mt-3 flex w-full items-start gap-1.5 rounded-md bg-card px-2 py-1.5 text-left font-mono text-[11px] leading-relaxed text-muted-foreground hover:text-brand-700"
                title={t("rev.showInDoc")}
              >
                <LocateFixed className="mt-0.5 size-3 shrink-0" />
                <span className="min-w-0">“{source}”</span>
              </button>
            )}
            <div className="mt-3 flex items-center justify-between">
              <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => removeItem(r.sec, r.idx)}>
                <Trash2 /> {t("rev.removeRow")}
              </Button>
              {r.key && (
                <Button size="sm" onClick={() => toggleEdit(r.id, false)} disabled={requiredMissing(r.sec, r.it)}>
                  <Check /> {t("rev.done")}
                </Button>
              )}
            </div>
          </div>
        )}
      </li>
    );
  }

  const presentSections = SECTIONS.filter((s) => (rowsBySection.get(s.key) ?? []).length > 0 || s.key === "lab_results" && data.document_type === "lab_report");
  const absentSections = SECTIONS.filter((s) => !presentSections.includes(s));

  return (
    <>
      {header}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="xl:sticky xl:top-6 xl:h-[calc(100vh-7rem)]">
          <SourcePanel id={id} highlight={active?.source ?? null} highlightLabel={active?.label} className="h-[60vh] xl:h-full" />
        </div>

        <div className="min-w-0 space-y-5 pb-44 lg:pb-28">
          {/* Progress + focus filters */}
          {allRows.length > 0 && (
            <section className="surface p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{t("rev.checked", { n: doneCount, total: allRows.length })}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("rev.checkHint")}</p>
                </div>
                <Button variant="outline" size="sm" onClick={markClean}>
                  <Check /> {t("rev.markAll")}
                </Button>
              </div>
              <div
                className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--neu-well)]"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={allRows.length}
                aria-valuenow={doneCount}
                aria-label={t("rev.itemsChecked")}
              >
                <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="mt-4 overflow-x-auto [scrollbar-width:none]">
                <Segmented
                  label={t("rec.filterStatus")}
                  size="sm"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: "all", label: `${t("rev.filter.all")} (${allRows.length})` },
                    { value: "attention", label: `${t("rev.filter.attention")} (${attentionCount})` },
                    { value: "unchecked", label: `${t("rev.filter.unchecked")} (${allRows.length - doneCount})` },
                  ]}
                />
              </div>
            </section>
          )}

          {generalDocIssues.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-warn/25 bg-warn-bg/50 px-4 py-3">
              {generalDocIssues.map((i, n) => (
                <IssueLine key={n} issue={i} />
              ))}
            </div>
          )}

          {/* Document details: one line, expands when editing or something needs fixing */}
          <section className="surface p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("rev.docDetails")}</p>
                <p className="mt-1 truncate text-sm font-medium">
                  {[t(`doctype.${data.document_type}`), formatDate(data.document_date) ?? t("rev.noDate"), data.facility, data.clinician].filter(Boolean).join(" · ")}
                </p>
              </div>
              {!docFieldIssue && (
                <Button variant="ghost" size="sm" onClick={() => setEditDoc((v) => !v)} aria-expanded={showDocFields}>
                  <Pencil /> {editDoc ? t("rev.done") : t("rev.editDetails")}
                </Button>
              )}
            </div>
            {showDocFields && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="doc_type">{t("rev.type")}</Label>
                  <select
                    id="doc_type"
                    value={data.document_type}
                    onChange={(e) => set({ document_type: e.target.value as DocType, classification_confidence: "high" })}
                    className="field h-9 w-full px-2 text-sm"
                  >
                    {DOC_TYPES.map((d) => (
                      <option key={d} value={d}>
                        {t(`doctype.${d}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="doc_date">{t("rev.docDate")}</Label>
                  <Input
                    id="doc_date"
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    value={data.document_date ?? ""}
                    onChange={(e) => set({ document_date: nullIfBlank(e.target.value) })}
                    aria-invalid={docIssues.some((i) => i.field === "document_date" && i.severity === "error")}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="facility">{t("rev.facility")}</Label>
                  <Input id="facility" value={data.facility ?? ""} onChange={(e) => set({ facility: nullIfBlank(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="clinician">{t("rev.clinician")}</Label>
                  <Input id="clinician" value={data.clinician ?? ""} onChange={(e) => set({ clinician: nullIfBlank(e.target.value) })} />
                </div>
                {docIssues
                  .filter((i) => i.field === "document_date" || i.field === "document_type")
                  .map((i, n) => (
                    <div key={n} className="sm:col-span-2">
                      <IssueLine issue={i} />
                    </div>
                  ))}
              </div>
            )}
          </section>

          {/* Sections */}
          {presentSections.map((s) => {
            const rows = (rowsBySection.get(s.key) ?? []).filter(visible);
            const total = (rowsBySection.get(s.key) ?? []).length;
            if (filter !== "all" && rows.length === 0) return null;
            return (
              <section key={s.key} className="surface overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
                  <h2 className="text-sm font-semibold">
                    {t(s.title)} <span className="font-normal text-muted-foreground">({total})</span>
                  </h2>
                  <Button variant="ghost" size="sm" onClick={() => addItem(s.key)}>
                    <Plus /> {t("rev.add")}
                  </Button>
                </div>
                {rows.length === 0 ? (
                  <p className="px-5 py-6 text-center text-sm text-muted-foreground">{t("rev.noneFound")}</p>
                ) : (
                  <ul className="divide-y">
                    {rows.map(renderRow)}
                  </ul>
                )}
              </section>
            );
          })}

          {filter !== "all" && allRows.filter(visible).length === 0 && (
            <div className="surface flex items-center gap-3 p-5 text-sm">
              <CheckCircle2 className="size-5 text-ok" />
              {filter === "unchecked" ? t("rev.allChecked") : t("rev.nothingHere")}
            </div>
          )}

          {absentSections.length > 0 && filter === "all" && (
            <section>
              <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">{t("rev.addMore")}</p>
              <div className="flex flex-wrap gap-2">
                {absentSections.map((s) => (
                  <button key={s.key} type="button" onClick={() => addItem(s.key)} className="neu-sm neu-press inline-flex items-center gap-1.5 rounded-full! px-3.5 py-2 text-xs font-medium">
                    <Plus className="size-3.5" /> {t(ADD_LABEL[s.key])}
                  </button>
                ))}
              </div>
            </section>
          )}
          <Disclaimer />
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-16 z-20 bg-[var(--neu-surface)]/95 shadow-[0_-6px_18px_rgba(20,45,33,0.08)] backdrop-blur lg:bottom-0 lg:left-[248px]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative hidden size-9 shrink-0 sm:block" aria-hidden="true">
              <svg viewBox="0 0 36 36" className="size-9 -rotate-90">
                <circle cx="18" cy="18" r="15" fill="none" stroke="var(--neu-well)" strokeWidth="4" />
                <circle cx="18" cy="18" r="15" fill="none" stroke="#1D6B50" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${progress * 94.2} 94.2`} />
              </svg>
            </div>
            <p className="min-w-0 truncate text-xs text-muted-foreground" aria-live="polite">
              {dirty
                ? t("rev.unsaved")
                : blocking.length > 0
                  ? t("rev.errorsLeft", { n: blocking.length })
                  : ex.status === "confirmed"
                    ? t("rev.alreadyConfirmed")
                    : t("rev.checkedShort", { n: doneCount, total: allRows.length })}
              {missingRequired && ` · ${t("rev.fillRequired")}`}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {dirty && (
              <Button variant="outline" onClick={onSave} disabled={saving !== null || missingRequired}>
                {saving === "save" ? <Loader2 className="animate-spin" /> : <Save />} <span className="hidden sm:inline">{t("common.save")}</span>
              </Button>
            )}
            <Button onClick={onConfirm} className="rounded-full px-5" disabled={saving !== null || missingRequired || (!dirty && blocking.length > 0)}>
              {saving === "confirm" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {t("review.confirm")}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
