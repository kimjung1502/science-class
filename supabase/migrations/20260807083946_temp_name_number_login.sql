-- 20260807083946_temp_name_number_login.sql
-- 임시 복원: 이름 + 학번(초기 비밀번호) 로그인.
--
-- ponytail: 교사 단독 사용 기간에만 쓰는 한시 조치다. 이 RPC 는 anon 에서 호출할 수 있어
-- 학생을 개방하기 전에 반드시 랜덤 1회용 코드 + 최초 변경 강제 + rate limit 으로 교체해야 한다.
-- 교체 사유와 설계는 restore-plan-v2.local.md 참고(저장소에 커밋하지 않는다).

create or replace function public.student_login_email(p_name text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.email
  from public.students s
  join public.student_identities si
    on si.student_id = s.id
   and si.auth_method = 'password'
   and si.disabled_at is null
  join auth.users u on u.id = si.auth_user_id
  where s.name = btrim(p_name)
    and s.is_active
  limit 1;   -- ponytail: 동명이인이면 먼저 만든 계정. 구 동작 유지.
$$;

grant execute on function public.student_login_email(text) to anon, authenticated;
