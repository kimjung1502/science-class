-- API 키를 평문 컬럼에서 Supabase Vault(암호화 저장소)로 옮긴다.
--
-- 왜: 키는 곧 요금이다. 평문이면 DB 백업 파일 하나, SQL 덤프 하나가 그대로 지갑이 된다.
-- Vault 는 암호키를 DB 밖(Supabase 인프라)에 두므로 pg_dump 를 통째로 들고 가도 암호문만 나온다.
--
-- 이후 구조:
--   api_keys        : 메타데이터만 (제공자, 끝 4자리, 누가·언제). 키 값은 여기 없다.
--   vault.secrets   : 암호화된 실제 값
--   get_api_key()   : service_role(Edge Function) 전용. 사람 계정은 호출조차 못 한다.
--   api_key_status(): vault 를 아예 건드리지 않는다 — 버그가 나도 값이 샐 경로가 없다.
--   api_key_events  : 누가 언제 키를 바꿨는지. 요금이 이상할 때 볼 곳.

alter table public.api_keys add column if not exists secret_id  uuid;
alter table public.api_keys add column if not exists key_tail   text;
alter table public.api_keys add column if not exists updated_by uuid;

-- 이미 들어 있는 평문 키를 Vault 로 옮긴다 (값은 어디에도 출력하지 않는다)
do $$
declare r record; sid uuid;
begin
  for r in select provider, api_key from public.api_keys
           where api_key is not null and api_key <> '' and secret_id is null loop
    sid := vault.create_secret(r.api_key, 'api_key_' || r.provider, 'AI 제공자 API 키');
    update public.api_keys
       set secret_id = sid, key_tail = right(r.api_key, 4)
     where provider = r.provider;
  end loop;
end $$;

-- 평문 컬럼 제거 — 이 시점부터 DB 어디에도 키 원문이 없다
alter table public.api_keys drop column if exists api_key;

create table if not exists public.api_key_events (
  id          bigserial primary key,
  provider    text not null,
  action      text not null check (action in ('set', 'delete')),
  actor       uuid,
  actor_email text,
  at          timestamptz not null default now()
);
alter table public.api_key_events enable row level security;   -- 정책 없음 = 직접 접근 불가
revoke all on public.api_key_events from anon, authenticated;

-- 저장/교체/삭제 (관리자만)
create or replace function public.save_api_key(p_provider text, p_key text)
returns void
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare v_sid uuid; v_key text := btrim(coalesce(p_key, ''));
begin
  if not public.is_admin() then
    raise exception '관리자만 API 키를 저장할 수 있습니다.';
  end if;
  if p_provider not in ('gemini', 'claude', 'openai') then
    raise exception '알 수 없는 제공자: %', p_provider;
  end if;

  select secret_id into v_sid from public.api_keys where provider = p_provider;

  -- 빈 값 = 삭제. 금고 안의 값까지 같이 지운다(메타만 지우면 암호문이 남는다)
  if v_key = '' then
    delete from public.api_keys where provider = p_provider;
    if v_sid is not null then delete from vault.secrets where id = v_sid; end if;
    insert into public.api_key_events (provider, action, actor, actor_email)
    values (p_provider, 'delete', auth.uid(), auth.jwt() ->> 'email');
    return;
  end if;

  if v_sid is null then
    v_sid := vault.create_secret(v_key, 'api_key_' || p_provider, 'AI 제공자 API 키');
  else
    perform vault.update_secret(v_sid, v_key);
  end if;

  insert into public.api_keys (provider, secret_id, key_tail, updated_by, updated_at)
  values (p_provider, v_sid, right(v_key, 4), auth.uid(), now())
  on conflict (provider) do update
    set secret_id = excluded.secret_id, key_tail = excluded.key_tail,
        updated_by = excluded.updated_by, updated_at = now();

  insert into public.api_key_events (provider, action, actor, actor_email)
  values (p_provider, 'set', auth.uid(), auth.jwt() ->> 'email');
end $$;

-- 화면 표시용. vault 를 읽지 않으므로 여기서는 키가 샐 수 없다.
create or replace function public.api_key_status()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception '관리자만 조회할 수 있습니다.';
  end if;

  select coalesce(jsonb_object_agg(provider, jsonb_build_object(
           'set', true,
           'tail', key_tail,
           'updated_at', updated_at
         )), '{}'::jsonb)
    into result
  from public.api_keys
  where secret_id is not null;

  return result;
end $$;

-- 최근 변경 내역 (관리자만). 요금이 이상할 때 "내가 바꾼 게 맞나" 를 여기서 본다.
create or replace function public.api_key_log()
returns table(provider text, action text, actor_email text, at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 조회할 수 있습니다.';
  end if;
  return query
    select e.provider, e.action, e.actor_email, e.at
      from public.api_key_events e
     order by e.at desc
     limit 20;
end $$;

-- 실제 키를 꺼내는 유일한 통로. Edge Function(service_role) 말고는 아무도 못 부른다.
create or replace function public.get_api_key(p_provider text)
returns text
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare v text;
begin
  select ds.decrypted_secret into v
    from public.api_keys k
    join vault.decrypted_secrets ds on ds.id = k.secret_id
   where k.provider = p_provider;
  return v;
end $$;

revoke all on function public.get_api_key(text)   from public, anon, authenticated;
revoke all on function public.api_key_status()    from public, anon;
revoke all on function public.save_api_key(text, text) from public, anon;
revoke all on function public.api_key_log()       from public, anon;
grant execute on function public.get_api_key(text)   to service_role;
grant execute on function public.api_key_status()    to authenticated;
grant execute on function public.save_api_key(text, text) to authenticated;
grant execute on function public.api_key_log()       to authenticated;
