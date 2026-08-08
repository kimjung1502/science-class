-- materials 버킷을 비공개로.
--
-- 왜: 공개 버킷은 RLS 가 적용되지 않는다. 그래서 drive-file 프록시로 막아 둔 teacher_only·
-- 공개기간 검사를 버킷 폴백 경로가 통째로 우회하고 있었다 — 업로드 때 만들어 둔 공개 URL 하나면
-- 로그인 없이 영구히 열렸다. 공지 첨부도 같은 버킷이라 대상 분반 지정이 무의미했다.
--
-- 이제 열람은 drive-file?op=link 한 곳으로만 간다. 그 함수가 호출자 권한으로 materials /
-- announcements 를 조회해(= RLS 정책이 판정) 통과하면 5분짜리 서명 URL 을 발급한다.
--
-- 주의: 이 마이그레이션 이후 materials.url / announcements.attachments[].url 에 저장된
-- 옛 공개 주소는 동작하지 않는다. 클라이언트는 storage_path 만 보고 링크를 받으므로 정상이다.
-- (그 url 컬럼은 외부 링크 자료에만 여전히 쓰인다.)

update storage.buckets set public = false where id = 'materials';
