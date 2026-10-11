-- Onboarding journey: personal details + completion flag, and structured timeline metadata
-- so event titles can be shown in the user's language.

alter table public.profiles add column if not exists age_years integer check (age_years between 0 and 130);
alter table public.profiles add column if not exists height_cm numeric(5, 1) check (height_cm between 30 and 260);
alter table public.profiles add column if not exists weight_kg numeric(5, 1) check (weight_kg between 1 and 400);
alter table public.profiles add column if not exists onboarding_completed boolean not null default false;

-- People who signed up before onboarding existed skip it.
update public.profiles set onboarding_completed = true where onboarding_completed = false;

alter table public.timeline_events add column if not exists meta jsonb;
