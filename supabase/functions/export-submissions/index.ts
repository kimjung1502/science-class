import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'

const url = Deno.env.get('SUPABASE_URL')!
const anon = Deno.env.get('SUPABASE_ANON_KEY')!
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(o: unknown, status = 200) { return new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } }) }

function isClosed(asg: any): boolean {
  const now = Date.now()
  if (asg.due_at) return new Date(asg.due_at).getTime() < now
  if (asg.due_date) return new Date(asg.due_date + 'T23:59:59.999+09:00').getTime() < now
  return false
}
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
async function ensureFolder(token: string, name: string, parentId: string): Promise<string> {
  const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${q1(name)}' and '${parentId}' in parents`
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`, { headers: { Authorization: `Bearer ${token}` } })
  const d = await r.json(); if (d.files && d.files.length) return d.files[0].id
  const cr = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }) })
  const cd = await cr.json(); if (!cr.ok) throw new Error('folder create failed'); return cd.id
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
  const { data } = await admin.storage.from('submissions').createSignedUrl(path, 31536000)
  return data?.signedUrl || ''
}

// 과제 한 건을 분반별로 xlsx 생성 → 드라이브에 구글 시트로 변환 업로드
async function exportAssignment(admin: any, assignmentId: string): Promise<{ ok: boolean; results?: any[]; error?: string }> {
  const { data: asg } = await admin.from('submission_assignments').select('id, subject_id, title, fields, due_at, due_date').eq('id', assignmentId).maybeSingle()
  if (!asg) return { ok: false, error: '과제를 찾을 수 없습니다.' }
  const { data: subj } = await admin.from('subjects').select('name').eq('id', asg.subject_id).maybeSingle()
  const subjectName = subj?.name || '과목'

  const { data: cfg } = await admin.from('google_drive_credentials').select('*').eq('id', 1).maybeSingle()
  if (!cfg || !cfg.refresh_token) return { ok: false, error: '구글 드라이브가 연결되어 있지 않습니다.' }
  const token = await getDriveToken(admin, cfg)
  const fSchool = await ensureFolder(token, cfg.school_name || '학교', 'root')
  const fYear = await ensureFolder(token, cfg.acad_year || '년도', fSchool)
  const fSem = await ensureFolder(token, cfg.semester || '학기', fYear)
  const fSubj = await ensureFolder(token, subjectName, fSem)

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
    const cronSecret = req.headers.get('x-cron-secret') || ''

    if (cronSecret) {
      const { data: cfg } = await admin.from('app_config').select('archive_cron_secret').eq('id', 1).maybeSingle()
      if (!cfg?.archive_cron_secret || cronSecret !== cfg.archive_cron_secret) return json({ error: 'invalid cron secret' }, 403)
      const { data: cands } = await admin.from('submission_assignments').select('id, due_at, due_date, export_status').eq('is_active', true).neq('export_status', 'done')
      const due = (cands || []).filter((a: any) => isClosed(a))
      const summary: any[] = []
      for (const a of due) {
        await admin.from('submission_assignments').update({ export_status: 'exporting' }).eq('id', a.id)
        try {
          const r = await exportAssignment(admin, a.id)
          if (r.ok) { await admin.from('submission_assignments').update({ export_status: 'done', exported_at: new Date().toISOString(), export_error: '' }).eq('id', a.id); summary.push({ id: a.id, ok: true, classes: r.results?.length || 0 }) }
          else { await admin.from('submission_assignments').update({ export_status: 'error', export_error: r.error || '' }).eq('id', a.id); summary.push({ id: a.id, ok: false, error: r.error }) }
        } catch (e) { await admin.from('submission_assignments').update({ export_status: 'error', export_error: String(e) }).eq('id', a.id); summary.push({ id: a.id, ok: false, error: String(e) }) }
      }
      return json({ ok: true, processed: summary.length, summary })
    }

    const authHeader = req.headers.get('Authorization') || ''
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return json({ error: '로그인이 필요합니다.' }, 401)
    if (!(await checkAdmin(admin, user))) return json({ error: '관리자만 가능합니다.' }, 403)
    const body = await req.json().catch(() => ({}))
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
