-- 20260808060000_class_hide_at_march.sql
-- 2학기 분반의 자동 숨김일을 2/1 → 3/1 로.
--
-- 기존 규칙은 class_term_end + 1개월이었다. 2학기는 수업 종료가 12월 말이라
-- class_term_end 가 다음해 1/1 이고, 거기에 1개월을 더해 2/1 에 숨겨졌다.
-- 그런데 학년도는 2월 말일에 끝난다(초·중등교육법 시행령 제44조).
-- 즉 학년도가 끝나기도 전에 분반이 화면에서 사라졌다.
--
-- 숨김일을 새 학년도 시작일(3/1)로 옮긴다. 개인정보 처리방침 제5조의
-- "해당 학년도 종료 시까지" 와도 이제 어긋나지 않는다.
--
-- 1학기(9/1)는 건드리지 않는다. 같은 학년도 안에서 2학기 분반으로 재편되므로
-- 학년도 끝까지 들고 있을 이유가 없다. 숨김은 화면에서 감추는 것일 뿐이고
-- 데이터는 남으므로, 학년말 세특 작성에는 영향이 없다.

create or replace function public.class_hide_at(p_year integer, p_sem integer)
returns timestamptz
language sql
immutable
as $$
  select case p_sem
    when 1 then make_timestamptz(p_year,     9, 1, 0, 0, 0, 'Asia/Seoul')  -- 수업 종료 + 1개월
    else        make_timestamptz(p_year + 1, 3, 1, 0, 0, 0, 'Asia/Seoul')  -- 학년도 종료 다음 날
  end;
$$;

comment on function public.class_hide_at(integer, integer) is
  '분반 자동 숨김 시점. 1학기 9/1, 2학기 다음해 3/1(학년도 종료 다음 날).';

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
  -- 1) 숨김 시점이 지난 분반을 숨긴다. 학년도·학기가 없으면 손대지 않는다.
  update public.classes c
     set hidden_at = now()
   where c.hidden_at is null
     and c.acad_year is not null
     and c.semester  is not null
     and now() >= public.class_hide_at(c.acad_year, c.semester);
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
