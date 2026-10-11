"use client";

import { FileText, ScanText, SearchX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { DocumentViewer } from "./document-viewer";
import { Segmented } from "./segmented";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface DocText {
  text: string;
  method: "native" | "ocr" | "mixed" | null;
  ocr_confidence: number | null;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Find the snippet in the text, tolerant to whitespace differences (OCR spacing, table columns). */
function locate(text: string, snippet: string | null | undefined): [number, number] | null {
  if (!snippet?.trim()) return null;
  const tokens = snippet.trim().split(/\s+/).map(esc);
  try {
    const m = new RegExp(tokens.join("\\s*"), "i").exec(text);
    if (m) return [m.index, m.index + m[0].length];
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Original document + the text we read from it. When `highlight` is set, the
 * text tab opens and the matching passage is marked and scrolled into view.
 */
export function SourcePanel({
  id,
  highlight,
  highlightLabel,
  className,
}: {
  id: string;
  highlight: string | null;
  highlightLabel?: string | null;
  className?: string;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"original" | "text">("original");
  const [lastHighlight, setLastHighlight] = useState<string | null>(null);
  const { data, error } = useSWR<DocText>(`/api/v1/documents/${id}/text`, { revalidateOnFocus: false });
  const markRef = useRef<HTMLElement>(null);

  // Selecting a new item switches to the text view (adjusting state during render, no effect needed).
  if (highlight !== lastHighlight) {
    setLastHighlight(highlight);
    if (highlight) setTab("text");
  }

  const range = useMemo(() => (data ? locate(data.text, highlight) : null), [data, highlight]);

  useEffect(() => {
    if (tab === "text" && range) markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [tab, range]);

  return (
    <div className={cn("surface flex flex-col overflow-hidden", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <Segmented
          label={t("source.view")}
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: "original", label: <span className="inline-flex items-center gap-1.5"><FileText className="size-3.5" />{t("source.original")}</span> },
            { value: "text", label: <span className="inline-flex items-center gap-1.5"><ScanText className="size-3.5" />{t("source.text")}</span> },
          ]}
        />
        {data && (
          <span className="text-[11px] text-muted-foreground">
            {data.method === "native" ? t("source.native") : data.method === "ocr" ? t("source.ocr") : t("source.mixed")}
            {data.ocr_confidence != null && ` · ${t("source.confidence", { n: Math.round(data.ocr_confidence * 100) })}`}
          </span>
        )}
      </div>

      {tab === "original" ? (
        <DocumentViewer id={id} className="flex-1 rounded-none border-0 shadow-none" bare />
      ) : (
        <div className="neu-inset relative m-3 min-h-[420px] flex-1 overflow-y-auto rounded-xl!">
          {highlight && (
            <div className="sticky top-0 z-10 border-b border-[var(--neu-edge)] bg-[var(--neu-surface)]/95 px-4 py-2 text-xs backdrop-blur">
              {range ? (
                <span className="text-foreground">{t("source.showing", { label: highlightLabel ?? "" })}</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-warn">
                  <SearchX className="size-3.5" /> {t("source.notFound")}
                </span>
              )}
            </div>
          )}
          {error ? (
            <p className="p-6 text-sm text-muted-foreground">{t("source.unavailable")}</p>
          ) : !data ? (
            <p className="p-6 text-sm text-muted-foreground">{t("source.loading")}</p>
          ) : (
            <pre className="px-4 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-foreground/80">
              {range ? (
                <>
                  {data.text.slice(0, range[0])}
                  <mark ref={markRef} className="rounded bg-[#FDE9B8] px-0.5 text-foreground ring-1 ring-warn/40">
                    {data.text.slice(range[0], range[1])}
                  </mark>
                  {data.text.slice(range[1])}
                </>
              ) : (
                data.text
              )}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
