-- 20260807092144_add_save_assessment.sql
-- js/db.js:427 saveAssessment() 가 부른다. assessments + assessment_details 를 한 트랜잭션에 반영.
-- 인자 이름·개수는 호출부(js/db.js:428-446)에서 그대로 가져왔다.

create or replace function public.save_assessment(
  p_id          uuid,
  p_subject     uuid,
  p_title       text,
  p_summary     text,
  p_status      text,
  p_start       date,
  p_due         date,
  p_open_from   timestamptz,
  p_open_until  timestamptz,
  p_weight      text,
  p_tags        text[],
  p_unit        uuid,
  p_mid         uuid,
  p_sub         uuid,
  p_body        text,
  p_rubric      jsonb,
  p_author_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  aid uuid;
begin
  if not public.is_admin() then
    raise exception '관리자만 수행평가를 저장할 수 있습니다.';
  end if;

  if p_id is null then
    insert into public.assessments (
      subject_id, title, summary, status, start_date, due_date,
      detail_open_from, detail_open_until, weight, tags,
      unit_id, mid_unit_id, subunit_id, author_name
    ) values (
      p_subject, p_title, p_summary, coalesce(p_status, 'upcoming'), p_start, p_due,
      p_open_from, p_open_until, p_weight, coalesce(p_tags, '{}'),
      p_unit, p_mid, p_sub, p_author_name
    )
    returning id into aid;
  else
    update public.assessments set
      subject_id        = p_subject,
      title             = p_title,
      summary           = p_summary,
      status            = coalesce(p_status, 'upcoming'),
      start_date        = p_start,
      due_date          = p_due,
      detail_open_from  = p_open_from,
      detail_open_until = p_open_until,
      weight            = p_weight,
      tags              = coalesce(p_tags, '{}'),
      unit_id           = p_unit,
      mid_unit_id       = p_mid,
      subunit_id        = p_sub,
      author_name       = p_author_name
    where id = p_id
    returning id into aid;

    if aid is null then
      raise exception '수행평가를 찾을 수 없습니다: %', p_id;
    end if;
  end if;

  insert into public.assessment_details (assessment_id, body, rubric)
  values (aid, coalesce(p_body, ''), coalesce(p_rubric, '[]'::jsonb))
  on conflict (assessment_id) do update
    set body       = excluded.body,
        rubric     = excluded.rubric,
        updated_at = now();

  return aid;
end $$;

revoke execute on function public.save_assessment(uuid, uuid, text, text, text, date, date, timestamptz, timestamptz, text, text[], uuid, uuid, uuid, text, jsonb, text) from anon, public;
grant  execute on function public.save_assessment(uuid, uuid, text, text, text, date, date, timestamptz, timestamptz, text, text[], uuid, uuid, uuid, text, jsonb, text) to authenticated;
