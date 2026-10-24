-- Kidney-function rechecks: every time a confirmed lab report adds a kidney result (eGFR or serum creatinine) the
-- backend re-evaluates the kidney-related medication rules for the user's active medicines and stores the outcome here.
-- Safe to run more than once.

create table if not exists public.kidney_rechecks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  trigger_document_id uuid references public.documents (id) on delete set null,  -- the lab report that added the result
  kidney_status text not null check (kidney_status in ('normal', 'reduced', 'unknown')),
  egfr numeric,                                                                  -- reported or calculated, mL/min/1.73 m²
  method text check (method in ('reported_egfr', 'calculated_ckd_epi_2021')),
  observed_date date,
  threshold numeric not null,
  previous_status text check (previous_status in ('normal', 'reduced', 'unknown')),
  medicines_checked integer not null default 0,
  findings jsonb not null default '[]',
  ruleset_version text not null,
  created_at timestamptz not null default now()
);
create index if not exists kidney_rechecks_user_idx on public.kidney_rechecks (user_id, created_at desc);

alter table public.kidney_rechecks enable row level security;
drop policy if exists "own rows read" on public.kidney_rechecks;
create policy "own rows read" on public.kidney_rechecks for select using (auth.uid() = user_id);
-- No insert/update/delete policies: writes happen only through the backend (service role).
