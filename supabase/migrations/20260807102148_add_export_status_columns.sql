-- 20260807102148_add_export_status_columns.sql
-- export-submissions 의 수동 내보내기와 산출물-제출.html:293 이 쓴다.
-- 새 스키마에서 누락돼 있었다(구 DB 에는 있었다).

alter table public.submission_assignments
  add column if not exists export_status text
    check (export_status is null or export_status in ('exporting','done','error')),
  add column if not exists exported_at   timestamptz,
  add column if not exists export_error  text;
