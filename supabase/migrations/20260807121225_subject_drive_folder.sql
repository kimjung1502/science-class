-- 선생님 드라이브에는 이미 "01. 통합과학2" 처럼 번호가 붙은 과목 폴더가 있다.
-- 과목명("통합과학 2")으로 폴더를 만들면 이름이 달라 중복 폴더가 생기므로,
-- 실제 드라이브 폴더명을 따로 들고 그걸로 찾아 들어간다.
-- 비어 있으면(null) 과목명을 그대로 쓴다 — 예전 동작.
--
-- 쓰는 곳: js/db.js subjectDriveFolder(), Edge Function submit-work / export-submissions.
-- 폴더명만 이 값을 쓰고, 시트 파일명·화면 표기는 계속 과목명(name)을 쓴다.

alter table public.subjects add column if not exists drive_folder text;

update public.subjects set drive_folder = '01. 통합과학2'     where name = '통합과학 2';
update public.subjects set drive_folder = '02. 과학탐구실험2' where name = '과학탐구실험 2';
update public.subjects set drive_folder = '03. 물질과에너지'  where name = '물질과 에너지';
