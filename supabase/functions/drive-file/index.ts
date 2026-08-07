// 사이트가 선생님 구글 드라이브에 올린 '수업자료' 파일을 브라우저가 CORS fetch로 받을 수 있게
// 스트리밍하는 프록시. (드라이브 웹 링크는 CORS·원본 바이트를 안 주므로 PDF 판서 뷰어가 못 읽음)
//
// 보안:
//  · materials 에 'gdrive:<id>'(사이트가 올린 것) 또는 'gdriveref:<id>'(선생님이 이미 갖고 있던 걸
//    Picker 로 고른 것)로 등록된 파일만 서빙한다 — 임의 id 조회 불가.
//  · teacher_only·공개기간 밖이면 관리자 JWT 필수.
//  · 드라이브 파일은 이제 공유 권한을 걸지 않는다(전부 비공개). 그래서 이 프록시가 유일한 통로이고,
//    여기 검사를 우회할 방법이 없다. 예전엔 '링크가 있는 모든 사용자'로 열어 둬서 드라이브 직링크로
//    이 검사를 전부 건너뛸 수 있었다.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL')!
const anon = Deno.env.get('SUPABASE_ANON_KEY')!
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
function json(o: unknown, status = 200) { return new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } }) }

async function getDriveToken(admin: any, cfg: any): Promise<string> {
  if (cfg.access_token && cfg.token_expiry && new Date(cfg.token_expiry).getTime() > Date.now() + 60000) return cfg.access_token
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cfg.client_id, client_secret: cfg.client_secret, refresh_token: cfg.refresh_token, grant_type: 'refresh_token' }) })
  const t = await r.json(); if (!r.ok || !t.access_token) throw new Error('token refresh failed')
  await admin.from('google_drive_credentials').update({ access_token: t.access_token, token_expiry: new Date(Date.now() + (t.expires_in || 3500) * 1000).toISOString() }).eq('id', 1)
  return t.access_token
}

async function isAdminReq(req: Request, admin: any): Promise<boolean> {
  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
  const { data: { user } } = await caller.auth.getUser()
  if (!user) return false
  const { data: byEmail } = await admin.from('admins').select('email').eq('email', user.email).maybeSingle()
  if (byEmail) return true
  const { data: byUid } = await admin.from('admins').select('email').eq('auth_user_id', user.id).maybeSingle()
  return !!byUid
}

// 예전에 자료마다 걸어 두던 '링크가 있는 모든 사용자 보기' 권한을 되돌린다.
// 코드에서 공유를 없애도 이미 걸린 권한은 남으므로, 한 번 훑어서 지워야 한다.
// (관리자 화면의 "기존 공유 링크 회수" 버튼이 부른다. 실수로 다시 공유됐을 때도 쓸 수 있다.)
async function unshareAll(admin: any, token: string) {
  const { data: mats } = await admin.from('materials')
    .select('id, name, storage_path')
    .or('storage_path.like.gdrive:%,storage_path.like.gdriveref:%')
  const ids = [...new Set((mats || []).map((m: any) => String(m.storage_path).split(':')[1]).filter(Boolean))]
  let revoked = 0, alreadyPrivate = 0
  const failed: string[] = []
  for (const fid of ids) {
    try {
      const pr = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fid)}/permissions?fields=permissions(id,type)&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
      const pd = await pr.json()
      if (!pr.ok) { failed.push(fid); continue }
      const open = (pd.permissions || []).filter((p: any) => p.type === 'anyone' || p.type === 'domain')
      if (!open.length) { alreadyPrivate++; continue }
      for (const p of open) {
        const dr = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fid)}/permissions/${encodeURIComponent(p.id)}?supportsAllDrives=true`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
        if (dr.ok) revoked++; else failed.push(fid)
      }
    } catch (_e) { failed.push(fid) }
  }
  return { checked: ids.length, revoked, alreadyPrivate, failed }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const u = new URL(req.url)

    if (u.searchParams.get('op') === 'unshare') {
      const admin = createClient(url, service)
      if (!(await isAdminReq(req, admin))) return json({ error: '관리자만 가능합니다.' }, 403)
      const { data: cfg } = await admin.from('google_drive_credentials').select('*').eq('id', 1).maybeSingle()
      if (!cfg?.refresh_token) return json({ error: '구글 드라이브가 연결되어 있지 않습니다.' }, 400)
      return json({ ok: true, ...(await unshareAll(admin, await getDriveToken(admin, cfg))) })
    }

    const id = u.searchParams.get('id') || ''
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return json({ error: '잘못된 파일 id 입니다.' }, 400)

    const admin = createClient(url, service)
    const { data: mat } = await admin.from('materials').select('id, teacher_only, original_filename, visible_from, visible_until').in('storage_path', ['gdrive:' + id, 'gdriveref:' + id]).maybeSingle()
    if (!mat) return json({ error: '등록된 자료가 아닙니다.' }, 404)

    // 공개 기간 밖이면 teacher_only와 동일하게 교사만 접근
    const now = Date.now()
    const outOfWindow = (mat.visible_from && new Date(mat.visible_from).getTime() > now)
      || (mat.visible_until && new Date(mat.visible_until).getTime() < now)
    if (mat.teacher_only || outOfWindow) {
      if (!(await isAdminReq(req, admin))) {
        const hasAuth = !!(req.headers.get('Authorization') || '').replace(/^Bearer\s*/i, '')
        return json({ error: hasAuth ? (mat.teacher_only ? '교사만 볼 수 있는 자료입니다.' : '지금은 공개 기간이 아닙니다.') : '로그인이 필요합니다.' }, hasAuth ? 403 : 401)
      }
    }

    const { data: cfg } = await admin.from('google_drive_credentials').select('*').eq('id', 1).maybeSingle()
    if (!cfg?.refresh_token) return json({ error: '구글 드라이브가 연결되어 있지 않습니다.' }, 400)
    const token = await getDriveToken(admin, cfg)

    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
    if (!r.ok) return json({ error: '드라이브에서 파일을 받지 못했습니다 (' + r.status + ')' }, 502)

    const headers: Record<string, string> = {
      ...cors,
      'Content-Type': r.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'private, max-age=300',
    }
    const len = r.headers.get('content-length'); if (len) headers['Content-Length'] = len
    if (mat.original_filename) headers['Content-Disposition'] = `inline; filename*=UTF-8''${encodeURIComponent(mat.original_filename)}`
    return new Response(r.body, { status: 200, headers })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
