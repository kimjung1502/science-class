-- 20260807103155_class_term_and_archive.sql
-- 분반에 학년도·학기를 달고, 수업 기간이 끝나면 단계적으로 정리한다.
--   1단계: 수업 기간 종료 + 1개월  → 분반 숨김(hidden_at). 데이터는 남는다.
--   2단계: 활성 분반이 하나도 없는 학생 → is_active=false (비활성)
--   3단계: 숨긴 지 6개월              → 분반 삭제
-- 3단계 6개월은 관리자.html:805 가 이미 화면에 표시하던 규칙을 그대로 자동화한 것이다.
-- 1단계에서 바로 지우지 않는 이유: 1학기(7월 종료)를 8월에 지우면 학년말 세특을 쓸 때
-- 그 학기 제출물·수행평가가 남아 있지 않다.

alter table public.classes
  add column if not exists acad_year integer check (acad_year between 2000 and 2100),
  add column if not exists semester  integer check (semester in (1, 2));

comment on column public.classes.acad_year is '학년도. null 이면 자동 정리 대상에서 제외된다.';
comment on column public.classes.semester  is '1학기(3~7월) / 2학기(8~12월).';

-- 수업 기간의 끝(= 다음 달 1일 0시, KST). 1학기는 7월 말, 2학기는 12월 말.
create or replace function public.class_term_end(p_year integer, p_sem integer)
returns timestamptz
language sql
immutable
as $$
  select case p_sem
    when 1 then make_timestamptz(p_year,     8, 1, 0, 0, 0, 'Asia/Seoul')
    else        make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'Asia/Seoul')
  end;
$$;

create or replace function public.archive_expired_classes()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n_hidden      integer := 0;
  n_deactivated integer := 0;
  n_deleted     integer := 0;
begin
  -- 1) 수업 기간 종료 + 1개월 지난 분반을 숨긴다. 학년도·학기가 없으면 손대지 않는다.
  update public.classes c
     set hidden_at = now()
   where c.hidden_at is null
     and c.acad_year is not null
     and c.semester  is not null
     and now() >= public.class_term_end(c.acad_year, c.semester) + interval '1 month';
  get diagnostics n_hidden = row_count;

  -- 2) 분반이 있었는데 전부 숨겨진 학생을 비활성 처리한다.
  --    아직 어느 분반에도 배정되지 않은 신규 학생이 휩쓸리지 않도록 exists 조건을 둔다.
  update public.students s
     set is_active = false
   where s.is_active
     and exists (select 1 from public.student_classes sc where sc.student_id = s.id)
     and not exists (
       select 1
       from public.student_classes sc
       join public.classes c on c.id = sc.class_id
       where sc.student_id = s.id and c.hidden_at is null
     );
  get diagnostics n_deactivated = row_count;

  -- 3) 숨긴 지 6개월 지난 분반을 실제로 지운다(student_classes 는 cascade).
  delete from public.classes
   where hidden_at is not null
     and hidden_at < now() - interval '6 months';
  get diagnostics n_deleted = row_count;

  return jsonb_build_object('hidden', n_hidden, 'deactivated', n_deactivated, 'deleted', n_deleted);
end $$;

revoke execute on function public.archive_expired_classes() from anon, authenticated, public;
