-- 20260807101236_restore_experiment_windows.sql
-- submit-work 의 op=experiment-window 가 쓴다. 실험별 임시 마감 시각(보강·결석생 연장).
-- upsert 대상이라 (subject_id, title) 이 PK 여야 한다.

create table if not exists public.experiment_windows (
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  title       text not null,
  close_at    timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (subject_id, title)
);

alter table public.experiment_windows enable row level security;

create policy experiment_windows_read on public.experiment_windows
  for select to authenticated using (true);
create policy experiment_windows_admin_write on public.experiment_windows
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.experiment_windows from anon;
grant select on public.experiment_windows to authenticated;
grant insert, update, delete on public.experiment_windows to authenticated;
