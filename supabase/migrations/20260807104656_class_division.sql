-- 20260807104656_class_division.sql
-- 분반 기호(F, I, J …)를 따로 보관한다. 이름은 "물질F(204)" 처럼 조합해서 만들지만,
-- 조합된 이름을 되파싱하면 과목명에 괄호나 영문이 섞일 때 깨지므로 원재료를 남긴다.

alter table public.classes
  add column if not exists division text;

comment on column public.classes.division is '선택과목 분반 기호(F, I, J …). 1학년 학급에는 쓰지 않는다.';
