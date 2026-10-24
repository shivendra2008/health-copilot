"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, HelpCircle, Loader2, Pill, Save, ShieldAlert, Undo2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FindingCard } from "@/components/app/med-safety";
import { freqText, timingText } from "@/components/app/rx-glossary";
import { hasKey, useI18n, type TKey } from "@/lib/i18n";
import type { Analysis, AnalysisMedicine, CatalogueEntry, SafetyFinding } from "@/lib/types";
import { cn } from "@/lib/utils";

export type Choice = { mode: "select"; catalogue_id: string } | { mode: "unresolved" } | null;

const ingredientText = (e: CatalogueEntry) =>
  e.ingredients.map((i) => (i.strength ? `${i.name} ${i.strength.value} ${i.strength.unit}` : i.name)).join(" + ");

// ----------------------------------------------------------------------------- headline
function Headline({ a }: { a: Analysis }) {
  const { t } = useI18n();
  const act = a.summary.by_tier?.act ?? 0;
  const know = a.summary.by_tier?.know ?? 0;
  const tone = act > 0 ? "danger" : know > 0 ? "warn" : "ok";
  const Icon = act > 0 ? ShieldAlert : know > 0 ? AlertTriangle : CheckCircle2;
  return (
    <div
      role="status"
      className={cn(
        "rounded-2xl border px-5 py-4",
        tone === "danger" && "border-danger/40 bg-danger-bg/70",
        tone === "warn" && "border-warn/40 bg-warn-bg/70",
        tone === "ok" && "border-ok/30 bg-ok-bg/60",
      )}
    >
      <p className="flex items-start gap-2 text-lg font-semibold">
        <Icon className={cn("mt-0.5 size-5 shrink-0", tone === "danger" && "text-danger", tone === "warn" && "text-warn", tone === "ok" && "text-ok")} />
        {act > 0 ? t("ms.sum.act", { n: act }) : know > 0 ? t("ms.sum.know", { n: know }) : t("ms.sum.none")}
      </p>
      <p className="mt-1 pl-7 text-sm text-muted-foreground">{act > 0 ? t("ms.sum.actHint") : know > 0 ? t("ms.sum.noneHint") : t("ms.sum.noneHint")}</p>
      {a.summary.medicines_unresolved > 0 && <p className="mt-2 pl-7 text-sm font-medium">{t("ms.sum.unresolved", { n: a.summary.medicines_unresolved })}</p>}
    </div>
  );
}

// ----------------------------------------------------------------------------- "we need your help"
function Identify({ meds, onChoose }: { meds: AnalysisMedicine[]; onChoose: (key: string, c: Choice) => void }) {
  const { t } = useI18n();
  const items = meds.filter((m) => ["ambiguous", "unresolved", "user_unresolved"].includes(m.resolution.status));
  if (!items.length) return null;
  return (
    <section aria-labelledby="rx-id" className="space-y-3 rounded-2xl border border-warn/40 bg-warn-bg/50 p-4">
      <h2 id="rx-id" className="flex items-center gap-2 text-sm font-semibold">
        <HelpCircle className="size-4 text-warn" /> {t("ms.id.title")}
      </h2>
      {items.map((m) => {
        const r = m.resolution;
        return (
          <div key={m.key} className="space-y-2 rounded-xl bg-card p-3 text-sm">
            {r.status === "user_unresolved" ? (
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span>{t("ms.id.skipped", { name: m.name })}</span>
                <Button variant="ghost" size="xs" onClick={() => onChoose(m.key, null)}>
                  <Undo2 /> {t("ms.id.undo")}
                </Button>
              </p>
            ) : r.status === "unresolved" ? (
              <>
                <p className="font-medium">{t("ms.id.notFound", { name: m.name })}</p>
                <p className="text-muted-foreground">{t("ms.id.noSuggestion")}</p>
              </>
            ) : (
              <>
                <p className="font-medium">
                  {r.reason === "no_exact_match_suggestions" ? t("ms.id.notFound", { name: m.name }) : t("ms.id.several", { name: m.name })}
                </p>
                {r.reason === "no_exact_match_suggestions" && <p className="text-muted-foreground">{t("ms.id.didYouMean")}</p>}
                <div className="grid gap-2 sm:grid-cols-2">
                  {r.candidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onChoose(m.key, { mode: "select", catalogue_id: c.id })}
                      className="rounded-lg border px-3 py-2 text-left transition-colors hover:border-brand-600/60 hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <span className="block font-medium">{c.name}</span>
                      <span className="block text-xs text-muted-foreground">{ingredientText(c)}</span>
                      <span className="mt-1 inline-block text-xs font-semibold text-brand-700">{t("ms.id.pick")}</span>
                    </button>
                  ))}
                </div>
                <Button variant="ghost" size="xs" onClick={() => onChoose(m.key, { mode: "unresolved" })}>
                  {t("ms.id.skip")}
                </Button>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

// ----------------------------------------------------------------------------- medicines
function MedicineCard({ m }: { m: AnalysisMedicine }) {
  const { t } = useI18n();
  const e = m.catalogue_entry;
  const how = [
    m.units_per_dose ? t("ms.med.perDose", { u: m.dosage ?? m.units_per_dose }) : m.dosage,
    m.frequency_info ? `${m.frequency_info.code}: ${freqText(t, m.frequency_info)}` : m.frequency,
    m.timing_info ? `${m.timing_info.code}: ${timingText(t, m.timing_info)}` : null,
    m.duration ? t("ms.med.for", { d: m.duration }) : null,
  ].filter(Boolean) as string[];
  return (
    <article className="surface space-y-3 p-4" aria-label={m.name}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-semibold">
          {m.name}
          {m.strength && <span className="ml-1.5 font-normal text-muted-foreground">{m.strength}</span>}
        </h3>
        {e && (
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
            {t(e.kind === "brand" ? "ms.med.kindBrand" : "ms.med.kindGeneric")}
          </span>
        )}
      </header>
      {e ? (
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("ms.med.contains")}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {e.ingredients.map((i) => (
              <li key={i.id} className="rounded-md bg-ok-bg px-2 py-1 text-sm font-medium text-ok">
                {i.name}
                {i.strength && <span className="ml-1 font-normal">{i.strength.value} {i.strength.unit}</span>}
              </li>
            ))}
          </ul>
          {e.ingredients.length > 1 && <p className="mt-1.5 text-xs text-muted-foreground">{t("ms.med.combo", { n: e.ingredients.length })}</p>}
          {e.name.toLowerCase() !== m.name.toLowerCase() && <p className="mt-1 text-xs text-muted-foreground">{t("ms.med.matched", { name: e.name })}</p>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("ms.id.skipped", { name: m.name })}</p>
      )}
      <div>
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("ms.med.howTaken")}</p>
        {how.length ? (
          <ul className="mt-1 space-y-0.5 text-sm">
            {how.map((h) => (
              <li key={h}>{h}</li>
            ))}
            {m.doses_per_day != null && <li className="text-muted-foreground">{t("ms.med.timesDay", { n: m.doses_per_day })}</li>}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{t("ms.med.noDose")}</p>
        )}
      </div>
    </article>
  );
}

// ----------------------------------------------------------------------------- alerts (importance tiers)
function Tier({ title, items, open: openByDefault }: { title: string; items: SafetyFinding[]; open: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(openByDefault);
  if (!items.length) return null;
  return (
    <div className="space-y-3">
      {openByDefault ? (
        <h3 className="text-sm font-semibold">{title}</h3>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl border bg-card px-4 py-3 text-left text-sm font-semibold hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span>
            {title} <span className="font-normal text-muted-foreground">({items.length})</span>
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
            {open ? t("ms.tier.hide") : t("ms.tier.show", { n: items.length })}
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </span>
        </button>
      )}
      {open && items.map((f) => <FindingCard key={f.id} f={f} />)}
    </div>
  );
}

export function Alerts({ a }: { a: Analysis }) {
  const { t } = useI18n();
  const alerts = a.findings.filter((f) => f.type !== "unresolved_medicine");
  const by = (tier: string) => alerts.filter((f) => f.tier === tier);
  if (!alerts.length) return null;
  return (
    <section aria-labelledby="rx-alerts" className="space-y-4">
      <h2 id="rx-alerts" className="text-base font-semibold">
        {t("ms.sec.alerts")}
      </h2>
      <Tier title={t("ms.tier.act")} items={by("act")} open />
      <Tier title={t("ms.tier.know")} items={by("know")} open={false} />
      <Tier title={t("ms.tier.fyi")} items={by("fyi")} open={false} />
    </section>
  );
}

// ----------------------------------------------------------------------------- the whole result
export function Result({ a, onChoose, onSave, saving }: { a: Analysis; onChoose: (key: string, c: Choice) => void; onSave: () => void; saving: boolean }) {
  const { t } = useI18n();
  const totals = a.ingredient_totals;
  const missing = a.missing_information;
  const limitFor = (ing: string) => a.findings.find((f) => f.type === "dose_concern" && f.evidence?.ingredient_name?.toLowerCase() === ing.toLowerCase())?.evidence?.limit_mg;
  return (
    <div className="space-y-8" aria-live="polite">
      <Headline a={a} />
      <Identify meds={a.medicines} onChoose={onChoose} />
      <Alerts a={a} />

      <section aria-labelledby="rx-meds" className="space-y-3">
        <h2 id="rx-meds" className="flex items-center gap-2 text-base font-semibold">
          <Pill className="size-4 text-brand-600" /> {t("ms.sec.medicines")}
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {a.medicines.map((m) => (
            <MedicineCard key={m.key} m={m} />
          ))}
        </div>
      </section>

      {totals.length > 0 && (
        <section aria-labelledby="rx-totals" className="space-y-2">
          <h2 id="rx-totals" className="text-base font-semibold">
            {t("ms.sec.totals")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("ms.sec.totalsHint")}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {totals.map((x) => {
              const limit = limitFor(x.name);
              return (
                <li key={x.ingredient} className="surface px-4 py-3 text-sm">
                  <p className="font-semibold">
                    {x.name}: <span className="tabular-nums">{x.total_mg.toLocaleString()} mg</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{x.parts.map((p) => `${p.medicine.label}: ${p.mg_per_day.toLocaleString()} mg`).join("  +  ")}</p>
                  {limit != null && <p className="mt-1 text-xs font-medium">{t("ms.totals.limit", { limit: limit.toLocaleString() })}</p>}
                  {!x.complete && <p className="mt-1 text-xs text-warn">{t("ms.totals.incomplete")}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {missing.length > 0 && (
        <details className="surface p-4 text-sm">
          <summary className="cursor-pointer font-semibold">{t("ms.rep.missing")} ({missing.length})</summary>
          <ul className="mt-3 space-y-1.5">
            {missing.map((x, i) => (
              <li key={i} className="rounded-lg bg-muted/60 px-3 py-2">
                {x.medicine && <span className="font-medium">{x.medicine.label}: </span>}
                {x.missing.map((k) => (hasKey(`ms.missing.${k}`) ? t(`ms.missing.${k}` as TKey) : k)).join(", ")}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="surface flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{t("ms.save.hint")}</p>
        <Button onClick={onSave} disabled={saving} variant="outline">
          {saving ? <Loader2 className="animate-spin" /> : <Save />} {t("ms.save")}
        </Button>
      </div>
    </div>
  );
}
