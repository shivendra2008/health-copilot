"use client";

import useSWR from "swr";
import { isProcessing } from "@/lib/format";
import type { DocumentMeta } from "@/lib/types";

/** Polls a document while it is processing; stops once it reaches a terminal state. */
export function useDocumentPoll(id: string | null) {
  return useSWR<DocumentMeta>(id ? `/api/v1/documents/${id}` : null, {
    refreshInterval: (d) => (d && isProcessing(d.status) ? 2500 : 0),
  });
}
