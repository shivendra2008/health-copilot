"use client";

import { AlertCircle, ArrowRight, CheckCircle2, FileText, ImageIcon, Loader2, RotateCcw, UploadCloud, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/app/badges";
import { ProcessingStory } from "@/components/app/processing-story";
import { Disclaimer, PageHeader } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useDocumentPoll } from "@/hooks/use-document-poll";
import { api, ApiError, errorMessage, uploadWithProgress } from "@/lib/api";
import { fileSize } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { DocumentMeta } from "@/lib/types";

const MAX_MB = 10;
const ACCEPT: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

interface Item {
  localId: string;
  file: File;
  progress: number;
  phase: "uploading" | "uploaded" | "error";
  error?: string;
  docId?: string;
  duplicate?: boolean;
}

function clientValidate(f: File): string | null {
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ACCEPT[ext]) return "Unsupported file type. Use PDF, JPG, JPEG or PNG.";
  if (f.size === 0) return "This file is empty.";
  if (f.size > MAX_MB * 1024 * 1024) return `File is larger than ${MAX_MB} MB.`;
  return null;
}

function UploadRow({ item, onRemove, autoOpen }: { item: Item; onRemove: () => void; autoOpen: boolean }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { data: doc, mutate } = useDocumentPoll(item.docId ?? null);
  const opened = useRef(false);

  // A single upload goes straight to review when it's ready.
  useEffect(() => {
    if (!autoOpen || opened.current || doc?.status !== "needs_review" || item.duplicate) return;
    opened.current = true;
    toast.success("Ready for review", { description: "Check the extracted values against your document." });
    const id = setTimeout(() => router.push(`/records/${doc.id}/review`), 900);
    return () => clearTimeout(id);
  }, [autoOpen, doc, item.duplicate, router]);
  const [retrying, setRetrying] = useState(false);
  const isImage = item.file.type.startsWith("image/");

  async function retry() {
    if (!item.docId) return;
    setRetrying(true);
    try {
      await api(`/api/v1/documents/${item.docId}/process`, { method: "POST", json: { language: lang } });
      await mutate();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRetrying(false);
    }
  }

  return (
    <li className="surface p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          {isImage ? <ImageIcon className="size-5" /> : <FileText className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.file.name}</p>
              <p className="text-xs text-muted-foreground">
                {fileSize(item.file.size)}
                {doc?.page_count ? ` · ${doc.page_count} page${doc.page_count > 1 ? "s" : ""}` : ""}
                {doc?.text_method ? ` · ${doc.text_method === "native" ? "digital text" : doc.text_method === "ocr" ? "OCR" : "digital + OCR"}` : ""}
              </p>
            </div>
            {doc ? <StatusBadge status={doc.status} /> : item.phase === "error" ? null : <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>

          {item.phase === "uploading" && (
            <div className="mt-3">
              <Progress value={item.progress} aria-label="Upload progress" className="h-1.5" />
              <p className="mt-1 text-xs text-muted-foreground">Uploading… {item.progress}%</p>
            </div>
          )}
          {item.phase === "error" && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <p role="alert" className="flex items-center gap-1.5 text-sm text-danger">
                <AlertCircle className="size-4" /> {item.error}
              </p>
              <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={onRemove}>
                <X />
              </Button>
            </div>
          )}
          {doc && (
            <>
              {item.duplicate && (
                <p className="mt-2 text-xs text-muted-foreground">This exact file was uploaded before — showing the existing record.</p>
              )}
              {doc.status !== "confirmed" && (
                <div className="mt-4 rounded-lg border bg-background/60 p-4">
                  <ProcessingStory doc={doc} compact />
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {doc.status === "needs_review" && (
                  <Button asChild size="sm">
                    <Link href={`/records/${doc.id}/review`}>
                      {t("review.title")} <ArrowRight />
                    </Link>
                  </Button>
                )}
                {doc.status === "confirmed" && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/records/${doc.id}`}>
                      <CheckCircle2 /> {t("common.view")}
                    </Link>
                  </Button>
                )}
                {doc.status === "failed" && (
                  <Button size="sm" variant="outline" onClick={retry} disabled={retrying}>
                    {retrying ? <Loader2 className="animate-spin" /> : <RotateCcw />} {t("common.retry")}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

export default function UploadPage() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (id: string, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.localId === id ? { ...x, ...patch } : x)));

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      Array.from(files).forEach(async (file) => {
        const localId = crypto.randomUUID();
        const err = clientValidate(file);
        setItems((xs) => [{ localId, file, progress: 0, phase: err ? "error" : "uploading", error: err ?? undefined }, ...xs]);
        if (err) return;
        try {
          const { body } = await uploadWithProgress<{ document: DocumentMeta; duplicate: boolean }>(
            `/api/v1/documents?language=${lang}`,
            file,
            (p) => update(localId, { progress: p }),
          );
          update(localId, { phase: "uploaded", docId: body.document.id, duplicate: body.duplicate });
          if (body.duplicate) toast.info("Duplicate file detected", { description: "Linked to your existing record." });
        } catch (e) {
          update(localId, { phase: "error", error: e instanceof ApiError ? e.message : errorMessage(e) });
        }
      });
    },
    [lang],
  );

  return (
    <>
      <PageHeader title={t("upload.title")} subtitle={t("upload.subtitle")} />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
          drag ? "border-brand-600 bg-brand-50" : "border-border bg-card"
        }`}
      >
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <UploadCloud className="size-6" />
        </div>
        <p className="text-sm font-medium">{t("upload.drop")}</p>
        <p className="my-2 text-xs text-muted-foreground">{t("upload.or")}</p>
        <Button onClick={() => inputRef.current?.click()}>{t("upload.browse")}</Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          className="sr-only"
          aria-label={t("upload.browse")}
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="mt-4 text-xs text-muted-foreground">PDF · JPG · PNG — max {MAX_MB} MB, 30 pages</p>
      </div>

      {items.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold">{t("upload.queue")}</h2>
          <ul className="space-y-3">
            {items.map((it) => (
              <UploadRow
                key={it.localId}
                item={it}
                autoOpen={items.length === 1}
                onRemove={() => setItems((xs) => xs.filter((x) => x.localId !== it.localId))}
              />
            ))}
          </ul>
        </section>
      )}
      <div className="mt-8 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">How processing works</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Your file is validated and stored in private storage.</li>
          <li>Digital PDFs are read directly; scans and photos go through OCR.</li>
          <li>AI extracts values exactly as written; software checks each against the source text.</li>
          <li>You review, correct and confirm before anything is added to your record.</li>
        </ol>
      </div>
      <Disclaimer className="mt-4" />
    </>
  );
}
