"use client";

import { CheckCircle2, CircleHelp, HelpCircle, Loader2, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useI18n, type TKey } from "@/lib/i18n";
import type { CatalogueEntry, ConfirmedMedication, CurrentStatus, UncertainField } from "@/lib/types";
import { cn } from "@/lib/utils";

const BASE = "/api/v1/medication-safety";
const FIELDS: { key: Extract<UncertainField, "name" | "strength" | "dosage" | "frequency">; label: TKey; wide?: boolean }[] = [
  { key: "name", label: "ms.med.name", wide: true },
  { key: "strength", label: "ms.med.strength" },
  { key: "dosage", label: "ms.med.dosage" },
  { key: "frequency", label: "ms.med.frequency" },
];

function ingredientsText(e: CatalogueEntry) {
  return e.ingredients.map((i) => (i.strength ? `${i.name} ${i.strength.value} ${i.strength.unit}` : i.name)).join(" + ");
}

/** Whether a medicine still needs the user's attention before it can be fully checked. */
export function needsAttention(m: ConfirmedMedication) {
  return !["resolved", "user_selected"].includes(m.resolution_status) && m.resolution_status !== "user_unresolved";
}

function Candidate({ entry, onPick, disabled }: { entry: CatalogueEntry; onPick: () => void; disabled: boolean }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      className="flex w-full flex-col items-start rounded-lg border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-brand-600/50 hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
    >
      <span className="font-medium">{entry.name}</span>
      <span className="text-xs text-muted-foreground">{t("ms.res.contains", { list: ingredientsText(entry) })}</span>
    </button>
  );
}

function CatalogueSearch({ onPick, disabled }: { onPick: (id: string) => void; disabled: boolean }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const { data } = useSWR<{ items: CatalogueEntry[] }>(q.trim().length >= 2 ? `${BASE}/medicines/search?q=${encodeURIComponent(q.trim())}` : null);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ms.res.search")} aria-label={t("ms.res.search")} className="pl-8" maxLength={100} />
      </div>
      {data?.items.map((e) => <Candidate key={e.id} entry={e} disabled={disabled} onPick={() => onPick(e.id)} />)}
    </div>
  );
}

function Resolution({ med, busy, onResolve }: { med: ConfirmedMedication; busy: boolean; onResolve: (r: { action: "select"; catalogue_id: string } | { action: "unresolved" }) => void }) {
  const { t } = useI18n();
  const [searching, setSearching] = useState(false);
  const s = med.resolution_status;
  const matched = s === "resolved" || s === "user_selected";
  return (
    <div className={cn("rounded-lg border px-3 py-2.5 text-sm", matched ? "bg-ok-bg/50" : s === "user_unresolved" ? "bg-muted/50" : "border-warn/40 bg-warn-bg/60")}>
      {matched && med.catalogue_entry ? (
        <>
          <p className="flex items-start gap-1.5 font-medium">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
            {t(s === "user_selected" ? "ms.res.userSelected" : "ms.res.resolved", { name: med.catalogue_entry.name })}
          </p>
          <p className="mt-0.5 pl-5.5 text-xs text-muted-foreground">
            {t("ms.res.contains", { list: ingredientsText(med.catalogue_entry) })} · {t("ms.res.confidence", { level: t(`ms.conf.${med.resolution_confidence}` as TKey) })}
          </p>
        </>
      ) : (
        <p className="flex items-start gap-1.5 font-medium">
          <HelpCircle className="mt-0.5 size-4 shrink-0 text-warn" />
          {t(s === "ambiguous" ? "ms.res.ambiguous" : s === "user_unresolved" ? "ms.res.userUnresolved" : "ms.res.unresolved")}
        </p>
      )}

      {s === "ambiguous" && (
        <div className="mt-2 space-y-1.5">
          {med.resolution_candidates.map((c) => (
            <Candidate key={c.id} entry={c} disabled={busy} onPick={() => onResolve({ action: "select", catalogue_id: c.id })} />
          ))}
        </div>
      )}
      {!matched && <p className="mt-2 text-xs text-muted-foreground">{t("ms.res.unresolvedNote")}</p>}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="xs" onClick={() => setSearching((v) => !v)} aria-expanded={searching}>
          <Search /> {t(matched ? "ms.res.change" : "ms.res.search")}
        </Button>
        {s !== "user_unresolved" && (
          <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => onResolve({ action: "unresolved" })}>
            {t("ms.res.none")}
          </Button>
        )}
      </div>
      {searching && (
        <div className="mt-2">
          <CatalogueSearch disabled={busy} onPick={(id) => { setSearching(false); onResolve({ action: "select", catalogue_id: id }); }} />
        </div>
      )}
    </div>
  );
}

/** One confirmed medicine: edit details, flag uncertain fields, state whether it is current, resolve the brand. */
export function MedCard({ med, onChanged }: { med: ConfirmedMedication; onChanged: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState({ name: med.name, strength: med.strength ?? "", dosage: med.dosage ?? "", frequency: med.frequency ?? "" });
  const [unc, setUnc] = useState<UncertainField[]>(med.uncertain_fields);
  const [busy, setBusy] = useState(false);
  const dirty =
    f.name !== med.name ||
    f.strength !== (med.strength ?? "") ||
    f.dosage !== (med.dosage ?? "") ||
    f.frequency !== (med.frequency ?? "") ||
    [...unc].sort().join() !== [...med.uncertain_fields].sort().join();

  async function patch(body: Record<string, unknown>, ok?: string) {
    setBusy(true);
    try {
      await api(`${BASE}/confirmed-medications/${med.id}`, { method: "PATCH", json: body });
      if (ok) toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("ms.med.removeConfirm"))) return;
    setBusy(true);
    try {
      await api(`${BASE}/confirmed-medications/${med.id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  }

  const toggle = (k: UncertainField) => setUnc((u) => (u.includes(k) ? u.filter((x) => x !== k) : [...u, k]));

  return (
    <div className="surface space-y-4 p-4" aria-busy={busy}>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(({ key, label, wide }) => {
          const isUnc = unc.includes(key);
          return (
            <div key={key} className={cn("space-y-1", wide && "sm:col-span-2")}>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`${med.id}-${key}`} className="text-xs font-medium text-muted-foreground">
                  {t(label)}
                </label>
                <button
                  type="button"
                  aria-pressed={isUnc}
                  onClick={() => toggle(key)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                    isUnc ? "bg-warn-bg text-warn" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <CircleHelp className="size-3" /> {t("ms.med.uncertain")}
                </button>
              </div>
              <Input
                id={`${med.id}-${key}`}
                value={f[key]}
                maxLength={key === "name" ? 200 : 120}
                onChange={(e) => setF((s) => ({ ...s, [key]: e.target.value }))}
                className={cn(isUnc && "border-warn/60 bg-warn-bg/30")}
              />
            </div>
          );
        })}
      </div>

      {med.prescription_date && <p className="text-xs text-muted-foreground">{t("ms.med.prescribed", { date: formatDate(med.prescription_date) ?? "" })}</p>}

      <Resolution med={med} busy={busy} onResolve={(resolution) => patch({ resolution })} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{t("ms.med.status")}</p>
          <Segmented<CurrentStatus>
            size="sm"
            label={t("ms.med.status")}
            value={med.current_status}
            onChange={(v) => patch({ current_status: v })}
            options={[
              { value: "current", label: t("ms.med.current") },
              { value: "past", label: t("ms.med.past") },
              { value: "unknown", label: t("ms.med.unknown") },
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove} aria-label={t("ms.med.remove")}>
            <Trash2 /> {t("ms.med.remove")}
          </Button>
          {dirty && (
            <Button
              type="button"
              size="sm"
              disabled={busy || !f.name.trim()}
              onClick={() => {
                // Only send what changed: a changed name/strength re-resolves the match, an unchanged one must keep it.
                const body: Record<string, unknown> = {};
                if (f.name.trim() !== med.name) body.name = f.name.trim();
                if (f.strength !== (med.strength ?? "")) body.strength = f.strength;
                if (f.dosage !== (med.dosage ?? "")) body.dosage = f.dosage;
                if (f.frequency !== (med.frequency ?? "")) body.frequency = f.frequency;
                if ([...unc].sort().join() !== [...med.uncertain_fields].sort().join()) body.uncertain_fields = unc;
                patch(body, t("ms.med.saved"));
              }}
            >
              {busy && <Loader2 className="animate-spin" />} {t("ms.med.save")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
