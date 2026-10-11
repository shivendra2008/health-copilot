"use client";

import { FlaskConical, Info, Search, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import useSWR from "swr";
import { CorrectedBadge, InterpBadge } from "@/components/app/badges";
import { Disclaimer, EmptyState, ErrorState, ListSkeleton, PageHeader, Pager } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Observation, Page, TrendDetail, TrendPoint, TrendTest } from "@/lib/types";
import { cn } from "@/lib/utils";

const LINE = "#0E7A54"; // validated (chroma + contrast) step of the brand green
const OUT = "#A35A07";

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: TrendPoint }[] }) {
  const { t } = useI18n();
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-sm">
      <p className="font-medium">{formatDate(p.effective_date)}</p>
      <p className="mt-0.5 tabular-nums">
        <span className="text-sm font-semibold">{p.value_text}</span> {p.unit}
      </p>
      <p className="text-muted-foreground">Printed range: {p.reference_range_text ?? "—"}</p>
      <p className="mt-1">{t(`interp.${p.interpretation}`)}</p>
      {p.is_user_corrected && <p className="text-muted-foreground">Value edited by you</p>}
    </div>
  );
}

function Dot(props: { cx?: number; cy?: number; payload?: TrendPoint }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  const out = payload.interpretation === "above_range" || payload.interpretation === "below_range";
  return <circle cx={cx} cy={cy} r={4.5} fill={out ? OUT : LINE} stroke="#fff" strokeWidth={2} />;
}

function TrendChart({ unit, points }: { unit: string; points: TrendPoint[] }) {
  // Only shade a reference band when every point shares the same printed range.
  const sameRange = points.every((p) => p.ref_low === points[0].ref_low && p.ref_high === points[0].ref_high);
  const lo = sameRange ? points[0].ref_low : null;
  const hi = sameRange ? points[0].ref_high : null;
  const data = points.map((p) => ({ ...p, value_num: Number(p.value_num), ts: new Date(`${p.effective_date}T00:00:00`).getTime() }));
  const values = data.map((d) => d.value_num).concat([lo, hi].filter((x): x is number => x != null).map(Number));
  const pad = (Math.max(...values) - Math.min(...values)) * 0.15 || Math.abs(values[0]) * 0.1 || 1;
  const domain: [number, number] = [Math.max(0, Math.min(...values) - pad), Math.max(...values) + pad];

  return (
    <div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#E2E8E3" strokeDasharray="0" vertical={false} />
            {(lo != null || hi != null) && (
              <ReferenceArea
                y1={lo != null ? Number(lo) : domain[0]}
                y2={hi != null ? Number(hi) : domain[1]}
                fill="#1D6B50"
                fillOpacity={0.07}
                ifOverflow="extendDomain"
              />
            )}
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => formatDate(new Date(v).toISOString(), { month: "short", year: "2-digit" }) ?? ""}
              tick={{ fontSize: 11, fill: "#5D6A62" }}
              axisLine={{ stroke: "#E2E8E3" }}
              tickLine={false}
              padding={{ left: 16, right: 16 }}
            />
            <YAxis
              domain={domain}
              tick={{ fontSize: 11, fill: "#5D6A62" }}
              axisLine={false}
              tickLine={false}
              width={48}
              tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${+v.toFixed(2)}`)}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#5D6A62", strokeDasharray: "3 3" }} />
            <Line type="linear" dataKey="value_num" stroke={LINE} strokeWidth={2} dot={<Dot />} activeDot={{ r: 6, stroke: "#fff", strokeWidth: 2, fill: LINE }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Unit: {unit}</span>
        {(lo != null || hi != null) && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-4 rounded-sm bg-brand-600/10" /> Printed reference range
          </span>
        )}
        {!sameRange && <span>Reference ranges differ between reports — see table.</span>}
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full" style={{ background: OUT }} /> Outside printed range
        </span>
      </div>
    </div>
  );
}

function TrendDetailView({ test }: { test: string }) {
  const { data, error, isLoading, mutate } = useSWR<TrendDetail>(`/api/v1/trends?test=${encodeURIComponent(test)}`);
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (isLoading || !data) return <ListSkeleton rows={3} />;
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">{data.display_name}</h2>
      {data.series.length === 0 && (
        <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No numeric values with units to chart for this test.</p>
      )}
      {data.series.map((s) => (
        <section key={s.unit} className="surface p-4">
          {data.series.length > 1 && (
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Values recorded in {s.unit} ({s.points.length})
            </p>
          )}
          {s.points.length >= 2 ? (
            <TrendChart unit={s.unit} points={s.points} />
          ) : (
            <p className="mb-3 text-sm text-muted-foreground">Only one value in {s.unit} so far — a trend appears after a second confirmed result.</p>
          )}
          <table className="mt-4 w-full text-sm">
            <caption className="sr-only">Values for {data.display_name} in {s.unit}</caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Value</th>
                <th className="hidden py-2 font-medium sm:table-cell">Printed range</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...s.points].reverse().map((p) => (
                <tr key={p.id}>
                  <td className="py-2">
                    <Link href={`/records/${p.document_id}`} className="hover:underline">
                      {formatDate(p.effective_date)}
                    </Link>
                  </td>
                  <td className="py-2 tabular-nums">
                    {p.value_text} {p.unit} {p.is_user_corrected && <CorrectedBadge />}
                  </td>
                  <td className="hidden py-2 text-muted-foreground tabular-nums sm:table-cell">{p.reference_range_text ?? "—"}</td>
                  <td className="py-2">
                    <InterpBadge value={p.interpretation} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {data.series.length > 1 && (
        <p className="flex items-start gap-2 rounded-lg bg-warn-bg p-3 text-xs text-warn">
          <Info className="mt-px size-3.5 shrink-0" /> This test was reported in different units. They are shown separately and never converted or compared directly.
        </p>
      )}
      {data.excluded.length > 0 && (
        <section className="surface p-4">
          <h3 className="text-sm font-semibold">Not charted ({data.excluded.length})</h3>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {data.excluded.map((e) => (
              <li key={e.id}>
                {formatDate(e.effective_date)} — {e.value_text} {e.unit ?? ""}{" "}
                <span className="text-xs">
                  ({e.reason === "missing_unit" ? "no unit recorded" : e.reason === "comparator_value" ? "value is a limit, e.g. “<0.5”" : "not a number"})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" /> {data.note}
      </p>
    </div>
  );
}

function AllResults() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [deb, setDeb] = useState("");
  const [interp, setInterp] = useState("");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => {
      setDeb(q.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);
  const params = new URLSearchParams({ type: "observations", limit: "20", offset: String(offset) });
  if (deb) params.set("q", deb);
  if (interp) params.set("interpretation", interp);
  const { data, error, isLoading, mutate } = useSWR<Page<Observation>>(`/api/v1/health-records?${params}`);

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tests" className="h-10 bg-card pl-9" aria-label="Search tests" />
        </div>
        <select aria-label="Range status" value={interp} onChange={(e) => {
            setInterp(e.target.value);
            setOffset(0);
          }} className="h-10 rounded-lg border bg-card px-3 text-sm">
          <option value="">All statuses</option>
          <option value="out_of_range">Outside printed range</option>
          <option value="within_range">{t("interp.within_range")}</option>
          <option value="unverified">{t("interp.unverified")}</option>
        </select>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <ListSkeleton />
      ) : data.items.length === 0 ? (
        <p className="surface p-8 text-center text-sm text-muted-foreground">No results match.</p>
      ) : (
        <>
          <div className="surface overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Test</th>
                  <th className="px-4 py-2 font-medium">Value</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">Printed range</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="hidden px-4 py-2 font-medium sm:table-cell">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.items.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-2.5">
                      <Link href={`/records/${o.document_id}`} className="font-medium hover:underline">
                        {o.test_name}
                      </Link>
                      {o.category && <div className="text-xs text-muted-foreground">{o.category}</div>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                      {o.value_text} {o.unit} {o.is_user_corrected && <CorrectedBadge />}
                    </td>
                    <td className="hidden px-4 py-2.5 text-muted-foreground tabular-nums md:table-cell">{o.reference_range_text ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <InterpBadge value={o.interpretation} />
                    </td>
                    <td className="hidden px-4 py-2.5 whitespace-nowrap text-muted-foreground sm:table-cell">{formatDate(o.effective_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager total={data.total} limit={20} offset={offset} onChange={setOffset} />
        </>
      )}
    </div>
  );
}

export default function LabResultsPage() {
  const { t } = useI18n();
  const { data, error, isLoading, mutate } = useSWR<{ tests: TrendTest[] }>("/api/v1/trends");
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const tests = useMemo(
    () => (data?.tests ?? []).filter((x) => x.display_name.toLowerCase().includes(filter.toLowerCase())),
    [data, filter],
  );
  const active = selected ?? data?.tests[0]?.test ?? null;

  return (
    <>
      <PageHeader title={t("labs.title")} subtitle={t("labs.subtitle")} />
      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <ListSkeleton rows={6} />
      ) : data.tests.length === 0 ? (
        <EmptyState
          icon={<FlaskConical />}
          title="No confirmed lab results yet"
          body="Upload a lab report and confirm the extracted values. They will appear here and build your trends over time."
          action={
            <Button asChild>
              <Link href="/upload">
                <Upload /> {t("common.upload")}
              </Link>
            </Button>
          }
        />
      ) : (
        <Tabs defaultValue="trends">
          <TabsList className="mb-4">
            <TabsTrigger value="trends">{t("labs.trend")}</TabsTrigger>
            <TabsTrigger value="all">All results</TabsTrigger>
          </TabsList>
          <TabsContent value="trends">
            <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
              <aside className="surface h-fit overflow-hidden">
                <div className="border-b p-2">
                  <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tests" className="h-9" aria-label="Filter tests" />
                </div>
                <ul className="max-h-[60vh] overflow-y-auto py-1" role="listbox" aria-label="Tests">
                  {tests.map((x) => (
                    <li key={x.test}>
                      <button
                        role="option"
                        aria-selected={active === x.test}
                        onClick={() => setSelected(x.test)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted",
                          active === x.test && "bg-brand-50 text-brand-700 hover:bg-brand-50",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{x.display_name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {x.units.join(", ") || "no unit"} · {formatDate(x.latest_date)}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground">{x.count}</span>
                      </button>
                    </li>
                  ))}
                  {tests.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">No tests match.</li>}
                </ul>
              </aside>
              <div className="min-w-0">{active && <TrendDetailView test={active} />}</div>
            </div>
          </TabsContent>
          <TabsContent value="all">
            <AllResults />
          </TabsContent>
        </Tabs>
      )}
      <Disclaimer className="mt-6" />
    </>
  );
}
