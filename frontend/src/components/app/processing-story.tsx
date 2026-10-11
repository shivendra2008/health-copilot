"use client";

import { Check, Loader2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { DocumentMeta } from "@/lib/types";
import { failureText } from "@/lib/doc-text";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "upload", label: "story.upload" },
  { key: "read", label: "story.read" },
  { key: "extract", label: "story.extract" },
  { key: "check", label: "story.check" },
  { key: "ready", label: "story.ready" },
] as const;

/** Index of the step currently running (STEPS.length when finished). Derived only from real backend status. */
function currentStep(doc: DocumentMeta): number {
  switch (doc.status) {
    case "uploaded":
      return 1;
    case "extracting_text":
      return 1;
    case "analyzing":
      return doc.status_detail?.startsWith("Found") || doc.status_detail?.startsWith("No structured") ? 3 : 2;
    case "needs_review":
    case "confirmed":
      return STEPS.length;
    default:
      return -1;
  }
}

function failedStep(doc: DocumentMeta): number {
  if (doc.error_code?.startsWith("ai_")) return 2;
  if (doc.error_code === "ocr_unavailable" || doc.error_code === "no_text_found") return 1;
  return doc.text_method ? 2 : 1;
}

export function ProcessingStory({ doc, compact = false }: { doc: DocumentMeta; compact?: boolean }) {
  const { t, lang } = useI18n();
  // The server narrates steps in English; other languages show the translated step label only.
  const detail = doc.status === "failed" ? failureText(doc) : lang === "en" ? doc.status_detail : null;
  const failed = doc.status === "failed";
  const cur = failed ? failedStep(doc) : currentStep(doc);

  return (
    <ol className={cn("space-y-0", compact ? "mt-3" : "")} aria-label={t("story.progress")}>
      {STEPS.map((s, i) => {
        const done = i < cur || (!failed && cur === STEPS.length);
        const active = i === cur && !failed;
        const err = failed && i === cur;
        const last = i === STEPS.length - 1;
        return (
          <li key={s.key} className="relative flex gap-3 pb-3 last:pb-0">
            {!last && (
              <span aria-hidden className={cn("absolute top-6 left-[11px] h-[calc(100%-18px)] w-px", done ? "bg-brand-600" : "bg-border")} />
            )}
            <span
              className={cn(
                "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                done && "border-brand-600 bg-brand-600 text-white",
                active && "border-brand-600 bg-[var(--neu-surface)] text-brand-600",
                err && "border-danger bg-danger text-white",
                !done && !active && !err && "neu-sm rounded-full! border-transparent text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : err ? <X className="size-3.5" /> : i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cn("text-sm", done || active || err ? "font-medium text-foreground" : "text-muted-foreground")}>{t(s.label)}</p>
              {(active || err) && detail && (
                <p className={cn("mt-0.5 text-xs", err ? "text-danger" : "text-muted-foreground")} aria-live="polite">
                  {detail}
                  {active && "…"}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
