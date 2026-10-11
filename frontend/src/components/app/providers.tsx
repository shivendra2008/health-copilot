"use client";

import { SWRConfig } from "swr";
import { TopLoadingBar } from "@/components/app/loaders";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fetcher } from "@/lib/api";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ fetcher, revalidateOnFocus: true, shouldRetryOnError: false }}>
      <I18nProvider>
        <AuthProvider>
          <TooltipProvider delayDuration={200}>
            <TopLoadingBar />
            {children}
            <Toaster position="top-right" richColors={false} closeButton />
          </TooltipProvider>
        </AuthProvider>
      </I18nProvider>
    </SWRConfig>
  );
}
