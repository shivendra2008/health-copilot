"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { en, type Dict, type TKey } from "./locales/en";
import { hi } from "./locales/hi";
import { mr } from "./locales/mr";
import type { Lang } from "./types";

export type { TKey };

const DICTS: Record<Lang, Dict> = { en, hi, mr };
export const LANG_LABELS: Record<Lang, string> = { en: "English", hi: "हिन्दी", mr: "मराठी" };
const DATE_LOCALE: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" };

type Vars = Record<string, string | number>;

function fill(template: string, vars?: Vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

// Module-level copy of the active language, for code that runs outside React (error text, date formatting).
let current: Lang = "en";

/** Translate outside components. Inside components prefer `useI18n().t`. */
export function tr(key: TKey, vars?: Vars): string {
  return fill(DICTS[current][key] ?? en[key] ?? key, vars);
}
export function hasKey(key: string): key is TKey {
  return key in en;
}
export function currentDateLocale() {
  return DATE_LOCALE[current];
}

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: TKey, vars?: Vars) => string;
}

const Ctx = createContext<I18nCtx>({ lang: "en", setLang: () => {}, t: (k, v) => fill(en[k], v) });

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("hc.lang") as Lang | null;
      // read after hydration so server and client markup match
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved && saved in DICTS) setLangState(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);
  // Keep the module copy in sync during render so tr()/dates used by children are never one render behind.
  // eslint-disable-next-line react-hooks/globals
  current = lang;
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    current = l;
    setLangState(l);
    try {
      localStorage.setItem("hc.lang", l);
    } catch {
      /* ignore */
    }
  }, []);
  const t = useCallback((k: TKey, vars?: Vars) => fill(DICTS[lang][k] ?? en[k] ?? k, vars), [lang]);
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
