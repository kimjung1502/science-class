import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL')!
const anon = Deno.env.get('SUPABASE_ANON_KEY')!
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SCOPE = 'openid email https://www.googleapis.com/auth/drive.file'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(o: unknown, status = 200) { return new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } }) }
function emailFromIdToken(idToken?: string): string {
  try { if (!idToken) return ''; const p = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); const pad = p + '==='.slice((p.length + 3) % 4); return JSON.parse(atob(pad)).email || '' } catch { return '' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return json({ error: '로그인이 필요합니다.' }, 401)
    const admin = createClient(url, service)
    const { data: byEmail } = await admin.from('admins').select('email').eq('email', user.email).maybeSingle()
    let isAdmin = !!byEmail
    if (!isAdmin) { const { data: byUid } = await admin.from('admins').select('email').eq('auth_user_id', user.id).maybeSingle(); isAdmin = !!byUid }
    if (!isAdmin) return json({ error: '관리자만 가능합니다.' }, 403)

    const { data: cfg } = await admin.from('google_drive_credentials').select('*').eq('id', 1).maybeSingle()
    const u = new URL(req.url)
    const op = u.searchParams.get('op') || 'status'

    if (op === 'status') {
      return json({ ok: true, connected: !!(cfg && cfg.refresh_token), email: cfg?.email || '', hasClient: !!(cfg && cfg.client_id), pickerReady: !!(cfg && cfg.picker_api_key), school: cfg?.school_name || '', year: cfg?.acad_year || '', semester: cfg?.semester || '', curriculum: cfg?.curriculum || '' })
    }

    if (op === 'savesettings') {
      const b = await req.json().catch(() => ({}))
      await admin.from('google_drive_credentials').update({
        school_name: (b.school || '').toString().trim() || null,
        acad_year: (b.year || '').toString().trim() || null,
        semester: (b.semester || '').toString().trim() || null,
        curriculum: (b.curriculum || '').toString().trim() || null,
      }).eq('id', 1)
      return json({ ok: true })
    }

    if (op === 'accesstoken') {
      if (!cfg?.refresh_token || !cfg?.client_id || !cfg?.client_secret) return json({ error: '드라이브가 연결되어 있지 않습니다.' }, 400)
      if (!cfg?.picker_api_key) return json({ error: 'Picker API 키가 설정되지 않았습니다. (관리자가 등록 필요)' }, 400)
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cfg.client_id, client_secret: cfg.client_secret, refresh_token: cfg.refresh_token, grant_type: 'refresh_token' }) })
      const tok = await r.json()
      if (!r.ok) return json({ error: '토큰 갱신 실패: ' + (tok.error_description || tok.error || r.status) }, 400)
      return json({ ok: true, access_token: tok.access_token, api_key: cfg.picker_api_key, app_id: (cfg.client_id || '').split('-')[0] })
    }

    if (op === 'authurl') {
      if (!cfg?.client_id) return json({ error: '클라이언트 ID가 설정되지 않았습니다.' }, 400)
      const redirectUri = u.searchParams.get('redirect_uri') || ''
      const state = u.searchParams.get('state') || ''
      const p = new URLSearchParams({ client_id: cfg.client_id, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state })
      return json({ ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}` })
    }

    if (op === 'exchange') {
      if (!cfg?.client_id || !cfg?.client_secret) return json({ error: '클라이언트 설정이 없습니다.' }, 400)
      const body = await req.json().catch(() => ({}))
      const code = body.code, redirectUri = body.redirect_uri
      if (!code || !redirectUri) return json({ error: 'code, redirect_uri가 필요합니다.' }, 400)
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: cfg.client_id, client_secret: cfg.client_secret, redirect_uri: redirectUri, grant_type: 'authorization_code' }) })
      const tok = await tokenRes.json()
      if (!tokenRes.ok) return json({ error: '토큰 교환 실패: ' + (tok.error_description || tok.error || tokenRes.status) }, 400)
      if (!tok.refresh_token) return json({ error: '리프레시 토큰을 받지 못했습니다. 구글 계정 연결을 해제 후 다시 시도하세요.' }, 400)
      const email = emailFromIdToken(tok.id_token)
      const expiry = new Date(Date.now() + (tok.expires_in || 3500) * 1000).toISOString()
      const { error } = await admin.from('google_drive_credentials').update({ refresh_token: tok.refresh_token, access_token: tok.access_token, token_expiry: expiry, email, connected_at: new Date().toISOString() }).eq('id', 1)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, email })
    }

    if (op === 'disconnect') {
      await admin.from('google_drive_credentials').update({ refresh_token: null, access_token: null, token_expiry: null, email: null, root_folder_id: null }).eq('id', 1)
      return json({ ok: true })
    }

    return json({ error: '알 수 없는 op' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
