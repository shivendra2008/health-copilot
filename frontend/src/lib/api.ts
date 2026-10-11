import { env } from "./env";
import { hasKey, tr } from "./i18n";
import { getSupabase } from "./supabase";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function token(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    if (body?.error) return new ApiError(res.status, body.error.code, body.error.message, body.error.details);
  } catch {
    /* non-JSON */
  }
  return new ApiError(res.status, "http_error", res.statusText || "Request failed");
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const t = await token();
  const headers = new Headers(init.headers);
  if (t) headers.set("Authorization", `Bearer ${t}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  // Never wait forever: a stalled request becomes an error with a Retry button instead of an endless skeleton.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.method && init.method !== "GET" ? 90_000 : 25_000);
  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, { ...init, headers, body, cache: "no-store", signal: controller.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ApiError(0, "timeout", "The server is taking too long to respond. Please try again.");
    }
    throw new ApiError(0, "network_error", "Cannot reach the Health Copilot server. Check that the backend is running.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = await parseError(res);
    if (res.status === 401) {
      await getSupabase()?.auth.signOut();
    }
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const fetcher = <T,>(path: string) => api<T>(path);

/** Upload with real progress events (fetch has no upload progress). */
export async function uploadWithProgress<T>(
  path: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<{ status: number; body: T }> {
  const t = await token();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${env.apiUrl}${path}`);
    if (t) xhr.setRequestHeader("Authorization", `Bearer ${t}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => reject(new ApiError(0, "network_error", "Upload failed: the server could not be reached."));
    xhr.onload = () => {
      let body: { error?: { code?: string; message?: string; details?: unknown } } & T = null as never;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve({ status: xhr.status, body: body as T });
      else
        reject(
          new ApiError(xhr.status, body?.error?.code ?? "upload_failed", body?.error?.message ?? "Upload failed.", body?.error?.details),
        );
    };
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

/** User-facing error text in the active language (falls back to the server's English message). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const key = `error.${e.code}`;
    return hasKey(key) ? tr(key) : e.message;
  }
  if (e instanceof Error) return e.message;
  return tr("error.internal_error");
}
