-- 20260807100348_restore_timetable_tables.sql
-- 관리자.html 의 시간표 화면이 쓴다(695-777줄). restore-plan-v2 는 학생 개방 범위를
-- 줄이려고 이 둘을 제외했지만, 교사 단독 사용 단계에서는 기능을 그대로 살린다.
-- 컬럼은 관리자.html 의 insert/select 에서 역추출했다.

create table if not exists public.school_periods (
  period      integer primary key check (period between 1 and 12),
  start_time  time not null,
  end_time    time not null
);

comment on table public.school_periods is '교시별 시작·종료 시각. 학교 전체 공통.';

create table if not exists public.class_periods (
  class_id  uuid    not null references public.classes(id) on delete cascade,
  weekday   integer not null check (weekday between 1 and 7),   -- 1=월
  period    integer not null check (period between 1 and 12),
  primary key (class_id, weekday, period)
);

create index if not exists class_periods_class_idx on public.class_periods (class_id);

comment on table public.class_periods is '분반별 수업 요일·교시. 관리자.html parseSlots("화3, 목5") 가 만든다.';

alter table public.school_periods enable row level security;
alter table public.class_periods  enable row level security;

-- 시간표는 수업 운영 정보라 로그인 사용자면 읽을 수 있고, 쓰기는 관리자만.
create policy school_periods_read on public.school_periods
  for select to authenticated using (true);
create policy school_periods_admin_write on public.school_periods
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy class_periods_read on public.class_periods
  for select to authenticated using (true);
create policy class_periods_admin_write on public.class_periods
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.school_periods from anon;
revoke all on public.class_periods  from anon;
grant select on public.school_periods to authenticated;
grant select on public.class_periods  to authenticated;
grant insert, update, delete on public.school_periods to authenticated;
grant insert, update, delete on public.class_periods  to authenticated;
