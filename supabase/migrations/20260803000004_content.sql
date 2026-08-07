-- 20260803000003_content.sql
-- 4단계 교육과정 트리(과목 → 대단원 → 중단원 → 소단원 → 자료)와 공지.
-- 컬럼은 js/db.js 의 fetchSubjectTree() select 절과 관리자.html CRUD 에서 역추출했다.

-- ── 대단원 ───────────────────────────────────────────────────
create table public.units (
  id          uuid primary key default gen_random_uuid(),
  subject_id  uuid not null references public.subjects(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index units_subject_idx on public.units (subject_id, is_active, sort_order);

-- ── 중단원 ───────────────────────────────────────────────────
create table public.mid_units (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references public.units(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index mid_units_unit_idx on public.mid_units (unit_id, is_active, sort_order);

-- ── 소단원 ───────────────────────────────────────────────────
create table public.subunits (
  id           uuid primary key default gen_random_uuid(),
  mid_unit_id  uuid not null references public.mid_units(id) on delete cascade,
  name         text not null,
  description  text,
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
create index subunits_mid_unit_idx on public.subunits (mid_unit_id, is_active, sort_order);

-- ── 수업자료 ─────────────────────────────────────────────────
create table public.materials (
  id                 uuid primary key default gen_random_uuid(),
  subunit_id         uuid not null references public.subunits(id) on delete cascade,
  type               text not null,
  name               text not null,
  meta               text,
  url                text,
  storage_path       text,
  original_filename  text,
  sort_order         integer not null default 0,
  is_active          boolean not null default true,
  teacher_only       boolean not null default false,
  visible_from       timestamptz,
  visible_until      timestamptz,
  created_at         timestamptz not null default now()
);
create index materials_subunit_idx on public.materials (subunit_id, is_active, sort_order);

comment on column public.materials.type is
  '자료 종류. 구 코드의 JS 상수는 7종이었으나 DB 제약 여부는 확인할 수 없었다. 값이 확정되면 CHECK 로 좁힐 것.';
comment on column public.materials.teacher_only is '참이면 학생에게 보이지 않는다. RLS 에서 적용.';

-- ── 공지 ─────────────────────────────────────────────────────
create table public.announcements (
  id                uuid primary key default gen_random_uuid(),
  subject_id        uuid not null references public.subjects(id) on delete cascade,
  title             text not null,
  body              text not null default '',
  level             text not null default 'general'
                      check (level in ('general', 'important', 'urgent')),
  is_active         boolean not null default true,
  publish_from      timestamptz,
  publish_until     timestamptz,
  attachments       jsonb not null default '[]'::jsonb,
  target_class_ids  uuid[],                     -- null 이면 과목 전체 대상
  created_at        timestamptz not null default now()
);
create index announcements_subject_idx on public.announcements (subject_id, is_active, created_at desc);

comment on column public.announcements.level is
  'UI 가 general/important/urgent 세 값을 쓴다. 구 DB 에 CHECK/enum 이 있었는지는 확인 불가 — 새로 CHECK 로 명시한다.';
comment on column public.announcements.target_class_ids is
  'null = 과목 수강 전체. 값이 있으면 해당 분반만.';
