-- 20260821090000_experiment_states.sql
-- 실험 페이지 '이어하기' 저장소.
--
-- 그동안 진행 중인 상태는 localStorage 에만 있었다. 저장소는 기기·브라우저마다 따로라
-- 교실 태블릿에서 하다가 집 노트북(또는 크롬→사파리)에서 열면 빈 화면이 나왔다.
-- 최종 제출본(선생님 드라이브의 학번_이름.json)은 결과물이고, 이 테이블은 그 전 단계의
-- 임시 저장이다 — 학생 본인만 읽고 쓴다.
create table public.experiment_states (
  student_id uuid not null default public.current_student_id()
             references public.students(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title      text not null,
  payload    jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (student_id, subject_id, title)
);
comment on table public.experiment_states is
  '실험 페이지 이어하기용 임시 저장(학생 본인 전용). 제출 결과물은 선생님 드라이브에 따로 남는다.';

alter table public.experiment_states enable row level security;

-- 학생은 자기 행만. 쓰기는 자기가 수강하는 과목에 대해서만.
create policy experiment_states_self on public.experiment_states
  for all to authenticated
  using (student_id = public.current_student_id())
  with check (student_id = public.current_student_id()
              and public.student_can_see_subject(subject_id));

-- 교사는 읽기만(누가 어디까지 왔는지 확인용). 고치는 건 학생 몫이다.
create policy experiment_states_admin_read on public.experiment_states
  for select to authenticated using (public.is_admin());

-- updated_at 은 서버 시각으로만 찍는다. 학생 기기 시계는 못 믿는다.
create or replace function public.touch_experiment_state()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger experiment_states_touch
  before insert or update on public.experiment_states
  for each row execute function public.touch_experiment_state();
