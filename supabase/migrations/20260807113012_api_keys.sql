-- AI 제공자 API 키 보관 (관리자 콘솔 > API 키 탭)
--
-- 키는 서버에서만 쓰이고 브라우저로 내려가지 않는다. 그래서 테이블은 정책 0개 =
-- anon/authenticated 전면 차단이고, 접근은 아래 SECURITY DEFINER 함수 두 개뿐이다.
--   api_key_status() : 등록 여부와 끝 4자리만 (값 자체는 절대 안 나간다)
--   save_api_key()   : 관리자만 쓰기. 빈 값이면 삭제
-- Edge Function 은 service_role 로 api_keys 를 직접 읽는다(RLS 우회).
--
-- 한계: 값이 평문이다. Supabase 대시보드 접근 권한이나 DB 백업을 가진 사람은 볼 수 있다.
-- 키가 샜다고 판단되면 콘솔에서 새 키로 덮어쓰면 된다.

create table if not exists public.api_keys (
  provider   text primary key check (provider in ('gemini', 'claude', 'openai')),
  api_key    text not null,
  updated_at timestamptz not null default now()
);

alter table public.api_keys enable row level security;
-- 정책 없음 = 아무도 직접 못 읽는다 (service_role 만 우회)

revoke all on public.api_keys from anon, authenticated;

create or replace function public.api_key_status()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception '관리자만 조회할 수 있습니다.';
  end if;

  select coalesce(jsonb_object_agg(provider, jsonb_build_object(
           'set', true,
           'tail', right(api_key, 4),
           'updated_at', updated_at
         )), '{}'::jsonb)
    into result
  from public.api_keys
  where api_key is not null and api_key <> '';

  return result;
end $$;

create or replace function public.save_api_key(p_provider text, p_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 API 키를 저장할 수 있습니다.';
  end if;
  if p_provider not in ('gemini', 'claude', 'openai') then
    raise exception '알 수 없는 제공자: %', p_provider;
  end if;

  -- 빈 값 저장 = 삭제 (관리자 화면의 "삭제" 버튼이 이 경로를 쓴다)
  if coalesce(btrim(p_key), '') = '' then
    delete from public.api_keys where provider = p_provider;
    return;
  end if;

  insert into public.api_keys (provider, api_key, updated_at)
  values (p_provider, btrim(p_key), now())
  on conflict (provider) do update
    set api_key = excluded.api_key, updated_at = now();
end $$;

revoke all on function public.api_key_status() from public, anon;
revoke all on function public.save_api_key(text, text) from public, anon;
grant execute on function public.api_key_status() to authenticated;
grant execute on function public.save_api_key(text, text) to authenticated;
