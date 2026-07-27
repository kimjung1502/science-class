import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL')!
const anon = Deno.env.get('SUPABASE_ANON_KEY')!
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(o: unknown, status = 200) { return new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } }) }

// 마감 판정: due_at(정밀) 우선, 없으면 due_date 당일 끝(KST). 둘 다 없으면 마감 없음.
function isClosed(asg: any): boolean {
  const now = Date.now()
  if (asg.due_at) return new Date(asg.due_at).getTime() < now
  if (asg.due_date) return new Date(asg.due_date + 'T23:59:59.999+09:00').getTime() < now
  return false
}

function sanitizeName(s: string): string {
  return String(s || '').replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'untitled'
}

// ---------- Google Drive (학생 제출 파일을 선생님 드라이브에 저장) ----------
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
// 같은 이름 파일이 있으면 내용 교체(재제출), 없으면 새로 만든다
async function uploadDrive(token: string, folderId: string, filename: string, bytes: Uint8Array, mime: string): Promise<{ id: string; link: string }> {
  const q = `trashed=false and name='${q1(filename)}' and '${folderId}' in parents`
  const fr = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`, { headers: { Authorization: `Bearer ${token}` } })
  const fd = await fr.json(); const existingId = fd.files && fd.files[0] ? fd.files[0].id : null
  if (existingId) {
    const pr = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media&fields=id,webViewLink`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime }, body: bytes })
    const pd = await pr.json(); if (!pr.ok) throw new Error('drive update failed'); return { id: pd.id, link: pd.webViewLink }
  }
  const boundary = '----driveBoundarySubmit7MA4YWxk'
  const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: filename, parents: [folderId] })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`
  const body = new Blob([pre, bytes, `\r\n--${boundary}--`])
  const ur = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body })
  const ud = await ur.json(); if (!ur.ok) throw new Error('drive upload failed'); return { id: ud.id, link: ud.webViewLink }
}

// 학생이 이 과목에서 수강하는 분반 판정 (class_subjects ∩ student_classes)
async function resolveClass(admin: any, studentId: string, subjectId: string): Promise<{ classId: string; className: string } | null> {
  const { data: scs } = await admin.from('class_subjects').select('class_id').eq('subject_id', subjectId)
  const subjClassIds = new Set((scs || []).map((x: any) => x.class_id))
  const { data: mycs } = await admin.from('student_classes').select('class_id').eq('student_id', studentId)
  const classId = (mycs || []).map((x: any) => x.class_id).find((id: string) => subjClassIds.has(id))
  if (!classId) return null
  const { data: cls } = await admin.from('classes').select('name').eq('id', classId).maybeSingle()
  return { classId, className: cls?.name || '미분류' }
}

async function checkAdmin(admin: any, user: any): Promise<boolean> {
  const { data: byEmail } = await admin.from('admins').select('email').eq('email', user.email).maybeSingle()
  if (byEmail) return true
  const { data: byUid } = await admin.from('admins').select('email').eq('auth_user_id', user.id).maybeSingle()
  return !!byUid
}

function collectPaths(answers: any): string[] {
  const out: string[] = []
  if (answers && typeof answers === 'object') {
    for (const k of Object.keys(answers)) {
      const v = answers[k]
      if (Array.isArray(v)) { v.forEach((f: any) => { if (f && typeof f.storage_path === 'string') out.push(f.storage_path) }) }
      else if (v && typeof v === 'object' && typeof v.storage_path === 'string') out.push(v.storage_path)
    }
  }
  return out
}

async function buildRoster(admin: any, subjectId: string, assignmentId: string) {
  const { data: scs } = await admin.from('class_subjects').select('class_id').eq('subject_id', subjectId)
  const classIds = (scs || []).map((x: any) => x.class_id)
  if (!classIds.length) return []
  const { data: classes } = await admin.from('classes').select('id, name, sort_order').in('id', classIds)
  const { data: scRows } = await admin.from('student_classes').select('student_id, class_id').in('class_id', classIds)
  const studentIds = [...new Set((scRows || []).map((x: any) => x.student_id))]
  const { data: students } = studentIds.length ? await admin.from('students').select('id, name, student_number').in('id', studentIds).eq('is_active', true) : { data: [] as any[] }
  const stMap = new Map((students || []).map((s: any) => [s.id, s]))
  const { data: subs } = await admin.from('submissions').select('student_id, submitted_at, updated_at').eq('assignment_id', assignmentId)
  const subMap = new Map((subs || []).map((s: any) => [s.student_id, s]))
  return (classes || []).sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((c: any) => {
    const members = (scRows || []).filter((r: any) => r.class_id === c.id && stMap.has(r.student_id)).map((r: any) => {
      const st: any = stMap.get(r.student_id)
      const sub: any = subMap.get(r.student_id)
      return { student_id: r.student_id, name: st.name || '', student_number: st.student_number || '', submitted: !!sub, submitted_at: sub?.submitted_at || null, updated_at: sub?.updated_at || null }
    }).sort((a: any, b: any) => String(a.student_number).localeCompare(String(b.student_number), 'ko', { numeric: true }))
    return { class_id: c.id, class_name: c.name, total: members.length, submitted: members.filter((m: any) => m.submitted).length, students: members }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return json({ error: '로그인이 필요합니다.' }, 401)
    const admin = createClient(url, service)
    const u = new URL(req.url)
    const op = u.searchParams.get('op') || 'submit'

    // ---------- 학생: 폼 응답 제출/수정 ----------
    if (op === 'submit') {
      const { data: student } = await admin.from('students').select('id, name, student_number, is_active').eq('auth_user_id', user.id).maybeSingle()
      if (!student) return json({ error: '학생만 제출할 수 있습니다.' }, 403)
      if (student.is_active === false) return json({ error: '비활성(자퇴) 계정입니다.' }, 403)
      const body = await req.json().catch(() => ({}))
      const assignmentId = body.assignment_id
      if (!assignmentId) return json({ error: 'assignment_id가 필요합니다.' }, 400)
      const { data: asg } = await admin.from('submission_assignments').select('id, subject_id, is_active, due_at, due_date').eq('id', assignmentId).maybeSingle()
      if (!asg || !asg.is_active) return json({ error: '제출 과제를 찾을 수 없습니다.' }, 404)
      if (isClosed(asg)) return json({ error: '마감되어 제출/수정할 수 없습니다.' }, 403)
      const cls = await resolveClass(admin, student.id, asg.subject_id)
      if (!cls) return json({ error: '이 과목을 수강하지 않아 제출할 수 없습니다.' }, 403)
      const answers = (body.answers && typeof body.answers === 'object') ? body.answers : {}
      const nowIso = new Date().toISOString()
      const { data: prev } = await admin.from('submissions').select('id').eq('assignment_id', assignmentId).eq('student_id', student.id).maybeSingle()
      if (prev) {
        const { error } = await admin.from('submissions').update({ student_name: student.name, class_id: cls.classId, class_name: cls.className, answers, mode: 'form', updated_at: nowIso }).eq('id', prev.id)
        if (error) return json({ error: error.message }, 400)
      } else {
        const { error } = await admin.from('submissions').insert({ assignment_id: assignmentId, student_id: student.id, student_name: student.name, class_id: cls.classId, class_name: cls.className, answers, mode: 'form', submitted_at: nowIso, updated_at: nowIso })
        if (error) return json({ error: error.message }, 400)
      }
      return json({ ok: true })
    }

    // ---------- 학생: 파일 항목 업로드 ----------
    // 구글 드라이브 연결 시: 선생님 드라이브(학교›년도›학기›과목›분반›과제명)에
    // '학번_이름_항목.ext'로 저장하고 { drive_id }를 반환. 미연결·실패 시 기존 버킷 폴백.
    if (op === 'upload-file') {
      const { data: student } = await admin.from('students').select('id, name, student_number, is_active').eq('auth_user_id', user.id).maybeSingle()
      if (!student) return json({ error: '학생만 업로드할 수 있습니다.' }, 403)
      if (student.is_active === false) return json({ error: '비활성(자퇴) 계정입니다.' }, 403)
      const assignmentId = u.searchParams.get('assignment_id')
      const fieldId = (u.searchParams.get('field_id') || 'file').replace(/[^A-Za-z0-9_-]/g, '') || 'file'
      const filename = decodeURIComponent(u.searchParams.get('filename') || 'file')
      if (!assignmentId) return json({ error: 'assignment_id가 필요합니다.' }, 400)
      const { data: asg } = await admin.from('submission_assignments').select('id, subject_id, title, is_active, due_at, due_date').eq('id', assignmentId).maybeSingle()
      if (!asg || !asg.is_active) return json({ error: '제출 과제를 찾을 수 없습니다.' }, 404)
      if (isClosed(asg)) return json({ error: '마감되어 업로드할 수 없습니다.' }, 403)
      const cls = await resolveClass(admin, student.id, asg.subject_id)
      if (!cls) return json({ error: '이 과목을 수강하지 않습니다.' }, 403)
      const bytes = new Uint8Array(await req.arrayBuffer())
      if (!bytes.length) return json({ error: '빈 파일입니다.' }, 400)
      if (bytes.length > 25 * 1024 * 1024) return json({ error: '파일이 너무 큽니다(최대 25MB).' }, 400)
      const dot = filename.lastIndexOf('.'); const ext = (dot > 0 ? filename.slice(dot + 1) : 'dat').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'dat'
      const sn = (student.student_number || student.id).toString().replace(/[^A-Za-z0-9_-]/g, '')
      const contentType = req.headers.get('content-type') || 'application/octet-stream'

      const { data: gcfg } = await admin.from('google_drive_credentials').select('*').eq('id', 1).maybeSingle()
      if (gcfg?.refresh_token && gcfg?.client_id && gcfg?.client_secret) {
        try {
          const token = await getDriveToken(admin, gcfg)
          const { data: subj } = await admin.from('subjects').select('name').eq('id', asg.subject_id).maybeSingle()
          const fSchool = await ensureFolder(token, gcfg.school_name || '학교', 'root')
          const fYear = await ensureFolder(token, gcfg.acad_year || '년도', fSchool)
          const fSem = await ensureFolder(token, gcfg.semester || '학기', fYear)
          const fSubj = await ensureFolder(token, subj?.name || '과목', fSem)
          const fClass = await ensureFolder(token, cls.className || '미분류', fSubj)
          const fAsg = await ensureFolder(token, sanitizeName(asg.title || '과제'), fClass)
          const dfName = sanitizeName(`${student.student_number || sn}_${student.name || ''}_${fieldId}`) + '.' + ext
          const up = await uploadDrive(token, fAsg, dfName, bytes, contentType)
          return json({ ok: true, file: { file_name: filename, drive_id: up.id, size: bytes.length } })
        } catch (_e) { /* 드라이브 실패 → 아래 버킷 폴백(제출이 막히면 안 됨) */ }
      }

      const path = `${asg.subject_id}/${cls.classId}/${assignmentId}/${sn}/${fieldId}.${ext}`
      const { error: upErr } = await admin.storage.from('submissions').upload(path, bytes, { contentType, upsert: true })
      if (upErr) return json({ error: upErr.message }, 400)
      return json({ ok: true, file: { file_name: filename, storage_path: path, size: bytes.length } })
    }

    // ---------- 학생: 실험 페이지 결과(JSON) 제출 ----------
    // 자립형 실험 HTML 이 직접 부른다. 제출 과제(assignment) 없이 과목·분반만으로
    // 학교›년도›학기›과목›분반›<실험명> 에 '학번_이름.json' 으로 저장(같은 이름이면 내용 교체 = 재제출).
    if (op === 'experiment') {
      const { data: student } = await admin.from('students').select('id, name, student_number, is_active').eq('auth_user_id', user.id).maybeSingle()
      if (!student) return json({ error: '학생 계정으로 로그인해야 제출할 수 있습니다.' }, 403)
      if (student.is_active === false) return json({ error: '비활성(자퇴) 계정입니다.' }, 403)
      const body = await req.json().catch(() => ({}))
      const subjectId = String(body.subject_id || '')
      const title = sanitizeName(body.title || '실험')
      const bytes = new TextEncoder().encode(JSON.stringify(body.payload ?? null, null, 2))
      if (bytes.length < 3) return json({ error: '보낼 내용이 없습니다.' }, 400)
      if (bytes.length > 10 * 1024 * 1024) return json({ error: '결과가 너무 큽니다(최대 10MB).' }, 400)
      const { data: gcfg } = await admin.from('google_drive_credentials').select('*').eq('id', 1).maybeSingle()
      if (!(gcfg?.refresh_token && gcfg?.client_id && gcfg?.client_secret)) return json({ error: '선생님 드라이브가 연결되어 있지 않습니다.' }, 503)
      const cls = subjectId ? await resolveClass(admin, student.id, subjectId) : null
      const { data: subj } = subjectId ? await admin.from('subjects').select('name').eq('id', subjectId).maybeSingle() : { data: null }
      const token = await getDriveToken(admin, gcfg)
      let f = await ensureFolder(token, gcfg.school_name || '학교', 'root')
      f = await ensureFolder(token, gcfg.acad_year || '년도', f)
      f = await ensureFolder(token, gcfg.semester || '학기', f)
      f = await ensureFolder(token, sanitizeName(subj?.name || '과목'), f)
      f = await ensureFolder(token, sanitizeName(cls?.className || '미분류'), f)
      f = await ensureFolder(token, title, f)
      const fname = sanitizeName(`${student.student_number || ''}_${student.name || ''}`) + '.json'
      const up = await uploadDrive(token, f, fname, bytes, 'application/json')
      return json({ ok: true, file_name: fname, drive_id: up.id })
    }

    // ---------- 다운로드 서명 (관리자 또는 본인) ----------
    if (op === 'sign') {
      const path = u.searchParams.get('path') || ''
      const assignmentId = u.searchParams.get('assignment_id') || ''
      const nameParam = u.searchParams.get('name')
      const downloadName = nameParam ? decodeURIComponent(nameParam) : undefined
      if (!path) return json({ error: 'path가 필요합니다.' }, 400)
      let allowed = await checkAdmin(admin, user)
      if (!allowed && assignmentId) {
        const { data: st } = await admin.from('students').select('id').eq('auth_user_id', user.id).maybeSingle()
        if (st) {
          const { data: mine } = await admin.from('submissions').select('answers').eq('assignment_id', assignmentId).eq('student_id', st.id).maybeSingle()
          if (mine) allowed = collectPaths(mine.answers).includes(path)
        }
      }
      if (!allowed) return json({ error: '권한이 없습니다.' }, 403)
      const { data: signed, error } = await admin.storage.from('submissions').createSignedUrl(path, 300, downloadName ? { download: downloadName } : {})
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, url: signed?.signedUrl })
    }

    // ---------- 교사: 응답 명부(제출/미제출) ----------
    if (op === 'roster') {
      if (!(await checkAdmin(admin, user))) return json({ error: '관리자만 가능합니다.' }, 403)
      const assignmentId = u.searchParams.get('assignment_id')
      if (!assignmentId) return json({ error: 'assignment_id가 필요합니다.' }, 400)
      const { data: asg } = await admin.from('submission_assignments').select('id, subject_id').eq('id', assignmentId).maybeSingle()
      if (!asg) return json({ error: '과제를 찾을 수 없습니다.' }, 404)
      const classes = await buildRoster(admin, asg.subject_id, assignmentId)
      return json({ ok: true, classes })
    }

    return json({ error: '알 수 없는 op' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
