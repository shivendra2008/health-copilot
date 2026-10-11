"use client";

import {
  Activity,
  ClipboardList,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Settings,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { LANG_LABELS, useI18n, type TKey } from "@/lib/i18n";
import type { Lang } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { SetupNotice } from "./setup-notice";

const NAV: { href: string; key: TKey; icon: React.ComponentType<{ className?: string }> }[] = [
  { href: "/overview", key: "nav.overview", icon: LayoutDashboard },
  { href: "/records", key: "nav.records", icon: ClipboardList },
  { href: "/lab-results", key: "nav.labs", icon: FlaskConical },
  { href: "/timeline", key: "nav.timeline", icon: Activity },
  { href: "/assistant", key: "nav.assistant", icon: MessageSquareText },
  { href: "/settings", key: "nav.settings", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ href, key, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              active && "bg-brand-50 text-brand-700 hover:bg-brand-50 hover:text-brand-700",
            )}
          >
            <Icon className="size-[18px]" />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}

const TABS: { href: string; key: TKey; icon: React.ComponentType<{ className?: string }> }[] = [
  { href: "/overview", key: "nav.overview", icon: LayoutDashboard },
  { href: "/records", key: "nav.records", icon: ClipboardList },
  { href: "/lab-results", key: "nav.labsShort", icon: FlaskConical },
  { href: "/timeline", key: "nav.timelineShort", icon: Activity },
  { href: "/assistant", key: "nav.assistantShort", icon: MessageSquareText },
];

function MobileTabBar() {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 grid h-16 grid-cols-5 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {TABS.map(({ href, key, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-col items-center justify-center gap-1 text-[10.5px] font-medium text-muted-foreground",
              active && "text-brand-700",
            )}
          >
            <span className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-brand-50")}>
              <Icon className="size-[19px]" />
            </span>
            <span className="max-w-full truncate px-1">{t(key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarFooter() {
  const { user, signOut } = useAuth();
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  return (
    <div className="space-y-3 border-t pt-4">
      <label className="block px-1 text-xs text-muted-foreground">
        <span className="sr-only">Language</span>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          className="h-9 w-full rounded-lg border bg-card px-2 text-sm text-foreground"
          aria-label="Language"
        >
          {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
            <option key={l} value={l}>
              {LANG_LABELS[l]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2 px-1">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
          {(user?.user_metadata?.full_name || user?.email || "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user?.user_metadata?.full_name || "You"}</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("nav.signout")}
          title={t("nav.signout")}
          onClick={async () => {
            await signOut();
            router.replace("/login");
          }}
        >
          <LogOut />
        </Button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const hideFab = pathname.startsWith("/upload") || pathname.endsWith("/review") || pathname.startsWith("/assistant");

  useEffect(() => {
    if (isSupabaseConfigured && !loading && !user) router.replace("/login");
  }, [user, loading, router]);


  if (!isSupabaseConfigured) return <SetupNotice />;
  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-busy="true">
        <Logo className="opacity-60" />
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r bg-card px-3 py-5 lg:flex">
        <Link href="/overview" className="mb-6 px-2">
          <Logo />
        </Link>
        <Button asChild className="mb-5 h-10 justify-start gap-2 px-3">
          <Link href="/upload">
            <Upload /> {t("common.upload")}
          </Link>
        </Button>
        <div className="flex-1 overflow-y-auto">
          <NavLinks />
        </div>
        <SidebarFooter />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-card/95 px-4 backdrop-blur lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-72 flex-col px-3 py-5">
            <SheetTitle className="mb-4 px-2">
              <Logo />
            </SheetTitle>
            <div className="flex-1">
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
            <SidebarFooter />
          </SheetContent>
        </Sheet>
        <Link href="/overview">
          <Logo />
        </Link>
        <Button asChild variant="ghost" size="icon" aria-label={t("nav.settings")}>
          <Link href="/settings">
            <Settings />
          </Link>
        </Button>
      </header>

      <main id="main" className="min-w-0 px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>

      {!hideFab && (
        <Button asChild size="icon-lg" className="fixed right-4 bottom-20 z-30 size-12 rounded-full shadow-[0_6px_16px_rgba(29,107,80,0.35)] lg:hidden">
          <Link href="/upload" aria-label={t("common.upload")}>
            <Upload className="size-5" />
          </Link>
        </Button>
      )}
      <MobileTabBar />
    </div>
  );
}
