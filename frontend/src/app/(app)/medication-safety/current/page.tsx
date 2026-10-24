"use client";

import { ArrowLeft, Loader2, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { MedCard } from "@/components/app/med-editor";
import { SafetyDisclaimer } from "@/components/app/med-safety";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ConfirmedMedication, SafetyReport } from "@/lib/types";

const BASE = "/api/v1/medication-safety";

export default function CurrentListPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [checking, setChecking] = useState(false);
  const { data, error, mutate } = useSWR<{ items: ConfirmedMedication[] }>(`${BASE}/confirmed-medications`);
  const nCurrent = data?.items.filter((m) => m.current_status === "current").length ?? 0;

  async function add() {
    if (!name.trim()) return;
    setAdding(true);
    try {
      await api(`${BASE}/confirmed-medications`, { method: "POST", json: { name: name.trim(), current_status: "current" } });
      setName("");
      await mutate();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setAdding(false);
    }
  }

  async function check() {
    setChecking(true);
    try {
      const r = await api<SafetyReport>(`${BASE}/check`, { method: "POST", json: { source_type: "current_list" } });
      router.push(`/medication-safety/reports/${r.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setChecking(false);
    }
  }

  return (
    <>
      <Link href="/medication-safety" className="mb-4 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> {t("ms.back")}
      </Link>
      <PageHeader
        title={t("ms.cur.title")}
        subtitle={t("ms.hub.currentHint")}
        actions={
          <Button disabled={nCurrent === 0 || checking} onClick={check}>
            {checking ? <Loader2 className="animate-spin" /> : <ShieldCheck />} {t("ms.hub.checkCurrent")}
          </Button>
        }
      />
      <SafetyDisclaimer className="mb-6" />

      <form
        className="surface mb-6 flex flex-col gap-2 p-4 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ms.add.name")} aria-label={t("ms.add.name")} maxLength={200} />
        <Button type="submit" disabled={!name.trim() || adding}>
          {adding ? <Loader2 className="animate-spin" /> : <Plus />} {t("ms.cur.add")}
        </Button>
      </form>

      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !data ? (
        <ListSkeleton rows={3} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={<ShieldCheck />} title={t("ms.cur.empty")} />
      ) : (
        <>
          {nCurrent === 0 && <p className="mb-3 text-sm text-muted-foreground">{t("ms.cur.noneCurrent")}</p>}
          <div className="space-y-4">
            {data.items.map((m) => (
              <MedCard key={`${m.id}:${m.updated_at}`} med={m} onChanged={() => mutate()} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
