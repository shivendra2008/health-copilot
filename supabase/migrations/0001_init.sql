-- Health Copilot — initial schema
-- FHIR-aligned (Patient, DocumentReference, Observation, MedicationRequest, Condition).
-- This is NOT an official ABDM/FHIR implementation; the mapping is for structure only.
--
-- Access model:
--   * The FastAPI backend uses the service-role key and ALWAYS filters by user_id.
--   * RLS is enabled on every table as defense in depth, so the anon key
--     (used by the browser only for Supabase Auth) can never read other users' data.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles  (FHIR: Patient)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  date_of_birth date,
  sex text check (sex in ('female', 'male', 'other', 'unknown')),
  blood_group text,
  preferred_language text not null default 'en' check (preferred_language in ('en', 'hi', 'mr')),
  mock_abha_id text,               -- clearly labelled DEMO value, never a real ABHA number
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create a profile row on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', null))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- documents  (FHIR: DocumentReference)
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  sha256 text not null,
  page_count integer,
  doc_type text not null default 'other'
    check (doc_type in ('prescription', 'lab_report', 'diagnostic_report', 'discharge_summary', 'other')),
  document_date date,
  source_facility text,
  source_clinician text,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'extracting_text', 'analyzing', 'needs_review', 'confirmed', 'failed')),
  status_detail text,
  text_method text check (text_method in ('native', 'ocr', 'mixed')),
  ocr_confidence numeric(5, 4),
  extracted_text text,             -- full text kept for provenance checks; never logged
  error_code text,
  attempts integer not null default 0,
  processing_started_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, sha256)
);
create index if not exists documents_user_created_idx on public.documents (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- extractions — one row per processing run (versioned, history preserved)
-- ---------------------------------------------------------------------------
create table if not exists public.extractions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  version integer not null,
  model text,
  ai_output jsonb not null,           -- original validated model output (immutable)
  current_data jsonb not null,        -- what the user sees / edits
  issues jsonb not null default '[]',  -- deterministic validation flags
  summary jsonb,                       -- AI summary (by language)
  status text not null default 'pending_review'
    check (status in ('pending_review', 'confirmed', 'superseded')),
  corrected_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, version)
);
create index if not exists extractions_doc_idx on public.extractions (document_id, version desc);

-- ---------------------------------------------------------------------------
-- observations  (FHIR: Observation — laboratory)
-- ---------------------------------------------------------------------------
create table if not exists public.observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  extraction_id uuid not null references public.extractions (id) on delete cascade,
  item_key text not null,             -- stable id of the item inside the extraction
  test_name text not null,
  normalized_name text not null,
  category text,
  value_text text not null,           -- exactly as documented / corrected
  value_num numeric,                  -- parsed number, null if not numeric
  value_comparator text,              -- '<', '>', '<=', '>=' when documented
  unit text,
  unit_normalized text,
  reference_range_text text,
  ref_low numeric,
  ref_high numeric,
  documented_flag text,               -- flag printed on the report (H, L, *)
  interpretation text not null default 'unverified'
    check (interpretation in ('within_range', 'above_range', 'below_range', 'unverified')),
  effective_date date,
  source_text text,
  original jsonb,                     -- original AI value, kept when user corrected
  is_user_corrected boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists observations_user_name_idx on public.observations (user_id, normalized_name, effective_date);

-- ---------------------------------------------------------------------------
-- medications  (FHIR: MedicationRequest)
-- ---------------------------------------------------------------------------
create table if not exists public.medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  extraction_id uuid not null references public.extractions (id) on delete cascade,
  item_key text not null,
  name text not null,
  strength text,
  dosage text,
  frequency text,
  duration text,
  route text,
  instructions text,
  authored_date date,
  source_text text,
  original jsonb,
  is_user_corrected boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists medications_user_idx on public.medications (user_id, authored_date desc);

-- ---------------------------------------------------------------------------
-- conditions  (FHIR: Condition — only as explicitly stated in the source)
-- ---------------------------------------------------------------------------
create table if not exists public.conditions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  extraction_id uuid not null references public.extractions (id) on delete cascade,
  item_key text not null,
  description text not null,
  clinical_status text,
  recorded_date date,
  source_text text,
  original jsonb,
  is_user_corrected boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists conditions_user_idx on public.conditions (user_id, recorded_date desc);

-- ---------------------------------------------------------------------------
-- timeline_events
-- ---------------------------------------------------------------------------
create table if not exists public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid references public.documents (id) on delete cascade,
  event_date date not null,
  event_type text not null
    check (event_type in ('document', 'lab_result', 'medication', 'diagnosis', 'procedure', 'follow_up')),
  category text,
  title text not null,
  description text,
  created_at timestamptz not null default now()
);
create index if not exists timeline_user_date_idx on public.timeline_events (user_id, event_date desc);

-- ---------------------------------------------------------------------------
-- assistant
-- ---------------------------------------------------------------------------
create table if not exists public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_user_idx on public.assistant_conversations (user_id, updated_at desc);

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb not null default '[]',
  insufficient_information boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.assistant_messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- audit_logs  (no raw medical content is ever written here)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists audit_user_idx on public.audit_logs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'documents', 'extractions', 'assistant_conversations'] loop
    execute format('drop trigger if exists %1$s_touch on public.%1$s', t);
    execute format('create trigger %1$s_touch before update on public.%1$s for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security (defense in depth)
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.extractions enable row level security;
alter table public.observations enable row level security;
alter table public.medications enable row level security;
alter table public.conditions enable row level security;
alter table public.timeline_events enable row level security;
alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select using (auth.uid() = id);
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

do $$
declare t text;
begin
  foreach t in array array['documents', 'extractions', 'observations', 'medications', 'conditions',
                           'timeline_events', 'assistant_conversations', 'assistant_messages'] loop
    execute format('drop policy if exists "own rows read" on public.%I', t);
    execute format('create policy "own rows read" on public.%I for select using (auth.uid() = user_id)', t);
  end loop;
end $$;
-- audit_logs: no client policies at all (backend only)

-- ---------------------------------------------------------------------------
-- Private storage bucket (10 MB limit, medical document types only)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('medical-documents', 'medical-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
-- No storage.objects policies are created: only the service role (backend) can
-- read/write, and users get short-lived signed URLs from the API.
