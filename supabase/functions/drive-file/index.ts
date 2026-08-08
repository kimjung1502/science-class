// 수업자료·공지 첨부 파일을 여는 유일한 통로.
//
// 두 단계로 나뉜다.
//  ① op=link (로그인 필수) — 호출자 권한으로 materials/announcements 를 조회한다.
//     RLS 정책(materials_read / announcements_read)이 교사전용·공개기간·수강 과목을 한 번에
//     판정하므로 같은 규칙을 여기서 손으로 다시 짜지 않는다. 통과하면 5분짜리 링크를 준다.
//       · 드라이브 파일 → 아래 ②로 가는 서명 URL
//       · 버킷 파일     → Supabase Storage 서명 URL (이미 있는 기능을 다시 만들지 않는다)
//  ② GET ?id=&exp=&sig= — 서명과 만료만 검증하고 드라이브 바이트를 흘려보낸다.
//     <a href>·<iframe src> 는 Authorization 헤더를 실을 수 없어서 이 단계가 따로 필요하다.
//
// 예전 구조의 문제(전부 이 파일에서 해결):
//  · ②에 해당하는 경로가 아무 검사 없이 열려 있었다 — 파일 id 만 알면 로그인 없이 받아갔다.
//  · 수강 과목 검사가 아예 없어서 A과목 학생이 B과목 자료를 열 수 있었다.
//  · teacher_only·공개기간을 RLS 정책과 이 파일에서 각각 판정해 규칙이 두 벌이었다.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL')!
const anon = Deno.env.get('SUPABASE_ANON_KEY')!
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const LINK_TTL_MS = 5 * 60 * 1000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
function json(o: unknown, status = 200) { return new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } }) }

// ---------- 링크 서명 ----------
// 전용 시크릿을 새로 두지 않고 service_role 키에서 파생한다(설정 항목을 늘리지 않는다).
// 서명값만 링크에 실리고 키 자체는 어떤 응답에도 나가지 않는다.
let hmacKey: CryptoKey | null = null
const enc = new TextEncoder()
async function getKey(): Promise<CryptoKey> {
  if (!hmacKey) {
    hmacKey = await crypto.subtle.importKey('raw', enc.encode('drive-link:' + service),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
  }
  return hmacKey
}
async function sign(id: string, exp: number): Promise<string> {
  const b = await crypto.subtle.sign('HMAC', await getKey(), enc.encode(`${id}.${exp}`))
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('')
}
async function verifySig(id: string, expRaw: string, sig: string): Promise<boolean> {
  const exp = Number(expRaw)
  if (!Number.isFinite(exp) || exp < Date.now()) return false
  if (!/^[0-9a-f]+$/.test(sig) || sig.length % 2 !== 0) return false
  const bytes = new Uint8Array((sig.match(/../g) || []).map((h) => parseInt(h, 16)))
  // crypto.subtle.verify 는 상수시간 비교다 — 직접 === 로 맞추지 않는다.
  return await crypto.subtle.verify('HMAC', await getKey(), bytes, enc.encode(`${id}.${exp}`))
}

async function getDriveToken(admin: any, cfg: any): Promise<string> {
  if (cfg.access_token && cfg.token_expiry && new Date(cfg.token_expiry).getTime() > Date.now() + 60000) return cfg.access_token
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cfg.client_id, client_secret: cfg.client_secret, refresh_token: cfg.refresh_token, grant_type: 'refresh_token' }) })
  const t = await r.json(); if (!r.ok || !t.access_token) throw new Error('token refresh failed')
  await admin.from('google_drive_credentials').update({ access_token: t.access_token, token_expiry: new Date(Date.now() + (t.expires_in || 3500) * 1000).toISOString() }).eq('id', 1)
  return t.access_token
}

function callerOf(req: Request) {
  return createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
}

async function isAdminReq(req: Request, admin: any): Promise<boolean> {
  const { data: { user } } = await callerOf(req).auth.getUser()
  if (!user) return false
  // 관리자 판정은 auth_user_id 로만 한다 — DB 의 is_admin() 과 같은 기준.
  const { data } = await admin.from('admins').select('id').eq('auth_user_id', user.id).maybeSingle()
  return !!data
}

const driveIdOf = (p: string) =>
  p.startsWith('gdriveref:') ? p.slice(10) : p.startsWith('gdrive:') ? p.slice(7) : ''

// 예전에 자료마다 걸어 두던 '링크가 있는 모든 사용자 보기' 권한을 되돌린다.
// 코드에서 공유를 없애도 이미 걸린 권한은 남으므로, 한 번 훑어서 지워야 한다.
// (관리자 화면의 "기존 공유 링크 회수" 버튼이 부른다. 실수로 다시 공유됐을 때도 쓸 수 있다.)
async function unshareAll(admin: any, token: string) {
  const { data: mats } = await admin.from('materials')
    .select('id, name, storage_path')
    .or('storage_path.like.gdrive:%,storage_path.like.gdriveref:%')
  const ids = [...new Set((mats || []).map((m: any) => driveIdOf(String(m.storage_path))).filter(Boolean))]
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

// op=link 대상의 storage_path 를 호출자 권한으로 찾는다. 권한이 없으면 빈 문자열.
async function resolvePath(req: Request, u: URL): Promise<string> {
  const caller = callerOf(req)
  const matId = u.searchParams.get('material') || ''
  if (matId) {
    const { data } = await caller.from('materials').select('storage_path').eq('id', matId).limit(1)
    return data?.[0]?.storage_path || ''
  }
  const annId = u.searchParams.get('announcement') || ''
  if (annId) {
    const i = Number(u.searchParams.get('i') || '0')
    if (!Number.isInteger(i) || i < 0) return ''
    const { data } = await caller.from('announcements').select('attachments').eq('id', annId).limit(1)
    const atts = Array.isArray(data?.[0]?.attachments) ? data[0].attachments : []
    const f = atts[i]
    return (f && typeof f.storage_path === 'string') ? f.storage_path : ''
  }
  return ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const u = new URL(req.url)
    const op = u.searchParams.get('op') || ''

    if (op === 'unshare') {
      const admin = createClient(url, service)
      if (!(await isAdminReq(req, admin))) return json({ error: '관리자만 가능합니다.' }, 403)
      const { data: cfg } = await admin.from('google_drive_credentials').select('*').eq('id', 1).maybeSingle()
      if (!cfg?.refresh_token) return json({ error: '구글 드라이브가 연결되어 있지 않습니다.' }, 400)
      return json({ ok: true, ...(await unshareAll(admin, await getDriveToken(admin, cfg))) })
    }

    // ---------- ① 링크 발급 (로그인 필수, RLS 가 권한 판정) ----------
    if (op === 'link') {
      if (!req.headers.get('Authorization')) return json({ error: '로그인이 필요합니다.' }, 401)
      if (!u.searchParams.get('material') && !u.searchParams.get('announcement')) {
        return json({ error: 'material 또는 announcement 가 필요합니다.' }, 400)
      }
      const path = await resolvePath(req, u)
      // 없음과 권한 없음을 구분하지 않는다 — 구분하면 자료의 존재 여부를 확인해 주는 통로가 된다.
      if (!path) return json({ error: '볼 수 없는 자료입니다.' }, 403)

      const drive = driveIdOf(path)
      if (drive) {
        const exp = Date.now() + LINK_TTL_MS
        const q = `id=${encodeURIComponent(drive)}&exp=${exp}&sig=${await sign(drive, exp)}`
        return json({ ok: true, url: `${u.origin}${u.pathname}?${q}`, expires_at: new Date(exp).toISOString() })
      }
      const admin = createClient(url, service)
      const { data: signed, error } = await admin.storage.from('materials').createSignedUrl(path, LINK_TTL_MS / 1000)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true, url: signed?.signedUrl, expires_at: new Date(Date.now() + LINK_TTL_MS).toISOString() })
    }

    // ---------- ② 서명된 드라이브 바이트 ----------
    const id = u.searchParams.get('id') || ''
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return json({ error: '잘못된 파일 id 입니다.' }, 400)
    if (!(await verifySig(id, u.searchParams.get('exp') || '', u.searchParams.get('sig') || ''))) {
      return json({ error: '링크가 만료되었거나 올바르지 않습니다. 자료를 다시 열어 주세요.' }, 403)
    }

    // 권한은 ①에서 이미 판정했다. 여기서는 원본 파일 이름만 가져온다.
    const admin = createClient(url, service)
    const { data: mats } = await admin.from('materials')
      .select('original_filename').in('storage_path', ['gdrive:' + id, 'gdriveref:' + id]).limit(1)
    const originalFilename = mats?.[0]?.original_filename || ''

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
    if (originalFilename) headers['Content-Disposition'] = `inline; filename*=UTF-8''${encodeURIComponent(originalFilename)}`
    return new Response(r.body, { status: 200, headers })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
