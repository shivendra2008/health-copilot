-- Medication Safety (prototype).
-- Three separate things are kept apart on purpose:
--   public.medications               document medication (what a prescription said; written when a document is confirmed)
--   public.confirmed_medications     what the USER confirmed, incl. explicit current-use status and resolved catalogue entry
--   public.medication_safety_reports saved, versioned safety reviews of a confirmed list
-- The catalogue and ruleset live in the backend repo as versioned JSON (not in the database).
-- Access model is unchanged: backend (service role) filters by user_id; RLS is defense in depth.

create table if not exists public.confirmed_medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid references public.documents (id) on delete set null,   -- source prescription, if any
  source_item_key text,                                                   -- item key inside the document extraction
  name text not null check (char_length(name) between 1 and 200),
  strength text,
  dosage text,
  frequency text,
  duration text,
  route text,
  instructions text,
  prescription_date date,
  current_status text not null default 'unknown' check (current_status in ('current', 'past', 'unknown')),
  status_confirmed_at timestamptz,
  uncertain_fields text[] not null default '{}',
  catalogue_id text,
  resolution_status text not null default 'unresolved'
    check (resolution_status in ('resolved', 'ambiguous', 'unresolved', 'user_selected', 'user_unresolved')),
  resolution_confidence text not null default 'none' check (resolution_confidence in ('high', 'medium', 'low', 'none', 'user_confirmed')),
  resolution_candidates jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists confirmed_meds_user_idx on public.confirmed_medications (user_id, created_at desc);
create index if not exists confirmed_meds_doc_idx on public.confirmed_medications (document_id);
create unique index if not exists confirmed_meds_source_uniq
  on public.confirmed_medications (user_id, document_id, source_item_key) where source_item_key is not null;

create table if not exists public.medication_safety_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_type text not null check (source_type in ('document', 'current_list')),
  document_id uuid references public.documents (id) on delete set null,
  include_current boolean not null default false,
  ruleset_version text not null,
  catalogue_version text not null,
  medication_snapshot jsonb not null,          -- the exact confirmed list that was checked
  patient_context jsonb not null default '{}', -- minimal, e.g. {"adult": true}
  findings jsonb not null default '[]',
  unresolved jsonb not null default '[]',
  missing_information jsonb not null default '[]',
  limitations jsonb not null default '[]',
  summary jsonb not null default '{}',
  explanations jsonb not null default '{}',    -- cached assistant explanations by language (derived from findings only)
  status text not null default 'ready' check (status in ('ready')),
  created_at timestamptz not null default now()
);
create index if not exists med_reports_user_idx on public.medication_safety_reports (user_id, created_at desc);

drop trigger if exists confirmed_medications_touch on public.confirmed_medications;
create trigger confirmed_medications_touch before update on public.confirmed_medications
  for each row execute function public.touch_updated_at();

alter table public.confirmed_medications enable row level security;
alter table public.medication_safety_reports enable row level security;

drop policy if exists "own rows read" on public.confirmed_medications;
create policy "own rows read" on public.confirmed_medications for select using (auth.uid() = user_id);
drop policy if exists "own rows read" on public.medication_safety_reports;
create policy "own rows read" on public.medication_safety_reports for select using (auth.uid() = user_id);
-- No insert/update/delete policies: writes happen only through the backend (service role).
