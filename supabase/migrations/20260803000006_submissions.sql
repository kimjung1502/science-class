-- 20260803000005_submissions.sql
-- 산출물 제출. 컬럼은 js/db.js 의 saveSubmissionAssignment payload 와
-- supabase/functions/submit-work/index.ts 의 insert/update 에서 역추출했다.
--
-- 구 스키마와 달라진 점(의도적):
--   * 시간표 기반 제출창(school_periods / class_periods / experiment_windows)을 복원하지 않는다.
--     교사가 과제별로 publish_at / due_at 을 직접 정한다.
--   * submissions.student_name / class_name 스냅샷은 남긴다. 학생이 전출·삭제돼도
--     세특 작성 근거가 유지돼야 하기 때문이다. 다만 보유기간이 끝나면 함께 파기한다.

create table public.submission_assignments (
  id            uuid primary key default gen_random_uuid(),
  subject_id    uuid not null references public.subjects(id) on delete cascade,
  title         text not null,
  description   text not null default '',
  due_date      date,
  due_at        timestamptz,
  publish_at    timestamptz,
  fields        jsonb not null default '[]'::jsonb,
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index submission_assignments_subject_idx
  on public.submission_assignments (subject_id, is_active, sort_order, created_at desc);

create trigger submission_assignments_touch before update on public.submission_assignments
  for each row execute function public.touch_updated_at();

comment on column public.submission_assignments.fields is
  '질문 정의 배열. 유형은 text / choice / mindmap / file 등. 구조 검증은 서버(submit-work)에서 한다.';
comment on column public.submission_assignments.publish_at is
  '이 시각 전에는 학생에게 보이지 않는다. 구 시스템의 시간표 게이트를 대체한다.';
comment on column public.submission_assignments.due_at is
  '이 시각 이후에는 제출·수정이 막힌다. 보강·결석생은 교사가 이 값을 늦추면 된다.';

create table public.submissions (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.submission_assignments(id) on delete cascade,
  student_id     uuid not null references public.students(id) on delete restrict,
  student_name   text not null,
  class_id       uuid references public.classes(id) on delete set null,
  class_name     text,
  answers        jsonb not null default '{}'::jsonb,
  mode           text not null default 'form',
  submitted_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index submissions_assignment_student_key
  on public.submissions (assignment_id, student_id);
create index submissions_student_idx on public.submissions (student_id);

create trigger submissions_touch before update on public.submissions
  for each row execute function public.touch_updated_at();

comment on table public.submissions is
  '학생 1명당 과제 1건. 재제출은 같은 행을 갱신한다(unique 제약이 그것을 보장).';
comment on column public.submissions.student_id is
  'on delete restrict — 학생을 지울 때 제출물이 조용히 사라지지 않게 한다. 파기는 명시적 절차로만.';
comment on column public.submissions.answers is
  '질문 id → 답. 텍스트·선택·마인드맵 JSON. 마인드맵은 {version,nodes,links} 만 저장하고 PNG 는 저장하지 않는다(교사 화면에서 다시 렌더링).';
