-- 20260803000008_revoke_anon.sql
-- 익명(anon) 역할의 권한을 전면 회수한다.
--
-- Supabase 기본 설정은 public 스키마의 새 테이블에 anon SELECT/INSERT/UPDATE/DELETE 를 부여한다.
-- RLS 정책에 anon 항목이 없으면 실제로는 0행이 반환되지만, 그 경우 방어선이 RLS 하나뿐이다.
-- 이 시스템에는 익명 접근이 아예 존재하지 않으므로 테이블 권한 자체를 없애 이중으로 막는다.
--
-- 배경: 구 시스템은 anon 이 호출할 수 있는 student_login_email(이름) 함수가 있어
-- 인터넷 누구나 학생 이름으로 로그인 이메일을 조회할 수 있었다. 그 사고 유형을 구조적으로 차단한다.

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- 앞으로 추가될 객체에도 같은 규칙이 자동 적용되게 한다.
-- (이걸 빼면 새 테이블을 만들 때마다 anon 권한이 다시 생긴다.)
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- 검증 쿼리 (마이그레이션 후 수동 확인용)
--   select count(*) from information_schema.role_table_grants
--    where table_schema='public' and grantee='anon';        -- 0 이어야 한다
--   select count(*) from information_schema.routine_privileges
--    where routine_schema='public' and grantee='anon';      -- 0 이어야 한다
