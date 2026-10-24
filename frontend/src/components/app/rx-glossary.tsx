"use client";

import { BookOpen } from "lucide-react";
import { hasKey, useI18n, type TKey } from "@/lib/i18n";
import type { FrequencyInfo, TimingInfo } from "@/lib/types";

type T = (k: TKey, v?: Record<string, string | number>) => string;

/** Plain-language meaning of a decoded frequency such as TDS or 1-0-1. */
export function freqText(t: T, info: FrequencyInfo | null): string | null {
  if (!info) return null;
  if (info.meaning === "schedule" && info.slots) {
    const [a, b, c, d] = info.slots;
    return info.slots.length === 4 ? t("ms.abbr.schedule4", { a, b, c, d }) : t("ms.abbr.schedule3", { a, b, c });
  }
  if (info.meaning === "every_n_hours") return t("ms.abbr.every_n_hours", { h: info.hours ?? 0 });
  const key = `ms.abbr.${info.meaning}`;
  return hasKey(key) ? t(key as TKey) : t("ms.abbr.unclear");
}

export function timingText(t: T, info: TimingInfo | null): string | null {
  if (!info) return null;
  const key = `ms.abbr.${info.meaning}`;
  return hasKey(key) ? t(key as TKey) : t("ms.abbr.unclear");
}

const FREQ: [string, string][] = [
  ["OD", "once_daily"],
  ["BD", "twice_daily"],
  ["TDS", "three_times_daily"],
  ["QID", "four_times_daily"],
  ["HS", "at_bedtime"],
  ["SOS", "as_needed"],
  ["STAT", "single_dose_now"],
];
const TIMING: [string, string][] = [
  ["AC", "before_food"],
  ["PC", "after_food"],
];

function Group({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h4>
      <dl className="space-y-1 text-sm">
        {rows.map(([code, text]) => (
          <div key={code} className="flex gap-3">
            <dt className="w-12 shrink-0 font-mono font-semibold text-brand-700">{code}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** "What do OD, BD, TDS, AC mean?" — always one click away on the page. */
export function Glossary() {
  const { t } = useI18n();
  return (
    <details className="surface group p-4">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <BookOpen className="size-4 text-brand-600" /> {t("ms.glossary.title")}
      </summary>
      <p className="mt-3 text-sm text-muted-foreground">{t("ms.glossary.intro")}</p>
      <div className="mt-4 grid gap-5 sm:grid-cols-3">
        <Group title={t("ms.glossary.freq")} rows={FREQ.map(([c, k]) => [c, t(`ms.abbr.${k}` as TKey)])} />
        <Group title={t("ms.glossary.timing")} rows={[...TIMING.map(([c, k]) => [c, t(`ms.abbr.${k}` as TKey)] as [string, string]), ["", t("ms.abbr.with_food")]]} />
        <Group
          title={t("ms.glossary.forms")}
          rows={(["tab", "cap", "syp", "inj"] as const).map((k) => {
            const [code, ...rest] = t(`ms.form.${k}` as TKey).split(" = ");
            return [code, rest.join(" = ")] as [string, string];
          })}
        />
      </div>
      <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2 text-sm">{t("ms.glossary.schedule")}</p>
    </details>
  );
}
