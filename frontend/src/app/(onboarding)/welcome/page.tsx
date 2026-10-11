"use client";

import { ArrowLeft, ArrowRight, Check, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/app/logo";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { LANG_LABELS, useI18n } from "@/lib/i18n";
import { en } from "@/lib/locales/en";
import { hi } from "@/lib/locales/hi";
import { mr } from "@/lib/locales/mr";
import { te } from "@/lib/locales/te";
import type { Lang, Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

const SAMPLE: Record<Lang, string> = { en: en["app.tagline"], hi: hi["app.tagline"], mr: mr["app.tagline"], te: te["app.tagline"] };
type Gender = "female" | "male" | "other" | "none";

function Stepper({ step }: { step: number }) {
  const { t } = useI18n();
  const steps = [t("welcome.step.account"), t("welcome.step.language"), t("welcome.step.about"), t("welcome.step.ready")];
  return (
    <ol className="flex items-center gap-2" aria-label={t("welcome.progress")}>
      {steps.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                done ? "bg-brand-600 text-white" : active ? "neu-sm rounded-full! text-brand-700 ring-2 ring-brand-600" : "neu-inset rounded-full! text-muted-foreground",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn("hidden text-xs font-medium sm:inline", active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            {i < steps.length - 1 && <span className={cn("h-px flex-1", done ? "bg-brand-600" : "bg-border")} />}
          </li>
        );
      })}
    </ol>
  );
}

function NumberField({ id, label, unit, value, onChange, min, max, invalid }: { id: string; label: string; unit: string; value: string; onChange: (v: string) => void; min: number; max: number; invalid: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          aria-invalid={invalid}
          placeholder={`${min}–${max}`}
          className="h-11 pr-14"
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}

export default function WelcomePage() {
  const { t, lang, setLang } = useI18n();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [gender, setGender] = useState<Gender>("none");
  const [saving, setSaving] = useState(false);
  const name = (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0] ?? "";

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const bad = {
    age: age !== "" && !(Number(age) >= 0 && Number(age) <= 130 && Number.isInteger(Number(age))),
    height: height !== "" && !(Number(height) >= 30 && Number(height) <= 260),
    weight: weight !== "" && !(Number(weight) >= 1 && Number(weight) <= 400),
  };

  async function finish(withDetails: boolean) {
    if (withDetails && (bad.age || bad.height || bad.weight)) return toast.error(t("welcome.invalid"));
    setSaving(true);
    const sex = gender === "none" ? null : gender;
    const full = withDetails
      ? { preferred_language: lang, sex, age_years: num(age), height_cm: num(height), weight_kg: num(weight), onboarding_completed: true }
      : { preferred_language: lang, onboarding_completed: true };
    try {
      await api<Profile>("/api/v1/profile", { method: "PATCH", json: full });
      setStep(3);
    } catch (e) {
      if (e instanceof ApiError && e.code === "migration_required") {
        // Older database: save what it supports and carry on.
        try {
          await api<Profile>("/api/v1/profile", { method: "PATCH", json: { preferred_language: lang, ...(withDetails ? { sex } : {}) } });
          setStep(3);
        } catch (e2) {
          toast.error(errorMessage(e2));
        }
      } else {
        toast.error(errorMessage(e));
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Logo className="opacity-60" />
      </div>
    );
  }

  return (
    <main className="relative isolate flex min-h-screen flex-col items-center px-4 py-8 sm:py-12">
      <svg aria-hidden="true" className="pointer-events-none absolute top-0 right-0 -z-10 size-[420px] opacity-80" viewBox="0 0 420 420">
        <circle cx="330" cy="90" r="200" fill="none" stroke="#D3E6DC" strokeWidth="1.5" />
        <circle cx="330" cy="90" r="120" fill="#EEF6F1" />
        <circle cx="140" cy="60" r="14" fill="#F8DFAE" />
      </svg>
      <div className="w-full max-w-xl">
        <Logo className="mb-8" />
        <div className="neu p-6 sm:p-9">
          <Stepper step={step} />

          {step === 1 && (
            <section className="mt-8">
              <p className="text-sm font-medium text-brand-700">{t("welcome.hello", { name })}</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">{t("welcome.langTitle")}</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("welcome.langBody")}</p>
              <div role="radiogroup" aria-label={t("common.language")} className="mt-6 space-y-3">
                {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    role="radio"
                    aria-checked={lang === l}
                    onClick={() => setLang(l)}
                    lang={l}
                    className={cn(
                      "flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left transition-[box-shadow,background-color] duration-100",
                      lang === l ? "neu-inset rounded-2xl! ring-2 ring-brand-600" : "neu-sm neu-press rounded-2xl!",
                    )}
                  >
                    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border-2", lang === l ? "border-brand-600 bg-brand-600 text-white" : "border-border")}>
                      {lang === l && <Check className="size-3.5" />}
                    </span>
                    <span>
                      <span className="block text-base font-semibold">{LANG_LABELS[l]}</span>
                      <span className="block text-sm text-muted-foreground">{SAMPLE[l]}</span>
                    </span>
                  </button>
                ))}
              </div>
              <Button size="lg" className="mt-8 h-11 w-full rounded-full" onClick={() => setStep(2)}>
                {t("common.continue")} <ArrowRight />
              </Button>
            </section>
          )}

          {step === 2 && (
            <section className="mt-8">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{t("welcome.aboutTitle")}</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{t("welcome.aboutBody")}</p>
              <div className="mt-6 space-y-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <NumberField id="age" label={t("profile.age")} unit={t("profile.years")} value={age} onChange={setAge} min={0} max={130} invalid={bad.age} />
                  <NumberField id="height" label={t("profile.height")} unit={t("profile.cm")} value={height} onChange={setHeight} min={30} max={260} invalid={bad.height} />
                  <NumberField id="weight" label={t("profile.weight")} unit={t("profile.kg")} value={weight} onChange={setWeight} min={1} max={400} invalid={bad.weight} />
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm font-medium" id="gender-label">
                    {t("profile.gender")}
                  </p>
                  <div className="overflow-x-auto pb-1">
                    <Segmented
                      label={t("profile.gender")}
                      value={gender}
                      onChange={setGender}
                      options={[
                        { value: "female", label: t("profile.female") },
                        { value: "male", label: t("profile.male") },
                        { value: "other", label: t("profile.other") },
                        { value: "none", label: t("profile.preferNot") },
                      ]}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Button variant="ghost" onClick={() => setStep(1)} disabled={saving}>
                  <ArrowLeft /> {t("common.back")}
                </Button>
                <div className="flex flex-col-reverse gap-3 sm:flex-row">
                  <Button variant="outline" className="h-11 rounded-full" onClick={() => finish(false)} disabled={saving}>
                    {t("common.skip")}
                  </Button>
                  <Button size="lg" className="h-11 rounded-full px-6" onClick={() => finish(true)} disabled={saving}>
                    {saving ? <Loader2 className="animate-spin" /> : <ArrowRight />} {t("common.continue")}
                  </Button>
                </div>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="mt-8 text-center">
              <div className="neu-sm mx-auto flex size-16 items-center justify-center rounded-full! text-brand-600">
                <Check className="size-7" />
              </div>
              <h1 className="mt-5 text-2xl font-semibold tracking-tight sm:text-[28px]">{t("welcome.readyTitle", { name })}</h1>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{t("welcome.readyBody")}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <Button asChild size="lg" className="h-11 rounded-full px-6">
                  <Link href="/upload">
                    <Upload /> {t("welcome.uploadFirst")}
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="h-11 rounded-full px-6">
                  <Link href="/overview">{t("welcome.goOverview")}</Link>
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
