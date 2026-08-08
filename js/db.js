// 공용 Supabase 클라이언트 및 헬퍼 (일반 스크립트 — file:// 직접 실행 지원)
// 이 파일보다 먼저 <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> 를 로드해야 함
(function () {
  const SUPABASE_URL = 'https://dnyocyknmcmxglgkjdfx.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_W8MIkrTVrQAskWLrpZaPNw_f6eRhWj1';
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
    // 비밀번호가 맞아도 학기 밖이면 서버가 학생으로 인정하지 않는다(current_student_id() = null).
    // 빈 화면으로 들여보내지 말고 여기서 이유를 알려 주고 세션을 정리한다.
    const { data: st } = await supabase.rpc('my_login_state');
    if (st && !st.is_admin && !st.student_id && !st.must_change_password) {
      await supabase.auth.signOut();
      throw new Error(st.opens_at
        ? `아직 이용 기간이 아닙니다. ${fmtDate(st.opens_at)}부터 열려요.`
        : '지금은 이용 기간이 아닙니다. 선생님께 문의하세요.');
    }
  }

  async function currentStudent() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    // 새 스키마는 auth 연결을 student_identities 로 분리했다.
    // 교사는 RLS students_admin_read 로 전체 학생을 보므로 select 결과만으로 본인을
    // 판정하면 안 된다(학생이 1명일 때 교사가 그 학생으로 잡힌다). 학생 계정인지는
    // current_student_id() 로만 가른다 — 교사면 null 이다.
    const { data: sid } = await supabase.rpc('current_student_id');
    if (!sid) return null;
    const { data } = await supabase.from('students').select('*').eq('id', sid).maybeSingle();
    return data;
  }

  async function requireLogin({ allowPasswordChangePage = false } = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { location.replace('학생-로그인.html'); return null; }
    // 세션이 실제로 유효한지 서버 검증 (만료/무효면 정리 후 로그인)
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) { await supabase.auth.signOut(); location.replace('학생-로그인.html'); return null; }
    // 비밀번호 미변경 학생은 서버가 current_student_id() 를 막으므로 student 가 null 이다.
    // "학생이 아니면 교사"로 판정하면 그 학생에게 교사 화면이 뜬다 — is_admin 을 따로 받는다.
    const { data: st } = await supabase.rpc('my_login_state');
    const isAdmin = !!(st && st.is_admin);
    if (st && st.must_change_password && !isAdmin) {
      if (!allowPasswordChangePage) { location.replace('비밀번호-변경.html'); return null; }
      return { user, student: null, isAdmin: false, mustChangePassword: true };
    }
    // 학기가 끝났거나(수업 기간 밖) 분반이 없으면 서버가 학생으로 인정하지 않는다.
    // 세션만 살아 있고 아무것도 못 보는 상태로 두지 않는다.
    if (!isAdmin && !(st && st.student_id)) {
      await supabase.auth.signOut(); location.replace('학생-로그인.html'); return null;
    }
    const student = (st && st.student_id) ? await currentStudent() : null;
    // 자퇴/비활성 처리된 학생은 로그인 유지 불가 (로그인 자체는 RPC에서 이미 차단됨)
    if (student && student.is_active === false) { await supabase.auth.signOut(); location.replace('학생-로그인.html'); return null; }
    return { user, student, isAdmin, mustChangePassword: false };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  // ---------- 스토리지 업로드/삭제 (Edge Function storage-admin 경유) ----------
  // storage RLS 컨텍스트에서 관리자 판정(is_admin 등)이 신뢰 불가(auth.uid는 오지만 함수가 false)라,
  // storage-admin Edge Function 은 폐기 때 소스까지 소실됐다. 되살리는 대신 storage.objects
  // 정책으로 열었다 — is_admin() 이 Storage RLS 안에서 정상 동작하는 것을 실측 확인했다
  // (관리자 업로드/삭제 200, 학생 업로드 400). 그래서 클라이언트가 직접 올린다.
  async function uploadToBucket(bucket, path, file) {
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: true,
    });
    if (error) throw new Error(error.message || '업로드에 실패했습니다.');
    return { path };
  }

  async function removeFromBucket(bucket, paths) {
    const { error } = await supabase.storage.from(bucket).remove(paths || []);
    return !error;
  }

  // manage-students Edge Function 은 폐기 때 소스까지 소실됐다. 하는 일이 전부 DB 조작이라
  // 같은 payload 를 받는 manage_students RPC 로 대체했다(호출부는 그대로 쓴다).
  async function callManageStudents(payload) {
    const { data, error } = await supabase.rpc('manage_students', { p: payload });
    if (error) throw new Error(error.message || '요청에 실패했습니다.');
    return data || {};
  }

  // 자료 유형 정의 (아이콘·색상·액션)
  const MATERIAL_TYPES = {
    print:    { label: '프린트',        icon: 'picture_as_pdf', action: 'download',    box: 'bg-red-50 text-red-600',      file: true },
    ppt:      { label: 'PPT',           icon: 'co_present',     action: 'download',    box: 'bg-orange-50 text-orange-600', file: true },
    video:    { label: '실험 안내 영상', icon: 'smart_display',  action: 'play_circle', box: 'bg-blue-50 text-blue-600',     file: true },
    quiz:     { label: '형성평가 평가지', icon: 'quiz',           action: 'edit_note',   box: 'bg-green-50 text-green-600',   file: true },
    textbook: { label: '교과서',        icon: 'menu_book',      action: 'open_in_new', box: 'bg-indigo-50 text-indigo-600', file: false, newTab: true, upload: true }, // 링크 또는 PDF 업로드 둘 다 허용
    link:     { label: '링크 자료',      icon: 'link',           action: 'open_in_new', box: 'bg-slate-100 text-slate-600',  file: false, newTab: true },
    html:     { label: '실험 자료(HTML)', icon: 'science',       action: 'expand_more', box: 'bg-violet-50 text-violet-600', file: true, newTab: false },
  };

  // 실험노트(Editorial Lab) 강조색. dot=강조점, iconBg/iconFg=아이콘 박스(인라인 style로 사용).
  // 레거시 필드(btn/border/ring)는 잉크 기반으로 통일해 하위 호환 유지.
  const _btn = 'bg-ink hover:bg-ink2', _border = 'hover:border-ink', _ring = 'focus-visible:ring-lime';
  const ACCENTS = {
    blue:    { dot: '#16213E', iconBg: '#E1E6F2', iconFg: '#16213E', btn: _btn, border: _border, ring: _ring },
    emerald: { dot: '#7FBF3F', iconBg: '#DAF0C8', iconFg: '#2E6B1E', btn: _btn, border: _border, ring: _ring },
    orange:  { dot: '#FF9A3C', iconBg: '#FFE9C7', iconFg: '#9A5B00', btn: _btn, border: _border, ring: _ring },
    violet:  { dot: '#7A5CC0', iconBg: '#E7E1F5', iconFg: '#4A3B7A', btn: _btn, border: _border, ring: _ring },
    rose:    { dot: '#FF5B24', iconBg: '#FFE1D5', iconFg: '#B23A12', btn: _btn, border: _border, ring: _ring },
    lime:    { dot: '#C4E000', iconBg: '#EEF7B8', iconFg: '#5E6B00', btn: _btn, border: _border, ring: _ring },
    signal:  { dot: '#FF5B24', iconBg: '#FFE1D5', iconFg: '#B23A12', btn: _btn, border: _border, ring: _ring },
    teal:    { dot: '#2A7C8C', iconBg: '#D7E7EA', iconFg: '#155E6B', btn: _btn, border: _border, ring: _ring },
    ink:     { dot: '#16213E', iconBg: '#E1E6F2', iconFg: '#16213E', btn: _btn, border: _border, ring: _ring },
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // href 로 들어가는 값은 esc() 만으로 부족하다 — 따옴표를 안 깨도 javascript:/data: 스킴이면
  // 클릭 한 번에 스크립트가 돈다. 스킴 판정은 직접 정규식을 짜지 말고 URL 파서에 맡긴다.
  const safeUrl = (u) => {
    try {
      const p = new URL(String(u ?? ''), location.href).protocol;   // 상대 경로는 현재 스킴으로 풀린다
      return (p === 'http:' || p === 'https:' || p === location.protocol) ? String(u) : '#';
    } catch (_e) { return '#'; }
  };

  // ---------- 공용 포맷 헬퍼 (페이지마다 중복 정의하던 것) ----------
  const _p2 = (n) => String(n).padStart(2, '0');
  const _dt = (iso) => { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? null : d; };
  const fmtDate = (iso) => { const d = _dt(iso); return d ? `${d.getFullYear()}.${_p2(d.getMonth() + 1)}.${_p2(d.getDate())}` : ''; };
  const fmtDateTime = (iso) => { const d = _dt(iso); return d ? `${fmtDate(iso)} ${_p2(d.getHours())}:${_p2(d.getMinutes())}` : ''; };
  // ISO(UTC) → <input type="datetime-local"> 값(로컬 시각)
  const toLocalInput = (iso) => { const d = _dt(iso); return d ? `${d.getFullYear()}-${_p2(d.getMonth() + 1)}-${_p2(d.getDate())}T${_p2(d.getHours())}:${_p2(d.getMinutes())}` : ''; };
  const nl2br = (s) => esc(s).replace(/\n/g, '<br>');
  // Supabase Storage 키는 ASCII 안전 문자만 허용 → 한글·로마숫자(Ⅰ)·공백 등은 _ 로 치환
  function safeStorageName(fn) {
    fn = String(fn || '');
    const dot = fn.lastIndexOf('.');
    const ext = (dot > 0 ? fn.slice(dot + 1) : '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    let base = (dot > 0 ? fn.slice(0, dot) : fn).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '');
    if (!base) base = 'file';
    return ext ? `${base}.${ext}` : base;
  }
  const fillSelect = (sel, items, placeholder) => {
    sel.innerHTML = `<option value="">${placeholder}</option>` + (items || []).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  };

  // ---------- 학생 페이지 공통 UI ----------
  // 모바일 사이드바 서랍(#sidebar/#sidebar-backdrop/#menu-btn/#sidebar-close) + 미구현 링크(.fixed-link) 무력화.
  // 반환값 = closeSidebar (소단원 클릭 시 서랍 닫기 등에 사용)
  function wireSidebar() {
    const $id = (id) => document.getElementById(id);
    const open = () => { $id('sidebar').classList.add('drawer-open'); $id('sidebar-backdrop').classList.remove('hidden'); };
    const close = () => { $id('sidebar').classList.remove('drawer-open'); $id('sidebar-backdrop').classList.add('hidden'); };
    $id('menu-btn').addEventListener('click', open);
    $id('sidebar-close').addEventListener('click', close);
    $id('sidebar-backdrop').addEventListener('click', close);
    document.querySelectorAll('.fixed-link').forEach((a) => a.addEventListener('click', (e) => e.preventDefault()));
    return close;
  }
  // 사이드바 '단원 바로가기' 아코디언 (대단원 > 중단원 > 소단원 링크 → 단원-상세)
  function renderUnitNav(nav, subjectId, units, sb) {
    const subLink = (s) => `<a href="단원-상세.html?subject=${encodeURIComponent(subjectId)}&sub=${encodeURIComponent(s.id)}" class="flex items-center gap-2 p-2 rounded-lg text-[12.5px] text-ink hover:bg-paper3 transition-all">
      <span class="material-symbols-outlined text-[16px] text-ink3">radio_button_unchecked</span><span>${esc(s.name)}</span></a>`;
    if (!units.length) { nav.innerHTML = '<p class="text-[12px] text-ink3 px-3 py-2">등록된 단원이 없습니다.</p>'; return; }
    nav.innerHTML = units.map((u) => {
      const unitOpen = u.id === sb.openUnit;
      const midsHtml = unitOpen ? (u.mid_units || []).map((m) => {
        const on = m.id === sb.openMid;
        const subs = (m.subunits || []).map(subLink).join('') || '<p class="text-[12px] text-ink3 p-2">소단원이 없습니다.</p>';
        return `<div>
          <button data-mid="${m.id}" class="sb-mid w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-all ${on ? 'bg-ink text-paper font-bold' : 'text-ink3 hover:bg-paper3'}">
            <span class="text-[13px]">${esc(m.name)}</span>
            <span class="material-symbols-outlined text-[18px] arrow ${on ? 'rotate-180 text-lime' : ''}">expand_more</span>
          </button>
          ${on ? `<div class="mt-1 ml-4 space-y-0.5 swap-in">${subs}</div>` : ''}
        </div>`;
      }).join('') : '';
      return `<div>
        <button data-unit="${u.id}" class="sb-unit w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-paper3 text-left transition-all">
          <span class="text-[13px] font-bold ${unitOpen ? 'text-signal' : 'text-ink'}">${esc(u.name)}</span>
          <span class="material-symbols-outlined arrow text-ink3 ${unitOpen ? 'rotate-180' : ''}">expand_more</span>
        </button>
        ${unitOpen ? `<div class="mt-1 space-y-1 swap-in">${midsHtml}</div>` : ''}
      </div>`;
    }).join('');
    nav.querySelectorAll('.sb-unit').forEach((btn) => btn.addEventListener('click', () => {
      sb.openUnit = (sb.openUnit === btn.dataset.unit) ? null : btn.dataset.unit;
      sb.openMid = null;
      renderUnitNav(nav, subjectId, units, sb);
    }));
    nav.querySelectorAll('.sb-mid').forEach((btn) => btn.addEventListener('click', () => {
      sb.openMid = (sb.openMid === btn.dataset.mid) ? null : btn.dataset.mid;
      renderUnitNav(nav, subjectId, units, sb);
    }));
  }
  // 필터 칩(.filter-chip) 선택 스타일 전환 + 콜백
  function wireFilterChips(onPick) {
    document.querySelectorAll('.filter-chip').forEach((chip) => chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach((c) => {
        const on = c === chip;
        ['border-ink', 'bg-ink', 'text-paper', 'font-bold'].forEach((k) => c.classList.toggle(k, on));
        ['border-faint', 'text-ink3'].forEach((k) => c.classList.toggle(k, !on));
      });
      onPick(chip.dataset.filter);
    }));
  }
  // 단원 트리 인덱스: id → 단원 조회 + 항목(unit_id/mid_unit_id/subunit_id)의 경로·칩 HTML
  function topicIndex(tree) {
    const units = new Map(), mids = new Map(), subs = new Map();
    (tree.units || []).forEach((u) => {
      units.set(u.id, u);
      (u.mid_units || []).forEach((m) => {
        mids.set(m.id, m);
        (m.subunits || []).forEach((s) => subs.set(s.id, s));
      });
    });
    const path = (x) => [units.get(x.unit_id), mids.get(x.mid_unit_id), subs.get(x.subunit_id)].filter(Boolean).map((t) => t.name);
    const chip = (x) => {
      const parts = path(x);
      return parts.length ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 bg-paper2 text-ink3 font-mono text-[11px] rounded-full max-w-full">
        <span class="material-symbols-outlined text-[15px] text-signal shrink-0">account_tree</span>
        <span class="truncate">${parts.map(esc).join(' › ')}</span></span>` : '';
    };
    return { units, mids, subs, path, chip };
  }

  // ---------- 구글 드라이브 Picker (교사) ----------
  function loadPickerApi() {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.picker) return resolve();
      const finish = () => window.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Picker 모듈 로드 실패')) });
      if (window.gapi) return finish();
      const s = document.createElement('script');
      s.src = 'https://apis.google.com/js/api.js';
      s.onload = finish;
      s.onerror = () => reject(new Error('구글 API를 불러오지 못했습니다 (네트워크/차단 확인). 대신 파일 업로드를 쓰세요.'));
      document.head.appendChild(s);
    });
  }
  // Picker를 열어 파일 1개 선택 → { id, name, url, token } (취소 시 null)
  async function pickDriveFile() {
    return pickFromDrive({ folders: false, title: '수업 자료로 넣을 파일 선택' });
  }
  // 폴더 1개 선택. 이걸 쓰는 이유가 중요하다:
  // 우리 OAuth 범위는 drive.file — 앱이 만들었거나 Picker 로 고른 것만 보인다.
  // 선생님이 드라이브에서 손으로 만든 폴더는 앱 눈에 안 보여서, 같은 이름으로 새 폴더를
  // 만들어 버린다(2026-08-08 '01. 통합과학' 중복 사고). 폴더를 한 번 골라 주면
  // 그 아래 전체가 보이므로 이후로는 기존 폴더를 그대로 재사용한다.
  async function pickDriveFolder() {
    return pickFromDrive({ folders: true, title: '수업자료를 넣을 폴더 선택 (예: 2022개정)' });
  }
  async function pickFromDrive({ folders, title }) {
    const { access_token, api_key, app_id } = await driveAccessToken();
    await loadPickerApi();
    return new Promise((resolve) => {
      const view = new google.picker.DocsView(folders ? google.picker.ViewId.FOLDERS : google.picker.ViewId.DOCS)
        .setIncludeFolders(folders).setSelectFolderEnabled(folders).setMode(google.picker.DocsViewMode.LIST);
      if (folders) view.setMimeTypes('application/vnd.google-apps.folder');
      new google.picker.PickerBuilder().setAppId(app_id).setOAuthToken(access_token).setDeveloperKey(api_key)
        .setTitle(title).addView(view)
        .setCallback((data) => {
          if (data.action === google.picker.Action.CANCEL) return resolve(null);
          if (data.action !== google.picker.Action.PICKED) return;
          const doc = (data.docs || [])[0];
          resolve(doc ? { id: doc.id, name: doc.name || '', url: doc.url || `https://drive.google.com/file/d/${doc.id}/view`, token: access_token } : null);
        })
        .build().setVisible(true);
    });
  }

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
              materials:materials ( id, type, name, meta, url, storage_path, original_filename, sort_order, is_active, teacher_only, visible_from, visible_until )
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
  // 과목에 연결된 분반 목록 (교사 전용 — classes RLS가 관리자만 허용)
  async function fetchSubjectClasses(subjectId) {
    const { data, error } = await supabase
      .from('class_subjects')
      .select('classes ( id, name, sort_order )')
      .eq('subject_id', subjectId);
    if (error) throw error;
    return (data || []).map((r) => r.classes).filter(Boolean)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
  }
  async function saveAnnouncement(id, a) {
    const payload = {
      subject_id: a.subjectId, title: a.title, body: a.body || '', level: a.level || 'general', is_active: a.isActive !== false,
      publish_from: a.publishFrom || null, publish_until: a.publishUntil || null,
      attachments: Array.isArray(a.attachments) ? a.attachments : [],
      target_class_ids: a.targetClassIds?.length ? a.targetClassIds : null,
    };
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
    const payload = {
      subject_id: a.subjectId, title: a.title, description: a.description || '',
      due_date: a.dueDate || null, due_at: a.dueAt || null,
      publish_at: a.publishAt || null,
      fields: Array.isArray(a.fields) ? a.fields : [],
      is_active: a.isActive !== false,
    };
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
  // 구글폼형 응답 제출/수정 (마감 전까지). answers: { [fieldId]: 값 }
  async function submitForm(assignmentId, answers) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${FUNCTIONS_URL}/submit-work?op=submit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${(session && session.access_token) || ''}`, 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignment_id: assignmentId, answers: answers || {} }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `제출 실패 (${res.status})`);
    return out;
  }
  // 파일 항목 업로드 → { file_name, storage_path, size } 반환 (answers에 참조로 넣어 제출)
  async function uploadSubmissionFile(assignmentId, fieldId, file) {
    const { data: { session } } = await supabase.auth.getSession();
    const qs = `op=upload-file&assignment_id=${encodeURIComponent(assignmentId)}&field_id=${encodeURIComponent(fieldId)}&filename=${encodeURIComponent(file.name)}`;
    const res = await fetch(`${FUNCTIONS_URL}/submit-work?${qs}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${(session && session.access_token) || ''}`, 'apikey': SUPABASE_KEY, 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `업로드 실패 (${res.status})`);
    return out.file;
  }
  // 교사: 응답 명부(분반별 수강생 전원 + 제출여부)
  async function fetchSubmissionRoster(assignmentId) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${FUNCTIONS_URL}/submit-work?op=roster&assignment_id=${encodeURIComponent(assignmentId)}`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${(session && session.access_token) || ''}`, 'apikey': SUPABASE_KEY },
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || '명부 조회 실패');
    return out.classes || [];
  }
  // 교사: 분반별 엑셀 생성 → 드라이브 저장 (수동 내보내기)
  async function exportSubmissions(assignmentId) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${FUNCTIONS_URL}/export-submissions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${(session && session.access_token) || ''}`, 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignment_id: assignmentId }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `내보내기 실패 (${res.status})`);
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
  async function driveSaveSettings(school, year, semester, curriculum) { return callGoogleOAuth('op=savesettings', { school, year, semester, curriculum }); }
  // OAuth 클라이언트 자격증명 저장. client_secret 은 빈 문자열로 보내면 기존 값을 유지한다.
  async function driveSaveClient(clientId, clientSecret, pickerApiKey) {
    return callGoogleOAuth('op=saveclient', { client_id: clientId, client_secret: clientSecret, picker_api_key: pickerApiKey });
  }
  // Picker(드라이브 파일·폴더 고르기) 전용 API 키만 따로 저장.
  // saveclient 는 넘어온 항목만 갱신하므로 클라이언트 ID·비밀은 건드리지 않는다.
  async function driveSavePickerKey(key) {
    return callGoogleOAuth('op=saveclient', { picker_api_key: key });
  }

  // ---------- 파일 입력에 드래그앤드롭 붙이기 ----------
  // 기존 <input type="file"> 은 그대로 두고 바로 아래에 드롭 영역을 만든다.
  // 떨어뜨린 파일을 input.files 에 넣고 change 를 쏘므로, 원래 핸들러가 그대로 동작한다.
  function wireFileDrop(input) {
    if (!input || input.dataset.dropWired) return;
    input.dataset.dropWired = '1';
    const zone = document.createElement('div');
    zone.className = 'mt-1.5 rounded-lg border-2 border-dashed border-outline-variant px-3 py-3 text-center text-caption text-on-surface-variant cursor-pointer select-none transition-colors';
    zone.textContent = '여기로 파일을 끌어다 놓아도 됩니다';
    input.insertAdjacentElement('afterend', zone);

    const lit = (on) => {
      zone.classList.toggle('border-primary', on);
      zone.classList.toggle('text-primary', on);
    };
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); lit(true); }));
    ['dragleave', 'dragend'].forEach((ev) => zone.addEventListener(ev, () => lit(false)));
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      lit(false);
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      const dt = new DataTransfer();   // input.files 는 직접 대입이 안 되므로 DataTransfer 로 감싼다
      dt.items.add(f);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      zone.textContent = `${f.name} — 다른 파일을 놓으면 바뀝니다`;
    });
  }

  // ---------- 외부 AI API 키 ----------
  // 키 값은 어떤 경로로도 돌려받지 않는다 — 브라우저는 물론 교사 계정으로도 못 꺼낸다.
  // 실제 값은 Vault(암호화)에 있고 get_api_key() 는 service_role(Edge Function) 전용이다.
  // 여기서 받는 건 등록 여부·꼬리 4자·저장 시각뿐.
  async function saveApiKey(provider, key) {
    const { error } = await supabase.rpc('save_api_key', { p_provider: provider, p_key: key });
    if (error) throw new Error(error.message);
  }
  async function apiKeyStatus() {
    const { data, error } = await supabase.rpc('api_key_status');
    if (error) throw new Error(error.message);
    return data || {};
  }
  // 키를 누가 언제 바꿨는지(최근 20건). 요금이 이상할 때 볼 곳.
  async function apiKeyLog() {
    const { data, error } = await supabase.rpc('api_key_log');
    if (error) throw new Error(error.message);
    return data || [];
  }
  // Picker용: 연결된 refresh_token으로 액세스 토큰 발급(+API키/appId 동봉). 관리자 전용.
  async function driveAccessToken() { return callGoogleOAuth('op=accesstoken'); }
  // (삭제됨) driveShareAnyone — 자료를 "링크가 있는 모든 사용자 보기"로 열던 함수.
  // 그 링크는 drive-file 프록시를 우회해서 교사전용·공개기간·로그인 검사를 전부 건너뛴다.
  // 학생 화면에 드라이브 주소가 그대로 뜨니 한 번 새면 회수도 안 된다.
  // 지금은 모든 자료를 프록시로만 연다 — 프록시가 선생님 토큰으로 바이트를 받아오므로
  // 파일이 비공개여도 학생이 볼 수 있다. 공유 권한 자체가 필요 없다.

  // ---------- 구글 드라이브 직접 업로드 (교사 수업자료) ----------
  // 같은 이름의 폴더가 있으면 재사용, 없으면 생성 → 폴더 id
  async function driveEnsureFolder(token, name, parentId) {
    const esc1 = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${esc1(name)}' and '${parentId}' in parents`;
    const fr = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`, { headers: { 'Authorization': `Bearer ${token}` } });
    const fd = await fr.json().catch(() => ({}));
    if (fr.ok && fd.files && fd.files.length) return fd.files[0].id;
    const cr = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
    });
    const cd = await cr.json().catch(() => ({}));
    if (!cr.ok) throw new Error('드라이브 폴더 생성 실패: ' + ((cd.error && cd.error.message) || cr.status));
    return cd.id;
  }
  // 파일 1개 업로드(4MB 이하 multipart, 초과는 resumable) → { id, url }
  async function driveUploadBytes(token, folderId, filename, file) {
    const meta = { name: filename, parents: [folderId] };
    const mime = file.type || 'application/octet-stream';
    if (file.size <= 4 * 1024 * 1024) {
      const boundary = '----labDriveUp' + Date.now();
      const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
      const body = new Blob([pre, file, `\r\n--${boundary}--`]);
      const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error('드라이브 업로드 실패: ' + ((d.error && d.error.message) || r.status));
      return { id: d.id, url: d.webViewLink || `https://drive.google.com/file/d/${d.id}/view` };
    }
    const init = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(file.size) },
      body: JSON.stringify(meta),
    });
    if (!init.ok) { const d = await init.json().catch(() => ({})); throw new Error('드라이브 업로드 시작 실패: ' + ((d.error && d.error.message) || init.status)); }
    const loc = init.headers.get('Location') || init.headers.get('location');
    if (!loc) throw new Error('드라이브 업로드 세션 주소를 받지 못했습니다.');
    const up = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': mime }, body: file });
    const d = await up.json().catch(() => ({}));
    if (!up.ok) throw new Error('드라이브 업로드 실패: ' + ((d.error && d.error.message) || up.status));
    return { id: d.id, url: d.webViewLink || `https://drive.google.com/file/d/${d.id}/view` };
  }
  // 수업자료 파일을 선생님 드라이브(학교›수업자료›개정›과목›대단원›중단원)에 올리고 학생 열람 공유까지.
  // 수업자료는 년도가 아니라 교육과정 개정 기준으로 묶는다(개정이 같으면 해마다 재사용).
  // subPath: 개정 아래로 이어질 폴더 이름 배열(예: [과목, 대단원, 중단원]) — 빈 값은 건너뜀.
  // 반환: { url, storage_path: 'gdrive:<id>', original_filename }
  // 드라이브 미연결이면 driveAccessToken()에서 throw → 호출부가 버킷 업로드로 폴백한다.
  // 드라이브에는 "01. 통합과학/통합과학2" 처럼 번호가 붙고 하위로 갈라진 과목 폴더가 이미 있다.
  // 과목명을 그대로 쓰면 그 옆에 번호 없는 새 폴더가 생기므로(실제로 '통합과학 1', '화학' 이
  // 그렇게 생겼다) 매핑을 보고 바꿔 준다.
  //
  // 트리가 둘이고 같은 과목의 폴더 이름이 서로 다르다:
  //   material_folder → 수업자료(개정 기준). '/' 로 하위 폴더를 나타낸다.
  //   drive_folder    → 제출물(학년도›학기 기준). 학기마다 번호가 새로 붙는다.
  let _folderMap = null;
  async function subjectFolderMap() {
    if (!_folderMap) {
      const { data } = await supabase.from('subjects').select('name, drive_folder, material_folder');
      _folderMap = new Map((data || []).map((s) => [s.name, s]));
    }
    return _folderMap;
  }
  // 과목명 → 수업자료 폴더 경로 조각들. 매핑이 없으면 과목명 하나짜리.
  async function materialFolderPath(name) {
    if (!name) return [];
    const row = (await subjectFolderMap()).get(name);
    const raw = (row && row.material_folder) || name;
    return String(raw).split('/').map((x) => x.trim()).filter(Boolean);
  }

  async function uploadMaterialToDrive(file, subPath, driveName) {
    const { access_token } = await driveAccessToken();
    const s = await driveStatus().catch(() => ({}));
    // 뿌리 폴더를 Picker 로 지정했으면 거기서 시작한다. 지정 안 했으면 예전처럼
    // 학교›수업자료›개정 을 만들어 쓰는데, 그 경우 선생님이 손으로 만든 폴더는
    // drive.file 범위 밖이라 안 보여서 같은 이름으로 새 폴더가 생긴다.
    let parent = s.rootId || 'root';
    const names = s.rootId ? [] : [s.school || '학교', '수업자료', ...(s.curriculum ? [s.curriculum] : [])];
    // subPath 의 첫 항목은 과목 이름이다(호출부가 그렇게 넘긴다).
    // 과목 하나가 폴더 여러 겹으로 펼쳐질 수 있어 splice 로 갈아 끼운다.
    const parts = (Array.isArray(subPath) ? subPath : [subPath]).filter(Boolean).map(String);
    if (parts.length) parts.splice(0, 1, ...(await materialFolderPath(parts[0])));
    parts.forEach((n) => { if (n) names.push(n); });
    for (const n of names) parent = await driveEnsureFolder(access_token, n, parent);
    const up = await driveUploadBytes(access_token, parent, driveName || file.name, file);
    return { url: up.url, storage_path: 'gdrive:' + up.id, original_filename: file.name };
  }
  // 드라이브에 저장할 파일 이름 규칙: "자료이름_유형라벨(_발췌면 대단원-중단원).확장자"
  // 자료 이름이 비어 있으면 원본 파일 이름(확장자 뺀 것)을 대신 쓴다.
  function materialDriveName(opts) {
    const { name, typeLabel, fileName, unitNames, excerpt } = opts || {};
    const dot = (fileName || '').lastIndexOf('.');
    const ext = dot > 0 ? fileName.slice(dot) : '';
    const stem = (name || '').trim() || (dot > 0 ? fileName.slice(0, dot) : fileName || '자료');
    let out = stem + (typeLabel ? '_' + typeLabel : '');
    const units = (unitNames || []).filter(Boolean).join('-');
    if (excerpt && units) out += '_' + units;
    out = out.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
    return (out || '자료') + ext;
  }
  // 드라이브 파일을 휴지통으로(완전삭제 아님 — 실수 복구 여지). 실패해도 조용히 넘어감.
  async function driveTrashFile(fileId) {
    try {
      const { access_token } = await driveAccessToken();
      await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
        method: 'PATCH', headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      });
      return true;
    } catch (_e) { return false; }
  }
  // 드라이브에 있는 자료의 파일 id. 접두어 두 가지를 구분한다:
  //   'gdrive:<id>'    사이트가 올린 파일 — 자료를 지우면 이 파일도 휴지통으로
  //   'gdriveref:<id>' 선생님이 원래 갖고 있던 걸 Picker 로 고른 것 — 자료를 지워도 파일은 그대로
  function driveIdOf(storagePath) {
    const p = String(storagePath || '');
    if (p.indexOf('gdriveref:') === 0) return p.slice(10);
    if (p.indexOf('gdrive:') === 0) return p.slice(7);
    return '';
  }
  // 자료 파일 정리: 사이트가 올린 드라이브 파일이면 휴지통, 아니면 materials 버킷에서 삭제
  async function removeMaterialFile(storagePath) {
    if (!storagePath) return true;
    // Picker 로 고른 선생님 원본은 절대 건드리지 않는다 — 자료 카드만 지우는 것이다
    if (storagePath.indexOf('gdriveref:') === 0) return true;
    if (storagePath.indexOf('gdrive:') === 0) return driveTrashFile(storagePath.slice(7));
    return removeFromBucket('materials', [storagePath]);
  }
  // 수업자료·공지 첨부를 여는 유일한 통로. 서버가 RLS(materials_read / announcements_read)로
  // 교사전용·공개기간·수강 과목을 판정한 뒤 5분짜리 링크를 준다.
  // 발급된 링크에는 로그인 토큰이 실리지 않으므로 <a href>·<iframe src> 에 그대로 쓸 수 있다.
  // (예전 driveProxyUrl 은 파일 id 만 붙인 주소여서 로그인 없이도 열렸고 수강 검사도 없었다.)
  async function fileLink(qs) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${FUNCTIONS_URL}/drive-file?op=link&${qs}`, {
      headers: { 'Authorization': `Bearer ${(session && session.access_token) || ''}`, 'apikey': SUPABASE_KEY },
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.url) throw new Error(out.error || `자료를 열지 못했습니다 (${res.status})`);
    return out.url;
  }
  function materialUrl(materialId) { return fileLink(`material=${encodeURIComponent(materialId)}`); }
  function announcementFileUrl(annId, index) { return fileLink(`announcement=${encodeURIComponent(annId)}&i=${index | 0}`); }

  // 링크를 받아오는 사이 팝업 차단에 걸리지 않게 빈 탭을 먼저 열고 주소를 나중에 넣는다.
  async function openInNewTab(getUrl) {
    const w = window.open('', '_blank');
    try {
      const href = await getUrl();
      if (w) { w.opener = null; w.location = href; } else { window.location.href = href; }
    } catch (e) {
      if (w) w.close();
      alert(e.message || '자료를 열지 못했습니다.');
    }
  }
  // 과목 ↔ 드라이브 폴더 매핑 (관리자 화면에서 편집). 저장 후에는 캐시를 버린다.
  async function subjectFolders() {
    const { data, error } = await supabase.from('subjects')
      .select('id, name, drive_folder, material_folder').order('sort_order');
    if (error) throw new Error(error.message);
    return data || [];
  }
  async function saveSubjectFolders(rows) {
    for (const r of rows) {
      const { error } = await supabase.from('subjects')
        .update({ drive_folder: r.drive_folder || null, material_folder: r.material_folder || null })
        .eq('id', r.id);
      if (error) throw new Error(error.message);
    }
    _folderMap = null;
  }
  // 수업자료 뿌리 폴더 지정 — Picker 로 고른 폴더를 저장한다.
  // 이걸 해야 선생님이 손으로 만든 폴더가 앱 눈에 보인다(drive.file 범위 때문).
  async function driveSaveRoot(id, name) {
    return callGoogleOAuth('op=saveroot', { id, name });
  }
  // 과목명 그대로 생긴 폴더를 매핑된 자리로 합친다(관리자 전용).
  // dry=true 면 무엇을 옮길지만 알려 주고 드라이브는 건드리지 않는다.
  // mode: 'dry' 미리보기 · 'dedupe' 이름 겹치는 폴더 합치기 · 'probe' 진단
  //     · 'ensure' 매핑된 폴더 미리 만들기 · 그 외 실행
  async function driveRefile(mode) {
    const qs = mode === 'dry' ? '?dry=1' : mode === 'dedupe' ? '?dedupe=1'
      : mode === 'probe' ? '?probe=1' : mode === 'ensure' ? '?ensure=1' : '';
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${FUNCTIONS_URL}/drive-refile${qs}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session?.access_token || ''}`, 'apikey': SUPABASE_KEY },
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) throw new Error(out.error || `요청 실패 (${res.status})`);
    return out;
  }
  // 예전에 자료에 걸어 둔 '링크가 있는 모든 사용자' 공유를 되돌린다(관리자 전용, 1회성).
  async function driveUnshareAll() {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${FUNCTIONS_URL}/drive-file?op=unshare`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session?.access_token || ''}`, 'apikey': SUPABASE_KEY },
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) throw new Error(out.error || `요청 실패 (${res.status})`);
    return out;
  }

  // 제출 파일 다운로드 서명 URL (storage_path 기준). 관리자 또는 본인만.
  async function signSubmissionFile(path, opts) {
    const { assignmentId = '', name = '' } = opts || {};
    const { data: { session } } = await supabase.auth.getSession();
    const qs = `op=sign&path=${encodeURIComponent(path)}`
      + (assignmentId ? `&assignment_id=${encodeURIComponent(assignmentId)}` : '')
      + (name ? `&name=${encodeURIComponent(name)}` : '');
    const res = await fetch(`${FUNCTIONS_URL}/submit-work?${qs}`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${(session && session.access_token) || ''}`, 'apikey': SUPABASE_KEY },
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || '링크 생성 실패');
    return out.url;
  }

  // PDF에서 수행평가 필드 자동 추출 (Claude API, 서버 전용). 관리자만. base64는 data URL 접두어 없이.
  async function extractAssessmentFromPdf(pdfB64, units) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${FUNCTIONS_URL}/assessment-from-pdf`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${(session && session.access_token) || ''}`, 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdf_base64: pdfB64, units: units || [] }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `자동 작성 실패 (${res.status})`);
    return out; // { data:{title,summary,status,weight,tags,start_date,due_date,unit_name,mid_name,sub_name,body,rubric}, usage }
  }

  // ---------- PDF 분할 (교과서 등 큰 PDF에서 일부 페이지만 추출해 업로드) ----------
  // pdf-lib은 무거워서 필요할 때만 CDN에서 로드
  let pdfLibPromise = null;
  function loadPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (!pdfLibPromise) {
      pdfLibPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
        s.onload = () => resolve(window.PDFLib);
        s.onerror = () => { pdfLibPromise = null; reject(new Error('PDF 처리 모듈을 불러오지 못했습니다 (네트워크 확인).')); };
        document.head.appendChild(s);
      });
    }
    return pdfLibPromise;
  }

  async function pdfPageCount(file) {
    const PDFLib = await loadPdfLib();
    const doc = await PDFLib.PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
    return doc.getPageCount();
  }

  // "1-40, 55, 60~70" → 1부터 시작하는 쪽 번호 배열 (입력 순서 유지, 중복 제거)
  function parsePageRange(str, total) {
    const out = []; const seen = new Set();
    for (const part of String(str || '').split(',')) {
      const p = part.trim();
      if (!p) continue;
      const m = p.match(/^(\d+)\s*[-~–]\s*(\d+)$/) || p.match(/^(\d+)$/);
      if (!m) throw new Error(`페이지 범위를 이해할 수 없습니다: "${p}" (예: 1-40 또는 3,5,10-20)`);
      let a = parseInt(m[1], 10), b = parseInt(m[2] || m[1], 10);
      if (a > b) { const t = a; a = b; b = t; }
      if (a < 1 || (total && b > total)) throw new Error(`${a}${a === b ? '' : '-' + b}쪽은 범위를 벗어납니다 (전체 ${total}쪽).`);
      for (let i = a; i <= b; i++) if (!seen.has(i)) { seen.add(i); out.push(i); }
    }
    if (!out.length) throw new Error('추출할 페이지가 없습니다.');
    return out;
  }

  // PDF에서 지정한 페이지만 뽑은 새 File 반환 → { file, pages(추출 쪽수), total(원본 쪽수), label }
  async function splitPdfFile(file, rangeStr) {
    const PDFLib = await loadPdfLib();
    let src;
    try {
      src = await PDFLib.PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
    } catch (_e) {
      throw new Error('PDF를 읽지 못했습니다. 손상됐거나 지원하지 않는 형식일 수 있어요.');
    }
    const total = src.getPageCount();
    const pages = parsePageRange(rangeStr, total);
    const out = await PDFLib.PDFDocument.create();
    const copied = await out.copyPages(src, pages.map((p) => p - 1));
    copied.forEach((pg) => out.addPage(pg));
    const bytes = await out.save();
    const label = String(rangeStr).replace(/\s+/g, '');
    const base = file.name.replace(/\.pdf$/i, '');
    const newFile = new File([bytes], `${base}_p${label}.pdf`, { type: 'application/pdf' });
    return { file: newFile, pages: pages.length, total, label };
  }

  // 전역 노출
  window.DB = {
    SUPABASE_URL, SUPABASE_KEY, FUNCTIONS_URL,
    supabase,
    studentSignIn, currentStudent, requireLogin, signOut, callManageStudents,
    uploadToBucket, removeFromBucket,
    MATERIAL_TYPES, ACCENTS, esc, safeUrl, fetchSubjects, fetchSubjectTree,
    fmtDate, fmtDateTime, toLocalInput, nl2br, safeStorageName, fillSelect,
    wireSidebar, renderUnitNav, wireFilterChips, topicIndex, pickDriveFile,
    fetchSubjectMeta, fetchQuestions, fetchQuestion, fetchAnswers,
    createQuestion, createAnswer, deleteQuestion, deleteAnswer, incrementQuestionViews,
    fetchAssessments, saveAssessment, deleteAssessment,
    fetchAnnouncements, saveAnnouncement, deleteAnnouncement, fetchSubjectClasses,
    fetchSubmissionAssignments, saveSubmissionAssignment, deleteSubmissionAssignment,
    fetchSubmissionsByAssignments, fetchSubmissionsForAssignment,
    submitForm, uploadSubmissionFile, signSubmissionFile, fetchSubmissionRoster, exportSubmissions,
    extractAssessmentFromPdf,
    pdfPageCount, splitPdfFile,
    driveStatus, driveAuthUrl, driveExchange, driveDisconnect, driveSaveSettings, driveSaveClient, driveSavePickerKey, driveSaveRoot, pickDriveFolder, driveAccessToken, saveApiKey, apiKeyStatus, apiKeyLog, wireFileDrop,
    uploadMaterialToDrive, removeMaterialFile, driveIdOf, driveUnshareAll, materialDriveName,
    subjectFolders, saveSubjectFolders, driveRefile,
    materialUrl, announcementFileUrl, openInNewTab,
  };
})();
