-- 20260807104857_subject_short_name.sql
-- 분반 이름을 "통과2(109)" · "물질F(204)" 처럼 조합하려면 과목 축약이 필요하다.
-- 축약은 규칙으로 뽑을 수 없다("통합과학"→통과 는 두 단어 첫 글자, "물질과 에너지"→물질
-- 은 앞 두 글자). 교사가 부르는 이름이므로 컬럼으로 두고 직접 고치게 한다.
--
-- ponytail: 과목 편집 화면이 아직 없어 축약을 바꾸려면 SQL 이 필요하다.
-- 과목이 7개뿐이라 화면을 새로 만들 만큼은 아니다. 과목이 늘면 그때 붙인다.

alter table public.subjects
  add column if not exists short_name text;

comment on column public.subjects.short_name is '분반 이름 조합에 쓰는 짧은 이름. 예: 통과2, 물질, 화반.';

-- 현재 과목에 관행적인 축약을 채워 둔다. 없는 과목은 이름 앞 두 글자.
update public.subjects set short_name = case name
  when '통합과학 1'      then '통과1'
  when '통합과학 2'      then '통과2'
  when '과학탐구실험 1'  then '과탐1'
  when '과학탐구실험 2'  then '과탐2'
  when '화학'            then '화학'
  when '물질과 에너지'   then '물질'
  when '화학반응의 세계' then '반응'
  else left(replace(name, ' ', ''), 2)
end
where short_name is null;
