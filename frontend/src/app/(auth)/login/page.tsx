"use client";

import { Loader2, Lock, ShieldCheck, FileSearch, LineChart } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/app/logo";
import { SetupNotice } from "@/components/app/setup-notice";
import { Disclaimer } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { LANG_LABELS, useI18n } from "@/lib/i18n";
import { getSupabase } from "@/lib/supabase";
import type { Lang } from "@/lib/types";

export default function LoginPage() {
  const { t, lang, setLang } = useI18n();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace("/overview");
  }, [user, loading, router]);

  if (!isSupabaseConfigured) return <SetupNotice />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const sb = getSupabase()!;
    setError(null);
    setNotice(null);
    if (mode === "signup" && password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/overview");
      } else {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: { data: { full_name: name }, emailRedirectTo: `${window.location.origin}/overview` },
        });
        if (error) throw error;
        if (data.session) {
          toast.success("Account created");
          router.replace("/overview");
        } else {
          setNotice(t("auth.checkEmail"));
          setMode("signin");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
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
              { icon: FileSearch, title: "Structured from your documents", body: "Lab values, medicines and diagnoses extracted exactly as written — and checked against the source." },
              { icon: LineChart, title: "A timeline you can trust", body: "Compare repeated tests only when units match, with the reference range printed on each report." },
              { icon: ShieldCheck, title: "Private by default", body: "Files live in private storage. Only you can see your records." },
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
            aria-label="Language"
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
          <p className="mt-1 text-sm text-muted-foreground">
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
              <Input
                id="password"
                type="password"
                required
                minLength={mode === "signup" ? 8 : undefined}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11"
                aria-describedby={mode === "signup" ? "pw-hint" : undefined}
              />
              {mode === "signup" && (
                <p id="pw-hint" className="text-xs text-muted-foreground">
                  At least 8 characters.
                </p>
              )}
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="rounded-lg bg-ok-bg px-3 py-2 text-sm text-ok">
                {notice}
              </p>
            )}
            <Button type="submit" className="h-11 w-full rounded-full" disabled={busy || !email || !password}>
              {busy ? <Loader2 className="animate-spin" /> : <Lock />}
              {mode === "signin" ? t("auth.signin") : t("auth.signup")}
            </Button>
          </form>
          <Disclaimer className="mt-8 lg:hidden" />
        </div>
      </section>
    </main>
  );
}
