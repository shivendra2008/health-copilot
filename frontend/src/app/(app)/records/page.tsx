"use client";

import { ChevronRight, ClipboardList, Loader2, RotateCcw, Search, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { StatusBadge } from "@/components/app/badges";
import { DeleteDocumentButton } from "@/components/app/delete-dialog";
import { DOC_ICON } from "@/components/app/doc-icon";
import { Segmented } from "@/components/app/segmented";
import { EmptyState, ErrorState, ListSkeleton, PageHeader, Pager } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { fileSize, formatDate, isProcessing } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { DocType, DocumentMeta, Page } from "@/lib/types";

const LIMIT = 15;
const DOC_TYPES: DocType[] = ["lab_report", "prescription", "diagnostic_report", "discharge_summary", "other"];

export default function RecordsPage() {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [docType, setDocType] = useState("");
  const [offset, setOffset] = useState(0);
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setDebounced(q.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(id);
  }, [q]);

  const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
  if (debounced) params.set("q", debounced);
  if (status) params.set("status", status);
  if (docType) params.set("doc_type", docType);
  const { data, error, isLoading, mutate } = useSWR<Page<DocumentMeta>>(`/api/v1/documents?${params}`, {
    refreshInterval: (d) => (d?.items.some((x) => isProcessing(x.status)) ? 3000 : 0),
  });
  const filtered = Boolean(debounced || status || docType);

  async function retry(id: string) {
    setRetrying(id);
    try {
      await api(`/api/v1/documents/${id}/process`, { method: "POST", json: { language: lang } });
      toast.success("Processing restarted");
      mutate();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRetrying(null);
    }
  }

  return (
    <>
      <PageHeader
        title={t("records.title")}
        subtitle={t("records.subtitle")}
        actions={
          <Button asChild>
            <Link href="/upload">
              <Upload /> {t("common.upload")}
            </Link>
          </Button>
        }
      />
      <div className="mb-4 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Segmented
          label="Filter by status"
          value={status || "all"}
          onChange={(v) => {
            setStatus(v === "all" ? "" : v);
            setOffset(0);
          }}
          options={[
            { value: "all", label: t("common.all") },
            { value: "pending_review", label: t("status.needs_review") },
            { value: "confirmed", label: t("status.confirmed") },
            { value: "processing", label: "Processing" },
            { value: "failed", label: t("status.failed") },
          ]}
        />
      </div>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by file name or facility"
            className="h-10 pl-9"
            aria-label={t("common.search")}
          />
        </div>

        <select aria-label="Document type" value={docType} onChange={(e) => {
            setDocType(e.target.value);
            setOffset(0);
          }} className="h-10 field px-3 text-sm">
          <option value="">All types</option>
          {DOC_TYPES.map((d) => (
            <option key={d} value={d}>
              {t(`doctype.${d}`)}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <ListSkeleton rows={6} />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title={filtered ? "No matching documents" : t("records.empty")}
          body={filtered ? "Try a different search or filter." : t("overview.emptyBody")}
          action={
            filtered ? (
              <Button
                variant="outline"
                onClick={() => {
                  setQ("");
                  setStatus("");
                  setDocType("");
                }}
              >
                {t("common.clear")}
              </Button>
            ) : (
              <Button asChild>
                <Link href="/upload">
                  <Upload /> {t("common.upload")}
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <ul className="space-y-3">
            {data.items.map((d) => {
              const href = d.status === "needs_review" ? `/records/${d.id}/review` : `/records/${d.id}`;
              const Icon = DOC_ICON[d.doc_type];
              return (
                <li key={d.id} className="surface group flex items-center gap-4 p-4 transition-transform hover:-translate-y-px">
                  <span className="neu-inset hidden size-12 shrink-0 items-center justify-center rounded-2xl! text-brand-600 sm:flex">
                    <Icon className="size-5" />
                  </span>
                  <Link href={href} className="min-w-0 flex-1 rounded focus-visible:outline-2">
                    <span className="block truncate font-medium group-hover:text-brand-700">{d.source_facility ?? d.file_name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {t(`doctype.${d.doc_type}`)} · {formatDate(d.document_date) ?? t("common.unknownDate")}
                      {d.source_facility ? ` · ${d.file_name}` : ""} · {fileSize(d.size_bytes)}
                    </span>
                    {d.status === "failed" && d.status_detail && <span className="mt-1 block text-xs text-danger">{d.status_detail}</span>}
                  </Link>
                  <StatusBadge status={d.status} />
                  <div className="flex items-center gap-1.5">
                    {d.status === "failed" && (
                      <Button variant="outline" size="icon-sm" aria-label="Retry processing" title={t("common.retry")} onClick={() => retry(d.id)} disabled={retrying === d.id}>
                        {retrying === d.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                      </Button>
                    )}
                    <Button asChild variant={d.status === "needs_review" ? "default" : "outline"} size="sm" className="hidden md:inline-flex">
                      <Link href={href}>
                        {d.status === "needs_review" ? t("review.title") : t("common.view")} <ChevronRight />
                      </Link>
                    </Button>
                    <DeleteDocumentButton id={d.id} name={d.file_name} onDeleted={() => mutate()} />
                  </div>
                </li>
              );
            })}
          </ul>
          <Pager total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
        </>
      )}
    </>
  );
}
