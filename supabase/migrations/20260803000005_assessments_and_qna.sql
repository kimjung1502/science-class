-- 20260803000004_assessments_and_qna.sql
-- 수행평가 공지와 질의응답.
-- 컬럼은 js/db.js 의 ASSESSMENT_COLS 상수와 questions/answers insert·select 에서 역추출했다.

-- ── 수행평가 ─────────────────────────────────────────────────
create table public.assessments (
  id                  uuid primary key default gen_random_uuid(),
  subject_id          uuid not null references public.subjects(id) on delete cascade,
  title               text not null,
  summary             text,
  status              text not null default 'upcoming'
                        check (status in ('upcoming', 'ongoing', 'closed')),
  start_date          date,
  due_date            date,
  weight              text,
  tags                text[] not null default '{}',
  detail_open_from    timestamptz,
  detail_open_until   timestamptz,
  unit_id             uuid references public.units(id)     on delete set null,
  mid_unit_id         uuid references public.mid_units(id) on delete set null,
  subunit_id          uuid references public.subunits(id)  on delete set null,
  sort_order          integer not null default 0,
  author_name         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index assessments_subject_idx on public.assessments (subject_id, sort_order, created_at desc);

create trigger assessments_touch before update on public.assessments
  for each row execute function public.touch_updated_at();

comment on column public.assessments.status is
  'UI 가 upcoming/ongoing/closed 를 쓴다. 구 DB 의 제약 여부는 확인 불가 — 새로 CHECK 로 명시.';
comment on column public.assessments.detail_open_from is
  '상세(본문·루브릭) 공개 시작. assessment_details 의 RLS 가 이 값을 본다.';

-- 상세는 별도 테이블로 분리한다. 목록은 항상 보여주되 본문·루브릭은
-- 공개 기간에만 열기 위해서다(구 스키마의 구조를 그대로 유지).
create table public.assessment_details (
  assessment_id  uuid primary key references public.assessments(id) on delete cascade,
  body           text not null default '',
  rubric         jsonb not null default '[]'::jsonb,
  updated_at     timestamptz not null default now()
);

create trigger assessment_details_touch before update on public.assessment_details
  for each row execute function public.touch_updated_at();

-- 상세 공개 여부 판정. 관리자는 항상 열람, 학생은 기간 안에서만.
create or replace function public.assessment_detail_visible(p_assessment uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.is_admin() then true
    else exists (
      select 1 from public.assessments a
      where a.id = p_assessment
        and (a.detail_open_from  is null or a.detail_open_from  <= now())
        and (a.detail_open_until is null or a.detail_open_until >= now())
    )
  end;
$$;
revoke execute on function public.assessment_detail_visible(uuid) from anon, public;
grant  execute on function public.assessment_detail_visible(uuid) to authenticated;

-- ── 질의응답 ─────────────────────────────────────────────────
-- 학생에게는 실명 대신 별칭을 보여준다. 실명 매핑은 교사만 본다.
-- (한지쌤 문서의 개인코드 방식과 같은 취지 — 게시판에 실명이 노출되지 않게 한다.)
create table public.questions (
  id            uuid primary key default gen_random_uuid(),
  subject_id    uuid not null references public.subjects(id) on delete cascade,
  title         text not null,
  body          text not null default '',
  author_id     uuid references auth.users(id) on delete set null,
  author_alias  text not null default '익명',
  unit_id       uuid references public.units(id)     on delete set null,
  mid_unit_id   uuid references public.mid_units(id) on delete set null,
  subunit_id    uuid references public.subunits(id)  on delete set null,
  view_count    integer not null default 0,
  is_hidden     boolean not null default false,   -- 교사가 부적절 게시물을 숨김 처리
  delete_requested_at timestamptz,                -- 학생의 삭제 요청 접수 시각
  created_at    timestamptz not null default now()
);
create index questions_subject_idx on public.questions (subject_id, is_hidden, created_at desc);

comment on column public.questions.author_alias is
  '게시판 표시용 별칭. 구 스키마의 author_name(실명)을 대체한다. 실명은 author_id → student_identities → students 로만 조회한다.';
comment on column public.questions.is_hidden is '교사가 숨김 처리한 게시물. 학생에게 보이지 않는다.';

create table public.answers (
  id            uuid primary key default gen_random_uuid(),
  question_id   uuid not null references public.questions(id) on delete cascade,
  body          text not null,
  author_id     uuid references auth.users(id) on delete set null,
  author_name   text not null default '선생님',
  created_at    timestamptz not null default now()
);
create index answers_question_idx on public.answers (question_id, created_at);

-- 조회수 증가. 학생이 questions 를 직접 update 하지 못하게 하고 이 함수로만 올린다.
create or replace function public.increment_question_views(p_question uuid)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  update public.questions
     set view_count = view_count + 1
   where id = p_question and is_hidden = false;
$$;
revoke execute on function public.increment_question_views(uuid) from anon, public;
grant  execute on function public.increment_question_views(uuid) to authenticated;
