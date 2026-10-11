"use client";

// Overview dashboard sections. Presentational: data comes from /api/v1/dashboard via the page.

import {
  Activity,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardList,
  FileText,
  FlaskConical,
  Loader2,
  MessageSquareText,
  Pill,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AreaSpark } from "@/components/app/area-spark";
import { StatusPill } from "@/components/app/comparison";
import { StatusBadge } from "@/components/app/badges";
import { Disclaimer } from "@/components/app/states";
import { Spinner } from "./loaders";
import { formatDate } from "@/lib/format";
import { currentDateLocale, useI18n, type TKey } from "@/lib/i18n";
import type { Dashboard, Interpretation, TrendTest } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<Interpretation, string> = {
  within_range: "#1D7A57",
  above_range: "#C2502E",
  below_range: "#E09A2D",
  unverified: "#9AA8A0",
};
const LINE = "#0E7A54";

const QUESTIONS = ["ask.q1", "ask.q2", "ask.q3"] as const;

/* ----------------------------------------------------------------------------- small pieces */

function CardTitle({ icon: Icon, title, hint, action }: { icon: React.ComponentType<{ className?: string }>; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="neu-inset flex size-10 items-center justify-center rounded-xl text-brand-600">
          <Icon className="size-[18px]" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

function greetingKey(hour: number): TKey {
  return hour < 12 ? "overview.morning" : hour < 17 ? "overview.afternoon" : "overview.evening";
}

/* ----------------------------------------------------------------------------- hero */

export function Hero({ d, name }: { d?: Dashboard; name?: string }) {
  const { t } = useI18n();
  const [hour] = useState(() => new Date().getHours());
  const [today] = useState(() => new Date().toLocaleDateString(currentDateLocale(), { weekday: "long", day: "numeric", month: "long" }));
  const pending = d?.recent_documents.find((x) => x.status === "needs_review");

  let status: React.ReactNode;
  if (!d) {
    status = (
      <span className="inline-flex items-center gap-2.5 text-sm text-muted-foreground" role="status">
        <Spinner className="size-5" /> {t("load.records")}
      </span>
    );
  } else if (d.stats.pending_review > 0) {
    status = (
      <Link
        href={pending ? `/records/${pending.id}/review` : "/records"}
        className="neu-sm neu-press inline-flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium"
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-sun/90 text-xs font-bold text-[#5a3a05]">{d.stats.pending_review}</span>
        {t("ov.needsLookText")}
        <ArrowRight className="size-4 text-brand-600" />
      </Link>
    );
  } else if (d.stats.processing > 0) {
    status = (
      <span className="neu-sm inline-flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium">
        <Loader2 className="size-4 animate-spin text-brand-600" /> {t("ov.analysing", { n: d.stats.processing })}
      </span>
    );
  } else {
    status = (
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 text-ok" /> {t("overview.caughtUp")}
      </span>
    );
  }

  return (
    <section className="neu relative overflow-hidden p-6 sm:p-8">
      {/* soft decorative rings */}
      <svg aria-hidden="true" className="pointer-events-none absolute -top-24 -right-24 size-[360px] opacity-70" viewBox="0 0 360 360">
        <circle cx="180" cy="180" r="170" fill="none" stroke="#D3E6DC" strokeWidth="1.5" />
        <circle cx="180" cy="180" r="130" fill="none" stroke="#D3E6DC" strokeWidth="1.5" />
        <circle cx="180" cy="180" r="90" fill="#E2EFE8" />
        <circle cx="180" cy="180" r="50" fill="#D3E9DE" />
        <circle cx="62" cy="292" r="16" fill="#F8DFAE" />
        <circle cx="300" cy="64" r="8" fill="#F8DFAE" />
      </svg>

      <div className="relative">
        <p className="text-xs font-semibold tracking-[0.12em] text-brand-600 uppercase">{today}</p>
        <h1 className="mt-2 text-[28px] leading-tight font-semibold tracking-tight sm:text-4xl">
          {t(greetingKey(hour))}
          {name ? `, ${name}` : ""}
        </h1>
        <div className="mt-4">{status}</div>

        <div className="mt-7 flex flex-wrap gap-3">
          <Link
            href="/upload"
            className="neu-press inline-flex h-11 items-center gap-2 rounded-full bg-brand-600 px-5 text-sm font-semibold text-white shadow-[6px_6px_14px_rgba(29,107,80,0.35),-4px_-4px_12px_rgba(255,255,255,0.9)] hover:bg-brand-700"
          >
            <Upload className="size-4" /> {t("overview.uploadReport")}
          </Link>
          <Link href="/assistant" className="neu-sm neu-press inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold text-brand-700">
            <Sparkles className="size-4" /> {t("nav.assistant")}
          </Link>
        </div>

        <dl className="mt-8 grid grid-cols-3 gap-3 sm:max-w-md">
          {[
            { label: t("overview.totalRecords"), value: d?.stats.total_documents, icon: ClipboardList, href: "/records" },
            { label: t("nav.labs"), value: d?.stats.lab_results, icon: FlaskConical, href: "/lab-results" },
            { label: t("ov.medicines"), value: d?.stats.medications, icon: Pill, href: "/timeline" },
          ].map(({ label, value, icon: Icon, href }) => (
            <Link key={label} href={href} className="neu-inset block px-3.5 py-3 transition-opacity hover:opacity-90">
              <Icon className="mb-1.5 size-4 text-brand-600" />
              <dd className="text-xl font-semibold tabular-nums">{value ?? <span className="inline-block h-6 w-6 animate-pulse rounded bg-muted align-middle" aria-hidden="true" />}</dd>
              <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
            </Link>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------------- donut */

function ResultsDonut({ d }: { d: Dashboard }) {
  const { t } = useI18n();
  const b = d.range_breakdown;
  const total = b.within_range + b.above_range + b.below_range + b.unverified;
  const compared = total - b.unverified;
  const rows: { key: Interpretation; label: string; value: number }[] = [
    { key: "within_range", label: t("interp.short.within_range"), value: b.within_range },
    { key: "above_range", label: t("interp.short.above_range"), value: b.above_range },
    { key: "below_range", label: t("interp.short.below_range"), value: b.below_range },
    { key: "unverified", label: t("interp.short.unverified"), value: b.unverified },
  ];
  const data = rows.filter((r) => r.value > 0);

  return (
    <section className="neu flex flex-col p-6">
      <CardTitle icon={Activity} title={t("overview.latestResults")} hint={t("overview.latestHint")} />
      {total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
          <div className="neu-inset mb-3 flex size-24 items-center justify-center rounded-full">
            <FlaskConical className="size-7 text-brand-600" />
          </div>
          <p className="text-sm text-muted-foreground">{t("ov.confirmToCompare")}</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center gap-6 sm:flex-row xl:flex-col 2xl:flex-row">
          <div className="neu-inset relative size-[176px] shrink-0 rounded-full p-3">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="label" innerRadius="70%" outerRadius="100%" paddingAngle={data.length > 1 ? 3 : 0} cornerRadius={6} stroke="none" isAnimationActive={false}>
                  {data.map((r) => (
                    <Cell key={r.key} fill={STATUS_COLOR[r.key]} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-sm">
                        {payload[0].name}: <span className="font-semibold">{String(payload[0].value)}</span>
                      </div>
                    ) : null
                  }
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-3xl font-semibold tabular-nums">{b.within_range}</span>
              <span className="text-[11px] leading-tight text-muted-foreground">
                {t("ov.ofInRange", { n: compared || total })}
              </span>
            </div>
          </div>
          <ul className="w-full space-y-2">
            {rows.map((r) => (
              <li key={r.key}>
                <Link href="/lab-results" className="neu-press flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-muted/70">
                  <span className="flex items-center gap-2.5 text-sm">
                    <span className="size-2.5 rounded-full" style={{ background: STATUS_COLOR[r.key] }} />
                    <StatusPill status={r.key} />
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{r.value}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------------------- trend tiles */

function TrendTile({ test }: { test: TrendTest }) {
  const { t } = useI18n();
  const l = test.latest;
  const out = l.interpretation === "above_range" || l.interpretation === "below_range";
  return (
    <Link href={`/lab-results?test=${encodeURIComponent(test.test)}`} className="neu-sm neu-press flex flex-col p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-medium text-muted-foreground" title={test.display_name}>
          {test.display_name}
        </p>
        <StatusPill status={l.interpretation} />
      </div>
      <p className="mt-2 leading-none">
        <span className={cn("text-[28px] font-semibold tabular-nums", out && "text-warn")}>{l.value_text}</span>
        {l.unit && <span className="ml-1.5 text-xs text-muted-foreground">{l.unit}</span>}
      </p>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {t("ov.expectedOn", { range: l.reference_range_text ?? "—", date: formatDate(l.effective_date) ?? "" })}
      </p>
      <div className="mt-3">
        <AreaSpark points={test.spark} />
      </div>
    </Link>
  );
}

/* ----------------------------------------------------------------------------- monthly bars */

function RecordsOverTime({ d }: { d: Dashboard }) {
  const { t } = useI18n();
  const data = d.monthly.map((m) => ({
    ...m,
    label: new Date(`${m.month}-01T00:00:00`).toLocaleDateString(currentDateLocale(), { month: "short" }),
    full: new Date(`${m.month}-01T00:00:00`).toLocaleDateString(currentDateLocale(), { month: "long", year: "numeric" }),
  }));
  const total = data.reduce((a, m) => a + m.documents, 0);
  return (
    <section className="neu p-6">
      <CardTitle
        icon={Activity}
        title={t("overview.overTime")}
        hint={t("ov.docsInYear", { n: total })}
        action={
          <Link href="/timeline" className="text-xs font-semibold text-brand-600 hover:underline">
            {t("nav.timeline")}
          </Link>
        }
      />
      <div className="neu-inset h-52 px-2 pt-4 pb-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#5D6A62" }} interval={0} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#5D6A62" }} width={40} />
            <Tooltip
              cursor={{ fill: "rgba(29,107,80,0.06)", radius: 8 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const m = payload[0].payload as (typeof data)[number];
                return (
                  <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-sm">
                    <p className="font-medium">{m.full}</p>
                    <p>
                      {t("ov.monthTip", { n: m.documents, c: m.confirmed })}
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="documents" fill={LINE} radius={[6, 6, 2, 2]} maxBarSize={22} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------------- attention / ask / recent */

function Attention({ d }: { d: Dashboard }) {
  const { t } = useI18n();
  return (
    <section className="neu p-6">
      <CardTitle icon={FlaskConical} title={t("overview.attention")} hint={t("ov.attentionHint")} />
      {d.attention.length === 0 ? (
        <div className="neu-inset flex items-center gap-3 px-4 py-5 text-sm">
          <CheckCircle2 className="size-5 shrink-0 text-ok" />
          {t("overview.allClear")}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {d.attention.slice(0, 4).map((o) => (
            <li key={o.id}>
              <Link href={`/records/${o.document_id}`} className="neu-inset neu-press block px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{o.test_name}</p>
                  <StatusPill status={o.interpretation} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {t("ov.yoursExpected", { value: `${o.value_text} ${o.unit ?? ""}`.trim(), range: o.reference_range_text ?? "—" })}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AskCard() {
  const { t } = useI18n();
  return (
    <section className="neu p-6">
      <CardTitle icon={MessageSquareText} title={t("overview.askTitle")} hint={t("assistant.grounded")} />
      <Link href="/assistant" className="neu-inset flex h-12 items-center justify-between gap-3 px-4 text-sm text-muted-foreground hover:text-foreground">
        {t("overview.askPlaceholder")}
        <span className="flex size-8 items-center justify-center rounded-full bg-brand-600 text-white">
          <ArrowRight className="size-4" />
        </span>
      </Link>
      <div className="mt-4 flex flex-wrap gap-2">
        {QUESTIONS.map((k) => t(k)).map((q) => (
          <Link key={q} href={`/assistant?q=${encodeURIComponent(q)}`} className="neu-sm neu-press inline-block max-w-full rounded-2xl px-3.5 py-2 text-left text-xs font-medium">
            {q}
          </Link>
        ))}
      </div>
    </section>
  );
}

function Recent({ d }: { d: Dashboard }) {
  const { t } = useI18n();
  return (
    <section className="neu p-6">
      <CardTitle
        icon={FileText}
        title={t("overview.recentDocs")}
        action={
          <Link href="/records" className="text-xs font-semibold text-brand-600 hover:underline">
            {t("common.viewAll")}
          </Link>
        }
      />
      <ul className="space-y-2">
        {d.recent_documents.slice(0, 4).map((doc) => (
          <li key={doc.id}>
            <Link
              href={doc.status === "needs_review" ? `/records/${doc.id}/review` : `/records/${doc.id}`}
              className="neu-press flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/70"
            >
              <span className="neu-sm flex size-10 shrink-0 items-center justify-center rounded-xl text-brand-600">
                <FileText className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{doc.source_facility ?? doc.file_name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t(`doctype.${doc.doc_type}`)} · {formatDate(doc.document_date) ?? t("ov.uploaded", { date: formatDate(doc.created_at) ?? "" })}
                </span>
              </span>
              <StatusBadge status={doc.status} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GettingStarted({ d, onDismiss }: { d: Dashboard; onDismiss?: () => void }) {
  const { t } = useI18n();
  const steps = [
    { label: t("overview.step1"), done: d.stats.total_documents > 0, href: "/upload", icon: Upload },
    { label: t("overview.step2"), done: d.stats.confirmed_documents > 0, href: "/records", icon: ClipboardList },
    { label: t("overview.step3"), done: d.stats.conversations > 0, href: "/assistant", icon: MessageSquareText },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <section className="neu p-6">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h2 className="text-[15px] font-semibold">{t("overview.getStarted")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("ov.stepsDone", { n: steps.filter((s) => s.done).length, total: steps.length })}
          </p>
        </div>
        {onDismiss && (
          <button type="button" onClick={onDismiss} aria-label={t("common.dismiss")} className="neu-sm neu-press flex size-8 items-center justify-center rounded-full">
            <X className="size-4" />
          </button>
        )}
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map(({ label, done, href, icon: Icon }, i) => (
          <li key={href}>
            <Link href={href} className={cn("flex h-full items-center gap-3 px-4 py-3.5 text-sm", done ? "neu-inset text-muted-foreground" : "neu-sm neu-press", i === next && "font-semibold")}>
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", done || i === next ? "bg-brand-600 text-white" : "bg-white text-brand-600")}>
                {done ? <Check className="size-4" /> : <Icon className="size-4" />}
              </span>
              {label}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ----------------------------------------------------------------------------- view */

export function OverviewView({
  data,
  name,
  showOnboarding,
  onDismissOnboarding,
}: {
  data: Dashboard;
  name?: string;
  showOnboarding: boolean;
  onDismissOnboarding: () => void;
}) {
  const { t } = useI18n();
  const allDone = data.stats.total_documents > 0 && data.stats.confirmed_documents > 0 && data.stats.conversations > 0;

  if (data.stats.total_documents === 0) {
    return (
      <div className="space-y-6">
        <Hero d={data} name={name} />
        <GettingStarted d={data} />
        <Disclaimer />
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div className="grid gap-7 [&>*]:min-w-0 xl:grid-cols-[1.6fr_1fr]">
        <Hero d={data} name={name} />
        <ResultsDonut d={data} />
      </div>

      {!allDone && showOnboarding && <GettingStarted d={data} onDismiss={onDismissOnboarding} />}

      {data.snapshot.length > 0 && (
        <section>
          <div className="mb-4 flex items-end justify-between gap-3 px-1">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">{t("overview.keyTrends")}</h2>
              <p className="text-xs text-muted-foreground">{t("overview.snapshotHint")}</p>
            </div>
            <Link href="/lab-results" className="text-xs font-semibold text-brand-600 hover:underline">
              {t("common.viewAll")}
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {data.snapshot.map((x) => (
              <TrendTile key={x.test} test={x} />
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-7 [&>*]:min-w-0 xl:grid-cols-[1.6fr_1fr]">
        <RecordsOverTime d={data} />
        <Attention d={data} />
      </div>

      <div className="grid gap-7 [&>*]:min-w-0 lg:grid-cols-2">
        <AskCard />
        <Recent d={data} />
      </div>

      <Disclaimer className="px-1" />
    </div>
  );
}
