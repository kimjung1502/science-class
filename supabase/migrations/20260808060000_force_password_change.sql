-- 최초 비밀번호 변경을 서버에서 강제한다.
--
-- 초기 비밀번호는 학번이고, 그건 로그인 이메일(<학번>@student.local)과 같은 문자열이다.
-- 즉 안 바꾼 계정은 이름을 몰라도 학번만 훑으면 열린다.
--
-- "어차피 첫 로그인에 바꾼다"가 성립하려면 그 강제가 진짜여야 하는데, 지금까지는
-- js/db.js 의 화면 이동(location.replace)뿐이었다. API 를 직접 부르면 그만이라
-- 구 운영에서 105명 중 72명이 안 바꾼 채로 남았다.
--
-- current_student_id() 하나만 막으면 RLS 정책 18개가 전부 따라온다.
-- 비밀번호를 바꾸기 전에는 학생으로 인정하지 않는다 = 어떤 데이터도 보이지 않는다.

create or replace function public.current_student_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select si.student_id
  from public.student_identities si
  join public.students s on s.id = si.student_id
  where si.auth_user_id = auth.uid()
    and si.disabled_at is null
    and s.is_active = true
    and s.must_change_password = false
  limit 1;
$$;

-- 비밀번호를 바꾼 뒤 호출된다. 위에서 current_student_id() 가 막혔으므로
-- 그걸 쓰면 영원히 못 푼다 — auth.uid() 로 직접 찾는다.
create or replace function public.mark_password_changed()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.students s
     set must_change_password = false
    from public.student_identities si
   where si.student_id = s.id
     and si.auth_user_id = auth.uid()
     and si.disabled_at is null
     and s.is_active;
$$;

-- 화면 판정용. current_student_id() 가 막혀 있는 동안에도 "너는 학생이고 비밀번호를
-- 바꿔야 한다"를 알려 줘야 안내 페이지로 보낼 수 있다. 데이터는 한 줄도 주지 않는다.
--
-- is_admin 을 같이 돌려주는 이유: 클라이언트가 지금까지 "학생이 아니면 교사"(!auth.student)
-- 로 판정했다. 비밀번호 미변경 학생은 student 가 null 이 되므로 그대로 두면 교사 화면이 뜬다.
-- (RLS 가 데이터는 막지만 화면이 잘못 뜨는 것 자체가 사고다.)
create or replace function public.my_login_state()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'is_admin', public.is_admin(),
    'student_id', public.current_student_id(),
    'must_change_password', coalesce((
      select s.must_change_password
      from public.student_identities si
      join public.students s on s.id = si.student_id
      where si.auth_user_id = auth.uid()
        and si.disabled_at is null
        and s.is_active
      limit 1
    ), false)
  );
$$;

revoke execute on function public.my_login_state() from anon, public;
grant  execute on function public.my_login_state() to authenticated;
