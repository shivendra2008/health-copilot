"use client";

import { ArrowRight, Eye, EyeOff, FileSearch, LineChart, Loader2, Lock, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/app/logo";
import { SetupNotice } from "@/components/app/setup-notice";
import { Disclaimer } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { LANG_LABELS, useI18n } from "@/lib/i18n";
import { getSupabase } from "@/lib/supabase";
import type { Lang } from "@/lib/types";

function authErrorText(err: unknown, t: ReturnType<typeof useI18n>["t"]) {
  if (err instanceof ApiError) return errorMessage(err);
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  if (msg.includes("invalid login")) return t("auth.invalid");
  if (msg.includes("not confirmed")) return t("auth.unconfirmed");
  return t("auth.failed");
}

export default function LoginPage() {
  const { t, lang, setLang } = useI18n();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signingUp = useRef(false);

  useEffect(() => {
    // After sign-up we route to /welcome ourselves.
    if (!loading && user && !signingUp.current) router.replace("/overview");
  }, [user, loading, router]);

  if (!isSupabaseConfigured) return <SetupNotice />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabase()!;
    setError(null);
    if (mode === "signup" && !name.trim()) return setError(t("auth.nameRequired"));
    if (mode === "signup" && password.length < 8) return setError(t("auth.pwShort"));
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/overview");
      } else {
        signingUp.current = true;
        // The backend creates the account already confirmed, so no verification email is needed.
        await api("/api/v1/auth/signup", { method: "POST", json: { full_name: name.trim(), email: email.trim(), password } });
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        router.replace("/welcome");
      }
    } catch (err) {
      signingUp.current = false;
      setError(authErrorText(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative isolate hidden flex-col justify-between overflow-hidden p-12 lg:flex">
        <svg aria-hidden="true" className="pointer-events-none absolute -right-40 -bottom-40 -z-10 size-[560px]" viewBox="0 0 560 560">
          <circle cx="280" cy="280" r="270" fill="none" stroke="#D3E6DC" strokeWidth="1.5" />
          <circle cx="280" cy="280" r="200" fill="none" stroke="#D3E6DC" strokeWidth="1.5" />
          <circle cx="280" cy="280" r="130" fill="#E2EFE8" />
          <circle cx="280" cy="280" r="70" fill="#D3E9DE" />
          <circle cx="470" cy="70" r="18" fill="#F8DFAE" />
        </svg>
        <Logo />
        <div className="max-w-md">
          <h2 className="text-4xl leading-tight font-semibold tracking-tight">{t("app.tagline")}</h2>
          <ul className="mt-8 space-y-5 text-sm">
            {[
              { icon: FileSearch, title: t("auth.feature1.title"), body: t("auth.feature1.body") },
              { icon: LineChart, title: t("auth.feature2.title"), body: t("auth.feature2.body") },
              { icon: ShieldCheck, title: t("auth.feature3.title"), body: t("auth.feature3.body") },
            ].map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-3">
                <span className="neu-sm mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl! text-brand-600">
                  <Icon className="size-4" />
                </span>
                <span>
                  <span className="block font-medium">{title}</span>
                  <span className="text-muted-foreground">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <Disclaimer />
      </section>

      <section className="relative flex flex-col justify-center px-5 py-8 sm:px-10">
        <div className="flex items-center justify-between lg:absolute lg:top-8 lg:right-10 lg:left-10">
          <Logo className="lg:invisible" />
          <select
            aria-label={t("common.language")}
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="h-9 field px-2 text-sm"
          >
            {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
              <option key={l} value={l}>
                {LANG_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
        <div className="neu mx-auto my-10 flex w-full max-w-md flex-1 flex-col justify-center p-7 sm:p-10 lg:flex-none">
          <h1 className="text-2xl font-semibold tracking-tight">{mode === "signin" ? t("auth.signin") : t("auth.signup")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{mode === "signin" ? t("auth.signinLead") : t("auth.signupLead")}</p>
          <p className="mt-3 text-sm text-muted-foreground">
            {mode === "signin" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
            <button
              type="button"
              className="font-medium text-brand-600 hover:underline"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
              }}
            >
              {mode === "signin" ? t("auth.signup") : t("auth.signin")}
            </button>
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">{t("auth.fullName")}</Label>
                <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">{t("auth.password")}</Label>
              <div className="relative">
              <Input
                id="password"
                type={showPw ? "text" : "password"}
                required
                minLength={mode === "signup" ? 8 : undefined}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 pr-11"
                aria-describedby={mode === "signup" ? "pw-hint" : undefined}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? t("auth.hidePw") : t("auth.showPw")}
                className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
              >
                {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
              </div>
              {mode === "signup" && (
                <p id="pw-hint" className="text-xs text-muted-foreground">
                  {t("auth.pwHint")}
                </p>
              )}
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" className="h-11 w-full rounded-full" disabled={busy || !email || !password || (mode === "signup" && !name.trim())}>
              {busy ? <Loader2 className="animate-spin" /> : mode === "signin" ? <Lock /> : <ArrowRight />}
              {busy && mode === "signup" ? t("auth.creating") : mode === "signin" ? t("auth.signin") : t("common.continue")}
            </Button>
          </form>
          <Disclaimer className="mt-8 lg:hidden" />
        </div>
      </section>
    </main>
  );
}
