"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { ProcessingStory } from "./processing-story";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { failureText } from "@/lib/doc-text";
import { useI18n } from "@/lib/i18n";
import type { DocumentMeta } from "@/lib/types";

export function ProcessingPanel({ doc }: { doc: DocumentMeta }) {
  const { t } = useI18n();
  return (
    <div className="surface mx-auto max-w-md p-6" role="status">
      <p className="mb-1 text-sm font-semibold">{t("doc.analysing")}</p>
      <p className="mb-5 text-xs text-muted-foreground">{t("doc.analysingHint")}</p>
      <ProcessingStory doc={doc} />
    </div>
  );
}

export function FailedPanel({ doc, onRetried }: { doc: DocumentMeta; onRetried: () => void }) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    try {
      await api(`/api/v1/documents/${doc.id}/process`, { method: "POST", json: { language: lang } });
      onRetried();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div role="alert" className="flex flex-col items-center rounded-xl border border-danger/20 bg-danger-bg/60 px-6 py-12 text-center">
      <p className="text-sm font-medium">{t("doc.failed")}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{failureText(doc)}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("doc.failedSafe", { n: doc.attempts })}</p>
      <Button className="mt-4" onClick={retry} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} {t("common.retry")}
      </Button>
    </div>
  );
}
