import { Settings2 } from "lucide-react";
import { Logo } from "./logo";

export function SetupNotice() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <Logo className="mb-8" />
      <div className="surface p-6">
        <div className="mb-3 flex items-center gap-2 text-brand-700">
          <Settings2 className="size-5" />
          <h1 className="text-lg font-semibold">Configuration required</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Supabase is not configured for the frontend. Create <code className="rounded bg-muted px-1">frontend/.env.local</code> with:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
{`NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
NEXT_PUBLIC_API_URL=http://localhost:8000`}
        </pre>
        <p className="mt-3 text-sm text-muted-foreground">Then restart <code className="rounded bg-muted px-1">npm run dev</code>. See README for the full setup.</p>
      </div>
    </main>
  );
}
