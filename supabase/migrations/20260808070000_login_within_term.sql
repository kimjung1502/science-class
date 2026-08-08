-- 학기 중에만 로그인할 수 있게 한다. 1학기 3/1~7/31, 2학기 8/1~12/31 (KST).
--
-- 이미 끝나는 쪽은 있었다: acad_year·semester → class_term_end() → 종료 +1개월에 hidden_at,
-- 그 뒤 학생 is_active=false (archive_expired_classes, 매일 cron). 없던 것은 시작하는 쪽이다.
--
-- 왜 필요한가: 초기 비밀번호가 학번이고 그게 로그인 이메일(<학번>@student.local)과 같은
-- 문자열이라, 아직 아무도 안 쓴 계정은 학번만 훑으면 열린다. 최초 변경을 서버에서 강제해도
-- (20260808060000) 공격자가 먼저 들어가 자기 비밀번호로 바꿔 버리면 그만이다. 방치 기간
-- 자체를 없애는 것이 실효 방어다 — 구 운영에서 2학년 계정이 링크도 안 준 채 1학기 내내
-- 열려 있었는데, 그 분반을 semester=2 로 달아 두면 8/1 전에는 애초에 열리지 않는다.
--
-- 새 컬럼도 관리 화면도 만들지 않는다. 교사가 분반에 이미 넣는 학년도·학기에서 유도한다.

-- class_term_end 의 짝. 1학기는 3/1, 2학기는 8/1 에 시작한다.
create or replace function public.class_term_start(p_year integer, p_sem integer)
returns timestamptz
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case p_sem
    when 1 then make_timestamptz(p_year, 3, 1, 0, 0, 0, 'Asia/Seoul')
    else        make_timestamptz(p_year, 8, 1, 0, 0, 0, 'Asia/Seoul')
  end;
$$;

-- 지금 수업 기간 안인 분반인가. 학년도·학기를 안 달면 상시 열림으로 본다
-- (archive_expired_classes 가 "학년도·학기가 없으면 손대지 않는다"고 한 것과 같은 규칙).
create or replace function public.class_in_term(p_class uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.classes c
    where c.id = p_class
      and c.hidden_at is null
      and (
        c.acad_year is null or c.semester is null
        or (now() >= public.class_term_start(c.acad_year, c.semester)
            and now() <  public.class_term_end(c.acad_year, c.semester))
      )
  );
$$;

-- 학생 판정에 "수업 기간 중인 분반에 속해 있는가"를 더한다.
-- current_student_id() 하나만 고치면 RLS 정책 18개가 전부 따라온다.
--
-- 분반이 하나도 없는 학생은 통과시키지 않는다. 어차피 can_see_subject() 가 분반→과목으로
-- 가므로 보이는 것이 없고, 통과시켜 두면 "로그인은 되는데 빈 화면"이 된다.
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
    and exists (
      select 1 from public.student_classes sc
      where sc.student_id = s.id and public.class_in_term(sc.class_id)
    )
  limit 1;
$$;

-- 화면이 "아직 학기가 아니다"와 "비밀번호를 바꿔야 한다"를 구분해 안내할 수 있게 사유를 준다.
create or replace function public.my_login_state()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (
    select s.id, s.must_change_password
    from public.student_identities si
    join public.students s on s.id = si.student_id
    where si.auth_user_id = auth.uid()
      and si.disabled_at is null
      and s.is_active
    limit 1
  )
  select jsonb_build_object(
    'is_admin', public.is_admin(),
    'student_id', public.current_student_id(),
    'must_change_password', coalesce((select must_change_password from me), false),
    -- 앞으로 열릴 분반이 있으면 그중 가장 이른 시각. 없으면 null.
    'opens_at', (
      select min(public.class_term_start(c.acad_year, c.semester))
      from public.student_classes sc
      join public.classes c on c.id = sc.class_id
      where sc.student_id = (select id from me)
        and c.hidden_at is null
        and c.acad_year is not null and c.semester is not null
        and public.class_term_start(c.acad_year, c.semester) > now()
    )
  );
$$;

revoke execute on function public.my_login_state() from anon, public;
grant  execute on function public.my_login_state() to authenticated;
