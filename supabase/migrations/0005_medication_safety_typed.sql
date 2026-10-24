-- Allow saved reports that come from a typed prescription (source_type = 'typed').
-- Safe to run more than once. Run 0004_medication_safety.sql first.
alter table public.medication_safety_reports drop constraint if exists medication_safety_reports_source_type_check;
alter table public.medication_safety_reports
  add constraint medication_safety_reports_source_type_check check (source_type in ('document', 'current_list', 'typed'));
