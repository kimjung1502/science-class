-- 20260825090000_experiment_window_class_time_only.sql
-- 수업 시간 제한을 '기본'에서 '교사가 고르는 것'으로 바꾼다.
-- 전에는 시간표만 있으면 무조건 수업 시간에만 열려서, 집에서 마저 쓰라고 할 방법이 없었다.
-- 이제 실험 페이지의 '수업 시간에만 제출하기' 를 체크한 실험만 시간표 게이트를 탄다.

alter table public.experiment_windows
  add column if not exists class_time_only boolean not null default false;

comment on column public.experiment_windows.class_time_only is
  '켜면 분반 시간표(class_periods × school_periods)의 수업 시간에만 제출이 열린다. 끄면 close_at 만 본다.';
