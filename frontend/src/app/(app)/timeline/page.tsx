"use client";

import { Activity, CalendarClock, FileText, FlaskConical, Pill, Stethoscope, Syringe, Upload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWRInfinite from "swr/infinite";
import { Disclaimer, EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import { tr, useI18n } from "@/lib/i18n";
import type { DocType, Page, TimelineEvent } from "@/lib/types";

const LIMIT = 30;
const ICONS: Record<TimelineEvent["event_type"], React.ComponentType<{ className?: string }>> = {
  document: FileText,
  lab_result: FlaskConical,
  medication: Pill,
  diagnosis: Stethoscope,
  procedure: Syringe,
  follow_up: CalendarClock,
};
const EVENT_TYPES = ["document", "lab_result", "medication", "diagnosis", "procedure", "follow_up"] as const;
const DOC_TYPES: DocType[] = ["lab_report", "prescription", "diagnostic_report", "discharge_summary", "other"];

/**
 * Event text in the user's language. Structured `meta` (newer events) is translated directly;
 * older events fall back to recognising the English patterns the server used to write.
 * Medical names and dosages are always shown exactly as recorded.
 */
function eventText(e: TimelineEvent): { title: string; description: string | null } {
  const m = (e.meta ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => Number(v ?? 0);
  switch (e.event_type) {
    case "document": {
      const docType = (m.doc_type as DocType | undefined) ?? e.documents?.doc_type;
      const facility = (m.facility as string | undefined) ?? e.title.split(" — ")[1];
      const title = docType ? `${tr(`doctype.${docType}`)}${facility ? ` — ${facility}` : ""}` : e.title;
      if (!e.meta) return { title, description: e.description };
      const parts = [
        n(m.lab_results) ? tr("tl.nLabs", { n: n(m.lab_results) }) + (n(m.out_of_range) ? ` (${tr("tl.nOutside", { n: n(m.out_of_range) })})` : "") : "",
        n(m.medications) ? tr("tl.nMeds", { n: n(m.medications) }) : "",
        n(m.conditions) ? tr("tl.nConds", { n: n(m.conditions) }) : "",
      ].filter(Boolean);
      return { title, description: parts.join(", ") || null };
    }
    case "lab_result": {
      const count = m.count ?? e.title.match(/^(\d+)/)?.[1];
      return { title: count ? tr("tl.labsRecorded", { n: n(count) }) : e.title, description: e.description };
    }
    case "medication": {
      const name = (m.name as string | undefined) ?? e.title.replace(/^Prescribed:\s*/, "");
      return { title: tr("tl.prescribed", { name }), description: e.description };
    }
    case "diagnosis":
      return { title: e.title, description: tr("tl.asDocumented") };
    case "follow_up":
      return { title: tr("tl.followUp"), description: e.description };
    default:
      return { title: e.title, description: e.description };
  }
}

export default function TimelinePage() {
  const { t } = useI18n();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [eventType, setEventType] = useState("");
  const [docType, setDocType] = useState("");
  const [category, setCategory] = useState("");

  const base = new URLSearchParams({ limit: String(LIMIT) });
  if (from) base.set("date_from", from);
  if (to) base.set("date_to", to);
  if (eventType) base.set("event_type", eventType);
  if (docType) base.set("doc_type", docType);
  if (category.trim()) base.set("category", category.trim());

  const { data, error, isLoading, size, setSize, mutate } = useSWRInfinite<Page<TimelineEvent>>((i, prev) => {
    if (prev && prev.offset + prev.limit >= prev.total) return null;
    const p = new URLSearchParams(base);
    p.set("offset", String(i * LIMIT));
    return `/api/v1/timeline?${p}`;
  });
  const events = data?.flatMap((p) => p.items) ?? [];
  const total = data?.[0]?.total ?? 0;
  const filtered = Boolean(from || to || eventType || docType || category);

  const groups = events.reduce<Record<string, TimelineEvent[]>>((acc, e) => {
    const k = e.event_date.slice(0, 7);
    (acc[k] ??= []).push(e);
    return acc;
  }, {});

  return (
    <>
      <PageHeader title={t("timeline.title")} subtitle={t("timeline.subtitle")} />
      <div className="surface mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1">
          <Label htmlFor="from" className="text-xs">{t("common.from")}</Label>
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to" className="text-xs">{t("common.to")}</Label>
          <Input id="to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="etype" className="text-xs">{t("tl.event")}</Label>
          <select id="etype" value={eventType} onChange={(e) => setEventType(e.target.value)} className="h-9 w-full field px-2 text-sm">
            <option value="">{t("common.all")}</option>
            {EVENT_TYPES.map((k) => (
              <option key={k} value={k}>{t(`tl.type.${k}`)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="dtype" className="text-xs">{t("tl.docType")}</Label>
          <select id="dtype" value={docType} onChange={(e) => setDocType(e.target.value)} className="h-9 w-full field px-2 text-sm">
            <option value="">{t("common.all")}</option>
            {DOC_TYPES.map((d) => (
              <option key={d} value={d}>{t(`doctype.${d}`)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cat" className="text-xs">{t("tl.category")}</Label>
          <Input id="cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={t("tl.categoryPh")} className="h-9" />
        </div>
        {filtered && (
          <div className="sm:col-span-2 lg:col-span-5">
            <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); setEventType(""); setDocType(""); setCategory(""); }}>
              {t("common.clear")}
            </Button>
          </div>
        )}
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading ? (
        <ListSkeleton rows={6} />
      ) : events.length === 0 ? (
        <EmptyState
          icon={<Activity />}
          title={filtered ? t("tl.noMatch") : t("tl.empty")}
          body={filtered ? undefined : t("tl.emptyBody")}
          action={!filtered && (<Button asChild><Link href="/upload"><Upload /> {t("common.upload")}</Link></Button>)}
        />
      ) : (
        <div className="space-y-8">
          {Object.entries(groups).map(([month, evs]) => (
            <section key={month}>
              <h2 className="sticky top-14 z-10 mb-3 bg-[var(--neu-surface)]/90 py-1.5 backdrop-blur text-xs font-semibold tracking-wide text-muted-foreground uppercase lg:top-0">
                {formatDate(`${month}-01`, { month: "long", year: "numeric" })}
              </h2>
              <ol className="relative ml-4 space-y-3 border-l-2 border-[var(--neu-edge)] pl-6">
                {evs.map((e) => {
                  const Icon = ICONS[e.event_type];
                  return (
                    <li key={e.id} className="relative">
                      <span className="neu-sm absolute top-3 -left-[39px] flex size-7 items-center justify-center rounded-full! text-brand-600">
                        <Icon className="size-3.5" />
                      </span>
                      <div className="surface p-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <p className="text-sm font-medium">{eventText(e).title}</p>
                          <time className="text-xs text-muted-foreground" dateTime={e.event_date}>{formatDate(e.event_date)}</time>
                        </div>
                        {eventText(e).description && <p className="mt-0.5 text-sm text-muted-foreground">{eventText(e).description}</p>}
                        {e.document_id && (
                          <Link href={`/records/${e.document_id}`} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                            <FileText className="size-3" /> {e.documents?.file_name ?? t("tl.viewSource")}
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
          {events.length < total && (
            <div className="text-center">
              <Button variant="outline" onClick={() => setSize(size + 1)}>{t("tl.loadMore", { n: total - events.length })}</Button>
            </div>
          )}
        </div>
      )}
      <Disclaimer className="mt-8" />
    </>
  );
}
