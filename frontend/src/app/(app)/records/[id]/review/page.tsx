"use client";

import { AlertCircle, AlertTriangle, ArrowLeft, Check, CheckCircle2, Info, Loader2, LocateFixed, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { InterpBadge, StatusBadge } from "@/components/app/badges";
import { FailedPanel, ProcessingPanel } from "@/components/app/doc-states";
import { SourcePanel } from "@/components/app/source-panel";
import { Disclaimer, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDocumentPoll } from "@/hooks/use-document-poll";
import { api, ApiError, errorMessage } from "@/lib/api";
import { isProcessing } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { DocType, Extraction, ExtractionData, Issue } from "@/lib/types";
import { cn } from "@/lib/utils";

type SectionKey = "lab_results" | "medications" | "conditions" | "procedures" | "follow_ups" | "findings";
type Field = { name: string; label: string; required?: boolean; wide?: boolean; placeholder?: string };

const SECTIONS: { key: SectionKey; title: string; fields: Field[]; blank: Record<string, unknown> }[] = [
  {
    key: "lab_results",
    title: "Lab results",
    fields: [
      { name: "test_name", label: "Test", required: true, wide: true },
      { name: "value", label: "Value", required: true },
      { name: "unit", label: "Unit" },
      { name: "reference_range", label: "Reference range" },
      { name: "flag", label: "Flag on report" },
      { name: "category", label: "Panel", wide: true },
    ],
    blank: { test_name: "", value: "", unit: null, reference_range: null, flag: null, category: null, source_text: "", confidence: "high" },
  },
  {
    key: "medications",
    title: "Medications (as documented)",
    fields: [
      { name: "name", label: "Medicine", required: true, wide: true },
      { name: "strength", label: "Strength" },
      { name: "dosage", label: "Dosage" },
      { name: "frequency", label: "Frequency" },
      { name: "duration", label: "Duration" },
      { name: "route", label: "Route" },
      { name: "instructions", label: "Instructions", wide: true },
    ],
    blank: { name: "", strength: null, dosage: null, frequency: null, duration: null, route: null, instructions: null, source_text: "", confidence: "high" },
  },
  {
    key: "conditions",
    title: "Diagnoses stated in the document",
    fields: [
      { name: "description", label: "Diagnosis", required: true, wide: true },
      { name: "status", label: "Status" },
    ],
    blank: { description: "", status: null, source_text: "", confidence: "high" },
  },
  {
    key: "procedures",
    title: "Procedures",
    fields: [
      { name: "name", label: "Procedure", required: true, wide: true },
      { name: "date", label: "Date (YYYY-MM-DD)", placeholder: "2026-03-12" },
    ],
    blank: { name: "", date: null, source_text: "", confidence: "high" },
  },
  {
    key: "follow_ups",
    title: "Follow-up instructions",
    fields: [
      { name: "instruction", label: "Instruction", required: true, wide: true },
      { name: "date", label: "Date (YYYY-MM-DD)", placeholder: "2026-04-12" },
    ],
    blank: { instruction: "", date: null, source_text: "" },
  },
  {
    key: "findings",
    title: "Clinical observations",
    fields: [{ name: "text", label: "Observation", required: true, wide: true }],
    blank: { text: "", source_text: "", confidence: "high" },
  },
];

const DOC_TYPES: DocType[] = ["lab_report", "prescription", "diagnostic_report", "discharge_summary", "other"];

function IssueLine({ issue }: { issue: Issue }) {
  const Icon = issue.severity === "error" ? AlertCircle : issue.severity === "warning" ? AlertTriangle : Info;
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-xs",
        issue.severity === "error" ? "text-danger" : issue.severity === "warning" ? "text-warn" : "text-muted-foreground",
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      {issue.message}
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
              <ArrowLeft /> Report
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

  const set = (patch: Partial<ExtractionData>) => {
    setDraft({ ...data, ...patch });
  };
  const setItem = (section: SectionKey, idx: number, field: string, value: string) => {
    const list = [...(data[section] as unknown as Record<string, unknown>[])];
    const isRequired = SECTIONS.find((s) => s.key === section)!.fields.find((f) => f.name === field)?.required;
    list[idx] = { ...list[idx], [field]: isRequired ? value : nullIfBlank(value) };
    set({ [section]: list } as Partial<ExtractionData>);
  };
  const addItem = (section: SectionKey) => {
    const blank = SECTIONS.find((s) => s.key === section)!.blank;
    set({ [section]: [...(data[section] as unknown[]), { ...blank, origin: "user" }] } as Partial<ExtractionData>);
  };
  const removeItem = (section: SectionKey, idx: number) =>
    set({ [section]: (data[section] as unknown[]).filter((_, i) => i !== idx) } as Partial<ExtractionData>);

  const missingRequired = SECTIONS.some((s) =>
    (data[s.key] as unknown as Record<string, unknown>[]).some((it) => s.fields.some((f) => f.required && !String(it[f.name] ?? "").trim())),
  );
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
  const allItems = SECTIONS.flatMap((sec) =>
    (data[sec.key] as unknown as Record<string, unknown>[]).map((it) => ({ sec: sec.key, it, key: it.key as string | undefined })),
  );
  const isDone = (x: (typeof allItems)[number]) => !x.key || x.it.origin === "user" || (x.key ? checked.has(x.key) : false);
  const doneCount = allItems.filter(isDone).length;
  const flaggedPaths = new Set(ex.issues.filter((i) => i.severity !== "info").map((i) => i.path));
  const markClean = () => {
    const next = new Set(checked);
    allItems.forEach((x) => x.key && !flaggedPaths.has(`${x.sec}.${x.key}`) && next.add(x.key));
    setChecked(next);
  };
  const docIssues = issuesByPath.get("document") ?? [];

  async function save(): Promise<Extraction | null> {
    try {
      const updated = await api<Extraction>(`/api/v1/documents/${id}/extraction`, { method: "PATCH", json: { data } });
      await mutateEx(updated, { revalidate: false });
      setDraft(null);
      return updated;
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    }
  }

  async function onSave() {
    setSaving("save");
    const r = await save();
    if (r) toast.success("Corrections saved", { description: r.issues.some((i) => i.severity === "error") ? "Some items still need fixing." : undefined });
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
        toast.error("Fix the highlighted errors before confirming.");
        return;
      }
      const res = await api<{ records: Record<string, number> }>(`/api/v1/documents/${id}/confirm`, { method: "POST" });
      toast.success("Saved to your health record", {
        description: `${res.records.observations} results, ${res.records.medications} medications, ${res.records.timeline_events} timeline events`,
      });
      await mutateDoc();
      router.push(`/records/${id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : errorMessage(e));
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      {header}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="xl:sticky xl:top-6 xl:h-[calc(100vh-7rem)]">
          <SourcePanel id={id} highlight={active?.source ?? null} highlightLabel={active?.label} className="h-[60vh] xl:h-full" />
        </div>

        <div className="min-w-0 space-y-5 pb-44 lg:pb-28">
          {allItems.length > 0 && (
            <div className="surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    {doneCount} of {allItems.length} items checked
                  </p>
                  <p className="text-xs text-muted-foreground">Click an item to see where it came from in the document, then mark it as right or fix it.</p>
                </div>
                <Button variant="outline" size="sm" onClick={markClean}>
                  <Check /> Mark all unflagged as checked
                </Button>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={allItems.length} aria-valuenow={doneCount} aria-label="Items checked">
                <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${(doneCount / allItems.length) * 100}%` }} />
              </div>
            </div>
          )}
          {(docIssues.length > 0 || doc.text_method) && (
            <div className="surface space-y-2 p-4">
              <p className="text-xs text-muted-foreground">
                Read using {doc.text_method === "native" ? "digital PDF text" : doc.text_method === "ocr" ? "OCR" : "digital text + OCR"}
                {doc.ocr_confidence != null && ` · OCR confidence ${Math.round(doc.ocr_confidence * 100)}%`} · extraction v{ex.version}
                {ex.model ? ` · ${ex.model}` : ""}
              </p>
              {docIssues.map((i, n) => (
                <IssueLine key={n} issue={i} />
              ))}
            </div>
          )}

          <section className="surface p-4">
            <h2 className="mb-3 text-sm font-semibold">Document details</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="doc_type">Type</Label>
                <select
                  id="doc_type"
                  value={data.document_type}
                  onChange={(e) => set({ document_type: e.target.value as DocType, classification_confidence: "high" })}
                  className="h-9 w-full rounded-lg border bg-card px-2 text-sm"
                >
                  {DOC_TYPES.map((d) => (
                    <option key={d} value={d}>
                      {t(`doctype.${d}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="doc_date">Document date</Label>
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
                <Label htmlFor="facility">Facility / laboratory</Label>
                <Input id="facility" value={data.facility ?? ""} onChange={(e) => set({ facility: nullIfBlank(e.target.value) })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="clinician">Clinician</Label>
                <Input id="clinician" value={data.clinician ?? ""} onChange={(e) => set({ clinician: nullIfBlank(e.target.value) })} />
              </div>
            </div>
          </section>

          {SECTIONS.map((s) => {
            const items = data[s.key] as unknown as Record<string, unknown>[];
            if (items.length === 0 && s.key !== "lab_results" && s.key !== "medications") {
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => addItem(s.key)}
                  className="flex w-full items-center gap-2 rounded-xl border border-dashed bg-card px-4 py-3 text-sm text-muted-foreground hover:text-foreground"
                >
                  <Plus className="size-4" /> Add {s.title.toLowerCase()}
                </button>
              );
            }
            return (
              <section key={s.key} className="surface">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <h2 className="text-sm font-semibold">
                    {s.title} <span className="font-normal text-muted-foreground">({items.length})</span>
                  </h2>
                  <Button variant="outline" size="sm" onClick={() => addItem(s.key)}>
                    <Plus /> {t("review.addRow")}
                  </Button>
                </div>
                {items.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">None found in this document.</p>
                ) : (
                  <ul className="divide-y">
                    {items.map((it, idx) => {
                      const key = it.key as string | undefined;
                      const issues = key ? issuesByPath.get(`${s.key}.${key}`) ?? [] : [];
                      const orig = key ? aiByKey.get(key) : undefined;
                      const hasErr = issues.some((i) => i.severity === "error");
                      const hasWarn = issues.some((i) => i.severity === "warning");
                      const label = String(it[s.fields[0].name] ?? "");
                      const source = typeof it.source_text === "string" ? it.source_text : "";
                      const isActive = !!key && active?.key === key;
                      const isChecked = !!key && checked.has(key);
                      const select = () => key && source && setActive({ key, source, label });
                      return (
                        <li
                          key={key ?? `new-${idx}`}
                          onClick={select}
                          className={cn(
                            "relative space-y-3 px-4 py-4 transition-colors",
                            hasErr ? "bg-danger-bg/40" : hasWarn ? "bg-warn-bg/40" : isChecked ? "bg-ok-bg/40" : "",
                            isActive && "shadow-[inset_3px_0_0_var(--primary)]",
                          )}
                        >
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {s.fields.map((f) => {
                              const val = (it[f.name] as string | null) ?? "";
                              const origVal = orig ? ((orig[f.name] as string | null) ?? "") : null;
                              const changed = origVal !== null && origVal !== val;
                              const fid = `${s.key}-${idx}-${f.name}`;
                              return (
                                <div key={f.name} className={cn("min-w-0 space-y-1", f.wide && "col-span-2")}>
                                  <Label htmlFor={fid} className="text-xs text-muted-foreground">
                                    {f.label}
                                    {f.required && <span aria-hidden="true"> *</span>}
                                  </Label>
                                  <Input
                                    id={fid}
                                    value={val}
                                    placeholder={f.placeholder}
                                    required={f.required}
                                    aria-invalid={(f.required && !val.trim()) || issues.some((i) => i.field === f.name && i.severity === "error")}
                                    onChange={(e) => setItem(s.key, idx, f.name, e.target.value)}
                                    className={cn("h-8 bg-card", changed && "border-brand-600/60")}
                                  />
                                  {changed && (
                                    <p className="truncate text-[11px] text-muted-foreground" title={`Original extraction: ${origVal || "(empty)"}`}>
                                      Originally: <span className="line-through">{origVal || "(empty)"}</span>
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {source && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                select();
                              }}
                              className="flex w-full items-start gap-1.5 rounded-md bg-muted px-2 py-1 text-left font-mono text-[11px] leading-relaxed text-muted-foreground hover:bg-brand-50 hover:text-brand-700"
                              title="Show this in the document text"
                            >
                              <LocateFixed className="mt-0.5 size-3 shrink-0" />
                              <span className="min-w-0">“{source}”</span>
                            </button>
                          )}
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              {issues.map((i, n) => (
                                <IssueLine key={n} issue={i} />
                              ))}
                              {it.origin === "user" && <p className="text-xs text-muted-foreground">Added by you</p>}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {s.key === "lab_results" && key && derivedByKey.get(key) && !dirty && <InterpBadge value={derivedByKey.get(key)!} />}
                              {s.key !== "lab_results" && it.confidence === "low" && <span className="text-xs text-warn">Low confidence</span>}
                              {key && it.origin !== "user" && (
                                <Button
                                  variant={isChecked ? "secondary" : "outline"}
                                  size="sm"
                                  aria-pressed={isChecked}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const next = new Set(checked);
                                    if (isChecked) next.delete(key);
                                    else next.add(key);
                                    setChecked(next);
                                  }}
                                  className={cn(isChecked && "text-ok")}
                                >
                                  <Check /> {isChecked ? "Checked" : "Looks right"}
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Remove row"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeItem(s.key, idx);
                                }}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
          <Disclaimer />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-16 z-20 border-t bg-card/95 backdrop-blur lg:bottom-0 lg:left-[248px]">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {dirty
              ? "Unsaved changes"
              : blocking.length > 0
                ? `${blocking.length} error(s) must be fixed before confirming`
                : ex.status === "confirmed"
                  ? "Already confirmed. Re-confirm to update your record."
                  : `${ex.issues.filter((i) => i.severity === "warning").length} item(s) flagged for a closer look`}
            {missingRequired && " · Fill in required fields"}
            {allItems.length > 0 && ` · ${doneCount}/${allItems.length} checked`}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onSave} disabled={!dirty || saving !== null || missingRequired}>
              {saving === "save" ? <Loader2 className="animate-spin" /> : <Save />} {t("common.save")}
            </Button>
            <Button onClick={onConfirm} disabled={saving !== null || missingRequired || (!dirty && blocking.length > 0)}>
              {saving === "confirm" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {t("review.confirm")}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
