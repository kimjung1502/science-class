-- 20260807092233_add_mark_password_changed.sql
-- 비밀번호-변경.html 이 비밀번호 교체 직후 호출한다. 새 스키마에서 누락돼 있었다.
-- 교사(학생 레코드 없음)가 호출하면 current_student_id() 가 null 이라 0행 갱신으로 조용히 끝난다.

create or replace function public.mark_password_changed()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.students
     set must_change_password = false
   where id = public.current_student_id();
$$;

revoke execute on function public.mark_password_changed() from anon, public;
grant  execute on function public.mark_password_changed() to authenticated;
