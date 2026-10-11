"use client";

import { ExternalLink, FileWarning, Loader2 } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";

interface Signed {
  url: string;
  expires_in: number;
  mime_type: string;
  file_name: string;
}

/** Shows the original file via a short-lived signed URL from the private bucket. */
export function DocumentViewer({ id, className = "" }: { id: string; className?: string }) {
  // Signed URLs are short-lived; refresh shortly before they expire.
  const { data: signed, error: loadError, mutate } = useSWR<Signed>(`/api/v1/documents/${id}/file`, {
    revalidateOnFocus: false,
    refreshInterval: (d) => (d ? Math.max(30, d.expires_in - 20) * 1000 : 0),
  });
  const [openError, setOpenError] = useState<string | null>(null);
  const error = loadError ? errorMessage(loadError) : openError;

  async function openNewTab() {
    try {
      const fresh = await api<Signed>(`/api/v1/documents/${id}/file`);
      window.open(fresh.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setOpenError(errorMessage(e));
    }
  }
  return (
    <div className={`surface flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="truncate text-xs font-medium text-muted-foreground">{signed?.file_name ?? "Original document"}</span>
        <Button variant="ghost" size="xs" onClick={openNewTab}>
          <ExternalLink /> Open
        </Button>
      </div>
      <div className="relative min-h-[420px] flex-1 bg-muted/40">
        {error ? (
          <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <FileWarning className="size-5" />
            {error}
            <Button variant="outline" size="sm" onClick={() => { setOpenError(null); mutate(); }}>
              Retry
            </Button>
          </div>
        ) : !signed ? (
          <div className="flex h-full min-h-[420px] items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : signed.mime_type === "application/pdf" ? (
          <iframe src={`${signed.url}#view=FitH`} title="Original document" className="absolute inset-0 h-full w-full" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={signed.url} alt="Original document" className="mx-auto max-h-full w-auto object-contain" />
        )}
      </div>
    </div>
  );
}
