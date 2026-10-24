-- Allergy master list. The backend compares each prescribed medicine with this list (by ingredient, drug class or
-- brand) and flags a match. Safe to run more than once.

create table if not exists public.allergies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  substance text not null check (char_length(substance) between 2 and 100),
  severity text not null default 'unknown' check (severity in ('mild', 'moderate', 'severe', 'unknown')),
  reaction text check (reaction is null or char_length(reaction) <= 200),
  notes text check (notes is null or char_length(notes) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists allergies_user_substance_uniq on public.allergies (user_id, lower(substance));
create index if not exists allergies_user_idx on public.allergies (user_id, created_at);

drop trigger if exists allergies_touch on public.allergies;
create trigger allergies_touch before update on public.allergies
  for each row execute function public.touch_updated_at();

alter table public.allergies enable row level security;
drop policy if exists "own rows read" on public.allergies;
create policy "own rows read" on public.allergies for select using (auth.uid() = user_id);
-- No insert/update/delete policies: writes happen only through the backend (service role).
