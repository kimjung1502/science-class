-- 20260807104030_class_grade_and_room.sql
-- 분반에 학년과 교실을 단다.
-- 1학년은 통합과학을 학급(반) 단위로 듣고, 2·3학년은 선택과목이라 분반으로 모이며
-- 수업하는 교실이 따로 정해진다. 그래서 입력 항목이 학년에 따라 다르다.

alter table public.classes
  add column if not exists grade integer check (grade between 1 and 3),
  add column if not exists room  text;

comment on column public.classes.grade is '1 = 학급(반) 단위, 2·3 = 선택과목 분반.';
comment on column public.classes.room  is '수업 교실. 선택과목 분반에서 주로 쓴다.';
