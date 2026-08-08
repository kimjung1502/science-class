-- 드라이브에 트리가 두 개인데 같은 과목의 폴더 이름이 서로 다르다.
--   수업자료: 학교 › 수업자료 › 2022개정 › "01. 통합과학/통합과학2"   (전 과목, 개정 기준)
--   제출물  : 학교 › 학년도 › 2학기 › "01. 통합과학2"                  (그 학기 과목만, 학기마다 번호 새로)
-- 그래서 drive_folder 한 칸으로는 둘 다 못 맞춘다. 수업자료용을 따로 둔다.
--
-- material_folder 는 '/' 로 하위 폴더를 나타낸다("01. 통합과학/통합과학2").
-- 통합과학은 한 폴더 안에서 1·2 로 갈라 두셨기 때문에 경로가 필요하다.
-- 비어 있으면 과목명을 그대로 쓴다 — 그러면 번호 없는 새 폴더가 생기므로 채워 두는 게 맞다.
-- (실제로 '통합과학 1', '화학' 폴더가 그렇게 생겨서 이 컬럼을 만들게 됐다.)

alter table public.subjects add column if not exists material_folder text;

comment on column public.subjects.drive_folder    is '제출물 트리(학년도›학기) 의 과목 폴더명. 비면 과목명 사용.';
comment on column public.subjects.material_folder is '수업자료 트리(개정) 의 과목 폴더 경로. ''/'' 로 하위 폴더 구분. 비면 과목명 사용.';

update public.subjects set material_folder = '01. 통합과학/통합과학1' where name = '통합과학 1';
update public.subjects set material_folder = '01. 통합과학/통합과학2' where name = '통합과학 2';
-- 과탐실 하위 폴더는 아직 드라이브에 없다 — 첫 자료를 올릴 때 ensureFolder 가 만든다.
update public.subjects set material_folder = '02. 과학탐구실험/과학탐구실험1' where name = '과학탐구실험 1';
update public.subjects set material_folder = '02. 과학탐구실험/과학탐구실험2' where name = '과학탐구실험 2';
update public.subjects set material_folder = '03. 화학'               where name = '화학';
update public.subjects set material_folder = '04. 물질과에너지'       where name = '물질과 에너지';
update public.subjects set material_folder = '05. 화학반응의세계'     where name = '화학반응의 세계';
