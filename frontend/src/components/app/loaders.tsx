"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useI18n, type TKey } from "@/lib/i18n";
import { network } from "@/lib/network";
import { cn } from "@/lib/utils";

/** Brand spinner: a soft track with a green arc. Respects reduced-motion (the arc stays, without spinning). */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role={label ? "status" : undefined} aria-label={label} className={cn("inline-block size-6 shrink-0", className)}>
      <svg viewBox="0 0 24 24" className="size-full motion-safe:animate-spin" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="#D3E6DC" strokeWidth="3" />
        <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="#1D6B50" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** True once `ms` have passed since mount. Used to avoid flashing loaders for fast responses. */
function useAfter(ms: number) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setDone(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return done;
}

/** Spinner + label. After 6 s it reassures the user that the app is still working. */
export function LoadingHint({ label = "load.records", className }: { label?: TKey; className?: string }) {
  const { t } = useI18n();
  const slow = useAfter(6000);
  return (
    <div className={cn("flex flex-col items-center gap-2 text-center", className)} role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <Spinner className="size-7" />
        <span className="text-sm font-medium">{t(label)}</span>
      </div>
      {slow && <p className="max-w-sm text-xs leading-5 text-muted-foreground">{t("load.still")}</p>}
    </div>
  );
}

/** Reassurance shown only if loading drags on (after 6 s). */
export function SlowNote({ className }: { className?: string }) {
  const { t } = useI18n();
  const slow = useAfter(6000);
  if (!slow) return null;
  return (
    <p role="status" className={cn("text-center text-xs leading-5 text-muted-foreground", className)}>
      {t("load.still")}
    </p>
  );
}

/** Centered loader for whole-page waits. Appears after a short delay so quick loads never flash it. */
export function PageLoader({ label = "load.records", className }: { label?: TKey; className?: string }) {
  const show = useAfter(250);
  return (
    <div className={cn("flex min-h-[40vh] items-center justify-center transition-opacity duration-200", show ? "opacity-100" : "opacity-0", className)}>
      <LoadingHint label={label} />
    </div>
  );
}

/** Thin progress bar fixed to the top of the screen while the app waits on the server (after 400 ms). */
export function TopLoadingBar() {
  const { t } = useI18n();
  const pending = useSyncExternalStore(network.subscribe, network.getSnapshot, network.getServerSnapshot);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (pending > 0) {
      const id = setTimeout(() => setVisible(true), 400);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setVisible(false), 250);
    return () => clearTimeout(id);
  }, [pending]);
  return (
    <div
      aria-hidden={!visible}
      role="progressbar"
      aria-label={t("load.working")}
      className={cn("pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] overflow-hidden transition-opacity duration-200", visible && pending > 0 ? "opacity-100" : "opacity-0")}
    >
      <div className="loading-bar h-full w-2/5 rounded-full bg-brand-600" />
    </div>
  );
}
