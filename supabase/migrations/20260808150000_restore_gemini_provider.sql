-- 제미나이 키 저장을 다시 허용한다 (20260808040000 에서 막았던 것).
--
-- 막았던 이유는 학생 대상 사용이었다. 학생 사진·서술을 Gemini 로 보내던
-- check-experiment-response 는 삭제됐고 되살리지 않는다 — 그 기능은 여전히 불가다.
--
-- 되돌리는 이유는 쓰는 주체가 다르기 때문이다. 교사가 자기 자료(수행평가 계획서 PDF 등)를
-- 처리하는 관리자 전용 기능이라면 이용자는 18세 이상이고 학생 개인정보가 가지 않는다.
-- 다만 약관의 "18세 미만이 접근할 가능성이 있는 서비스의 일부로 사용 금지" 는 이용자 나이가
-- 아니라 서비스 기준이라, 이 사이트에 붙이는 이상 완전히 벗어나지는 않는다. 위험 판단은
-- 운영 교사가 한다(2026-08-08 결정).
--
-- 지켜야 할 선: 학생이 부를 수 있는 경로에서는 이 키를 쓰지 않는다.
-- 새 기능을 붙일 때 관리자 JWT 검사가 있는지 반드시 확인할 것.

alter table public.api_keys drop constraint if exists api_keys_provider_check;
alter table public.api_keys add  constraint api_keys_provider_check
  check (provider in ('gemini', 'claude', 'openai'));
