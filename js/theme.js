/* =====================================================================
 *  정환쌤과 함께하는 과학 수업 — 공통 디자인 테마 "실험노트 (Editorial Lab)"
 *  ---------------------------------------------------------------------
 *  이 파일 하나가 담당하는 것:
 *   1) Tailwind(CDN) 설정 — 실험노트 팔레트/폰트/그림자 토큰
 *      (+ 기존 Material-3 토큰 이름을 새 팔레트로 재매핑해 레거시 마크업도 자동 반영)
 *   2) 공통 CSS 주입 — 모눈종이 배경, 형광펜 밑줄, 점선, 테이프 라벨, 카드,
 *      사이드바 nav, 미세 인터랙션 등
 *   3) 아이콘 시스템 — 기존 <span class="material-symbols-outlined">name</span> 및
 *      동적으로 생성되는 마크업을 인라인 SVG(라인) 아이콘으로 자동 치환
 *
 *  사용법(각 페이지 <head>):
 *    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
 *    <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
 *    <script src="https://cdn.tailwindcss.com?plugins=forms"></script>
 *    <script src="js/theme.js"></script>
 * ===================================================================== */
(function () {
  'use strict';

  /* ---------- 1) 팔레트 상수 ---------- */
  var C = {
    paper:  '#FBFAF6', paper2: '#F4F2E9', paper3: '#ECE8DA',
    ink:    '#16213E', ink2:   '#2C3A5E', ink3: '#5A6379',
    lime:   '#C4E000', lime2:  '#D6F03A', limeSoft: '#EEF7B8',
    signal: '#FF5B24', signalSoft: '#FFE1D5',
    faint:  '#E4E1D4', line: '#E7E4D6',
    white:  '#FFFFFF', error: '#C0362C',
  };

  /* ---------- 2) Tailwind 설정 ---------- */
  // CDN 스크립트가 먼저 로드돼 있어야 함(전역 tailwind 존재).
  try {
    window.tailwind = window.tailwind || {};
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            /* ── 실험노트 신규 토큰 ── */
            paper: C.paper, paper2: C.paper2, paper3: C.paper3,
            ink: C.ink, ink2: C.ink2, ink3: C.ink3,
            lime: C.lime, lime2: C.lime2, 'lime-soft': C.limeSoft,
            signal: C.signal, 'signal-soft': C.signalSoft,
            faint: C.faint,

            /* ── 레거시 Material-3 토큰 재매핑(값만 교체) ── */
            'background': C.paper,
            'surface': C.paper,
            'surface-bright': C.paper,
            'surface-container-lowest': C.white,
            'surface-container-low': '#F7F5EE',
            'surface-container': C.paper2,
            'surface-container-high': C.paper3,
            'surface-container-highest': C.paper3,
            'surface-variant': C.paper3,
            'surface-dim': C.paper3,
            'on-background': C.ink,
            'on-surface': C.ink,
            'on-surface-variant': C.ink3,
            'primary': C.ink,
            'on-primary': C.paper,
            'primary-container': C.ink2,
            'on-primary-container': C.paper,
            'primary-fixed': C.paper2,
            'primary-fixed-dim': C.paper3,
            'on-primary-fixed': C.ink,
            'secondary': C.ink2,
            'on-secondary': C.paper,
            'secondary-container': C.ink,        /* 사이드바 active = 잉크 배경 */
            'on-secondary-container': C.paper,   /*                 + 밝은 글자 */
            'tertiary': C.signal,
            'on-tertiary': C.white,
            'tertiary-container': C.signalSoft,
            'on-tertiary-container': '#7A2A0E',
            'outline': '#9A9686',
            'outline-variant': C.faint,
            'error': C.error,
            'on-error': C.white,
          },
          fontFamily: {
            sans: ['Pretendard Variable', 'Pretendard', '-apple-system', 'BlinkMacSystemFont',
                   'system-ui', 'Roboto', 'Helvetica Neue', 'Segoe UI', 'Apple SD Gothic Neo',
                   'Noto Sans KR', 'Malgun Gothic', 'sans-serif'],
            mono: ['"Space Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
          },
          borderRadius: { DEFAULT: '0.5rem', lg: '0.625rem', xl: '0.875rem', '2xl': '1.125rem', full: '9999px' },
          boxShadow: {
            note: '0 1px 0 rgba(22,33,62,.04), 0 8px 24px -14px rgba(22,33,62,.28)',
            lift: '0 2px 0 rgba(22,33,62,.05), 0 18px 40px -20px rgba(22,33,62,.40)',
            sm:   '0 1px 2px rgba(22,33,62,.06)',
          },
          letterSpacing: { tightest: '-0.035em' },
          spacing: {
            base: '4px', xs: '8px', sm: '16px', md: '24px', gutter: '24px',
            lg: '40px', xl: '64px', 'max-width': '1280px',
            'margin-mobile': '16px', 'margin-desktop': '48px',
          },
          fontSize: {
            caption:     ['13px', { lineHeight: '1.35', fontWeight: '400' }],
            'label-md':  ['14px', { lineHeight: '1.2',  letterSpacing: '0.01em', fontWeight: '600' }],
            'body-md':   ['16px', { lineHeight: '1.6',  fontWeight: '400' }],
            'body-lg':   ['18px', { lineHeight: '1.6',  fontWeight: '400' }],
            'title-lg':  ['20px', { lineHeight: '1.35', fontWeight: '700' }],
            'headline-md':['24px',{ lineHeight: '1.3',  letterSpacing: '-0.02em', fontWeight: '800' }],
            'headline-lg':['32px',{ lineHeight: '1.2',  letterSpacing: '-0.03em', fontWeight: '800' }],
            'display':   ['44px', { lineHeight: '1.1',  letterSpacing: '-0.035em', fontWeight: '800' }],
          },
        },
      },
    };
  } catch (_e) { /* Tailwind CDN 미로드 시 무시 */ }

  /* ---------- 3) 공통 CSS 주입 ---------- */
  var CSS = [
    ':root{ --lab-grid:#E7E4D6; }',
    'html,body{ overflow-x:hidden; }',
    // 본문 폰트 + 모눈종이 배경(레거시 인라인 Be Vietnam Pro 규칙을 덮어씀)
    'body{ font-family:"Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,system-ui,"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif !important;',
    '  background-color:#FBFAF6;',
    '  background-image:linear-gradient(to right,var(--lab-grid) 1px,transparent 1px),linear-gradient(to bottom,var(--lab-grid) 1px,transparent 1px);',
    '  background-size:26px 26px; -webkit-font-smoothing:antialiased; }',
    '.font-mono,.pin-label{ font-family:"Space Mono",ui-monospace,SFMono-Regular,Menlo,monospace; }',
    // 형광펜
    '.hl{ background:linear-gradient(120deg,transparent 0 8%,#C4E000 8% 92%,transparent 92%); box-decoration-break:clone; -webkit-box-decoration-break:clone; padding:.02em .12em; border-radius:2px; }',
    '.hl-soft{ background:linear-gradient(180deg,transparent 58%,rgba(196,224,0,.55) 58%); }',
    // 점선 구분선
    '.dashed{ border-top:1.5px dashed #C9C6B6; }',
    // 마스킹테이프 라벨
    '.tape{ position:relative; background:repeating-linear-gradient(45deg,#FFF7D6 0 7px,#FFF2BE 7px 14px); box-shadow:0 1px 6px -3px rgba(22,33,62,.5); color:#6B6412; }',
    '.tape::before,.tape::after{ content:""; position:absolute; top:0; bottom:0; width:10px; background:rgba(255,255,255,.35); }',
    '.tape::before{ left:0; } .tape::after{ right:0; }',
    // 종이 카드
    '.card{ background:#FFFFFF; border:1px solid var(--lab-grid); }',
    // 팔레트 점
    '.dot{ width:14px; height:14px; border-radius:50%; box-shadow:inset 0 0 0 1px rgba(22,33,62,.15); }',
    // 미세 인터랙션
    '.lift-hover{ transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease; }',
    '.lift-hover:hover{ transform:translateY(-4px); }',
    // 사이드바 nav
    '.nav-item{ transition:background .15s ease,color .15s ease,padding-left .15s ease; }',
    '.nav-item:hover{ background:#F4F2E9; }',
    '.nav-item.active{ background:#16213E !important; color:#fff !important; }',
    '.nav-item.active .nav-mono{ color:#C4E000; }',
    '.nav-item.active .lab-ic{ color:#C4E000; }',
    // 체크박스 강조색
    'input[type=checkbox].lab:checked,input[type=radio].lab:checked{ background-color:#16213E; border-color:#16213E; }',
    // 회전 유틸
    '.rot-1{ transform:rotate(-2.4deg); } .rot-2{ transform:rotate(1.8deg); } .rot-3{ transform:rotate(-1.2deg); }',
    // 선택 색
    '::selection{ background:#C4E000; color:#16213E; }',
    // 아이콘 기본
    '.lab-ic{ display:inline-block; width:1em; height:1em; vertical-align:-0.15em; flex:none; }',
    // 스핀(로딩) 아이콘
    '.lab-ic.spin{ animation:lab-spin 1s linear infinite; }',
    '@keyframes lab-spin{ to{ transform:rotate(360deg); } }',
    // 스크롤 여백
    '.screen{ scroll-margin-top:90px; }',
  ].join('\n');

  function injectCSS() {
    if (document.getElementById('lab-theme-css')) return;
    var s = document.createElement('style');
    s.id = 'lab-theme-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  injectCSS();

  /* ---------- 4) 아이콘 시스템 (Material Symbols → 인라인 SVG 라인 아이콘) ---------- */
  // Lucide 계열 라인 아이콘. viewBox 0 0 24 24, stroke=currentColor.
  var P = { // 특수(채움/특이 stroke) 아이콘용 커스텀 렌더
  };
  var ICONS = {
    science:        '<path d="M9 3h6M10 3v6l-5 8.5A2 2 0 0 0 6.7 20h10.6a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7.5 15h9"/>',
    experiment:     '<path d="M9 3h6M10 3v6l-5 8.5A2 2 0 0 0 6.7 20h10.6a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7.5 15h9"/>',
    biotech:        '<path d="M9 3h6M10 3v6l-5 8.5A2 2 0 0 0 6.7 20h10.6a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7.5 15h9"/>',
    person:         '<path d="M20 21a8 8 0 1 0-16 0"/><circle cx="12" cy="7" r="4"/>',
    account_circle: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M6.2 18.2a6 6 0 0 1 11.6 0"/>',
    lock:           '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    lock_reset:     '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    lock_clock:     '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="M12 15v2l1.5 1"/>',
    encrypted:      '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="m10.5 16 1 1 2-2"/>',
    key:            '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.8 12.2 8-8M17 8l2-2M14 11l2-2"/>',
    visibility:     '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    visibility_off: '<path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M6.61 6.61A18.5 18.5 0 0 0 2 12s3.5 7 10 7a9.1 9.1 0 0 0 5.39-1.61"/><path d="M2 2l20 20"/>',
    arrow_forward:  '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    arrow_back:     '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
    chevron_right:  '<path d="m9 18 6-6-6-6"/>',
    expand_more:    '<path d="m6 9 6 6 6-6"/>',
    keyboard_arrow_down: '<path d="m6 9 6 6 6-6"/>',
    keyboard_arrow_up:   '<path d="m18 15-6-6-6 6"/>',
    info:           '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    home:           '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    menu_book:      '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    school:         '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 2.7 3 6 3s6-2 6-3v-5"/>',
    assignment:     '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3"/><path d="m9 14 2 2 4-4"/>',
    list_alt:       '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h9M8 13h9M8 17h5"/>',
    list:           '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    upload_file:    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3-3 3 3"/>',
    file_upload:    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3-3 3 3"/>',
    upload:         '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    download:       '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    forum:          '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2Z"/><path d="M18 9h2a2 2 0 0 1 2 2v10l-4-4h-6a2 2 0 0 1-2-2v-1"/>',
    chat_bubble_outline: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>',
    reply:          '<path d="M9 17 4 12l5-5"/><path d="M4 12h11a4 4 0 0 1 4 4v2"/>',
    campaign:       '<path d="m3 11 15-5v12L3 13z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/><path d="M18 8a3 3 0 0 1 0 6"/>',
    health_and_safety: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M12 8v6M9 11h6"/>',
    verified:       '<path d="m9 12 2 2 4-4"/><path d="M12 2 3.6 6.3l1 9.2L12 22l7.4-6.5 1-9.2z"/>',
    check_circle:   '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    logout:         '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    admin_panel_settings: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><circle cx="12" cy="9.5" r="2.1"/><path d="M8.5 16a3.5 3.5 0 0 1 7 0"/>',
    edit:           '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    edit_square:    '<path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
    delete:         '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
    add:            '<path d="M12 5v14M5 12h14"/>',
    close:          '<path d="M18 6 6 18M6 6l12 12"/>',
    menu:           '<path d="M4 6h16M4 12h16M4 18h16"/>',
    search:         '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    event:          '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    date_range:     '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    schedule:       '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    hourglass_top:  '<path d="M6 2h12M6 22h12M6 2v4a6 6 0 0 0 6 6 6 6 0 0 0 6-6V2M6 22v-4a6 6 0 0 1 6-6 6 6 0 0 1 6 6v4"/>',
    progress_activity: '<path d="M12 3a9 9 0 1 0 9 9"/>',
    person_add:     '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    group_add:      '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    group:          '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    groups:         '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    open_in_new:    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    description:    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h8M8 9h2"/>',
    folder:         '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
    folder_off:     '<path d="M4 20h13.5M22 15V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H5"/><path d="M2 2l20 20"/>',
    cloud:          '<path d="M17.5 19a4.5 4.5 0 0 0 0-9h-1.8A7 7 0 1 0 4 15.9"/>',
    add_to_drive:   '<path d="M17.5 19a4.5 4.5 0 0 0 0-9h-1.8A7 7 0 1 0 4 15.9"/><path d="M12 12v6M9 15h6"/>',
    drive_file_move:'<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/><path d="M10 13h5m0 0-2-2m2 2-2 2"/>',
    account_tree:   '<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v4M5 17v-3h14v3"/>',
    radio_button_unchecked: '<circle cx="12" cy="12" r="9"/>',
    remove_circle_outline: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    auto_awesome:   '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M21 5h-4"/>',
  };
  // 별칭
  ICONS.expand_less = ICONS.keyboard_arrow_up;
  ICONS.arrow_drop_down = ICONS.expand_more;
  ICONS.check = '<path d="M20 6 9 17l-5-5"/>';
  ICONS.more_vert = '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>';
  ICONS.settings = '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>';

  // 자료 유형(MATERIAL_TYPES) 및 관리자 페이지 보강 아이콘
  ICONS.picture_as_pdf = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/>';
  ICONS.co_present = '<rect x="2" y="4" width="20" height="12" rx="2"/><path d="M12 16v5M8 21h8"/><circle cx="9" cy="8.4" r="1.5"/><path d="M6.5 12.4a2.5 2.5 0 0 1 5 0"/>';
  ICONS.smart_display = '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="m10 9 5 3-5 3z"/>';
  ICONS.play_circle = '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4z"/>';
  ICONS.quiz = '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9.3 9.2a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1.2.9-1.2 1.6v.4"/><path d="M11.5 17h.01"/>';
  ICONS.edit_note = '<path d="M3 7h13M3 12h8M3 17h6"/><path d="M17.5 12.5a2.1 2.1 0 0 1 3 3L15 21l-4 1 1-4z"/>';
  ICONS.link = '<path d="M9 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M15 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>';
  ICONS.radio_button_checked = '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>';
  ICONS.warning = '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>';
  ICONS.error = '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>';
  ICONS.refresh = '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>';
  ICONS.content_copy = '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>';
  ICONS.star = '<path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z"/>';
  ICONS.calendar_today = ICONS.event;
  ICONS.help = ICONS.quiz;

  var FALLBACK = '<circle cx="12" cy="12" r="8"/>';
  var SPIN = { progress_activity: 1, hourglass_top: 1 };

  function svgFor(name, extraClass) {
    var inner = ICONS[name] || FALLBACK;
    var cls = 'lab-ic' + (SPIN[name] ? ' spin' : '') + (extraClass ? ' ' + extraClass : '');
    return '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
           'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
           inner + '</svg>';
  }

  // 기존 <span class="material-symbols-outlined ...">name</span> → SVG 로 치환(클래스/스타일 보존)
  function hydrateOne(el) {
    var name = (el.textContent || '').trim();
    var tmp = document.createElement('div');
    tmp.innerHTML = svgFor(name);
    var svg = tmp.firstChild;
    // 기존 유틸 클래스(text-*, 크기 등) 이관, 아이콘 폰트 클래스는 제외
    el.classList.forEach(function (c) {
      if (c !== 'material-symbols-outlined' && c !== 'material-symbols' && c !== 'material-icons') {
        svg.classList.add(c);
      }
    });
    if (el.getAttribute('style')) svg.setAttribute('style', el.getAttribute('style'));
    if (el.getAttribute('title')) svg.setAttribute('aria-label', el.getAttribute('title'));
    el.parentNode.replaceChild(svg, el);
  }

  function hydrate(root) {
    var scope = root || document;
    var list = scope.querySelectorAll ? scope.querySelectorAll('.material-symbols-outlined,.material-symbols,.material-icons') : [];
    for (var i = 0; i < list.length; i++) hydrateOne(list[i]);
  }

  // 동적 마크업 대응: 추가되는 노드 자동 치환
  function observe() {
    if (!window.MutationObserver) return;
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue;
          if (n.classList && (n.classList.contains('material-symbols-outlined') ||
                              n.classList.contains('material-symbols') ||
                              n.classList.contains('material-icons'))) {
            hydrateOne(n);
          } else if (n.querySelectorAll) {
            hydrate(n);
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function boot() {
    injectCSS();
    hydrate(document);
    observe();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* ---------- 5) 외부 노출 API ---------- */
  window.LabTheme = {
    colors: C,
    icon: svgFor,          // LabTheme.icon('home') → SVG 문자열(동적 innerHTML 삽입용)
    hydrate: hydrate,      // 수동 재치환이 필요할 때 LabTheme.hydrate(el)
  };
})();
