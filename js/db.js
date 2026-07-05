// 공용 Supabase 클라이언트 및 헬퍼 (일반 스크립트 — file:// 직접 실행 지원)
// 이 파일보다 먼저 <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> 를 로드해야 함
(function () {
  const SUPABASE_URL = 'https://razxfewnttqbqaxgypju.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_I4a3qah7BkbvUr_NS1dHfA_fURwDbw9';
  const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

  // ---------- 외부 리소스(CDN) 로드 실패 안내 ----------
  // 학교/기관 네트워크가 cdn.jsdelivr.net·cdn.tailwindcss.com 을 차단하면 화면이 깨질 수 있어,
  // 백지 대신 명확한 안내를 띄운다. (Tailwind가 막혀도 보이도록 전부 인라인 스타일 사용)
  function runWhenBody(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  function showLoadError() {
    if (document.getElementById('dep-error-overlay')) return;
    var wrap = document.createElement('div');
    wrap.id = 'dep-error-overlay';
    wrap.setAttribute('style', 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:#f8f9ff;font-family:system-ui,-apple-system,"Malgun Gothic",sans-serif;');
    wrap.innerHTML =
      '<div style="max-width:420px;width:100%;background:#fff;border:1px solid #c1c6d6;border-radius:16px;padding:32px 28px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.08);">'
      + '<div style="font-size:44px;line-height:1;margin-bottom:12px;">📡</div>'
      + '<h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0d1c2e;">페이지를 불러오지 못했어요</h1>'
      + '<p style="margin:0 0 4px;font-size:15px;line-height:1.6;color:#414754;">인터넷 연결이 끊겼거나, 학교·기관 네트워크가 외부 스크립트를 차단하고 있을 수 있어요.</p>'
      + '<p style="margin:0 0 20px;font-size:13px;color:#727785;">Wi-Fi·데이터 연결을 확인한 뒤 다시 시도해 주세요. 계속 안 되면 다른 네트워크(예: 개인 데이터)로 접속해 보세요.</p>'
      + '<button id="dep-error-retry" style="border:0;background:#005bbf;color:#fff;font-size:15px;font-weight:700;padding:12px 24px;border-radius:10px;cursor:pointer;">다시 시도</button>'
      + '</div>';
    document.body.appendChild(wrap);
    var btn = document.getElementById('dep-error-retry');
    if (btn) btn.addEventListener('click', function () { location.reload(); });
  }
  function showStyleWarning() {
    if (document.getElementById('dep-style-warning')) return;
    var bar = document.createElement('div');
    bar.id = 'dep-style-warning';
    bar.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:2147483646;background:#fff3cd;color:#664d03;border-bottom:1px solid #ffe69c;font:500 13px/1.5 system-ui,-apple-system,"Malgun Gothic",sans-serif;padding:8px 34px 8px 14px;text-align:center;');
    bar.innerHTML = '⚠ 디자인(스타일)을 불러오지 못했습니다. 네트워크를 확인하세요. 화면은 단순해 보여도 <b>기능은 정상 동작</b>합니다.'
      + '<button style="position:absolute;right:8px;top:5px;border:0;background:transparent;font-size:16px;line-height:1;cursor:pointer;color:#664d03;">×</button>';
    document.body.appendChild(bar);
    bar.querySelector('button').addEventListener('click', function () { bar.remove(); });
  }

  // supabase-js 로드 실패 → 앱 동작 불가 → 전체 안내 + 안전한 stub(페이지의 const {..}=window.DB 방지)
  if (!window.supabase || !window.supabase.createClient) {
    runWhenBody(showLoadError);
    window.DB = window.DB || {};
    return;
  }
  // Tailwind(스타일)만 실패 → 기능은 계속, 상단 배너만
  if (!window.tailwind) {
    runWhenBody(showStyleWarning);
  }

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // ---------- 인증 (학생/교사 공용) ----------
  async function studentSignIn(name, password) {
    const { data: email, error } = await supabase.rpc('student_login_email', { p_name: name.trim() });
    if (error) throw error;
    if (!email) throw new Error('존재하지 않는 아이디입니다.');
    const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signErr) throw new Error('비밀번호가 올바르지 않습니다.');
  }

  async function currentStudent() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from('students').select('*').eq('auth_user_id', user.id).maybeSingle();
    return data;
  }

  async function requireLogin({ allowPasswordChangePage = false } = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { location.replace('학생-로그인.html'); return null; }
    // 세션이 실제로 유효한지 서버 검증 (만료/무효면 정리 후 로그인)
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) { await supabase.auth.signOut(); location.replace('학생-로그인.html'); return null; }
    const student = await currentStudent();
    if (student && student.must_change_password && !allowPasswordChangePage) {
      location.replace('비밀번호-변경.html'); return null;
    }
    return { user, student };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  // ---------- 스토리지 업로드/삭제 (Edge Function storage-admin 경유) ----------
  // storage RLS 컨텍스트에서 관리자 판정(is_admin 등)이 신뢰 불가(auth.uid는 오지만 함수가 false)라,
  // 서비스롤 Edge Function 이 관리자 검증 후 업로드/삭제(RLS 우회). manage-students 와 같은 패턴.
  async function callStorageAdmin(qs, body, contentType) {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = {
      'Authorization': `Bearer ${(session && session.access_token) || ''}`,
      'apikey': SUPABASE_KEY,
    };
    if (contentType) headers['Content-Type'] = contentType;
    const res = await fetch(`${FUNCTIONS_URL}/storage-admin?${qs}`, { method: 'POST', headers, body });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `요청 실패 (${res.status})`);
    return out;
  }

  async function uploadToBucket(bucket, path, file) {
    const qs = `op=upload&bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
    return callStorageAdmin(qs, file, file.type || 'application/octet-stream');
  }

  async function removeFromBucket(bucket, paths) {
    const qs = `op=remove&bucket=${encodeURIComponent(bucket)}&paths=${encodeURIComponent((paths || []).join(','))}`;
    try { await callStorageAdmin(qs, null, null); return true; } catch (_e) { return false; }
  }

  async function callManageStudents(payload) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${FUNCTIONS_URL}/manage-students`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`,
        'apikey': SUPABASE_KEY,
      },
      body: JSON.stringify(payload),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || '요청에 실패했습니다.');
    return out;
  }

  // 자료 유형 정의 (아이콘·색상·액션)
  const MATERIAL_TYPES = {
    print:    { label: '프린트',        icon: 'picture_as_pdf', action: 'download',    box: 'bg-red-50 text-red-600',      file: true },
    ppt:      { label: 'PPT',           icon: 'co_present',     action: 'download',    box: 'bg-orange-50 text-orange-600', file: true },
    video:    { label: '실험 안내 영상', icon: 'smart_display',  action: 'play_circle', box: 'bg-blue-50 text-blue-600',     file: true },
    quiz:     { label: '형성평가 평가지', icon: 'quiz',           action: 'edit_note',   box: 'bg-green-50 text-green-600',   file: true },
    textbook: { label: '교과서',        icon: 'menu_book',      action: 'open_in_new', box: 'bg-indigo-50 text-indigo-600', file: false, newTab: true },
    link:     { label: '링크 자료',      icon: 'link',           action: 'open_in_new', box: 'bg-slate-100 text-slate-600',  file: false, newTab: true },
  };

  const ACCENTS = {
    blue:    { strip: 'bg-blue-600',    iconBox: 'bg-blue-50 text-blue-700',       btn: 'bg-blue-600 hover:bg-blue-700',       border: 'hover:border-blue-400',    ring: 'focus-visible:ring-blue-500' },
    emerald: { strip: 'bg-emerald-600', iconBox: 'bg-emerald-50 text-emerald-700', btn: 'bg-emerald-600 hover:bg-emerald-700', border: 'hover:border-emerald-400', ring: 'focus-visible:ring-emerald-500' },
    orange:  { strip: 'bg-orange-600',  iconBox: 'bg-orange-50 text-orange-700',   btn: 'bg-orange-600 hover:bg-orange-700',   border: 'hover:border-orange-400',  ring: 'focus-visible:ring-orange-500' },
    violet:  { strip: 'bg-violet-600',  iconBox: 'bg-violet-50 text-violet-700',   btn: 'bg-violet-600 hover:bg-violet-700',   border: 'hover:border-violet-400',  ring: 'focus-visible:ring-violet-500' },
    rose:    { strip: 'bg-rose-600',    iconBox: 'bg-rose-50 text-rose-700',       btn: 'bg-rose-600 hover:bg-rose-700',       border: 'hover:border-rose-400',    ring: 'focus-visible:ring-rose-500' },
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function fetchSubjects() {
    const { data, error } = await supabase.from('subjects').select('*').eq('is_active', true).order('sort_order');
    if (error) throw error;
    return data;
  }

  async function fetchSubjectTree(subjectId) {
    const { data, error } = await supabase
      .from('subjects')
      .select(`
        id, name, description, icon, accent,
        units:units (
          id, name, sort_order, is_active,
          mid_units:mid_units (
            id, name, sort_order, is_active,
            subunits:subunits (
              id, name, description, sort_order, is_active,
              materials:materials ( id, type, name, meta, url, storage_path, original_filename, sort_order, is_active, teacher_only )
            )
          )
        )
      `)
      .eq('id', subjectId)
      .single();
    if (error) throw error;
    return pruneAndSort(data);
  }

  // ---------- Q&A 게시판 ----------
  async function fetchSubjectMeta(subjectId) {
    const { data, error } = await supabase.from('subjects').select('id, name, accent').eq('id', subjectId).maybeSingle();
    if (error) throw error;
    return data; // 열람 권한 없으면 null
  }

  async function fetchQuestions(subjectId) {
    const { data, error } = await supabase
      .from('questions')
      .select('id, title, body, author_name, created_at, view_count, unit_id, mid_unit_id, subunit_id, answers(count)')
      .eq('subject_id', subjectId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((q) => ({ ...q, answer_count: (q.answers && q.answers[0] && q.answers[0].count) || 0 }));
  }

  async function fetchQuestion(id) {
    const { data, error } = await supabase
      .from('questions')
      .select('id, subject_id, title, body, author_name, author_id, created_at, view_count, unit_id, mid_unit_id, subunit_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function fetchAnswers(questionId) {
    const { data, error } = await supabase
      .from('answers')
      .select('id, body, author_name, author_id, created_at')
      .eq('question_id', questionId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function createQuestion({ subjectId, title, body, authorName, unitId, midUnitId, subunitId }) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('questions')
      .insert({
        subject_id: subjectId, title, body,
        author_id: user && user.id, author_name: authorName || '',
        unit_id: unitId || null, mid_unit_id: midUnitId || null, subunit_id: subunitId || null,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data;
  }

  async function createAnswer({ questionId, body, authorName }) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('answers')
      .insert({ question_id: questionId, body, author_id: user && user.id, author_name: authorName || '선생님' })
      .select('id')
      .single();
    if (error) throw error;
    return data;
  }

  async function deleteQuestion(id) {
    const { error } = await supabase.from('questions').delete().eq('id', id);
    if (error) throw error;
  }

  async function deleteAnswer(id) {
    const { error } = await supabase.from('answers').delete().eq('id', id);
    if (error) throw error;
  }

  async function incrementQuestionViews(id) {
    await supabase.rpc('increment_question_views', { p_question: id });
  }

  // ---------- 수행평가 공지 ----------
  // 세부 내용(body/rubric)은 자식 테이블 assessment_details 에 저장. 공개 기간 밖이면 학생에겐 RLS로 숨겨져
  // 임베드가 비어옴 → detail_locked 로 판단. 교사는 항상 보임. 목록/기간/요약은 기반 테이블에서 항상 노출.
  const ASSESSMENT_COLS = 'id, subject_id, title, summary, status, start_date, due_date, weight, tags, detail_open_from, detail_open_until, unit_id, mid_unit_id, subunit_id, sort_order, author_name, created_at, updated_at, assessment_details(body, rubric)';

  async function fetchAssessments(subjectId) {
    const { data, error } = await supabase
      .from('assessments')
      .select(ASSESSMENT_COLS)
      .eq('subject_id', subjectId)
      .order('sort_order', { ascending: true })
      .order('start_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((a) => {
      const raw = a.assessment_details;
      const d = Array.isArray(raw) ? raw[0] : raw; // 공개 기간 밖(학생)이면 null
      const out = Object.assign({}, a);
      delete out.assessment_details;
      out.body = d ? d.body : null;
      out.rubric = (d && Array.isArray(d.rubric)) ? d.rubric : [];
      out.detail_locked = !d; // 교사는 항상 존재 → false
      return out;
    });
  }

  // 작성/수정을 assessments + assessment_details 에 원자적으로 반영 (RPC, 교사만)
  async function saveAssessment(id, a) {
    const { data, error } = await supabase.rpc('save_assessment', {
      p_id: id || null,
      p_subject: a.subjectId,
      p_title: a.title,
      p_summary: a.summary || '',
      p_status: a.status || 'ongoing',
      p_start: a.startDate || null,
      p_due: a.dueDate || null,
      p_open_from: a.detailFrom || null,
      p_open_until: a.detailUntil || null,
      p_weight: a.weight || '',
      p_tags: a.tags || [],
      p_unit: a.unitId || null,
      p_mid: a.midUnitId || null,
      p_sub: a.subunitId || null,
      p_body: a.body || '',
      p_rubric: a.rubric || [],
      p_author_name: a.authorName || '선생님',
    });
    if (error) throw error;
    return { id: data };
  }

  async function createAssessment(a) { return saveAssessment(null, a); }
  async function updateAssessment(id, a) { await saveAssessment(id, a); }

  async function deleteAssessment(id) {
    const { error } = await supabase.from('assessments').delete().eq('id', id);
    if (error) throw error;
  }

  function pruneAndSort(subject) {
    const by = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0);
    const active = (arr) => (arr || []).filter((x) => x.is_active !== false).sort(by);
    subject.units = active(subject.units);
    subject.units.forEach((u) => {
      u.mid_units = active(u.mid_units);
      u.mid_units.forEach((m) => {
        m.subunits = active(m.subunits);
        m.subunits.forEach((s) => { s.materials = active(s.materials); });
      });
    });
    return subject;
  }

  // ---------- 일반 공지사항 ----------
  async function fetchAnnouncements(subjectId, { activeOnly = false, limit = null } = {}) {
    let q = supabase.from('announcements').select('*').eq('subject_id', subjectId)
      .order('created_at', { ascending: false });
    if (activeOnly) q = q.eq('is_active', true);
    if (limit) q = q.limit(limit);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  async function saveAnnouncement(id, a) {
    const payload = { subject_id: a.subjectId, title: a.title, body: a.body || '', level: a.level || 'general', is_active: a.isActive !== false };
    if (id) { const { error } = await supabase.from('announcements').update(payload).eq('id', id); if (error) throw error; return { id }; }
    const { data, error } = await supabase.from('announcements').insert(payload).select('id').single();
    if (error) throw error; return data;
  }
  async function deleteAnnouncement(id) {
    const { error } = await supabase.from('announcements').delete().eq('id', id); if (error) throw error;
  }

  // ---------- 산출물 제출 ----------
  async function fetchSubmissionAssignments(subjectId, { activeOnly = false } = {}) {
    let q = supabase.from('submission_assignments').select('*').eq('subject_id', subjectId)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: false });
    if (activeOnly) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  async function saveSubmissionAssignment(id, a) {
    const payload = { subject_id: a.subjectId, title: a.title, description: a.description || '', due_date: a.dueDate || null, is_active: a.isActive !== false };
    if (id) { const { error } = await supabase.from('submission_assignments').update(payload).eq('id', id); if (error) throw error; return { id }; }
    const { data, error } = await supabase.from('submission_assignments').insert(payload).select('id').single();
    if (error) throw error; return data;
  }
  async function deleteSubmissionAssignment(id) {
    const { error } = await supabase.from('submission_assignments').delete().eq('id', id); if (error) throw error;
  }
  async function fetchSubmissionsByAssignments(assignmentIds) {
    if (!assignmentIds || !assignmentIds.length) return [];
    const { data, error } = await supabase.from('submissions').select('*').in('assignment_id', assignmentIds);
    if (error) throw error; return data || [];
  }
  async function fetchSubmissionsForAssignment(assignmentId) {
    const { data, error } = await supabase.from('submissions').select('*').eq('assignment_id', assignmentId)
      .order('class_name', { ascending: true }).order('student_name', { ascending: true });
    if (error) throw error; return data || [];
  }
  // payload: { file } (파일 업로드) 또는 { text } (글 작성 → 서버에서 docx 생성)
  async function submitWork(assignmentId, payload) {
    const { data: { session } } = await supabase.auth.getSession();
    const auth = { 'Authorization': `Bearer ${(session && session.access_token) || ''}`, 'apikey': SUPABASE_KEY };
    let qs, body, contentType;
    if (payload && payload.text != null) {
      qs = `op=submit&assignment_id=${encodeURIComponent(assignmentId)}&mode=text`;
      body = payload.text; contentType = 'text/plain; charset=utf-8';
    } else {
      const file = payload.file;
      qs = `op=submit&assignment_id=${encodeURIComponent(assignmentId)}&mode=file&filename=${encodeURIComponent(file.name)}`;
      body = file; contentType = file.type || 'application/octet-stream';
    }
    const res = await fetch(`${FUNCTIONS_URL}/submit-work?${qs}`, { method: 'POST', headers: { ...auth, 'Content-Type': contentType }, body });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `제출 실패 (${res.status})`);
    return out;
  }
  // ---------- 구글 드라이브 연결 (교사) ----------
  async function callGoogleOAuth(qs, bodyObj) {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = { 'Authorization': `Bearer ${(session && session.access_token) || ''}`, 'apikey': SUPABASE_KEY };
    if (bodyObj) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${FUNCTIONS_URL}/google-oauth?${qs}`, { method: 'POST', headers, body: bodyObj ? JSON.stringify(bodyObj) : undefined });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `요청 실패 (${res.status})`);
    return out;
  }
  async function driveStatus() { return callGoogleOAuth('op=status'); }
  async function driveAuthUrl(redirectUri, state) { return callGoogleOAuth(`op=authurl&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`); }
  async function driveExchange(code, redirectUri) { return callGoogleOAuth('op=exchange', { code, redirect_uri: redirectUri }); }
  async function driveDisconnect() { return callGoogleOAuth('op=disconnect'); }
  async function driveSaveSettings(school, year, semester) { return callGoogleOAuth('op=savesettings', { school, year, semester }); }

  async function getSubmissionSignedUrl(submissionId) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${FUNCTIONS_URL}/submit-work?op=sign&submission_id=${encodeURIComponent(submissionId)}`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${(session && session.access_token) || ''}`, 'apikey': SUPABASE_KEY },
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || '링크 생성 실패');
    return out.url;
  }

  // 전역 노출
  window.DB = {
    SUPABASE_URL, SUPABASE_KEY, FUNCTIONS_URL,
    supabase,
    studentSignIn, currentStudent, requireLogin, signOut, callManageStudents,
    uploadToBucket, removeFromBucket,
    MATERIAL_TYPES, ACCENTS, esc, fetchSubjects, fetchSubjectTree,
    fetchSubjectMeta, fetchQuestions, fetchQuestion, fetchAnswers,
    createQuestion, createAnswer, deleteQuestion, deleteAnswer, incrementQuestionViews,
    fetchAssessments, createAssessment, updateAssessment, deleteAssessment,
    fetchAnnouncements, saveAnnouncement, deleteAnnouncement,
    fetchSubmissionAssignments, saveSubmissionAssignment, deleteSubmissionAssignment,
    fetchSubmissionsByAssignments, fetchSubmissionsForAssignment, submitWork, getSubmissionSignedUrl,
    driveStatus, driveAuthUrl, driveExchange, driveDisconnect, driveSaveSettings,
  };
})();
