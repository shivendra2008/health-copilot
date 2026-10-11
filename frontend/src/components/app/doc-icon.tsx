import { FileText, FlaskConical, Hospital, Pill, ScanLine } from "lucide-react";
import type { DocType } from "@/lib/types";

export const DOC_ICON: Record<DocType, React.ComponentType<{ className?: string }>> = {
  lab_report: FlaskConical,
  prescription: Pill,
  diagnostic_report: ScanLine,
  discharge_summary: Hospital,
  other: FileText,
};
