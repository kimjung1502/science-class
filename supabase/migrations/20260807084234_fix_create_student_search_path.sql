-- 20260807084234_fix_create_student_search_path.sql
-- 학생 계정 생성(관리자 전용).
-- auth.users + auth.identities + students + student_identities + 분반 배정을 한 번에 한다.
--
-- pgcrypto(crypt/gen_salt)는 extensions 스키마에 있다. security definer 함수는 search_path 를
-- 고정하므로 extensions 를 명시하지 않으면 gen_salt 를 찾지 못한다.

create or replace function public.create_student(
  p_name   text,
  p_number text,
  p_class  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  uid uuid := gen_random_uuid();
  sid uuid;
  cid uuid;
  em  text := p_number || '@student.local';
begin
  if not public.is_admin() then
    raise exception '관리자만 학생을 만들 수 있습니다.';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    em, crypt(p_number, gen_salt('bf')),   -- ponytail: 초기 비밀번호 = 학번. 임시 방식.
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), uid,
    jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true),
    'email', uid::text, now(), now(), now()
  );

  insert into public.students (name, student_number)
  values (btrim(p_name), btrim(p_number))
  returning id into sid;

  insert into public.student_identities (student_id, auth_user_id, auth_method)
  values (sid, uid, 'password');

  if p_class is not null then
    select id into cid from public.classes where name = btrim(p_class);
    if cid is null then
      insert into public.classes (name) values (btrim(p_class)) returning id into cid;
    end if;
    insert into public.student_classes (student_id, class_id)
    values (sid, cid)
    on conflict do nothing;
  end if;

  return sid;
end $$;

revoke execute on function public.create_student(text, text, text) from anon, public;
grant  execute on function public.create_student(text, text, text) to authenticated;
