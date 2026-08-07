-- 20260803000006_rls.sql
-- 행 수준 보안. 전 테이블 deny-by-default 로 시작한다.
--
-- 원칙
--   1. anon 에는 아무것도 열지 않는다. 구 시스템은 anon 이 호출할 수 있는
--      student_login_email(이름) 이 있어 계정 열거가 가능했다. 그런 함수를 만들지 않는다.
--   2. 학생 판정은 언제나 current_student_id() 로만 한다. 이름·학번·이메일을 근거로 쓰지 않는다.
--   3. 학생은 자기 것과 자기가 수강하는 과목만 본다.
--   4. 쓰기는 원칙적으로 관리자만. 학생 쓰기는 질의응답 작성뿐이고 제출은 서버 함수를 거친다.

-- 헬퍼 함수(is_admin / current_student_id / student_can_see_subject / can_see_subject)는
-- 20260803000003_auth_helpers.sql 에서 정의한다.

-- ── RLS 활성화 (정책이 없으면 0행) ────────────────────────────
alter table public.admins                 enable row level security;
alter table public.classes                enable row level security;
alter table public.students               enable row level security;
alter table public.student_identities     enable row level security;
alter table public.subjects               enable row level security;
alter table public.class_subjects         enable row level security;
alter table public.student_classes        enable row level security;
alter table public.units                  enable row level security;
alter table public.mid_units              enable row level security;
alter table public.subunits               enable row level security;
alter table public.materials              enable row level security;
alter table public.announcements          enable row level security;
alter table public.assessments            enable row level security;
alter table public.assessment_details     enable row level security;
alter table public.questions              enable row level security;
alter table public.answers                enable row level security;
alter table public.submission_assignments enable row level security;
alter table public.submissions            enable row level security;

-- ── 관리자·인증 ──────────────────────────────────────────────
-- admins: 본인 행만 읽는다(is_admin() 판정용). 계정 관리는 owner 만.
create policy admins_self_read on public.admins
  for select to authenticated using (auth_user_id = auth.uid() or public.is_owner());
create policy admins_owner_write on public.admins
  for all to authenticated using (public.is_owner()) with check (public.is_owner());

-- students: 학생은 자기 행만, 관리자는 전체.
create policy students_self_read on public.students
  for select to authenticated using (id = public.current_student_id());
create policy students_admin_read on public.students
  for select to authenticated using (public.is_admin());
create policy students_admin_write on public.students
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- student_identities: 학생 본인과 관리자만. 다른 학생의 연결을 볼 수 없다.
create policy identities_self_read on public.student_identities
  for select to authenticated using (student_id = public.current_student_id());
create policy identities_admin_all on public.student_identities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- classes / class_subjects / student_classes: 학생은 자기 소속만, 관리자는 전체.
create policy classes_admin_all on public.classes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy classes_student_read on public.classes
  for select to authenticated using (
    exists (select 1 from public.student_classes sc
            where sc.class_id = classes.id and sc.student_id = public.current_student_id())
  );

create policy class_subjects_admin_all on public.class_subjects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy class_subjects_student_read on public.class_subjects
  for select to authenticated using (
    exists (select 1 from public.student_classes sc
            where sc.class_id = class_subjects.class_id and sc.student_id = public.current_student_id())
  );

create policy student_classes_admin_all on public.student_classes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy student_classes_self_read on public.student_classes
  for select to authenticated using (student_id = public.current_student_id());

-- ── 콘텐츠 트리 ──────────────────────────────────────────────
create policy subjects_read on public.subjects
  for select to authenticated using (public.can_see_subject(id) and (is_active or public.is_admin()));
create policy subjects_admin_write on public.subjects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy units_read on public.units
  for select to authenticated using (public.can_see_subject(subject_id) and (is_active or public.is_admin()));
create policy units_admin_write on public.units
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy mid_units_read on public.mid_units
  for select to authenticated using (
    exists (select 1 from public.units u
            where u.id = mid_units.unit_id and public.can_see_subject(u.subject_id))
    and (is_active or public.is_admin())
  );
create policy mid_units_admin_write on public.mid_units
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy subunits_read on public.subunits
  for select to authenticated using (
    exists (select 1 from public.mid_units m
            join public.units u on u.id = m.unit_id
            where m.id = subunits.mid_unit_id and public.can_see_subject(u.subject_id))
    and (is_active or public.is_admin())
  );
create policy subunits_admin_write on public.subunits
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- materials: teacher_only 와 공개기간을 학생에게 적용한다.
create policy materials_read on public.materials
  for select to authenticated using (
    public.is_admin()
    or (
      is_active
      and teacher_only = false
      and (visible_from  is null or visible_from  <= now())
      and (visible_until is null or visible_until >= now())
      and exists (
        select 1 from public.subunits s
        join public.mid_units m on m.id = s.mid_unit_id
        join public.units u     on u.id = m.unit_id
        where s.id = materials.subunit_id and public.student_can_see_subject(u.subject_id)
      )
    )
  );
create policy materials_admin_write on public.materials
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── 공지 ─────────────────────────────────────────────────────
create policy announcements_read on public.announcements
  for select to authenticated using (
    public.is_admin()
    or (
      is_active
      and (publish_from  is null or publish_from  <= now())
      and (publish_until is null or publish_until >= now())
      and public.student_can_see_subject(subject_id)
      and (
        target_class_ids is null
        or exists (select 1 from public.student_classes sc
                   where sc.student_id = public.current_student_id()
                     and sc.class_id = any (announcements.target_class_ids))
      )
    )
  );
create policy announcements_admin_write on public.announcements
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── 수행평가 ─────────────────────────────────────────────────
create policy assessments_read on public.assessments
  for select to authenticated using (public.can_see_subject(subject_id));
create policy assessments_admin_write on public.assessments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 상세는 공개 기간에만. 목록은 위 정책으로 항상 보인다.
create policy assessment_details_read on public.assessment_details
  for select to authenticated using (
    public.assessment_detail_visible(assessment_id)
    and exists (select 1 from public.assessments a
                where a.id = assessment_details.assessment_id and public.can_see_subject(a.subject_id))
  );
create policy assessment_details_admin_write on public.assessment_details
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── 질의응답 ─────────────────────────────────────────────────
create policy questions_read on public.questions
  for select to authenticated using (
    public.can_see_subject(subject_id) and (is_hidden = false or public.is_admin())
  );
-- 학생은 자기가 수강하는 과목에만 질문을 쓸 수 있고, author_id 를 위조할 수 없다.
create policy questions_student_insert on public.questions
  for insert to authenticated with check (
    author_id = auth.uid()
    and public.student_can_see_subject(subject_id)
    and is_hidden = false
  );
-- 본인 글의 삭제 요청 표시만 허용(실제 삭제는 교사가 한다).
create policy questions_self_request_delete on public.questions
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and is_hidden = false);
create policy questions_admin_write on public.questions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy answers_read on public.answers
  for select to authenticated using (
    exists (select 1 from public.questions q
            where q.id = answers.question_id
              and public.can_see_subject(q.subject_id)
              and (q.is_hidden = false or public.is_admin()))
  );
create policy answers_admin_write on public.answers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── 제출 ─────────────────────────────────────────────────────
create policy submission_assignments_read on public.submission_assignments
  for select to authenticated using (
    public.is_admin()
    or (
      is_active
      and (publish_at is null or publish_at <= now())
      and public.student_can_see_subject(subject_id)
    )
  );
create policy submission_assignments_admin_write on public.submission_assignments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 학생은 자기 제출물만 읽는다. 쓰기는 서버(submit-work)가 마감·필드 검증을 한 뒤
-- service_role 로 수행한다 — 클라이언트가 직접 insert 하지 못하게 정책을 두지 않는다.
create policy submissions_self_read on public.submissions
  for select to authenticated using (student_id = public.current_student_id());
create policy submissions_admin_all on public.submissions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
