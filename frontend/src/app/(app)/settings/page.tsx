"use client";

import { CheckCircle2, Download, Fingerprint, Loader2, LogOut, Save, ShieldCheck, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Disclaimer, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LANG_LABELS, useI18n } from "@/lib/i18n";
import type { HealthStatus, Lang, Profile } from "@/lib/types";

const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-danger" />}
      <span>{label}</span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
    </li>
  );
}

export default function SettingsPage() {
  const { t, lang, setLang } = useI18n();
  const { signOut } = useAuth();
  const router = useRouter();
  const { data: profile, error, mutate } = useSWR<Profile>("/api/v1/profile", {
    onSuccess: (p) => p.preferred_language && p.preferred_language !== lang && setLang(p.preferred_language),
  });
  const { data: health } = useSWR<HealthStatus>("/api/v1/health");
  const [edits, setForm] = useState<Partial<Profile>>({});
  const [saving, setSaving] = useState(false);
  const [abhaBusy, setAbhaBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!profile) return <ListSkeleton rows={5} />;
  const form: Partial<Profile> = { ...profile, ...edits };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api<Profile>("/api/v1/profile", {
        method: "PATCH",
        json: {
          full_name: form.full_name || null,
          sex: form.sex || null,
          age_years: form.age_years ?? null,
          height_cm: form.height_cm ?? null,
          weight_kg: form.weight_kg ?? null,
          blood_group: form.blood_group || null,
          preferred_language: form.preferred_language,
        },
      });
      await mutate(updated, { revalidate: false });
      setForm({});
      if (updated.preferred_language) setLang(updated.preferred_language);
      toast.success(t("set.saved"));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function genAbha() {
    setAbhaBusy(true);
    try {
      await mutate(await api<Profile>("/api/v1/profile/mock-abha", { method: "POST" }), { revalidate: false });
      toast.success(t("set.abhaDone"));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setAbhaBusy(false);
    }
  }

  async function exportFhir() {
    setExporting(true);
    try {
      const bundle = await api<object>("/api/v1/fhir/bundle");
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/fhir+json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `health-copilot-fhir-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader title={t("settings.title")} />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <form onSubmit={save} className="surface space-y-4 p-5">
          <h2 className="text-sm font-semibold">{t("settings.profile")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pname">{t("auth.fullName")}</Label>
              <Input id="pname" value={form.full_name ?? ""} maxLength={120} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input id="email" value={profile.email ?? ""} disabled />
            </div>
            {(
              [
                ["age_years", t("profile.age"), t("profile.years"), 0, 130],
                ["height_cm", t("profile.height"), t("profile.cm"), 30, 260],
                ["weight_kg", t("profile.weight"), t("profile.kg"), 1, 400],
              ] as const
            ).map(([key, label, unit, min, max]) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={key}>{label}</Label>
                <div className="relative">
                  <Input
                    id={key}
                    type="number"
                    inputMode="decimal"
                    min={min}
                    max={max}
                    value={form[key] ?? ""}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value === "" ? null : Number(e.target.value) })}
                    className="pr-14"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">{unit}</span>
                </div>
              </div>
            ))}
            <div className="space-y-1.5">
              <Label htmlFor="sex">{t("profile.gender")}</Label>
              <select id="sex" value={form.sex ?? ""} onChange={(e) => setForm({ ...form, sex: (e.target.value || null) as Profile["sex"] })} className="h-9 w-full field px-2 text-sm">
                <option value="">{t("profile.preferNot")}</option>
                <option value="female">{t("profile.female")}</option>
                <option value="male">{t("profile.male")}</option>
                <option value="other">{t("profile.other")}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="blood">{t("set.blood")}</Label>
              <select id="blood" value={form.blood_group ?? ""} onChange={(e) => setForm({ ...form, blood_group: e.target.value || null })} className="h-9 w-full field px-2 text-sm">
                <option value="">{t("set.notSet")}</option>
                {BLOOD.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="lang">{t("settings.language")}</Label>
              <select id="lang" value={form.preferred_language ?? "en"} onChange={(e) => setForm({ ...form, preferred_language: e.target.value as Lang })} className="h-9 w-full field px-2 text-sm">
                {(Object.keys(LANG_LABELS) as Lang[]).map((l) => <option key={l} value={l}>{LANG_LABELS[l]}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">{t("set.langHint")}</p>
            </div>
          </div>
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} {t("common.save")}
          </Button>
        </form>

        <div className="space-y-6">
          <section className="surface space-y-3 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Fingerprint className="size-4 text-brand-600" /> {t("settings.abha")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("set.abhaBody")}
            </p>
            {profile.mock_abha_id ? (
              <p className="rounded-lg border border-dashed bg-muted/50 px-3 py-2 font-mono text-sm">{profile.mock_abha_id}</p>
            ) : null}
            <Button variant="outline" size="sm" onClick={genAbha} disabled={abhaBusy}>
              {abhaBusy && <Loader2 className="animate-spin" />} {profile.mock_abha_id ? t("set.abhaRegen") : t("set.abhaGen")}
            </Button>
          </section>

          <section className="surface space-y-3 p-5">
            <h2 className="text-sm font-semibold">{t("settings.fhir")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("set.fhirBody")}
            </p>
            <Button variant="outline" size="sm" onClick={exportFhir} disabled={exporting}>
              {exporting ? <Loader2 className="animate-spin" /> : <Download />} {t("set.download")}
            </Button>
          </section>

          <section className="surface space-y-3 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-brand-600" /> {t("settings.privacy")}</h2>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>{t("set.p1")}</li>
              <li>{t("set.p2")}</li>
              <li>{t("set.p3")}</li>
              <li>{t("set.p4")}</li>
              <li>{t("set.p5")}</li>
            </ul>
            {health && (
              <ul className="space-y-1.5 border-t pt-3">
                <StatusRow ok={health.supabase_configured} label={t("set.dbStatus")} />
                <StatusRow ok={health.ai_configured} label={t("set.aiStatus")} detail={health.ai_model} />
                <StatusRow ok={health.ocr_available} label={t("set.ocrStatus")} />
              </ul>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await signOut();
                router.replace("/login");
              }}
            >
              <LogOut /> {t("nav.signout")}
            </Button>
          </section>
        </div>
      </div>
      <Disclaimer className="mt-6" />
    </>
  );
}
