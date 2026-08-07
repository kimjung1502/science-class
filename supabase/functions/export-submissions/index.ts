import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'

const url = Deno.env.get('SUPABASE_URL')!
const anon = Deno.env.get('SUPABASE_ANON_KEY')!
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(o: unknown, status = 200) { return new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } }) }

function kst(iso: string | null): string {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) } catch { return '' }
}
function sanitizeName(s: string): string {
  return String(s || '').replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'untitled'
}
function sheetName(s: string): string {
  return (String(s || 'Sheet').replace(/[\\/?*\[\]:]/g, ' ').trim().slice(0, 31)) || 'Sheet'
}

// ---------- Google Drive ----------
async function getDriveToken(admin: any, cfg: any): Promise<string> {
  if (cfg.access_token && cfg.token_expiry && new Date(cfg.token_expiry).getTime() > Date.now() + 60000) return cfg.access_token
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cfg.client_id, client_secret: cfg.client_secret, refresh_token: cfg.refresh_token, grant_type: 'refresh_token' }) })
  const t = await r.json(); if (!r.ok || !t.access_token) throw new Error('token refresh failed')
  await admin.from('google_drive_credentials').update({ access_token: t.access_token, token_expiry: new Date(Date.now() + (t.expires_in || 3500) * 1000).toISOString() }).eq('id', 1)
  return t.access_token
}
const q1 = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
// 학년도·학기 자동 계산 (KST): 1~2월은 전년도 2학기, 3~7월 = 1학기, 8~12월 = 2학기 — submit-work 와 같은 규칙
function acadYearSem(): { year: string; sem: string } {
  const d = new Date(Date.now() + 9 * 3600 * 1000)
  const m = d.getUTCMonth() + 1
  return { year: String(d.getUTCFullYear() - (m <= 2 ? 1 : 0)), sem: m >= 3 && m <= 7 ? '1학기' : '2학기' }
}
async function ensureFolder(token: string, name: string, parentId: string): Promise<string> {
  const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${q1(name)}' and '${parentId}' in parents`
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`, { headers: { Authorization: `Bearer ${token}` } })
  const d = await r.json(); if (d.files && d.files.length) return d.files[0].id
  const cr = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }) })
  const cd = await cr.json(); if (!cr.ok) throw new Error('folder create failed'); return cd.id
}
// 있으면 id, 없으면 null — 실험 내보내기는 폴더를 새로 만들면 안 된다(없음 = 제출 없음).
// API 오류(만료 토큰·권한)는 '없음'과 구분해 던진다 — 삼키면 원인을 알 수 없다.
async function findFolder(token: string, name: string, parentId: string): Promise<string | null> {
  const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${q1(name)}' and '${parentId}' in parents`
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`, { headers: { Authorization: `Bearer ${token}` } })
  const d = await r.json()
  if (!r.ok) throw new Error(`드라이브 검색 실패 ${r.status}: ${JSON.stringify(d).slice(0, 180)}`)
  return (d.files && d.files[0]) ? d.files[0].id : null
}
// xlsx 바이트를 올리되 대상 mimeType을 구글 시트로 지정 → Drive가 네이티브 구글 시트로 변환 저장.
// 같은 이름의 시트가 이미 있으면 내용만 교체(재내보내기 시 링크·파일 id 유지).
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
async function uploadDrive(token: string, folderId: string, filename: string, bytes: Uint8Array, mime: string): Promise<{ id: string; link: string }> {
  const q = `trashed=false and name='${q1(filename)}' and '${folderId}' in parents`
  const fr = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`, { headers: { Authorization: `Bearer ${token}` } })
  const fd = await fr.json(); const existingId = fd.files && fd.files[0] ? fd.files[0].id : null
  if (existingId) {
    const pr = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media&fields=id,webViewLink`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime }, body: bytes })
    const pd = await pr.json(); if (!pr.ok) throw new Error('drive update failed'); return { id: pd.id, link: pd.webViewLink }
  }
  const boundary = '----driveBoundaryXlsx7MA4YWxk'
  const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: filename, parents: [folderId], mimeType: SHEET_MIME })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`
  const body = new Blob([pre, bytes, `\r\n--${boundary}--`])
  const ur = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body })
  const ud = await ur.json(); if (!ur.ok) throw new Error('drive upload failed'); return { id: ud.id, link: ud.webViewLink }
}

async function signFileUrl(admin: any, path: string): Promise<string> {
  // ponytail: 구 버전은 31536000초(1년)짜리 링크를 XLSX 셀에 영구히 박아 넣었다.
  // restore-plan-v2 Q4 가 최대 300초로 못박은 항목이라 5분으로 줄인다. 내보낸 파일의
  // 링크는 그만큼 빨리 죽으므로, 오래된 시트에서는 사이트에서 다시 받아야 한다.
  const { data } = await admin.storage.from('submissions').createSignedUrl(path, 300)
  return data?.signedUrl || ''
}

// 과제 한 건을 분반별로 xlsx 생성 → 드라이브에 구글 시트로 변환 업로드
async function exportAssignment(admin: any, assignmentId: string): Promise<{ ok: boolean; results?: any[]; error?: string }> {
  const { data: asg } = await admin.from('submission_assignments').select('id, subject_id, title, fields, due_at, due_date').eq('id', assignmentId).maybeSingle()
  if (!asg) return { ok: false, error: '과제를 찾을 수 없습니다.' }
  const { data: subj } = await admin.from('subjects').select('name, drive_folder').eq('id', asg.subject_id).maybeSingle()
  const subjectName = subj?.name || '과목'
  // 드라이브에는 "03. 물질과에너지" 처럼 번호가 붙은 폴더가 이미 있다. 폴더는 그 이름을 쓰고,
  // 시트 파일명에는 읽기 좋은 과목명을 그대로 쓴다.
  const subjectFolder = subj?.drive_folder || subjectName

  const { data: cfg } = await admin.from('google_drive_credentials').select('*').eq('id', 1).maybeSingle()
  if (!cfg || !cfg.refresh_token) return { ok: false, error: '구글 드라이브가 연결되어 있지 않습니다.' }
  const token = await getDriveToken(admin, cfg)
  const ys = acadYearSem()
  const fSchool = await ensureFolder(token, cfg.school_name || '학교', 'root')
  const fYear = await ensureFolder(token, ys.year, fSchool)
  const fSem = await ensureFolder(token, ys.sem, fYear)
  const fSubj = await ensureFolder(token, subjectFolder, fSem)

  const fields = (Array.isArray(asg.fields) ? asg.fields : []).filter((f: any) => f && f.type && f.type !== 'section' && f.type !== 'pagebreak')

  const { data: scs } = await admin.from('class_subjects').select('class_id').eq('subject_id', asg.subject_id)
  const classIds = (scs || []).map((x: any) => x.class_id)
  const { data: classes } = classIds.length ? await admin.from('classes').select('id, name, sort_order').in('id', classIds) : { data: [] as any[] }
  const { data: scRows } = classIds.length ? await admin.from('student_classes').select('student_id, class_id').in('class_id', classIds) : { data: [] as any[] }
  const studentIds = [...new Set((scRows || []).map((x: any) => x.student_id))]
  const { data: students } = studentIds.length ? await admin.from('students').select('id, name, student_number').in('id', studentIds).eq('is_active', true) : { data: [] as any[] }
  const stMap = new Map((students || []).map((s: any) => [s.id, s]))
  const { data: subs } = await admin.from('submissions').select('student_id, answers, submitted_at, updated_at').eq('assignment_id', assignmentId)
  const subMap = new Map((subs || []).map((s: any) => [s.student_id, s]))

  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const results: any[] = []

  for (const c of (classes || []).sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    const members = (scRows || []).filter((r: any) => r.class_id === c.id && stMap.has(r.student_id))
      .map((r: any) => stMap.get(r.student_id))
      .sort((a: any, b: any) => String(a.student_number).localeCompare(String(b.student_number), 'ko', { numeric: true }))

    const header = ['학번', '이름', '제출여부', '제출시각', ...fields.map((f: any) => f.label || f.id)]
    const aoa: any[][] = [header]
    const fileCells: { r: number; col: number; url: string; text: string; storage_path: string; drive_id: string }[] = []

    members.forEach((st: any, idx: number) => {
      const sub: any = subMap.get(st.id)
      const ans = (sub && sub.answers) || {}
      const row: any[] = [st.student_number || '', st.name || '', sub ? '제출' : '미제출', sub ? kst(sub.submitted_at) : '']
      fields.forEach((f: any, ci: number) => {
        const v = ans[f.id]
        let cell = ''
        // 파일·마인드맵 첨부: 드라이브 저장(drive_id)이면 드라이브 보기 링크,
        // 구 스토리지 저장(storage_path)이면 1년짜리 서명 URL (하위 호환)
        if (v && typeof v === 'object' && !Array.isArray(v) && (v.drive_id || v.storage_path)) {
          cell = v.file_name || '첨부파일'
          fileCells.push({ r: idx + 1, col: 4 + ci, url: '', text: cell, storage_path: v.storage_path || '', drive_id: v.drive_id || '' })
        } else if (Array.isArray(v)) {
          cell = v.join(', ')
        } else if (v != null) {
          cell = String(v)
        }
        row.push(cell)
      })
      aoa.push(row)
    })

    for (const fc of fileCells) {
      fc.url = fc.drive_id ? `https://drive.google.com/file/d/${fc.drive_id}/view` : await signFileUrl(admin, fc.storage_path)
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    for (const fc of fileCells) {
      const ref = XLSX.utils.encode_cell({ r: fc.r, c: fc.col })
      ws[ref] = fc.url ? { t: 's', v: fc.text, l: { Target: fc.url, Tooltip: fc.text } } : { t: 's', v: fc.text }
    }
    ws['!cols'] = header.map((_h: string, i: number) => ({ wch: i === 0 ? 10 : i === 1 ? 12 : i < 4 ? 16 : 28 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, sheetName(c.name))
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const bytes = new Uint8Array(out)

    const fClass = await ensureFolder(token, c.name || '미분류', fSubj)
    const filename = sanitizeName(`${asg.title}(${subjectName}_${c.name})`) // 구글 시트라 확장자 없음
    const up = await uploadDrive(token, fClass, filename, bytes, mime)
    results.push({ class_name: c.name, filename, drive_link: up.link || '', submitted: (subs || []).filter((s: any) => members.some((m: any) => m.id === s.student_id)).length, total: members.length })
  }
  return { ok: true, results }
}

// ---------- 실험 결과(드라이브의 학번_이름.json) → 반별 구글 시트 ----------
// 실험 페이지 교사 화면이 부른다. submit-work op=experiment 가 만든 폴더 구조
// (학교›년도›학기›과목›분반›실험명)를 그대로 되짚어 읽고, 시트를 실험명 폴더에 둔다.
function getByPath(o: any, path: string): any {
  return path.split('.').reduce((x: any, k: string) => (x == null ? undefined : x[k]), o)
}
function cellOf(payload: any, path: string): any {
  const v = getByPath(payload, path)
  if (v == null) return ''
  if (Array.isArray(v)) return v.length          // 측정점 배열 등은 개수만
  if (typeof v === 'object') return JSON.stringify(v)
  return v
}
// 열 지정이 안 왔을 때의 대비책 — 페이로드에서 값 경로를 그대로 열로 쓴다
const FLAT_SKIP = new Set(['version', 'student', 'updatedAt', 'unlockedStep', 'exportedAt', 'exportedHash', 'aiCheck'])
function leafPaths(o: any, prefix: string, out: string[]) {
  for (const k of Object.keys(o || {})) {
    if (!prefix && FLAT_SKIP.has(k)) continue
    const v = o[k], p = prefix ? prefix + '.' + k : k
    if (v && typeof v === 'object' && !Array.isArray(v)) leafPaths(v, p, out)
    else out.push(p)
  }
}
// AI 검수 요약 한 칸 — 지적당한 문항만 나열, 없으면 ✔ (판정은 페이지가 저장한 status 그대로)
function aiSummary(payload: any, labelOf: Map<string, string>): string {
  const ai = payload?.aiCheck
  if (!ai || typeof ai !== 'object') return ''
  const bad: string[] = []; let ok = 0
  for (const k of Object.keys(ai)) {
    const r = ai[k]; if (!r || !r.status) continue
    if (r.status === 'fail') bad.push(`⚠ ${labelOf.get(k) || k}${r.reason ? ': ' + r.reason : ''}`)
    else ok++
  }
  return bad.length ? bad.join('\n') : (ok ? '✔ 모두 통과' : '')
}
async function exportExperiment(admin: any, opts: any): Promise<{ ok: boolean; results?: any[]; error?: string }> {
  const subjectId = String(opts.subject_id || '')
  const title = sanitizeName(String(opts.title || ''))
  if (!subjectId || !title) return { ok: false, error: 'subject_id와 title이 필요합니다.' }
  const columns = (Array.isArray(opts.columns) ? opts.columns : [])
    .filter((c: any) => c && typeof c.path === 'string')
    .map((c: any) => ({ path: c.path, label: String(c.label || c.path) }))
    .slice(0, 100)

  const { data: subj } = await admin.from('subjects').select('name, drive_folder').eq('id', subjectId).maybeSingle()
  const subjectName = subj?.name || '과목'
  const subjectFolder = subj?.drive_folder || subjectName   // 폴더는 "03. 물질과에너지" 같은 실제 이름
  const { data: cfg } = await admin.from('google_drive_credentials').select('*').eq('id', 1).maybeSingle()
  if (!cfg || !cfg.refresh_token) return { ok: false, error: '구글 드라이브가 연결되어 있지 않습니다.' }
  const token = await getDriveToken(admin, cfg)

  // submit-work op=experiment 와 같은 경로·같은 sanitize 로 내려간다
  const ys = acadYearSem()
  let fBase: string | null = await findFolder(token, cfg.school_name || '학교', 'root')
  if (fBase) fBase = await findFolder(token, ys.year, fBase)
  if (fBase) fBase = await findFolder(token, ys.sem, fBase)
  if (fBase) fBase = await findFolder(token, sanitizeName(subjectFolder), fBase)
  if (!fBase) return { ok: false, error: '드라이브에서 제출 폴더를 찾지 못했습니다 — 아직 제출이 없는 것 같아요.' }

  const { data: scs } = await admin.from('class_subjects').select('class_id').eq('subject_id', subjectId)
  const classIds = (scs || []).map((x: any) => x.class_id)
  const { data: classes } = classIds.length ? await admin.from('classes').select('id, name, sort_order').in('id', classIds) : { data: [] as any[] }
  const { data: scRows } = classIds.length ? await admin.from('student_classes').select('student_id, class_id').in('class_id', classIds) : { data: [] as any[] }
  const studentIds = [...new Set((scRows || []).map((x: any) => x.student_id))]
  const { data: students } = studentIds.length ? await admin.from('students').select('id, name, student_number').in('id', studentIds).eq('is_active', true) : { data: [] as any[] }
  const stMap = new Map((students || []).map((s: any) => [s.id, s]))

  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const results: any[] = []

  for (const c of (classes || []).sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    const members = (scRows || []).filter((r: any) => r.class_id === c.id && stMap.has(r.student_id))
      .map((r: any) => stMap.get(r.student_id))
      .sort((a: any, b: any) => String(a.student_number).localeCompare(String(b.student_number), 'ko', { numeric: true }))

    const fClass = await findFolder(token, sanitizeName(c.name || '미분류'), fBase)
    const fExp = fClass ? await findFolder(token, title, fClass) : null
    if (!fExp) { results.push({ class_name: c.name, skipped: true, submitted: 0, total: members.length }); continue }

    // 실험 폴더의 JSON 전부 내려받아 학번 → 페이로드 맵 구성 (파일명: 학번_이름.json)
    const lr = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`trashed=false and '${fExp}' in parents and mimeType='application/json'`)}&fields=files(id,name)&pageSize=1000&spaces=drive`, { headers: { Authorization: `Bearer ${token}` } })
    const ld = await lr.json(); if (!lr.ok) return { ok: false, error: '드라이브 파일 목록을 읽지 못했습니다.' }
    const jsonFiles: any[] = ld.files || []
    const loaded = await Promise.all(jsonFiles.map(async (f: any) => {
      const dr = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, { headers: { Authorization: `Bearer ${token}` } })
      let payload: any = null
      try { payload = await dr.json() } catch { payload = null }
      return { name: f.name, payload }
    }))
    const bySid = new Map<string, any>()
    for (const it of loaded) {
      if (!it.payload) continue
      const sid = String(it.payload?.student?.sid || String(it.name).split('_')[0] || '')
      if (sid) bySid.set(sid, it.payload)
    }

    // 열: 페이지가 보낸 지정이 있으면 그대로, 없으면 페이로드에서 자동 추출
    let cols = columns
    if (!cols.length) {
      const seen: string[] = []
      for (const p of bySid.values()) { const ps: string[] = []; leafPaths(p, '', ps); for (const x of ps) if (!seen.includes(x)) seen.push(x) }
      cols = seen.map((p) => ({ path: p, label: p }))
    }
    const labelOf = new Map(cols.map((x: any) => [x.path, x.label]))

    const header = ['학번', '이름', '제출여부', '제출시각', ...cols.map((x: any) => x.label), 'AI 검수']
    const aoa: any[][] = [header]
    const rowOf = (sid: string, name: string, p: any) =>
      [sid, name, p ? '제출' : '미제출', p ? kst(p.exportedAt || p.updatedAt) : '',
        ...cols.map((x: any) => (p ? cellOf(p, x.path) : '')), p ? aiSummary(p, labelOf) : '']
    const seenSid = new Set<string>()
    for (const st of members) {
      const sid = String(st.student_number || '')
      seenSid.add(sid)
      aoa.push(rowOf(sid, st.name || '', bySid.get(sid) || null))
    }
    for (const [sid, p] of bySid) if (!seenSid.has(sid)) aoa.push(rowOf(sid, String(p?.student?.name || ''), p))   // 명부 밖 제출(전출입 등)도 버리지 않는다

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = header.map((_h: string, i: number) => ({ wch: i === 0 ? 10 : i === 1 ? 12 : i < 4 ? 16 : 28 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, sheetName(c.name))
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })

    const filename = sanitizeName(`${title}(${subjectName}_${c.name}) 응답모음`)
    const up = await uploadDrive(token, fExp, filename, new Uint8Array(out), mime)
    results.push({ class_name: c.name, filename, drive_link: up.link || '', submitted: bySid.size, total: members.length })
  }
  return { ok: true, results }
}

async function checkAdmin(admin: any, user: any): Promise<boolean> {
  const { data: byEmail } = await admin.from('admins').select('email').eq('email', user.email).maybeSingle()
  if (byEmail) return true
  const { data: byUid } = await admin.from('admins').select('email').eq('auth_user_id', user.id).maybeSingle()
  return !!byUid
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(url, service)

    // 구 버전에는 x-cron-secret 헤더로 도는 자동 일괄 내보내기가 있었다.
    // 비밀값을 app_config 테이블에 두는 구조였는데 그 테이블을 복원하지 않기로 했고
    // (restore-plan-v2 Q2), 교사가 직접 내보내는 지금은 필요도 없어 제거했다.

    const authHeader = req.headers.get('Authorization') || ''
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return json({ error: '로그인이 필요합니다.' }, 401)
    if (!(await checkAdmin(admin, user))) return json({ error: '관리자만 가능합니다.' }, 403)
    const body = await req.json().catch(() => ({}))
    if (body.experiment) {   // 실험 페이지 결과 내보내기 — 과제(assignment)와 무관
      const r = await exportExperiment(admin, body.experiment)
      return r.ok ? json({ ok: true, results: r.results }) : json({ error: r.error || '내보내기 실패' }, 400)
    }
    const assignmentId = body.assignment_id
    if (!assignmentId) return json({ error: 'assignment_id가 필요합니다.' }, 400)
    await admin.from('submission_assignments').update({ export_status: 'exporting' }).eq('id', assignmentId)
    const r = await exportAssignment(admin, assignmentId)
    if (r.ok) { await admin.from('submission_assignments').update({ export_status: 'done', exported_at: new Date().toISOString(), export_error: '' }).eq('id', assignmentId); return json({ ok: true, results: r.results }) }
    await admin.from('submission_assignments').update({ export_status: 'error', export_error: r.error || '' }).eq('id', assignmentId)
    return json({ error: r.error || '내보내기 실패' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
