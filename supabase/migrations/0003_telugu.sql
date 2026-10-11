-- Allow Telugu as a preferred language.
alter table public.profiles drop constraint if exists profiles_preferred_language_check;
alter table public.profiles
  add constraint profiles_preferred_language_check check (preferred_language in ('en', 'hi', 'mr', 'te'));
