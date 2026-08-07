-- 20260807103257_schedule_class_archive_cron.sql
-- 매일 한 번 정리한다. 18:00 UTC = 03:00 KST (수업 중이 아닌 시각).

create extension if not exists pg_cron;

select cron.unschedule('archive-expired-classes')
where exists (select 1 from cron.job where jobname = 'archive-expired-classes');

select cron.schedule(
  'archive-expired-classes',
  '0 18 * * *',
  $$select public.archive_expired_classes()$$
);
