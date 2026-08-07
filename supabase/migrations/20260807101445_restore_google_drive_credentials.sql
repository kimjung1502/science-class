-- 20260807101445_restore_google_drive_credentials.sql
-- Drive 연동 복원. Supabase 무료 Storage 는 1GB 라 5과목 수업자료를 담을 수 없어서
-- 원래 교사 Google Drive 로 보내던 구조였다. 그래서 이 테이블이 다시 필요하다.
--
-- ponytail: client_secret·refresh_token 을 public 스키마에 평문으로 둔다. RLS 를 켜고
-- 정책을 하나도 만들지 않아 anon·authenticated 는 전부 차단되고 service_role(Edge
-- Function)만 읽는다. 클라이언트 코드도 이 테이블을 직접 참조하지 않는다.
-- 학생 개방 전에는 Supabase Vault 로 옮길 것(restore-plan-v2 Q2).

create table if not exists public.google_drive_credentials (
  id              integer primary key default 1 check (id = 1),
  client_id       text,
  client_secret   text,
  picker_api_key  text,
  refresh_token   text,
  access_token    text,
  token_expiry    timestamptz,
  email           text,
  connected_at    timestamptz,
  root_folder_id  text,
  school_name     text,
  acad_year       text,
  semester        text,
  curriculum      text
);

-- Edge Function 이 전부 update(...).eq('id', 1) 이라 단일 행이 미리 있어야 한다.
insert into public.google_drive_credentials (id) values (1) on conflict (id) do nothing;

alter table public.google_drive_credentials enable row level security;
revoke all on public.google_drive_credentials from anon, authenticated;
