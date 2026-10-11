"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { Hero, OverviewView } from "@/components/app/overview";
import { SlowNote } from "@/components/app/loaders";
import { ErrorState } from "@/components/app/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import type { Dashboard } from "@/lib/types";

export default function OverviewPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("hc.onboarding.dismissed") === "1";
    } catch {
      return false;
    }
  });
  // Instant paint: show the last dashboard this tab saw (sessionStorage: per-tab, cleared on sign-out)
  // while fresh data loads in the background.
  const cacheKey = user ? `hc.cache.dashboard.${user.id}` : null;
  const [cached] = useState<Dashboard | undefined>(() => {
    try {
      const raw = cacheKey ? sessionStorage.getItem(cacheKey) : null;
      return raw ? (JSON.parse(raw) as Dashboard) : undefined;
    } catch {
      return undefined;
    }
  });
  const { data, error, mutate } = useSWR<Dashboard>("/api/v1/dashboard", {
    fallbackData: cached,
    refreshInterval: (d) => (d && d.stats.processing > 0 ? 4000 : 0),
    onSuccess: (d) => {
      try {
        if (cacheKey) sessionStorage.setItem(cacheKey, JSON.stringify(d));
      } catch {
        /* storage full or unavailable */
      }
    },
  });
  const firstName = (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0];

  if (error && !data) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) {
    // Greeting and buttons appear immediately; only the data-driven cards wait.
    return (
      <div className="space-y-7" aria-busy="true" aria-label={t("common.loading")}>
        <div className="grid gap-7 xl:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
          <Hero name={firstName} />
          <Skeleton className="h-[340px] rounded-3xl bg-muted" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl bg-muted" />
          ))}
        </div>
        <SlowNote />
      </div>
    );
  }

  // Tolerate an older backend (fields added later) so a frontend-first deploy never crashes.
  const safe: Dashboard = {
    ...data,
    stats: { ...data.stats, conversations: data.stats.conversations ?? 0 },
    snapshot: (data.snapshot ?? []).filter((x) => x.latest),
    range_breakdown: data.range_breakdown ?? { within_range: 0, above_range: 0, below_range: 0, unverified: 0 },
    monthly: data.monthly ?? [],
  };

  return (
    <>
      <div className="pb-16 lg:pb-20">
        <OverviewView
          data={safe}
          name={(user?.user_metadata?.full_name as string | undefined)?.split(" ")[0]}
          showOnboarding={!dismissed}
          onDismissOnboarding={() => {
            setDismissed(true);
            try {
              localStorage.setItem("hc.onboarding.dismissed", "1");
            } catch {
              /* ignore */
            }
          }}
        />
      </div>

      {/* Floating shortcut to the assistant. On phones it sits above the upload button. */}
      <Link
        href="/assistant"
        aria-label={t("nav.assistant")}
        className="neu-press fixed right-4 bottom-36 z-30 flex size-12 items-center justify-center gap-2 rounded-full border border-[var(--neu-edge)] bg-card text-brand-700 shadow-[0_8px_24px_rgba(20,45,33,0.16)] focus-visible:ring-4 focus-visible:ring-brand-600/30 focus-visible:outline-none lg:right-8 lg:bottom-8 lg:h-14 lg:w-auto lg:border-transparent lg:bg-brand-600 lg:px-6 lg:text-white lg:shadow-[0_8px_24px_rgba(29,107,80,0.35)] lg:hover:bg-brand-700"
      >
        <Sparkles className="size-5" />
        <span className="hidden text-sm font-semibold lg:inline">{t("nav.assistant")}</span>
      </Link>
    </>
  );
}
