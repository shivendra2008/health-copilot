"use client";

import { useState } from "react";
import useSWR from "swr";
import { OverviewView } from "@/components/app/overview";
import { ErrorState } from "@/components/app/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import type { Dashboard } from "@/lib/types";

export default function OverviewPage() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("hc.onboarding.dismissed") === "1";
    } catch {
      return false;
    }
  });
  const { data, error, mutate } = useSWR<Dashboard>("/api/v1/dashboard", {
    refreshInterval: (d) => (d && d.stats.processing > 0 ? 4000 : 0),
  });

  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading">
        <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
          <Skeleton className="h-[340px] rounded-3xl bg-muted" />
          <Skeleton className="h-[340px] rounded-3xl bg-muted" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl bg-muted" />
          ))}
        </div>
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
  );
}
