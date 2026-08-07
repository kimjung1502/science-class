-- 20260803000002_identity_and_classes.sql
-- 관리자, 학생, 인증 연결, 분반.
--
-- 구 스키마와 달라진 점(의도적):
--   * students.email / students.auth_user_id / students.class_id 를 두지 않는다.
--     인증 연결은 student_identities 한 곳, 분반 소속은 student_classes 한 곳만 진실로 삼는다.
--     구 스키마는 students.class_id 와 student_classes 가 동시에 있어 이중 진실이었다.
--   * students.must_change_password 는 남긴다(비밀번호 방식 채택 시 필요).
--   * 초기 비밀번호를 학번으로 만드는 관행은 폐기한다. 계정별 무작위 코드로 발급하고
--     최초 로그인 시 변경을 강제한다. 자세한 내용은 REBUILD-NOTES.md 4-1절.

-- ── 관리자(교사) ──────────────────────────────────────────────
create table public.admins (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null unique references auth.users(id) on delete cascade,
  email         text not null,
  name          text,
  is_owner      boolean not null default false,
  created_at    timestamptz not null default now()
);
create unique index admins_email_lower_key on public.admins (lower(email));

comment on table  public.admins is '교사·관리자 계정. auth.users 와 1:1.';
comment on column public.admins.is_owner is '관리자 계정 자체를 추가·삭제할 수 있는 최상위 권한.';

-- ── 분반 ─────────────────────────────────────────────────────
create table public.classes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort_order  integer not null default 0,
  hidden_at   timestamptz,                      -- 숨김 처리 시각. 즉시 삭제하지 않는다.
  created_at  timestamptz not null default now()
);
create index classes_visible_idx on public.classes (hidden_at, sort_order, name);

comment on column public.classes.hidden_at is
  '숨긴 시각. 구 UI 는 "6개월 뒤 자동 삭제"를 표시했으나 그 배치 작업은 소실됐다. 자동 삭제가 필요하면 별도 작업으로 명시적으로 만들 것.';

-- ── 학생 ─────────────────────────────────────────────────────
create table public.students (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  student_number        text not null,
  is_active             boolean not null default true,
  must_change_password  boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index students_number_key on public.students (student_number);
create index students_active_idx on public.students (is_active, name);

create trigger students_touch before update on public.students
  for each row execute function public.touch_updated_at();

comment on table public.students is
  '학생 명부. 인증 정보는 여기 두지 않는다(student_identities 참조). 수집 항목은 이름·학번뿐이다.';

-- ── 인증 연결 (신규) ──────────────────────────────────────────
-- 학교 구글 계정 SSO 와 비밀번호 로그인을 같은 학생 레코드에 붙일 수 있게 한다.
-- 방식을 바꿔도 students.id 와 제출 데이터는 그대로 유지된다.
create table public.student_identities (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.students(id) on delete cascade,
  auth_user_id  uuid not null unique references auth.users(id) on delete cascade,
  auth_method   text not null check (auth_method in ('google', 'password')),
  linked_at     timestamptz not null default now(),
  disabled_at   timestamptz
);
create index student_identities_student_idx on public.student_identities (student_id, disabled_at);

comment on table public.student_identities is
  '학생 ↔ Supabase Auth 사용자 연결. 전환기에는 한 학생에 google/password 두 건이 공존할 수 있고, 전환이 끝나면 구 방식을 disabled_at 으로 비활성화한다.';

-- ── 과목 ─────────────────────────────────────────────────────
create table public.subjects (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  icon         text,
  accent       text,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index subjects_active_idx on public.subjects (is_active, sort_order);

-- ── 분반 ↔ 과목 ──────────────────────────────────────────────
create table public.class_subjects (
  class_id    uuid not null references public.classes(id)  on delete cascade,
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  primary key (class_id, subject_id)
);
create index class_subjects_subject_idx on public.class_subjects (subject_id);

-- ── 학생 ↔ 분반 ──────────────────────────────────────────────
create table public.student_classes (
  student_id  uuid not null references public.students(id) on delete cascade,
  class_id    uuid not null references public.classes(id)  on delete cascade,
  primary key (student_id, class_id)
);
create index student_classes_class_idx on public.student_classes (class_id);
