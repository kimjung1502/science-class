-- 20260807100423_manage_students_rpc.sql
-- manage-students Edge Function 대체. 원본 소스가 폐기 때 소실됐고, 하는 일이 전부
-- DB 조작이라 Edge Function 대신 RPC 로 만든다(배포 불필요).
-- payload 형태는 관리자.html 의 callManageStudents 호출부를 그대로 따른다.
--
-- 이 파일은 20260807100526_fix_manage_students_class_ids 까지 반영한 최종본이다.
-- (초판은 jsonb_array_elements_text 의 반환을 t(cid) 로 명시하지 않아 class_id 가 null 이었다.)

create or replace function public.manage_students(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  act text := p->>'action';
  sid uuid;
  uid uuid;
  em  text;
  num text;
begin
  if not public.is_admin() then
    raise exception '관리자 권한이 필요합니다.';
  end if;

  if act = 'create' then
    sid := public.create_student(p->>'name', p->>'student_number', null);
    insert into public.student_classes (student_id, class_id)
    select sid, t.cid::uuid
    from jsonb_array_elements_text(coalesce(p->'class_ids', '[]'::jsonb)) as t(cid)
    where t.cid is not null and t.cid <> ''
    on conflict do nothing;
    return jsonb_build_object('id', sid);

  elsif act = 'delete' then
    sid := (p->>'id')::uuid;
    delete from auth.users u
      using public.student_identities si
      where si.student_id = sid and u.id = si.auth_user_id;
    delete from public.students where id = sid;
    return jsonb_build_object('ok', true);

  elsif act = 'reset' then
    sid := (p->>'id')::uuid;
    select s.student_number into num from public.students s where s.id = sid;
    if num is null then
      raise exception '학생을 찾을 수 없습니다.';
    end if;
    update auth.users u
       set encrypted_password = crypt(num, gen_salt('bf')),
           updated_at = now()
      from public.student_identities si
     where si.student_id = sid
       and u.id = si.auth_user_id
       and si.auth_method = 'password';
    update public.students set must_change_password = true where id = sid;
    return jsonb_build_object('ok', true);

  elsif act = 'add_class' then
    insert into public.student_classes (student_id, class_id)
    values ((p->>'student_id')::uuid, (p->>'class_id')::uuid)
    on conflict do nothing;
    return jsonb_build_object('ok', true);

  elsif act = 'remove_class' then
    delete from public.student_classes
     where student_id = (p->>'student_id')::uuid
       and class_id   = (p->>'class_id')::uuid;
    return jsonb_build_object('ok', true);

  elsif act = 'create_admin' then
    if not public.is_owner() then
      raise exception '최상위 관리자만 다른 관리자를 만들 수 있습니다.';
    end if;
    em  := btrim(p->>'email');
    uid := gen_random_uuid();
    if em is null or em = '' or coalesce(p->>'password', '') = '' then
      raise exception '이메일과 비밀번호가 필요합니다.';
    end if;
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      em, crypt(p->>'password', gen_salt('bf')),
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
    insert into public.admins (auth_user_id, email, is_owner)
    values (uid, em, false);
    return jsonb_build_object('ok', true);

  elsif act = 'delete_admin' then
    if not public.is_owner() then
      raise exception '최상위 관리자만 관리자를 삭제할 수 있습니다.';
    end if;
    em := btrim(p->>'email');
    -- is_owner 계정은 지우지 않는다(관리자 0명 상태 방지).
    delete from auth.users u
      using public.admins a
      where lower(a.email) = lower(em)
        and u.id = a.auth_user_id
        and a.is_owner = false;
    delete from public.admins where lower(email) = lower(em) and is_owner = false;
    return jsonb_build_object('ok', true);
  end if;

  raise exception '알 수 없는 action: %', coalesce(act, '(없음)');
end $$;

revoke execute on function public.manage_students(jsonb) from anon, public;
grant  execute on function public.manage_students(jsonb) to authenticated;
