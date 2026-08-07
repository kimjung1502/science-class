-- 20260803000003_auth_helpers.sql
-- 인증·권한 판정 헬퍼. 20260803000002 가 만든 테이블을 참조하므로 그 뒤에 온다.
--
-- 핵심 원칙: 학생 판정은 언제나 current_student_id() 로만 한다.
-- 이름·학번·이메일을 인증 근거로 쓰지 않는다. 구 시스템은 이름으로 계정을 찾을 수 있어
-- 인터넷 누구나 학생 로그인 이메일을 조회할 수 있었다.

-- 관리자(교사) 판정
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admins a
    where a.auth_user_id = auth.uid()
  );
$$;

-- 소유자(최상위 관리자) 판정. 관리자 계정 자체를 관리할 때 쓴다.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admins a
    where a.auth_user_id = auth.uid() and a.is_owner = true
  );
$$;

-- 현재 로그인 사용자에 연결된 학생 id.
-- 인증 방식(구글 SSO / 비밀번호)이 바뀌어도 이 함수만 그대로면 RLS 를 건드릴 필요가 없다.
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
  limit 1;
$$;

-- 학생이 이 과목을 수강하는가 (student_classes → class_subjects)
create or replace function public.student_can_see_subject(p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.student_classes sc
    join public.class_subjects cs on cs.class_id = sc.class_id
    where sc.student_id = public.current_student_id()
      and cs.subject_id = p_subject
  );
$$;

-- 이 과목을 볼 수 있는가 (관리자이거나 수강생이거나)
create or replace function public.can_see_subject(p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin() or public.student_can_see_subject(p_subject);
$$;

-- anon 에는 어떤 헬퍼도 노출하지 않는다.
revoke execute on function public.is_admin()                        from anon, public;
revoke execute on function public.is_owner()                        from anon, public;
revoke execute on function public.current_student_id()              from anon, public;
revoke execute on function public.student_can_see_subject(uuid)     from anon, public;
revoke execute on function public.can_see_subject(uuid)             from anon, public;
grant  execute on function public.is_admin()                        to authenticated;
grant  execute on function public.is_owner()                        to authenticated;
grant  execute on function public.current_student_id()              to authenticated;
grant  execute on function public.student_can_see_subject(uuid)     to authenticated;
grant  execute on function public.can_see_subject(uuid)             to authenticated;
