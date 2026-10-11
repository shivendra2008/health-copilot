export type Lang = "en" | "hi" | "mr" | "te";
export type DocType = "prescription" | "lab_report" | "diagnostic_report" | "discharge_summary" | "other";
export type DocStatus = "uploaded" | "extracting_text" | "analyzing" | "needs_review" | "confirmed" | "failed";
export type Interpretation = "within_range" | "above_range" | "below_range" | "unverified";
export type Confidence = "high" | "medium" | "low";

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface DocumentMeta {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  page_count: number | null;
  doc_type: DocType;
  document_date: string | null;
  source_facility: string | null;
  source_clinician: string | null;
  status: DocStatus;
  status_detail: string | null;
  error_code: string | null;
  text_method: "native" | "ocr" | "mixed" | null;
  ocr_confidence: number | null;
  attempts: number;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
}

interface ItemMeta {
  key?: string | null;
  origin?: "ai" | "user";
  user_corrected?: boolean;
}

export interface LabResult extends ItemMeta {
  test_name: string;
  value: string;
  unit: string | null;
  reference_range: string | null;
  flag: string | null;
  category: string | null;
  source_text: string;
  confidence: Confidence;
}
export interface Medication extends ItemMeta {
  name: string;
  strength: string | null;
  dosage: string | null;
  frequency: string | null;
  duration: string | null;
  route: string | null;
  instructions: string | null;
  source_text: string;
  confidence: Confidence;
}
export interface ConditionItem extends ItemMeta {
  description: string;
  status: string | null;
  source_text: string;
  confidence: Confidence;
}
export interface Procedure extends ItemMeta {
  name: string;
  date: string | null;
  source_text: string;
  confidence: Confidence;
}
export interface FollowUp extends ItemMeta {
  instruction: string;
  date: string | null;
  source_text: string;
}
export interface Finding extends ItemMeta {
  text: string;
  source_text: string;
  confidence: Confidence;
}

export interface ExtractionData {
  document_type: DocType;
  classification_confidence: Confidence;
  document_date: string | null;
  facility: string | null;
  clinician: string | null;
  lab_results: LabResult[];
  medications: Medication[];
  conditions: ConditionItem[];
  procedures: Procedure[];
  follow_ups: FollowUp[];
  findings: Finding[];
}

export interface Issue {
  path: string;
  field: string | null;
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

export interface Derived {
  key: string;
  test_name: string;
  value: string;
  unit: string | null;
  reference_range: string | null;
  status: Interpretation;
  value_num: number | null;
  ref_low: number | null;
  ref_high: number | null;
}

export interface Summary {
  overview: string;
  key_findings: { statement: string; related_item: string | null }[];
  term_explanations: { term: string; explanation: string }[];
  questions_for_clinician: string[];
  language: Lang;
  model: string;
  generated_at: string;
}

export interface Extraction {
  id: string;
  document_id: string;
  version: number;
  model: string | null;
  status: "pending_review" | "confirmed" | "superseded";
  data: ExtractionData;
  ai_output: ExtractionData;
  issues: Issue[];
  derived: Derived[];
  summary: Partial<Record<Lang, Summary>> | null;
  corrected_at: string | null;
  confirmed_at: string | null;
  created_at: string;
}

export interface ExtractionHistoryItem {
  id: string;
  version: number;
  status: string;
  model: string | null;
  created_at: string;
  corrected_at: string | null;
  confirmed_at: string | null;
}

export interface Observation {
  id: string;
  document_id: string;
  test_name: string;
  normalized_name: string;
  category: string | null;
  value_text: string;
  value_num: number | null;
  value_comparator: string | null;
  unit: string | null;
  unit_normalized: string | null;
  reference_range_text: string | null;
  ref_low: number | null;
  ref_high: number | null;
  documented_flag: string | null;
  interpretation: Interpretation;
  effective_date: string | null;
  source_text: string | null;
  original: Record<string, unknown> | null;
  is_user_corrected: boolean;
  documents?: { file_name: string; doc_type: DocType } | null;
}

export interface MedicationRecord {
  id: string;
  document_id: string;
  name: string;
  strength: string | null;
  dosage: string | null;
  frequency: string | null;
  duration: string | null;
  route: string | null;
  instructions: string | null;
  authored_date: string | null;
  is_user_corrected: boolean;
  documents?: { file_name: string; doc_type: DocType } | null;
}

export interface ConditionRecord {
  id: string;
  document_id: string;
  description: string;
  clinical_status: string | null;
  recorded_date: string | null;
  is_user_corrected: boolean;
  documents?: { file_name: string; doc_type: DocType } | null;
}

export interface TimelineEvent {
  id: string;
  document_id: string | null;
  event_date: string;
  event_type: "document" | "lab_result" | "medication" | "diagnosis" | "procedure" | "follow_up";
  category: string | null;
  title: string;
  description: string | null;
  meta?: Record<string, unknown> | null;
  documents?: { file_name: string; doc_type: DocType } | null;
}

export interface TrendTest {
  test: string;
  display_name: string;
  category: string | null;
  count: number;
  numeric_count: number;
  units: string[];
  latest_date: string | null;
  latest: {
    document_id: string;
    value_text: string;
    value_num: number | null;
    value_comparator: string | null;
    unit: string | null;
    reference_range_text: string | null;
    ref_low: number | null;
    ref_high: number | null;
    interpretation: Interpretation;
    effective_date: string | null;
  };
  spark: { date: string; value: number }[];
}

export interface TrendPoint {
  id: string;
  document_id: string;
  test_name: string;
  value_text: string;
  value_num: number;
  unit: string;
  reference_range_text: string | null;
  ref_low: number | null;
  ref_high: number | null;
  interpretation: Interpretation;
  effective_date: string;
  is_user_corrected: boolean;
}

export interface TrendDetail {
  test: string;
  display_name: string;
  series: { unit: string; points: TrendPoint[] }[];
  excluded: (Omit<TrendPoint, "value_num" | "unit"> & { value_num: number | null; unit: string | null; reason: string })[];
  note: string;
}

export interface Dashboard {
  stats: {
    total_documents: number;
    confirmed_documents: number;
    pending_review: number;
    processing: number;
    failed: number;
    lab_results: number;
    out_of_range: number;
    medications: number;
    conversations: number;
  };
  snapshot: TrendTest[];
  range_breakdown: Record<Interpretation, number>;
  monthly: { month: string; documents: number; confirmed: number }[];
  recent_documents: Pick<DocumentMeta, "id" | "file_name" | "doc_type" | "status" | "document_date" | "source_facility" | "created_at" | "status_detail">[];
  attention: Pick<
    Observation,
    "id" | "document_id" | "test_name" | "value_text" | "value_num" | "unit" | "reference_range_text" | "ref_low" | "ref_high" | "interpretation" | "effective_date"
  >[];
  activity: { action: string; entity_id: string | null; created_at: string; metadata: Record<string, unknown> }[];
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  date_of_birth: string | null;
  sex: "female" | "male" | "other" | "unknown" | null;
  blood_group: string | null;
  preferred_language: Lang;
  mock_abha_id: string | null;
  age_years?: number | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  onboarding_completed?: boolean | null;
}

export interface Citation {
  ref: string;
  kind: "observation" | "medication" | "condition" | "document";
  document_id: string | null;
  label: string;
  detail: string | null;
  date: string | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  insufficient_information: boolean;
  created_at: string;
}

export interface HealthStatus {
  status: string;
  supabase_configured: boolean;
  ai_configured: boolean;
  ai_model: string;
  ocr_available: boolean;
}
