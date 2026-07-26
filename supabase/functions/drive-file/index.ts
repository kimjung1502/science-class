// 사이트가 선생님 구글 드라이브에 올린 '수업자료' 파일을 브라우저가 CORS fetch로 받을 수 있게
// 스트리밍하는 프록시. (드라이브 웹 링크는 CORS·원본 바이트를 안 주므로 PDF 판서 뷰어가 못 읽음)
//
// 보안:
//  · materials 테이블에 storage_path = 'gdrive:<id>' 로 등록된 파일만 서빙한다(임의 id 조회 불가).
//  · teacher_only 자료는 관리자 JWT 필수. 그 외 자료는 어차피 '링크가 있는 모든 사용자 보기'로
//    학생에게 공개되는 파일이라 로그인 없이 서빙한다.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const u = new URL(req.url)
    const id = u.searchParams.get('id') || ''
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return json({ error: '잘못된 파일 id 입니다.' }, 400)

    const admin = createClient(url, service)
    const { data: mat } = await admin.from('materials').select('id, teacher_only, original_filename').eq('storage_path', 'gdrive:' + id).maybeSingle()
    if (!mat) return json({ error: '등록된 자료가 아닙니다.' }, 404)

    if (mat.teacher_only) {
      const authHeader = req.headers.get('Authorization') || ''
      const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
      const { data: { user } } = await caller.auth.getUser()
      if (!user) return json({ error: '로그인이 필요합니다.' }, 401)
      const { data: byEmail } = await admin.from('admins').select('email').eq('email', user.email).maybeSingle()
      let isAdmin = !!byEmail
      if (!isAdmin) { const { data: byUid } = await admin.from('admins').select('email').eq('auth_user_id', user.id).maybeSingle(); isAdmin = !!byUid }
      if (!isAdmin) return json({ error: '교사만 볼 수 있는 자료입니다.' }, 403)
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
