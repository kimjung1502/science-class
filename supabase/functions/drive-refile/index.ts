// 잘못 생긴 과목 폴더를 매핑된 자리로 합치고, 이름이 겹치는 폴더를 하나로 정리한다.
// 관리자 전용, 필요할 때만 부른다.
//
// 왜 필요한가: subjects.material_folder 가 비어 있던 과목은 업로드 때 과목명 그대로
// 폴더가 만들어졌다('통합과학 1', '화학'). 매핑을 채워도 이미 만들어진 폴더와 그 안의
// 파일은 제자리로 돌아오지 않는다.
//
// 파일 id 는 바뀌지 않는다 → materials.storage_path 도, 학생이 여는 링크도 그대로 산다.
// 빈 껍데기 폴더는 휴지통으로만 보낸다(완전삭제 아님 — 잘못되면 되돌릴 수 있게).
//
// ⚠ 이름으로 폴더를 찾을 때 files.list 의 `name='...'` 질의를 쓰지 않는다.
//   그 질의가 "01. 통합과학" 같은 이름을 못 찾아 폴더를 중복 생성한 적이 있다(2026-08-08).
//   대신 부모의 자식을 통째로 받아 JS 에서 이름을 맞춘다 — 질의 문법·색인에 기대지 않는다.
//   그리고 API 오류는 삼키지 않고 던진다. 조회 실패를 "없음"으로 읽으면 중복이 생긴다.
//
// 모드: ?probe=1 진단만 · ?dedupe=1 이름 겹치는 폴더 합치기 · 그 외 매핑대로 정리
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

async function isAdminReq(req: Request, admin: any): Promise<boolean> {
  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
  const { data: { user } } = await caller.auth.getUser()
  if (!user) return false
  const { data } = await admin.from('admins').select('id').eq('auth_user_id', user.id).maybeSingle()
  return !!data
}

async function getDriveToken(admin: any, cfg: any): Promise<string> {
  if (cfg.access_token && cfg.token_expiry && new Date(cfg.token_expiry).getTime() > Date.now() + 60000) return cfg.access_token
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.client_id, client_secret: cfg.client_secret, refresh_token: cfg.refresh_token, grant_type: 'refresh_token' }),
  })
  const t = await r.json(); if (!r.ok || !t.access_token) throw new Error('token refresh failed')
  await admin.from('google_drive_credentials').update({ access_token: t.access_token, token_expiry: new Date(Date.now() + (t.expires_in || 3500) * 1000).toISOString() }).eq('id', 1)
  return t.access_token
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
type Node = { id: string; name: string; mimeType: string; createdTime?: string }

// 부모의 자식 전부(페이지네이션 포함). 오류는 던진다 — 삼키면 "없음"으로 오해된다.
async function children(token: string, parentId: string): Promise<Node[]> {
  const out: Node[] = []
  let pageToken = ''
  do {
    const q = `trashed=false and '${parentId}' in parents`
    const u = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`
      + `&fields=nextPageToken,files(id,name,mimeType,createdTime)&pageSize=1000&spaces=drive&supportsAllDrives=true`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')
    const r = await fetch(u, { headers: auth(token) })
    const d = await r.json()
    if (!r.ok) throw new Error(`드라이브 목록 조회 실패 ${r.status}: ${JSON.stringify(d).slice(0, 160)}`)
    out.push(...((d.files || []) as Node[]))
    pageToken = d.nextPageToken || ''
  } while (pageToken)
  return out
}
const folderNamed = (kids: Node[], name: string) =>
  kids.filter((c) => c.mimeType === FOLDER_MIME && c.name === name)
       .sort((a, b) => String(a.createdTime || '').localeCompare(String(b.createdTime || '')))

async function findFolder(token: string, name: string, parentId: string): Promise<string | null> {
  const hit = folderNamed(await children(token, parentId), name)   // 여럿이면 가장 오래된 것
  return hit.length ? hit[0].id : null
}
async function ensureFolder(token: string, name: string, parentId: string): Promise<string> {
  const found = await findFolder(token, name, parentId)
  if (found) return found
  const r = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  })
  const d = await r.json(); if (!r.ok) throw new Error('폴더 생성 실패'); return d.id
}
async function moveTo(token: string, fileId: string, fromId: string, toId: string) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?addParents=${toId}&removeParents=${fromId}&supportsAllDrives=true&fields=id`,
    { method: 'PATCH', headers: auth(token) })
  if (!r.ok) throw new Error('이동 실패 ' + r.status)
}
async function trash(token: string, fileId: string) {
  await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
    method: 'PATCH', headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
}

// src 의 자식들을 dst 로 옮긴다. 같은 이름의 폴더가 이미 있으면 그 안으로 파고들어 합친다.
// 덮어쓰지 않고 합치는 게 중요하다 — 같은 대단원 폴더가 양쪽에 있을 수 있다.
async function mergeInto(token: string, srcId: string, dstId: string, moved: { files: number; folders: number }) {
  const dstKids = await children(token, dstId)
  for (const c of await children(token, srcId)) {
    if (c.mimeType === FOLDER_MIME) {
      const twin = folderNamed(dstKids, c.name)[0]
      if (twin) { await mergeInto(token, c.id, twin.id, moved); await trash(token, c.id) }
      else { await moveTo(token, c.id, srcId, dstId); moved.folders++ }
    } else {
      await moveTo(token, c.id, srcId, dstId); moved.files++
    }
  }
}

// 수업자료 뿌리: 학교 › 수업자료 › 개정 — uploadMaterialToDrive 가 쓰는 경로와 같아야 한다.
async function findBase(admin: any, token: string) {
  const { data: cfg } = await admin.from('google_drive_credentials').select('school_name, curriculum').eq('id', 1).maybeSingle()
  let base: string | null = await findFolder(token, cfg?.school_name || '학교', 'root')
  if (base) base = await findFolder(token, '수업자료', base)
  if (base && cfg?.curriculum) base = await findFolder(token, cfg.curriculum, base)
  return base
}

// 같은 이름 폴더가 여럿이면 가장 오래된 것으로 합친다(중복 생성 사고 복구용).
async function dedupe(token: string, parentId: string) {
  const byName = new Map<string, Node[]>()
  for (const c of await children(token, parentId)) {
    if (c.mimeType !== FOLDER_MIME) continue
    byName.set(c.name, [...(byName.get(c.name) || []), c])
  }
  const done: any[] = []
  for (const [name, list] of byName) {
    if (list.length < 2) continue
    const sorted = folderNamed(list, name)          // 오래된 순
    const keep = sorted[0]
    const moved = { files: 0, folders: 0 }
    for (const dup of sorted.slice(1)) {
      await mergeInto(token, dup.id, keep.id, moved)
      await trash(token, dup.id)
    }
    done.push({ name, kept: keep.id, merged: sorted.length - 1, ...moved })
  }
  return done
}

async function refileStrays(admin: any, token: string, base: string, dryRun: boolean) {
  const { data: subs } = await admin.from('subjects').select('name, material_folder').order('sort_order')
  const plan: any[] = []
  for (const s of (subs || [])) {
    const target = String(s.material_folder || '').trim()
    if (!target || target === s.name) continue           // 매핑이 없거나 과목명과 같으면 정리할 게 없다
    const stray = await findFolder(token, s.name, base)  // 과목명 그대로 생긴 폴더
    if (!stray) continue

    const kids = await children(token, stray)
    if (dryRun) { plan.push({ subject: s.name, into: target, children: kids.length }); continue }

    let parent = base
    for (const seg of target.split('/').map((x) => x.trim()).filter(Boolean)) parent = await ensureFolder(token, seg, parent)
    if (parent === stray) continue                       // 이미 제자리

    const moved = { files: 0, folders: 0 }
    await mergeInto(token, stray, parent, moved)
    await trash(token, stray)
    plan.push({ subject: s.name, into: target, ...moved })
  }
  return plan
}

// 진단: 매핑에 적힌 폴더가 실제로 찾아지는지, 이름이 겹치는 게 있는지 그대로 보여 준다.
async function probe(admin: any, token: string, base: string) {
  const { data: subs } = await admin.from('subjects').select('name, material_folder').order('sort_order')
  const kids = await children(token, base)
  const dups = [...new Set(kids.filter((c) => c.mimeType === FOLDER_MIME)
    .filter((c, _i, a) => a.filter((x) => x.name === c.name).length > 1).map((c) => c.name))]
  const rows: any[] = []
  for (const s of (subs || [])) {
    const target = String(s.material_folder || '').trim()
    if (!target) continue
    const first = target.split('/')[0].trim()
    const hits = folderNamed(kids, first)
    rows.push({ subject: s.name, target, firstSegment: first, found: hits.length, ids: hits.map((h) => h.id) })
  }
  return { baseChildren: kids.length, duplicateNames: dups, rows }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(url, service)
    if (!(await isAdminReq(req, admin))) return json({ error: '관리자만 가능합니다.' }, 403)
    const { data: cfg } = await admin.from('google_drive_credentials').select('*').eq('id', 1).maybeSingle()
    if (!cfg?.refresh_token) return json({ error: '구글 드라이브가 연결되어 있지 않습니다.' }, 400)
    const token = await getDriveToken(admin, cfg)

    const base = await findBase(admin, token)
    if (!base) return json({ error: '수업자료 폴더를 찾지 못했습니다(학교 이름·교육과정 설정을 확인하세요).' }, 400)

    const p = new URL(req.url).searchParams
    if (p.get('probe') === '1')  return json({ ok: true, probe: await probe(admin, token, base) })
    if (p.get('dedupe') === '1') return json({ ok: true, deduped: await dedupe(token, base) })

    const dryRun = p.get('dry') === '1'
    return json({ ok: true, dry: dryRun, moved: await refileStrays(admin, token, base, dryRun) })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
