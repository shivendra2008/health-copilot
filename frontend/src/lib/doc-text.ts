import { hasKey, tr } from "./i18n";
import type { DocumentMeta } from "./types";

/** Why processing failed, in the user's language (server text is the English fallback). */
export function failureText(doc: DocumentMeta) {
  const key = `error.${doc.error_code}`;
  return doc.error_code && hasKey(key) ? tr(key) : (doc.status_detail ?? tr("error.internal_error"));
}
