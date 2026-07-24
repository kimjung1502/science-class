// 자체 제작 마인드맵 에디터 (외부 라이브러리·CDN 의존 없음)
// 실험노트(Editorial Lab) 팔레트 사용. window.MindmapEditor.create(mount, opts) -> api
//   api.load(data) / api.getData() / api.isEmpty()
//   api.exportPNGBlob({scale,background}) -> Promise<Blob>
//   api.focusCanvas() / api.destroy()
// data 형식: { version:1, nodes:[ {id,text,x,y,parent,color} ], links:[ {id,from,to,label} ] }
//   parent=null → 중심 주제. links = 아무 두 노드나 잇는 개념 연결(cross-link, 선택적 연결어 label).
(function () {
  'use strict';
  const SVGNS = 'http://www.w3.org/2000/svg';

  // 노드 색상(팔레트) — db.js ACCENTS 와 동일 계열. {stroke=테두리/글자, fill=배경}
  const PALETTE = {
    ink:     { stroke: '#16213E', fill: '#E1E6F2', text: '#16213E' },
    emerald: { stroke: '#2E6B1E', fill: '#DAF0C8', text: '#2E6B1E' },
    orange:  { stroke: '#9A5B00', fill: '#FFE9C7', text: '#9A5B00' },
    violet:  { stroke: '#4A3B7A', fill: '#E7E1F5', text: '#4A3B7A' },
    rose:    { stroke: '#B23A12', fill: '#FFE1D5', text: '#B23A12' },
    teal:    { stroke: '#155E6B', fill: '#D7E7EA', text: '#155E6B' },
  };
  const PALETTE_KEYS = Object.keys(PALETTE);
  const DEFAULT_TEXT = '중심 주제';
  const FONT = '"Pretendard Variable",Pretendard,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif';
  const FONT_SIZE = 15, LINE_H = 20, PAD_X = 15, PAD_Y = 9, MIN_W = 64, MIN_H = 42;
  const MAX_CHARS = 14;       // 한 줄 최대 글자수(대략)
  const MIN_S = 0.3, MAX_S = 2.5;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // 에디터 CSS 1회 주입(페이지가 스타일을 따로 넣지 않아도 됨)
  const CSS = [
    '.mm-root{position:relative;width:100%;height:100%;}',
    '.mm-canvas-wrap{position:absolute;inset:0;outline:none;touch-action:none;overflow:hidden;background:#FBFAF6;background-image:radial-gradient(circle,rgba(22,33,62,.08) 1px,transparent 1px);background-size:22px 22px;border-radius:12px;}',
    '.mm-svg{display:block;width:100%;height:100%;touch-action:none;-webkit-user-select:none;user-select:none;}',
    '.mm-toolbar{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:5;display:flex;align-items:center;gap:3px;padding:6px;background:#fff;border:1px solid #E4E1D4;border-radius:14px;box-shadow:0 8px 24px -14px rgba(22,33,62,.4);max-width:calc(100% - 20px);flex-wrap:wrap;}',
    '.mm-btn{display:inline-flex;align-items:center;gap:4px;padding:7px 9px;border:0;background:transparent;color:#16213E;font-family:inherit;font-weight:600;font-size:13px;line-height:1;border-radius:9px;cursor:pointer;}',
    '.mm-btn:hover{background:#F4F2E9;}',
    '.mm-btn:disabled{opacity:.35;cursor:not-allowed;}',
    '.mm-btn-active,.mm-btn-active:hover{background:#2A7C8C;color:#fff;}',
    '.mm-btn .lab-ic{width:18px;height:18px;}',
    '.mm-btn-label{white-space:nowrap;}',
    '.mm-sep{width:1px;height:22px;background:#E4E1D4;margin:0 3px;}',
    '.mm-swatches{display:inline-flex;gap:4px;align-items:center;}',
    '.mm-swatch{width:22px;height:22px;border-radius:7px;border:2px solid;cursor:pointer;padding:0;background-clip:padding-box;}',
    '.mm-swatch:hover{transform:scale(1.12);}',
    '.mm-swatch:disabled{opacity:.3;cursor:not-allowed;transform:none;}',
    '.mm-editor{position:absolute;z-index:10;box-sizing:border-box;border:2px solid #16213E;border-radius:10px;padding:4px 8px;font-family:inherit;color:#16213E;background:#fff;resize:none;outline:none;text-align:center;box-shadow:0 8px 24px -12px rgba(22,33,62,.5);overflow:hidden;line-height:1.3;}',
    '@media (max-width:520px){.mm-btn-label{display:none;}}',
  ].join('\n');
  function injectCSS() {
    if (typeof document === 'undefined' || document.getElementById('mm-editor-css')) return;
    const s = document.createElement('style');
    s.id = 'mm-editor-css';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // 문단(\n)·길이 기준으로 줄바꿈
  function wrapText(text) {
    const out = [];
    String(text == null ? '' : text).split('\n').forEach((para) => {
      if (para.length <= MAX_CHARS) { out.push(para); return; }
      const words = para.split(' ');
      let line = '';
      const flush = () => { if (line) { out.push(line); line = ''; } };
      words.forEach((w) => {
        // 한 단어가 너무 길면 하드 슬라이스
        while (w.length > MAX_CHARS) { flush(); out.push(w.slice(0, MAX_CHARS)); w = w.slice(MAX_CHARS); }
        const cand = line ? line + ' ' + w : w;
        if (cand.length > MAX_CHARS) { flush(); line = w; } else { line = cand; }
      });
      flush();
    });
    return out.length ? out : [''];
  }

  function el(tag, attrs) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function create(mount, opts) {
    injectCSS();
    opts = opts || {};
    const readonly = !!opts.readonly;
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};

    // ----- 상태 -----
    let nodes = [];              // 트리 노드
    let links = [];              // 개념 연결(cross-link): {id, from, to, label}
    let seq = 0, linkSeq = 0;    // id 카운터
    let selectedId = null;       // 선택된 노드
    let selectedLinkId = null;   // 선택된 연결선
    let linkMode = false, linkSource = null; // 연결 모드 / 연결 시작 노드
    const view = { tx: 0, ty: 0, s: 1 };
    const byId = () => { const m = {}; nodes.forEach((n) => { m[n.id] = n; }); return m; };
    const uid = () => 'n' + (++seq);
    const luid = () => 'l' + (++linkSeq);

    // ----- DOM -----
    mount.classList.add('mm-root');
    const wrap = document.createElement('div');
    wrap.className = 'mm-canvas-wrap';
    const svg = el('svg', { class: 'mm-svg' });
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    const gView = el('g', { class: 'mm-view' });
    const gEdges = el('g', { class: 'mm-edges' });
    const gNodes = el('g', { class: 'mm-nodes' });
    gView.appendChild(gEdges);
    gView.appendChild(gNodes);
    svg.appendChild(gView);
    wrap.appendChild(svg);

    // 편집용 textarea 오버레이
    const editor = document.createElement('textarea');
    editor.className = 'mm-editor';
    editor.style.display = 'none';
    editor.setAttribute('rows', '1');
    wrap.appendChild(editor);

    mount.appendChild(wrap);

    // 툴바
    let toolbar = null;
    if (!readonly) toolbar = buildToolbar();

    // ----- 좌표 변환 -----
    function applyView() { gView.setAttribute('transform', `translate(${view.tx},${view.ty}) scale(${view.s})`); }
    function screenToWorld(clientX, clientY) {
      const r = svg.getBoundingClientRect();
      return { x: (clientX - r.left - view.tx) / view.s, y: (clientY - r.top - view.ty) / view.s };
    }
    function worldToScreen(x, y) {
      const r = svg.getBoundingClientRect();
      return { x: r.left + view.tx + x * view.s, y: r.top + view.ty + y * view.s };
    }

    // ----- 렌더 -----
    let rafPending = false;
    function requestRender() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; render(); }); }

    function render() {
      const map = byId();
      // 노드 크기 측정 후 그리기
      gNodes.textContent = '';
      gEdges.textContent = '';
      nodes.forEach((n) => drawNode(n));
      // 엣지(부모→자식). 노드 크기(_w,_h)가 계산된 뒤 그린다.
      nodes.forEach((n) => {
        if (!n.parent) return;
        const p = map[n.parent];
        if (!p) return;
        drawEdge(p, n);
      });
      // 개념 연결(cross-link): 아무 두 노드나 점선+화살표로 연결
      links.forEach((l) => {
        const a = map[l.from], b = map[l.to];
        if (a && b) drawLink(l, a, b);
      });
      applyView();
    }

    // 노드 중심에서 target 방향으로 노드 경계 위의 점(연결선이 상자 밖에서 시작/끝나게)
    function boxEdgePoint(node, towardX, towardY) {
      const bw = (node._w || MIN_W) / 2 + 3, bh = (node._h || MIN_H) / 2 + 3;
      const dx = towardX - node.x, dy = towardY - node.y;
      if (dx === 0 && dy === 0) return { x: node.x, y: node.y };
      const tx = dx !== 0 ? bw / Math.abs(dx) : Infinity;
      const ty = dy !== 0 ? bh / Math.abs(dy) : Infinity;
      const t = Math.min(tx, ty);
      return { x: node.x + dx * t, y: node.y + dy * t };
    }

    function drawNode(n) {
      const pal = PALETTE[n.color] || PALETTE.ink;
      const g = el('g', { class: 'mm-node', 'data-node-id': n.id, transform: `translate(${n.x},${n.y})` });
      g.style.cursor = readonly ? 'default' : 'grab';
      const rect = el('rect', { rx: 12, ry: 12 });
      const txt = el('text', {
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-family': FONT, 'font-size': FONT_SIZE, 'font-weight': n.parent ? 600 : 800, fill: pal.text,
      });
      const lines = wrapText(n.text);
      lines.forEach((ln, i) => {
        const t = el('tspan', { x: 0, y: (i - (lines.length - 1) / 2) * LINE_H });
        t.textContent = ln === '' ? '​' : ln;
        txt.appendChild(t);
      });
      g.appendChild(rect); g.appendChild(txt);
      gNodes.appendChild(g);
      // 측정
      let w = MIN_W;
      try { for (const t of txt.childNodes) w = Math.max(w, t.getComputedTextLength() + PAD_X * 2); } catch (_e) {}
      const h = Math.max(MIN_H, lines.length * LINE_H + PAD_Y * 2);
      n._w = w; n._h = h;
      rect.setAttribute('x', -w / 2); rect.setAttribute('y', -h / 2);
      rect.setAttribute('width', w); rect.setAttribute('height', h);
      rect.setAttribute('fill', pal.fill);
      rect.setAttribute('stroke', pal.stroke);
      rect.setAttribute('stroke-width', n.parent ? 2 : 2.5);
      // 선택 표시(내보내기 제외)
      if (n.id === selectedId && !readonly) {
        const ring = el('rect', {
          x: -w / 2 - 5, y: -h / 2 - 5, width: w + 10, height: h + 10, rx: 15, ry: 15,
          fill: 'none', stroke: '#C4E000', 'stroke-width': 3, 'data-ephemeral': '1',
        });
        g.insertBefore(ring, rect);
      }
      // 연결 모드에서 시작 노드 표시(teal 점선 링)
      if (n.id === linkSource && !readonly) {
        const ring2 = el('rect', {
          x: -w / 2 - 5, y: -h / 2 - 5, width: w + 10, height: h + 10, rx: 15, ry: 15,
          fill: 'none', stroke: '#2A7C8C', 'stroke-width': 2.5, 'stroke-dasharray': '5 4', 'data-ephemeral': '1',
        });
        g.insertBefore(ring2, rect);
      }
    }

    function drawEdge(p, c) {
      const x1 = p.x, y1 = p.y, x2 = c.x, y2 = c.y;
      const dx = Math.max(30, Math.abs(x2 - x1) / 2);
      const c1x = x1 + (x2 >= x1 ? dx : -dx), c2x = x2 + (x2 >= x1 ? -dx : dx);
      const pal = PALETTE[c.color] || PALETTE.ink;
      const path = el('path', {
        d: `M ${x1} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${x2} ${y2}`,
        fill: 'none', stroke: pal.stroke, 'stroke-width': 2.5, 'stroke-opacity': 0.55, 'stroke-linecap': 'round',
      });
      gEdges.appendChild(path);
    }

    // 개념 연결선(점선 + 화살표 + 선택적 연결어 라벨)
    function drawLink(l, a, b) {
      const LC = '#2A7C8C'; // teal
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const off = clamp(len * 0.14, 14, 70);
      const cx = mx - (dy / len) * off, cy = my + (dx / len) * off; // 제어점(살짝 휨)
      const s = boxEdgePoint(a, cx, cy), e = boxEdgePoint(b, cx, cy);
      const d = `M ${s.x} ${s.y} Q ${cx} ${cy} ${e.x} ${e.y}`;
      const sel = l.id === selectedLinkId && !readonly;
      // 넓은 투명 히트영역만 포인터 이벤트 수신(장식 요소는 pointer-events:none 로 통과)
      const hit = el('path', { d: d, fill: 'none', stroke: 'transparent', 'stroke-width': 20, 'pointer-events': 'stroke', 'data-link-id': l.id });
      if (!readonly) hit.style.cursor = 'pointer';
      gEdges.appendChild(hit);
      if (sel) gEdges.appendChild(el('path', { d: d, fill: 'none', stroke: '#C4E000', 'stroke-width': 7, 'stroke-opacity': 0.4, 'pointer-events': 'none', 'data-ephemeral': '1' }));
      gEdges.appendChild(el('path', { d: d, fill: 'none', stroke: LC, 'stroke-width': sel ? 2.8 : 2.2, 'stroke-dasharray': '6 5', 'stroke-linecap': 'round', 'pointer-events': 'none' }));
      // 화살표(방향)
      const ang = Math.atan2(e.y - cy, e.x - cx), ah = 9;
      gEdges.appendChild(el('path', {
        d: `M ${e.x - ah * Math.cos(ang - 0.42)} ${e.y - ah * Math.sin(ang - 0.42)} L ${e.x} ${e.y} L ${e.x - ah * Math.cos(ang + 0.42)} ${e.y - ah * Math.sin(ang + 0.42)}`,
        fill: 'none', stroke: LC, 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none',
      }));
      // 연결어 라벨(칩) — 길면 줄바꿈, 실제 크기 측정해 저장
      l._lw = 0; l._lh = 0;
      if (l.label && String(l.label).trim()) {
        const lines = wrapText(l.label);
        const bg = el('rect', { rx: 7, ry: 7, fill: '#FBFAF6', stroke: LC, 'stroke-width': 1.2, 'data-link-id': l.id });
        const t = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-family': FONT, 'font-size': 12.5, 'font-weight': 700, fill: '#155E6B', 'data-link-id': l.id });
        lines.forEach((ln, i) => { const ts = el('tspan', { x: cx, y: cy + (i - (lines.length - 1) / 2) * 16 }); ts.textContent = ln === '' ? '​' : ln; t.appendChild(ts); });
        gEdges.appendChild(bg); gEdges.appendChild(t);
        let w = 24; try { for (const ts of t.childNodes) w = Math.max(w, ts.getComputedTextLength() + 14); } catch (_e) {}
        const h = lines.length * 16 + 8;
        bg.setAttribute('x', cx - w / 2); bg.setAttribute('y', cy - h / 2);
        bg.setAttribute('width', w); bg.setAttribute('height', h);
        if (!readonly) { bg.style.cursor = 'pointer'; t.style.cursor = 'pointer'; }
        l._lw = w; l._lh = h;
      }
      l._mx = cx; l._my = cy; // 라벨 편집 위치
    }

    // ----- 모델 조작 -----
    function fireChange() { onChange(); }
    function findNode(id) { return nodes.find((n) => n.id === id) || null; }
    function findLink(id) { return links.find((l) => l.id === id) || null; }
    function childrenOf(id) { return nodes.filter((n) => n.parent === id); }
    function select(id) { selectedId = id; selectedLinkId = null; requestRender(); syncToolbar(); }
    function selectLink(id) { selectedLinkId = id; selectedId = null; requestRender(); syncToolbar(); }

    // 개념 연결 만들기/삭제
    function createLink(fromId, toId) {
      if (!fromId || !toId || fromId === toId) return null;
      if (!findNode(fromId) || !findNode(toId)) return null; // 양 끝 노드가 실제 존재할 때만
      if (links.some((l) => (l.from === fromId && l.to === toId) || (l.from === toId && l.to === fromId))) return null; // 중복 방지
      const l = { id: luid(), from: fromId, to: toId, label: '' };
      links.push(l); selectedLinkId = l.id; selectedId = null;
      requestRender(); syncToolbar(); fireChange();
      return l;
    }
    function deleteLink(id) {
      links = links.filter((l) => l.id !== id);
      if (selectedLinkId === id) selectedLinkId = null;
      requestRender(); syncToolbar(); fireChange();
    }
    // 연결 모드 토글
    function setLinkMode(on) {
      linkMode = !!on; linkSource = null;
      wrap.style.cursor = linkMode ? 'crosshair' : '';
      syncToolbar(); requestRender();
    }

    function addChild(parentId) {
      const p = findNode(parentId) || findNode('root') || nodes[0];
      if (!p) return null;
      const sibs = childrenOf(p.id);
      const dir = p.parent == null ? (sibs.length % 2 === 0 ? 1 : -1) : (p.x >= (findNode('root') ? findNode('root').x : 0) ? 1 : -1);
      const n = {
        id: uid(), text: '새 생각', parent: p.id,
        x: p.x + dir * 190,
        y: p.y + (sibs.length - (sibs.length ? (sibs.length - 1) / 2 : 0)) * 66,
        color: p.parent == null ? PALETTE_KEYS[(sibs.length) % PALETTE_KEYS.length] : p.color,
      };
      nodes.push(n); select(n.id); fireChange();
      return n;
    }
    function addSibling(id) {
      const n = findNode(id);
      if (!n || n.parent == null) return addChild(id); // 루트면 자식 추가
      const created = addChild(n.parent);
      if (created) { created.y = n.y + 66; requestRender(); }
      return created;
    }
    function deleteSubtree(id) {
      const n = findNode(id);
      if (!n || n.parent == null) return; // 루트 삭제 불가
      const kill = new Set([id]);
      let changed = true;
      while (changed) { changed = false; nodes.forEach((x) => { if (x.parent && kill.has(x.parent) && !kill.has(x.id)) { kill.add(x.id); changed = true; } }); }
      nodes = nodes.filter((x) => !kill.has(x.id));
      links = links.filter((l) => !kill.has(l.from) && !kill.has(l.to)); // 삭제된 노드의 연결도 제거
      if (linkSource && kill.has(linkSource)) { linkMode = false; linkSource = null; wrap.style.cursor = ''; } // 연결 시작 노드가 삭제됨
      selectedId = n.parent; selectedLinkId = null;
      requestRender(); syncToolbar(); fireChange();
    }
    function setColor(id, color) { const n = findNode(id); if (!n) return; n.color = color; requestRender(); fireChange(); }

    // ----- 편집(텍스트) -----
    let editing = null;
    function beginEdit(id) {
      if (readonly) return;
      const n = findNode(id); if (!n) return;
      editing = { kind: 'node', id: id };
      const sc = worldToScreen(n.x, n.y);
      const wrapRect = wrap.getBoundingClientRect();
      const w = Math.max(90, (n._w || MIN_W) * view.s);
      const h = Math.max(38, (n._h || MIN_H) * view.s);
      editor.value = n.text === '새 생각' || n.text === DEFAULT_TEXT ? '' : n.text;
      editor.style.display = 'block';
      editor.style.left = (sc.x - wrapRect.left - w / 2) + 'px';
      editor.style.top = (sc.y - wrapRect.top - h / 2) + 'px';
      editor.style.width = w + 'px';
      editor.style.height = h + 'px';
      editor.style.fontSize = (FONT_SIZE * view.s) + 'px';
      editor.placeholder = n.parent == null ? DEFAULT_TEXT : '내용 입력';
      editor.focus();
      editor.select();
    }
    // 연결어(라벨) 편집 — 연결선 중점 위치에 입력창
    function beginLinkEdit(id) {
      if (readonly) return;
      const l = findLink(id); if (!l) return;
      selectedLinkId = id; selectedId = null;
      let wx = l._mx, wy = l._my;
      if (wx == null) { const a = findNode(l.from), b = findNode(l.to); if (a && b) { wx = (a.x + b.x) / 2; wy = (a.y + b.y) / 2; } else { wx = 0; wy = 0; } }
      editing = { kind: 'link', id: id };
      const sc = worldToScreen(wx, wy);
      const wrapRect = wrap.getBoundingClientRect();
      const w = 140, h = 34;
      editor.value = l.label || '';
      editor.style.display = 'block';
      editor.style.left = (sc.x - wrapRect.left - w / 2) + 'px';
      editor.style.top = (sc.y - wrapRect.top - h / 2) + 'px';
      editor.style.width = w + 'px';
      editor.style.height = h + 'px';
      editor.style.fontSize = (12.5 * view.s) + 'px';
      editor.placeholder = '연결어(예: 포함한다)';
      editor.focus();
      editor.select();
    }
    function commitEdit(keep) {
      if (!editing) return;
      if (keep) {
        if (editing.kind === 'node') { const n = findNode(editing.id); if (n) { const v = editor.value.trim(); n.text = v || (n.parent == null ? DEFAULT_TEXT : '새 생각'); } }
        else if (editing.kind === 'link') { const l = findLink(editing.id); if (l) l.label = editor.value.trim(); }
      }
      editing = null;
      editor.style.display = 'none';
      requestRender(); fireChange();
      focusCanvas();
    }
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commitEdit(false); }
      e.stopPropagation();
    });
    editor.addEventListener('blur', () => commitEdit(true));

    // ----- 포인터(드래그/팬/선택) -----
    const drag = { mode: null, id: null, linkId: null, pointerId: null, startX: 0, startY: 0, origX: 0, origY: 0, moved: false, lastTap: 0, lastTapId: null };
    function onPointerDown(e) {
      if (editing != null || drag.mode) return; // 이미 드래그 중이면(다른 포인터) 무시
      const nodeEl = e.target.closest && e.target.closest('[data-node-id]');
      const linkEl = e.target.closest && e.target.closest('[data-link-id]');
      // 연결 모드: 노드 두 개를 골라 연결
      if (linkMode && !readonly) {
        if (nodeEl) {
          const id = nodeEl.getAttribute('data-node-id');
          if (!linkSource) { linkSource = id; requestRender(); }
          else if (id !== linkSource) { const created = createLink(linkSource, id); setLinkMode(false); if (created) setTimeout(() => beginLinkEdit(created.id), 0); }
          else { linkSource = null; requestRender(); } // 같은 노드 재클릭 → 취소
        } else { setLinkMode(false); } // 빈 곳 → 연결 모드 종료
        return; // 연결 모드에선 드래그/팬 없음
      }
      drag.pointerId = e.pointerId;
      try { svg.setPointerCapture && svg.setPointerCapture(e.pointerId); } catch (_e) {}
      drag.startX = e.clientX; drag.startY = e.clientY; drag.moved = false;
      drag.linkId = null;
      if (nodeEl && !readonly) {
        const id = nodeEl.getAttribute('data-node-id');
        const n = findNode(id);
        drag.mode = 'node'; drag.id = id; drag.origX = n.x; drag.origY = n.y;
        if (selectedId !== id) select(id);
      } else {
        drag.mode = 'pan'; drag.origX = view.tx; drag.origY = view.ty;
        drag.linkId = (linkEl && !readonly) ? linkEl.getAttribute('data-link-id') : null;
      }
    }
    function onPointerMove(e) {
      if (!drag.mode || e.pointerId !== drag.pointerId) return;
      const dxs = e.clientX - drag.startX, dys = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dxs, dys) > 4) drag.moved = true;
      if (drag.mode === 'node') {
        const n = findNode(drag.id); if (!n) return;
        n.x = drag.origX + dxs / view.s; n.y = drag.origY + dys / view.s;
        requestRender();
      } else if (drag.mode === 'pan') {
        view.tx = drag.origX + dxs; view.ty = drag.origY + dys; applyView();
      }
    }
    function onPointerUp(e) {
      if (!drag.mode || e.pointerId !== drag.pointerId) return;
      const mode = drag.mode, moved = drag.moved, id = drag.id, linkId = drag.linkId;
      if (mode === 'node' && moved) fireChange();
      // 탭/더블탭(모바일) 처리 — 같은 노드를 320ms 내에 두 번 탭해야 편집
      if (mode === 'node' && !moved) {
        const now = e.timeStamp || (window.performance ? performance.now() : 0);
        if (!readonly && id === drag.lastTapId && now - drag.lastTap < 320) { beginEdit(id); drag.lastTap = 0; drag.lastTapId = null; }
        else { drag.lastTap = now; drag.lastTapId = id; }
      }
      // 빈 곳/연결선 탭: 연결선 선택 또는 전체 선택 해제(팬 드래그면 유지)
      if (mode === 'pan' && !moved) {
        if (linkId && !readonly) selectLink(linkId);
        else if (selectedId != null || selectedLinkId != null) { selectedId = null; selectedLinkId = null; requestRender(); syncToolbar(); }
      }
      drag.mode = null; drag.id = null; drag.pointerId = null; drag.linkId = null;
    }
    // 포인터 취소/캡처 상실: 드래그 안전 종료(현재 위치 유지, 탭/편집 트리거 안 함)
    function onPointerCancel(e) {
      if (!drag.mode || (e && e.pointerId != null && e.pointerId !== drag.pointerId)) return;
      const wasNode = drag.mode === 'node', moved = drag.moved;
      if (wasNode && moved) fireChange();
      drag.mode = null; drag.id = null; drag.pointerId = null; drag.linkId = null;
    }
    svg.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    svg.addEventListener('lostpointercapture', onPointerCancel);

    // 더블클릭 편집(데스크톱) — 노드 텍스트 / 연결어
    svg.addEventListener('dblclick', (e) => {
      if (readonly) return;
      const nodeEl = e.target.closest && e.target.closest('[data-node-id]');
      if (nodeEl) { e.preventDefault(); beginEdit(nodeEl.getAttribute('data-node-id')); return; }
      const linkEl = e.target.closest && e.target.closest('[data-link-id]');
      if (linkEl) { e.preventDefault(); beginLinkEdit(linkEl.getAttribute('data-link-id')); }
    });

    // 휠 줌(커서 기준)
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const ns = clamp(view.s * factor, MIN_S, MAX_S);
      const r = svg.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      view.tx = cx - (cx - view.tx) * (ns / view.s);
      view.ty = cy - (cy - view.ty) * (ns / view.s);
      view.s = ns; applyView();
    }, { passive: false });

    // 키보드(캔버스 포커스 시)
    function onKey(e) {
      if (readonly || editing != null) return;
      if (e.key === 'Escape') { if (linkMode) setLinkMode(false); else { selectedLinkId = null; select(null); } return; }
      if (linkMode) return; // 연결 모드에선 대상 클릭/Escape 외 변경 금지
      // 연결선이 선택된 경우
      if (selectedLinkId) {
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteLink(selectedLinkId); }
        else if (e.key === 'F2' || e.key === 'Enter') { e.preventDefault(); beginLinkEdit(selectedLinkId); }
        return;
      }
      if (!selectedId) return;
      if (e.key === 'Tab') { e.preventDefault(); const c = addChild(selectedId); if (c) setTimeout(() => beginEdit(c.id), 0); }
      else if (e.key === 'Enter') { e.preventDefault(); const c = addSibling(selectedId); if (c) setTimeout(() => beginEdit(c.id), 0); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSubtree(selectedId); }
      else if (e.key === 'F2') { e.preventDefault(); beginEdit(selectedId); }
    }
    wrap.setAttribute('tabindex', '0');
    wrap.addEventListener('keydown', onKey);
    function focusCanvas() { try { wrap.focus({ preventScroll: true }); } catch (_e) { wrap.focus(); } }

    // ----- 뷰 맞춤 -----
    function contentBBox() {
      if (!nodes.length) return { x: -100, y: -60, w: 200, h: 120 };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach((n) => {
        const w = n._w || MIN_W, h = n._h || MIN_H;
        minX = Math.min(minX, n.x - w / 2); maxX = Math.max(maxX, n.x + w / 2);
        minY = Math.min(minY, n.y - h / 2); maxY = Math.max(maxY, n.y + h / 2);
      });
      // 연결선 곡선/연결어 라벨이 노드 바깥으로 나갈 수 있어 포함(내보내기 클리핑 방지)
      links.forEach((l) => {
        if (l._mx == null) return;
        const rx = Math.max((l._lw || 0) / 2 + 6, 24), ry = Math.max((l._lh || 0) / 2 + 6, 16);
        minX = Math.min(minX, l._mx - rx); maxX = Math.max(maxX, l._mx + rx);
        minY = Math.min(minY, l._my - ry); maxY = Math.max(maxY, l._my + ry);
      });
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    function fit() {
      render(); // 크기 확정
      const b = contentBBox();
      const r = svg.getBoundingClientRect();
      const pad = 60;
      const s = clamp(Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h, 1.4), MIN_S, MAX_S);
      view.s = s;
      view.tx = r.width / 2 - (b.x + b.w / 2) * s;
      view.ty = r.height / 2 - (b.y + b.h / 2) * s;
      applyView();
    }
    function zoomBy(f) {
      const r = svg.getBoundingClientRect();
      const cx = r.width / 2, cy = r.height / 2;
      const ns = clamp(view.s * f, MIN_S, MAX_S);
      view.tx = cx - (cx - view.tx) * (ns / view.s);
      view.ty = cy - (cy - view.ty) * (ns / view.s);
      view.s = ns; applyView();
    }

    // ----- 툴바 -----
    function buildToolbar() {
      const bar = document.createElement('div');
      bar.className = 'mm-toolbar';
      bar.innerHTML =
        btn('add', 'add', '가지', '자식 노드 추가 (Tab)') +
        btn('sibling', 'add_road', '형제', '형제 노드 추가 (Enter)') +
        btn('link', 'link', '연결', '두 노드를 연결 — 개념도 (A 클릭 → B 클릭)') +
        btn('del', 'delete', '삭제', '선택 삭제 (Del)') +
        '<span class="mm-sep"></span>' +
        '<span class="mm-swatches" id="mm-swatches"></span>' +
        '<span class="mm-sep"></span>' +
        btn('zin', 'zoom_in', '', '확대') +
        btn('zout', 'zoom_out', '', '축소') +
        btn('fit', 'fit_screen', '', '전체 보기');
      mount.appendChild(bar);
      // 스와치
      const sw = bar.querySelector('#mm-swatches');
      PALETTE_KEYS.forEach((k) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'mm-swatch'; b.dataset.color = k; b.title = '색상';
        b.style.background = PALETTE[k].fill; b.style.borderColor = PALETTE[k].stroke;
        b.addEventListener('click', () => { if (!linkMode && selectedId) setColor(selectedId, k); });
        sw.appendChild(b);
      });
      bar.querySelector('[data-act=add]').addEventListener('click', () => { const c = addChild(selectedId || 'root'); if (c) beginEdit(c.id); });
      bar.querySelector('[data-act=sibling]').addEventListener('click', () => { if (selectedId) { const c = addSibling(selectedId); if (c) beginEdit(c.id); } });
      bar.querySelector('[data-act=link]').addEventListener('click', () => setLinkMode(!linkMode));
      bar.querySelector('[data-act=del]').addEventListener('click', () => { if (selectedLinkId) deleteLink(selectedLinkId); else if (selectedId) deleteSubtree(selectedId); });
      bar.querySelector('[data-act=zin]').addEventListener('click', () => zoomBy(1.2));
      bar.querySelector('[data-act=zout]').addEventListener('click', () => zoomBy(1 / 1.2));
      bar.querySelector('[data-act=fit]').addEventListener('click', () => fit());
      return bar;
    }
    function btn(act, icon, label, title) {
      return `<button type="button" class="mm-btn" data-act="${act}" title="${title}"><span class="material-symbols-outlined">${icon}</span>${label ? `<span class="mm-btn-label">${label}</span>` : ''}</button>`;
    }
    function syncToolbar() {
      if (!toolbar) return;
      const node = selectedId ? findNode(selectedId) : null;
      const root = node && node.parent == null;
      const lm = linkMode;
      toolbar.querySelector('[data-act=add]').disabled = lm;
      toolbar.querySelector('[data-act=sibling]').disabled = lm || !node || root;
      toolbar.querySelector('[data-act=del]').disabled = lm || !((node && !root) || selectedLinkId);
      const lb = toolbar.querySelector('[data-act=link]'); if (lb) lb.classList.toggle('mm-btn-active', lm);
      toolbar.querySelectorAll('.mm-swatch').forEach((sw) => { sw.disabled = lm; }); // 연결 모드엔 색상 변경 잠금
    }

    // ----- 공개 API -----
    function load(data) {
      nodes = []; links = [];
      seq = 0; linkSeq = 0;
      selectedLinkId = null; linkMode = false; linkSource = null;
      if (data && Array.isArray(data.nodes) && data.nodes.length) {
        data.nodes.forEach((n) => {
          nodes.push({
            id: String(n.id), text: n.text == null ? '' : String(n.text),
            x: Number(n.x) || 0, y: Number(n.y) || 0,
            parent: n.parent == null ? null : String(n.parent),
            color: PALETTE[n.color] ? n.color : 'ink',
          });
          const m = /^n(\d+)$/.exec(String(n.id)); if (m) seq = Math.max(seq, parseInt(m[1], 10));
        });
        if (!nodes.some((n) => n.parent == null)) nodes[0].parent = null; // 루트 보정
        // 개념 연결 복원(양 끝 노드가 존재하고, id는 유일하게)
        if (Array.isArray(data.links)) {
          const nodeIds = new Set(nodes.map((n) => n.id));
          // 1) 먼저 입력 링크 id로 linkSeq 복원 → 이후 luid()가 기존 id와 충돌하지 않게
          data.links.forEach((l) => { if (l && l.id) { const m = /^l(\d+)$/.exec(String(l.id)); if (m) linkSeq = Math.max(linkSeq, parseInt(m[1], 10)); } });
          const usedIds = new Set();
          data.links.forEach((l) => {
            if (!l) return;
            const from = String(l.from), to = String(l.to);
            if (from === to || !nodeIds.has(from) || !nodeIds.has(to)) return;
            if (links.some((x) => (x.from === from && x.to === to) || (x.from === to && x.to === from))) return;
            let id = l.id ? String(l.id) : '';
            if (!id || usedIds.has(id)) id = luid(); // 누락·중복 id → 충돌 없는 새 id
            usedIds.add(id);
            links.push({ id: id, from: from, to: to, label: l.label == null ? '' : String(l.label) });
          });
        }
      } else {
        nodes.push({ id: 'root', text: DEFAULT_TEXT, x: 0, y: 0, parent: null, color: 'ink' });
      }
      selectedId = (nodes.find((n) => n.parent == null) || nodes[0]).id;
      syncToolbar();
      // 레이아웃 후 맞춤
      setTimeout(fit, 0);
    }
    function getData() {
      return {
        version: 1,
        nodes: nodes.map((n) => ({ id: n.id, text: n.text, x: Math.round(n.x), y: Math.round(n.y), parent: n.parent, color: n.color })),
        links: links.map((l) => ({ id: l.id, from: l.from, to: l.to, label: l.label || '' })),
      };
    }
    function isEmpty() {
      if (nodes.length === 0) return true;
      if (nodes.length === 1) { const t = (nodes[0].text || '').trim(); return t === '' || t === DEFAULT_TEXT; }
      return false;
    }

    // SVG → PNG Blob
    function exportPNGBlob(o) {
      o = o || {};
      const scale = o.scale || 2;
      const bg = o.background || '#FBFAF6';
      render(); // 최신 크기 반영
      const b = contentBBox();
      const pad = 40;
      const vx = b.x - pad, vy = b.y - pad, vw = b.w + pad * 2, vh = b.h + pad * 2;
      // 독립 SVG 구성(선택 링 등 data-ephemeral 제외)
      const out = el('svg', { xmlns: SVGNS, width: Math.round(vw * scale), height: Math.round(vh * scale), viewBox: `${vx} ${vy} ${vw} ${vh}` });
      out.appendChild(el('rect', { x: vx, y: vy, width: vw, height: vh, fill: bg }));
      const clone = gView.cloneNode(true);
      clone.removeAttribute('transform');
      clone.querySelectorAll('[data-ephemeral]').forEach((n) => n.remove());
      out.appendChild(clone);
      const svgStr = new XMLSerializer().serializeToString(out);
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(vw * scale); canvas.height = Math.round(vh * scale);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG 변환 실패')), 'image/png');
          } catch (err) { reject(err); }
        };
        img.onerror = () => reject(new Error('이미지 렌더 실패'));
        img.src = url;
      });
    }

    function destroy() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      mount.textContent = '';
    }

    // 초기 렌더
    const api = { load, getData, isEmpty, exportPNGBlob, focusCanvas, fit, destroy,
      addChild: () => addChild(selectedId || 'root'), get selectedId() { return selectedId; } };
    load(opts.data || null);
    return api;
  }

  window.MindmapEditor = { create, PALETTE };
})();
