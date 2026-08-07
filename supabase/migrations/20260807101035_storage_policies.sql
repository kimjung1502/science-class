-- 20260807101035_storage_policies.sql
-- storage.objects 정책이 하나도 없어 RLS 가 전부 막고 있었다.
-- storage-admin Edge Function 원본은 폐기 때 소실됐는데, 관리자 판정만 되면
-- 클라이언트 직접 업로드로 충분하므로 함수를 되살리는 대신 정책으로 연다.
-- 실측: 관리자 업로드/읽기/삭제 200, 학생 업로드 400.

-- materials: 수업자료. 공개 버킷이라 읽기는 공개 URL 로도 되고, 쓰기는 관리자만.
create policy materials_read on storage.objects
  for select to authenticated
  using (bucket_id = 'materials');

create policy materials_admin_write on storage.objects
  for all to authenticated
  using      (bucket_id = 'materials' and public.is_admin())
  with check (bucket_id = 'materials' and public.is_admin());

-- submissions: 비공개. 지금은 관리자만. 학생 업로드는 submit-work(서비스롤)가 맡는다.
create policy submissions_admin_all on storage.objects
  for all to authenticated
  using      (bucket_id = 'submissions' and public.is_admin())
  with check (bucket_id = 'submissions' and public.is_admin());
