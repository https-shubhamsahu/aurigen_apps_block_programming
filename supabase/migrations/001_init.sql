-- Aurigen initial schema
-- Run in Supabase SQL editor or via `supabase db push`

-- ============================================================
-- users: public profile row mirroring auth.users
-- ============================================================
create table public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  role       text not null default 'student' check (role in ('student', 'teacher', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "users can read own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "users can update own profile"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id and role = 'student'); -- students cannot self-promote

-- Auto-create a profile row on signup (runs as definer, bypasses RLS)
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.users (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- projects: one row per saved Blockly workspace
-- ============================================================
create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  title         text not null default 'Untitled Project',
  board_target  text not null default 'esp32_devkit_v1',
  workspace_xml text,           -- Blockly serialized state
  generated_cpp text,           -- last translated C++ (historical reference)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index projects_user_id_idx on public.projects (user_id, updated_at desc);

alter table public.projects enable row level security;

-- Owner-only CRUD
create policy "read own projects"   on public.projects for select using (auth.uid() = user_id);
create policy "insert own projects" on public.projects for insert with check (auth.uid() = user_id);
create policy "update own projects" on public.projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own projects" on public.projects for delete using (auth.uid() = user_id);

-- Keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();
