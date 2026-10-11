"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function DeleteDocumentButton({
  id,
  name,
  onDeleted,
  variant = "icon",
}: {
  id: string;
  name: string;
  onDeleted: () => void;
  variant?: "icon" | "button";
}) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  async function del() {
    setBusy(true);
    try {
      await api(`/api/v1/documents/${id}`, { method: "DELETE" });
      toast.success(t("doc.deleted"));
      setOpen(false);
      onDeleted();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === "icon" ? (
          <Button variant="ghost" size="icon-sm" aria-label={t("doc.deleteNamed", { name })} title={t("common.delete")}>
            <Trash2 />
          </Button>
        ) : (
          <Button variant="destructive" size="sm">
            <Trash2 /> {t("common.delete")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("doc.deleteTitle")}</DialogTitle>
          <DialogDescription>{t("doc.deleteBody", { name })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={del} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} {t("doc.deleteForever")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
