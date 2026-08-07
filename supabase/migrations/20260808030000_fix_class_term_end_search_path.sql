-- search_path 을 안 박아 둔 유일한 함수였다. SECURITY DEFINER 는 아니라 당장 위험하진 않지만,
-- 나중에 정책·트리거에서 불릴 때 호출자 search_path 를 타면 엉뚱한 make_timestamptz 로 갈 수 있다.
-- (gen_salt 가 extensions 스키마에 있어 못 찾았던 것과 같은 종류의 함정)
create or replace function public.class_term_end(p_year integer, p_sem integer)
returns timestamptz
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case p_sem
    when 1 then make_timestamptz(p_year,     8, 1, 0, 0, 0, 'Asia/Seoul')
    else        make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'Asia/Seoul')
  end;
$$;
