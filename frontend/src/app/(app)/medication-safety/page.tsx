"use client";

import { ChevronRight, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { SafetyDisclaimer, SeverityBadge } from "@/components/app/med-safety";
import { Glossary } from "@/components/app/rx-glossary";
import { Result, type Choice } from "@/components/app/rx-result";
import { Segmented } from "@/components/app/segmented";
import { ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Analysis, Extraction, PatientInput, ParsedMedicine, ParseResult, Page, SafetyReport, SafetyReportListItem, Severity } from "@/lib/types";

const BASE = "/api/v1/medication-safety";
const SEVERITIES: Severity[] = ["critical", "high", "moderate", "low", "info"];
const EXAMPLE = {
  text: "Tab Dolo 650 mg 1 tab 1-0-1 x 5 days\nTab Combiflam 1 tab TDS after food\nTab Warfarin 5 mg OD\nTab Voveran 50 mg BD pc\nSyp Crocine 5 ml SOS\nCap Zyxotab 20 mg OD",
  age: "52",
  weight: "62",
  kidney: "normal" as PatientInput["kidney"],
};

const choiceKey = (m: ParsedMedicine) => `${m.name}|${m.strength ?? ""}`.toLowerCase();

function Checker({ initialText, fromDoc }: { initialText: string; fromDoc: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [age, setAge] = useState("");
  const [weight, setWeight] = useState("");
  const [kidney, setKidney] = useState<PatientInput["kidney"]>("unknown");
  const [parsed, setParsed] = useState<ParsedMedicine[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patient = (): PatientInput => ({
    age_years: age.trim() === "" ? null : Math.max(0, Math.min(120, Math.round(Number(age)))),
    weight_kg: weight.trim() === "" ? null : Math.max(1, Math.min(400, Number(weight))),
    kidney,
  });

  const payload = (meds: ParsedMedicine[], ch: Record<string, Choice>) => ({
    medicines: meds.map((m) => {
      const c = ch[choiceKey(m)];
      return {
        key: m.key, name: m.name, strength: m.strength, dosage: m.dosage, frequency: m.frequency, timing: m.timing, duration: m.duration,
        ...(c ? { resolution_choice: c.mode, catalogue_id: c.mode === "select" ? c.catalogue_id : null } : {}),
      };
    }),
    patient: patient(),
  });

  async function runAnalyze(meds: ParsedMedicine[], ch: Record<string, Choice>) {
    setAnalysis(await api<Analysis>(`${BASE}/analyze`, { method: "POST", json: payload(meds, ch) }));
  }

  async function check() {
    if (!text.trim()) {
      setError(t("ms.input.empty"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const p = await api<ParseResult>(`${BASE}/parse`, { method: "POST", json: { text } });
      setSkipped(p.skipped);
      setParsed(p.medicines);
      if (!p.medicines.length) {
        setAnalysis(null);
        setError(t("ms.parse.none"));
        return;
      }
      await runAnalyze(p.medicines, choices);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function choose(key: string, c: Choice) {
    const med = parsed.find((m) => m.key === key);
    if (!med) return;
    const next = { ...choices, [choiceKey(med)]: c };
    setChoices(next);
    setBusy(true);
    try {
      await runAnalyze(parsed, next);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const r = await api<SafetyReport>(`${BASE}/reports/save`, { method: "POST", json: { ...payload(parsed, choices), document_id: fromDoc } });
      router.push(`/medication-safety/reports/${r.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <ol className="grid gap-2 text-sm font-medium sm:grid-cols-3">
        {(["ms.step1", "ms.step2", "ms.step3"] as const).map((k) => (
          <li key={k} className="rounded-xl bg-brand-50 px-4 py-2.5 text-brand-700">
            {t(k)}
          </li>
        ))}
      </ol>

      <section className="surface space-y-5 p-5" aria-labelledby="rx-input">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label id="rx-input" htmlFor="rx-text" className="text-sm font-semibold">
              {t("ms.input.label")}
            </label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => {
                  setText(EXAMPLE.text);
                  setAge(EXAMPLE.age);
                  setWeight(EXAMPLE.weight);
                  setKidney(EXAMPLE.kidney);
                }}
              >
                <Sparkles /> {t("ms.input.example")}
              </Button>
              {text && (
                <Button type="button" variant="ghost" size="xs" onClick={() => { setText(""); setAnalysis(null); setParsed([]); setError(null); }}>
                  {t("ms.input.clear")}
                </Button>
              )}
            </div>
          </div>
          {fromDoc && initialText && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{t("ms.input.fromRecord")}</p>}
          <Textarea
            id="rx-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("ms.input.placeholder")}
            rows={6}
            maxLength={6000}
            className="min-h-36 font-mono"
            aria-describedby="rx-help"
          />
          <p id="rx-help" className="text-xs text-muted-foreground">{t("ms.input.help")}</p>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">{t("ms.step2")}</legend>
          <p className="text-xs text-muted-foreground">{t("ms.patient.hint")}</p>
          <div className="grid gap-4 sm:grid-cols-[120px_120px_1fr]">
            <div className="space-y-1">
              <label htmlFor="rx-age" className="text-xs font-medium text-muted-foreground">{t("ms.patient.age")}</label>
              <Input id="rx-age" inputMode="numeric" type="number" min={0} max={120} value={age} onChange={(e) => setAge(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor="rx-weight" className="text-xs font-medium text-muted-foreground">{t("ms.patient.weight")}</label>
              <Input id="rx-weight" inputMode="decimal" type="number" min={1} max={400} value={weight} onChange={(e) => setWeight(e.target.value)} />
            </div>
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{t("ms.patient.kidney")}</span>
              <div>
                <Segmented<PatientInput["kidney"]>
                  size="sm"
                  label={t("ms.patient.kidney")}
                  value={kidney}
                  onChange={setKidney}
                  options={[
                    { value: "unknown", label: t("ms.kidney.unknown") },
                    { value: "normal", label: t("ms.kidney.normal") },
                    { value: "reduced", label: t("ms.kidney.reduced") },
                  ]}
                />
              </div>
            </div>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={check} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {busy ? t("ms.checking") : t("ms.check")}
          </Button>
          {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        </div>
      </section>

      {skipped.length > 0 && <p className="rounded-lg bg-warn-bg/60 px-4 py-2.5 text-sm">{t("ms.parse.skipped", { n: skipped.length, lines: skipped.join(" | ") })}</p>}
      {analysis && <Result a={analysis} onChoose={choose} onSave={save} saving={saving} />}
    </div>
  );
}

/** Pre-fills the text from an uploaded prescription (?from=<document id>); the user checks the lines before pressing Check. */
function FromRecord({ docId }: { docId: string }) {
  const ex = useSWR<Extraction>(`/api/v1/documents/${docId}/extraction`);
  if (ex.error) return <ErrorState error={ex.error} onRetry={() => ex.mutate()} />;
  if (!ex.data) return <ListSkeleton rows={3} />;
  const lines = ex.data.data.medications.map((m) => [m.name, m.strength, m.dosage, m.frequency, m.duration && `x ${m.duration}`].filter(Boolean).join(" "));
  return <Checker initialText={lines.join("\n")} fromDoc={docId} />;
}

function SavedReports() {
  const { t } = useI18n();
  const { data } = useSWR<Page<SafetyReportListItem>>(`${BASE}/reports?limit=5`, { shouldRetryOnError: false });
  if (!data || data.items.length === 0) return null; // silent when empty or when saving isn't set up yet
  return (
    <section className="mt-10" aria-labelledby="ms-saved">
      <h2 id="ms-saved" className="mb-3 text-sm font-semibold">{t("ms.hub.reports")}</h2>
      <ul className="space-y-2">
        {data.items.map((r) => (
          <li key={r.id}>
            <Link href={`/medication-safety/reports/${r.id}`} className="surface flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:border-brand-600/40">
              <span className="flex flex-wrap items-center gap-1.5">
                {SEVERITIES.filter((s) => r.summary.by_severity?.[s]).map((s) => (
                  <span key={s} className="inline-flex items-center gap-1">
                    <SeverityBadge severity={s} />
                    <span className="text-xs tabular-nums text-muted-foreground">×{r.summary.by_severity[s]}</span>
                  </span>
                ))}
                {!SEVERITIES.some((s) => r.summary.by_severity?.[s]) && <span className="text-muted-foreground">{t("ms.sum.none")}</span>}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">{formatDateTime(r.created_at)} <ChevronRight className="size-3.5" /></span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Inner() {
  const { t } = useI18n();
  const from = useSearchParams().get("from");
  return (
    <>
      <PageHeader title={t("ms.title")} subtitle={t("ms.subtitle")} />
      <SafetyDisclaimer className="mb-6" />
      <div className="mb-6 space-y-3">
        <Glossary />
        <details className="surface p-4">
          <summary className="cursor-pointer text-sm font-semibold">{t("ms.sec.how")}</summary>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm">
            {(["ms.how.1", "ms.how.2", "ms.how.3", "ms.how.4"] as const).map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">{t("ms.how.limit")}</p>
        </details>
      </div>
      {from ? <FromRecord key={from} docId={from} /> : <Checker initialText="" fromDoc={null} />}
      <SavedReports />
    </>
  );
}

export default function MedicationSafetyPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={3} />}>
      <Inner />
    </Suspense>
  );
}
