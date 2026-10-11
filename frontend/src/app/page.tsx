"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SetupNotice } from "@/components/app/setup-notice";
import { useAuth } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!isSupabaseConfigured || loading) return;
    router.replace(user ? "/overview" : "/login");
  }, [user, loading, router]);
  if (!isSupabaseConfigured) return <SetupNotice />;
  return null;
}
