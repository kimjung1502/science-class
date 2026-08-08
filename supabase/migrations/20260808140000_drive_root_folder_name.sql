-- 수업자료를 넣을 뿌리 폴더. Picker 로 한 번 고르면 그 아래 전체가 앱에 보인다.
--
-- 왜 필요한가: OAuth 범위가 drive.file 이라 앱은 "자기가 만들었거나 Picker 로 고른 것"만
-- 볼 수 있다. 선생님이 드라이브에서 손으로 만든 '01. 통합과학' 같은 폴더는 앱 눈에
-- 아예 없는 것과 같아서, 같은 이름으로 새 폴더를 또 만들었다(2026-08-08 중복 사고).
-- 폴더를 한 번 지정해 주면 그 하위가 전부 보이므로 기존 폴더를 그대로 재사용한다.
--
-- 범위를 auth/drive(전체)로 넓히는 대신 이 방법을 골랐다 — 최소 권한을 지키기 위해.
-- root_folder_id 컬럼은 처음부터 있었지만 아무 데서도 쓰이지 않았다. 이제 쓴다.

alter table public.google_drive_credentials add column if not exists root_folder_name text;

comment on column public.google_drive_credentials.root_folder_id   is '수업자료 뿌리 폴더 id. Picker 로 지정. 비면 학교›수업자료›개정 경로를 만들어 쓴다.';
comment on column public.google_drive_credentials.root_folder_name is '위 폴더의 이름(화면 표시용).';
