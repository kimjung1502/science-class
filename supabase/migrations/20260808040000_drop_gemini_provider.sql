-- Gemini 제거.
--
-- 왜: Google 생성형 AI API 약관이 18세 미만 대상 서비스에서의 사용을 금지한다.
-- 보호자 동의로도 해결되지 않는다. 학생 응답 1차 검수를 하던 Edge Function
-- check-experiment-response 를 지웠고(그 함수는 인증도 없어 키가 무제한 노출돼 있었다),
-- 남은 것은 DB 에 저장된 키뿐이라 여기서 지운다. 되살리지 말 것.

-- 금고 안의 값까지 같이 지운다 — 메타만 지우면 암호문이 남는다.
do $$
declare v_sid uuid;
begin
  select secret_id into v_sid from public.api_keys where provider = 'gemini';
  delete from public.api_keys where provider = 'gemini';
  if v_sid is not null then delete from vault.secrets where id = v_sid; end if;
end $$;

-- 앞으로 저장 자체가 안 되게 막는다. save_api_key() 안의 허용목록에는 아직
-- 'gemini' 가 남아 있지만, 통과해도 이 제약에서 걸린다(제약이 실제 방어선).
alter table public.api_keys drop constraint if exists api_keys_provider_check;
alter table public.api_keys add  constraint api_keys_provider_check
  check (provider in ('claude', 'openai'));
