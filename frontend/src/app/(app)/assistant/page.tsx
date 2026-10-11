"use client";

import { AlertTriangle, Bot, FileText, Loader2, MessageSquarePlus, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Disclaimer, PageHeader } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { ChatMessage, Citation, Page } from "@/lib/types";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Which of my results were outside the printed reference range?",
  "What was my most recent haemoglobin value?",
  "Which medicines are listed on my prescriptions?",
  "Summarise my latest lab report.",
];

interface Conv { id: string; title: string; updated_at: string }

function Sources({ cites }: { cites: Citation[] }) {
  const { t } = useI18n();
  if (!cites.length) return null;
  return (
    <div className="mt-3 border-t pt-2">
      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t("assistant.sources")}</p>
      <ul className="flex flex-wrap gap-1.5">
        {cites.map((c) => (
          <li key={c.ref}>
            <Link
              href={c.document_id ? `/records/${c.document_id}` : "#"}
              className="inline-flex max-w-[260px] items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted"
              title={[c.label, c.detail, formatDate(c.date)].filter(Boolean).join(" · ")}
            >
              <FileText className="size-3 shrink-0 text-brand-600" />
              <span className="truncate">
                {c.label}
                {c.detail ? ` — ${c.detail}` : ""}
                {c.date ? ` (${formatDate(c.date)})` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AssistantPage() {
  const { t, lang } = useI18n();
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const { data: convs, mutate: mutateConvs } = useSWR<Page<Conv>>("/api/v1/assistant/conversations?limit=30");

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages, sending]);

  async function open(id: string) {
    setLoadingConv(true);
    try {
      const res = await api<{ items: ChatMessage[] }>(`/api/v1/assistant/conversations/${id}/messages`);
      setConvId(id);
      setMessages(res.items);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoadingConv(false);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/v1/assistant/conversations/${id}`, { method: "DELETE" });
      if (id === convId) {
        setConvId(null);
        setMessages([]);
      }
      mutateConvs();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || sending) return;
    setInput("");
    const optimistic: ChatMessage = { id: `tmp-${++seq.current}`, role: "user", content: msg, citations: [], insufficient_information: false, created_at: "" };
    setMessages((m) => [...m, optimistic]);
    setSending(true);
    try {
      const res = await api<{ conversation_id: string; message_id: string; answer: string; citations: Citation[]; insufficient_information: boolean }>(
        "/api/v1/assistant/chat",
        { method: "POST", json: { message: msg, conversation_id: convId, language: lang } },
      );
      setConvId(res.conversation_id);
      setMessages((m) => [
        ...m,
        { id: res.message_id, role: "assistant", content: res.answer, citations: res.citations, insufficient_information: res.insufficient_information, created_at: "" },
      ]);
      mutateConvs();
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(msg);
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t("assistant.title")}
        subtitle={t("assistant.subtitle")}
        actions={
          <Button variant="outline" onClick={() => { setConvId(null); setMessages([]); }}>
            <MessageSquarePlus /> {t("assistant.new")}
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="hidden lg:block">
          <p className="mb-2 px-1 text-xs font-semibold text-muted-foreground uppercase">History</p>
          <ul className="space-y-0.5">
            {convs?.items.map((c) => (
              <li key={c.id} className="group flex items-center">
                <button
                  onClick={() => open(c.id)}
                  className={cn("min-w-0 flex-1 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted", convId === c.id && "bg-brand-50 text-brand-700")}
                >
                  <span className="block truncate">{c.title}</span>
                  <span className="block text-xs text-muted-foreground">{relativeTime(c.updated_at)}</span>
                </button>
                <Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label="Delete conversation" onClick={() => remove(c.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
            {convs && convs.items.length === 0 && <li className="px-2 text-sm text-muted-foreground">No conversations yet.</li>}
          </ul>
        </aside>

        <section className="surface flex min-h-[70vh] flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-live="polite">
            {loadingConv ? (
              <div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
            ) : messages.length === 0 ? (
              <div className="mx-auto flex max-w-lg flex-col items-center py-10 text-center">
                <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-brand-50 text-brand-600"><Bot className="size-5" /></div>
                <p className="text-sm font-medium">Ask about your confirmed records</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  The assistant only uses values you have reviewed and confirmed, cites its sources, and will tell you when your records don&apos;t contain the answer.
                </p>
                <div className="mt-5 grid w-full gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-lg border bg-background p-3 text-left text-sm hover:bg-muted">{s}</button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[75%]",
                      m.role === "user" ? "rounded-br-sm bg-brand-600 text-white" : "rounded-bl-sm border bg-background",
                    )}
                  >
                    {m.role === "assistant" && m.insufficient_information && (
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-warn">
                        <AlertTriangle className="size-3.5" /> {t("assistant.insufficient")}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    {m.role === "assistant" && <Sources cites={m.citations} />}
                  </div>
                </div>
              ))
            )}
            {sending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border bg-background px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Searching your records…
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <form
            className="border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder={t("assistant.placeholder")}
                aria-label="Message"
                maxLength={1000}
                rows={1}
                className="max-h-40 min-h-10 resize-none bg-background"
              />
              <Button type="submit" size="icon-lg" disabled={!input.trim() || sending} aria-label={t("assistant.send")}>
                {sending ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </div>
            <Disclaimer className="mt-2" />
          </form>
        </section>
      </div>
    </>
  );
}
