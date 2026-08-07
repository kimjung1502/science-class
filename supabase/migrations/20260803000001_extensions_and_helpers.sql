-- 20260803000001_extensions_and_helpers.sql
-- 확장과 공통 헬퍼. 이후 모든 마이그레이션이 이 파일을 전제한다.
--
-- 배경: 구 프로젝트(razxfewnttqbqaxgypju)는 마이그레이션이 없어 스키마를 통째로 잃었다.
-- 이번에는 모든 DDL을 이 디렉터리에만 두고 대시보드 수동 변경을 금지한다.
-- 자세한 경위는 저장소 루트 REBUILD-NOTES.md 참고.

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- updated_at 자동 갱신 트리거 함수
-- search_path 를 고정한다. 비워 두면 Supabase 보안 린터가 경고하고,
-- 검색 경로 조작으로 다른 스키마의 함수가 호출될 여지가 생긴다.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 인증·권한 헬퍼는 참조하는 테이블이 만들어진 뒤에 정의한다(20260803000003_auth_helpers.sql).
-- language sql 함수는 생성 시점에 본문을 검증하므로 순서를 지켜야 한다.
