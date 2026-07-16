create table if not exists public.aiac_projects (
  id text primary key,
  project jsonb not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.aiac_jobs (
  id text primary key,
  project_id text not null,
  job jsonb not null,
  status text not null default 'queued',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists aiac_projects_updated_at_idx
  on public.aiac_projects (updated_at desc);

create index if not exists aiac_jobs_project_id_idx
  on public.aiac_jobs (project_id);

alter table public.aiac_projects enable row level security;
alter table public.aiac_jobs enable row level security;

revoke all on table public.aiac_projects from anon, authenticated;
revoke all on table public.aiac_jobs from anon, authenticated;

grant select, insert, update, delete on table public.aiac_projects to service_role;
grant select, insert, update, delete on table public.aiac_jobs to service_role;
