-- 20260807104743_class_periods_per_subject.sql
-- 수업 시간을 분반 단위가 아니라 (분반 × 과목) 단위로 잡는다.
-- 한 분반이 여러 과목을 들으면 과목마다 요일·교시가 다르기 때문이다.
-- 데이터가 0행이라 재생성한다(20260807100348 에서 만든 지 얼마 안 된 표).

drop table if exists public.class_periods;

create table public.class_periods (
  class_id    uuid    not null references public.classes(id)  on delete cascade,
  subject_id  uuid    not null references public.subjects(id) on delete cascade,
  weekday     integer not null check (weekday between 1 and 7),   -- 1=월
  period      integer not null check (period between 1 and 12),
  primary key (class_id, subject_id, weekday, period)
);

create index class_periods_class_idx   on public.class_periods (class_id);
create index class_periods_subject_idx on public.class_periods (class_id, subject_id);

comment on table public.class_periods is
  '분반×과목별 수업 요일·교시. 관리자.html parseSlots("화3, 목5") 가 만든다.';

alter table public.class_periods enable row level security;

create policy class_periods_read on public.class_periods
  for select to authenticated using (true);
create policy class_periods_admin_write on public.class_periods
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.class_periods from anon;
grant select on public.class_periods to authenticated;
grant insert, update, delete on public.class_periods to authenticated;
