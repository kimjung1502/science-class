// 학생이 실험 페이지(스펙트럼 관찰 / 이상기체 상태 방정식)에 올린 사진·서술형 응답이
// 그 실험과 무관한(장난) 제출인지 Google Gemini(무료 등급)로 가볍게 1차 확인한다.
// 과학적으로 완벽한지 채점하지 않음 — "아무 사진/아무 글"만 걸러내는 용도.
// 실험 페이지는 학생 로그인이 없으므로 인증 없이(공개 anon key만으로) 호출 가능.
//
// Gemini API 키는 Edge Function 시크릿 GEMINI_API_KEY 에 둔다(권장).
//   supabase secrets set GEMINI_API_KEY=... 또는 대시보드 Edge Functions > Secrets
// (없으면 app_config.gemini_api_key 를 서비스롤로 조회해 폴백)
//
// 입출력 형식: { contextId?, items: [...] } → { results: [{key, ok, reason}] }
//
// ── 이상기체 기획서 §8.4 (A)안 ────────────────────────────────────────────────
//  · contextId 허용목록('spectrum' | 'ideal_gas'). 미전송이면 'spectrum' 폴백
//    → 기존 스펙트럼_실험_페이지.html(contextId 없이 호출)이 그대로 통과(하위 호환).
//  · 시스템 지침·key 허용목록·expect 문구를 전부 '서버가' contextId+key 로 선택.
//    클라이언트가 보낸 expect 는 무시한다(공개 anon 함수 = 프롬프트 주입 통로 차단).
//  · 공개 함수 방어: items 12개 초과 400 / 중복 key 400 / kind 허용목록 /
//    text 2,000자 / imageBase64 7,000,000자 + mediaType 허용목록 / 본문 32 MB /
//    IP당 분당 120회(학교 공용 NAT 전제 — 반 30명 × 동시 4회 버스트 수용).
//  · 위반은 400(또는 429) — 클라이언트는 unavailable(fail-open) 처리한다.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPA_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// 무료 등급·비전·JSON 스키마 지원. 더 가볍게: 'gemini-2.5-flash-lite'
const GEMINI_MODEL = 'gemini-2.5-flash'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

/* ═════════════════ PURE VALIDATION BEGIN ═════════════════
   이 구간은 Deno API 를 전혀 쓰지 않는다. tests-idealgas/edge-validate.test.mjs 가
   BEGIN~END 사이를 그대로 잘라 Node 에서 실행해 검증한다
   (= 테스트한 코드와 배포되는 코드가 문자 단위로 동일).
   ═══════════════════════════════════════════════════════ */

/* ─────────────────────── 확정 상한(§8.4) ─────────────────────── */
const MAX_ITEMS = 12
const MAX_TEXT_CHARS = 2_000
const MAX_IMAGE_B64_CHARS = 7_000_000      // wire 필드 imageBase64 문자열 기준(원본 ≈5 MB)
const MAX_BODY_BYTES = 32 * 1024 * 1024    // 요청 본문 전체 32 MB
// (하위 호환 우선 §8.4: 장당 imageBase64 7,000,000자를 통과하는 요청은 4장 합계도 통과해야 한다.
//  4 × 7 M자 = 28 MB + JSON 오버헤드 여유 → 32 MB. v1.14 에서 20 → 32 MB 로 갱신)
const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const RATE_PER_MIN = 120                   // IP당 분당 — 학교 공용 NAT 전제

/* ─────────────────────── contextId 별 서버 지침 ─────────────────────── */
const COMMON_POLICY = [
  "각 항목이 '이 실험과 무관하거나 성의 없이 아무거나 낸 것'인지만 판단해.",
  '과학적으로 정확한지는 채점하지 마 — 실험과 관련 있고 성의 있게 시도한 흔적이 있으면 통과(ok=true).',
  "글은 한두 글자의 의미 없는 답(예: 'ㅇㅇ', 'ㅁㄴㅇㄹ', '없음', 숫자만, 이모지만)이거나 질문과 전혀 무관한 내용이면 ok=false.",
  '판단이 애매하면 학생에게 불리하지 않게 ok=true로 통과시켜.',
  'reason은 ok=false일 때만 학생이 이해할 한국어 한 줄(20자 이내), ok=true면 빈 문자열.',
  '입력으로 준 각 항목(key)에 대해 정확히 하나씩 결과를 만들어. 항목 순서·key를 그대로 사용해.',
]

type Ctx = {
  system: string
  kinds: ReadonlyArray<'photo' | 'text'>
  expect: Record<string, string>
}

const CONTEXTS: Record<string, Ctx> = {
  // ── 기존 스펙트럼 페이지(하위 호환) — 현행 클라이언트의 expect 문구를 그대로 서버로 이관 ──
  spectrum: {
    system: [
      '너는 과학 실험(스펙트럼 관찰) 활동지를 채점 전에 걸러주는 1차 보조 도구야.',
      ...COMMON_POLICY.slice(0, 2),
      '사진은 실제로 그 대상(빛·스펙트럼 띠·분광기 등)을 찍었는지만 보고, 화질·구도·선명도는 신경 쓰지 마.',
      ...COMMON_POLICY.slice(2),
    ].join('\n'),
    kinds: ['photo', 'text'],
    expect: {
      slitWide: "간이 분광기 슬릿을 '넓게' 두고 빛(광원)을 촬영해 스펙트럼 띠가 보이는 사진",
      slitNarrow: "간이 분광기 슬릿을 '좁게' 두고 빛을 촬영해 스펙트럼 선이 더 또렷하게 보이는 사진",
      bulb: '백열등 빛을 분광기로 촬영한 스펙트럼 사진',
      sun: '태양 빛을 분광기로 촬영한 스펙트럼 사진(태양을 직접 찍은 사진이 아니라 분광된 빛의 사진)',
      obsCommon: '백열등과 태양의 스펙트럼을 관찰한 공통점 서술',
      obsDiff: '백열등과 태양의 스펙트럼을 관찰한 차이점 서술',
    },
  },
  // ── 이상기체 상태 방정식(§8.4 표 그대로) — 전부 text, 사진 없음 ──
  ideal_gas: {
    system: [
      '너는 과학 실험(이상기체 상태 방정식 — 실린더 입자 운동 시뮬레이션) 활동지를 채점 전에 걸러주는 1차 보조 도구야.',
      ...COMMON_POLICY.slice(0, 2),
      "'확인할 것'은 정답 요건이 아니라 '어떤 질문에 대한 답인지' 알려주는 관련성 맥락일 뿐이야.",
      '과학적으로 틀린 관계를 쓴 답이라도 그 질문에 대한 성의 있는 시도면 ok=true.',
      '무성의(자모 나열·한 글자)·장난·전혀 무관한 내용만 ok=false.',
      ...COMMON_POLICY.slice(2),
    ].join('\n'),
    kinds: ['text'],
    expect: {
      // predict.reason 은 문항별 3키로 분리됨(클라이언트 v1.15) — 옛 키는 캐시된 구버전 클라이언트 호환용으로 유지
      'predict.reason': '실험 전 P·V·T 관계 예상(3문항)에 대한 이유 서술 — 나름의 근거를 댄 시도면 통과',
      'predict.reasonPv': '온도 일정에서 세게 누르면 부피가 어떻게 될지 예상한 이유 — 나름의 근거를 댄 시도면 통과',
      'predict.reasonVt': '압력 일정에서 가열하면 부피가 어떻게 될지 예상한 이유 — 나름의 근거를 댄 시도면 통과',
      'predict.reasonPt': '부피 고정에서 가열하면 압력이 어떻게 될지 예상한 이유 — 나름의 근거를 댄 시도면 통과',
      'boyle.q1': '온도 일정에서 압력을 2배로 하면 부피가 어떻게 되는지(P–V 관계)에 대한 답',
      'boyle.q2': '표의 P×V 값이 어떻게 되는지(경향)에 대한 답',
      'charles.relation': '온도를 올리면 부피가 왜 커지는지를 입자 운동으로 설명하려는 시도',
      'gaylussac.relation': '부피가 고정인데 온도를 올리면 압력이 왜 오르는지를 설명하려는 시도',
      'assess.a1': '막은 주사기가 잘 안 눌리는 까닭을 기체 압력·입자로 설명하려는 시도',
      'assess.a2': '여름에 타이어가 터질 수 있는 까닭을 온도·압력으로 설명하려는 시도',
      'assess.a3': '온도 상승 시 압력이 커지는 이유를 설명하려는 시도 — 낱말 포함 요건은 AI가 판정하지 않음(클라이언트 로컬 판정)',
    },
  },
}

// Gemini responseSchema (OpenAPI 부분집합, type 은 대문자 enum)
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    results: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          key: { type: 'STRING' },
          ok: { type: 'BOOLEAN' },
          reason: { type: 'STRING' },
        },
        required: ['key', 'ok', 'reason'],
      },
    },
  },
  required: ['results'],
}

type Item = {
  key: string
  kind: 'photo' | 'text'
  expect?: string          // 무시한다(서버가 contextId+key 로 선택)
  text?: string
  imageBase64?: string
  mediaType?: string
}

/** 요청 검증 — 통과하면 { ctx, items }, 위반이면 { error, status } */
export function validateRequest(body: unknown): { ctx: Ctx; ctxId: string; items: Item[] } | { error: string; status: number } {
  const b = (body ?? {}) as Record<string, unknown>

  // contextId: 미전송이면 spectrum 폴백(하위 호환), 허용목록 밖·비정상 길이는 400
  const rawCtx = b.contextId
  if (rawCtx !== undefined && (typeof rawCtx !== 'string' || rawCtx.length > 32)) {
    return { error: 'contextId 형식이 올바르지 않습니다.', status: 400 }
  }
  const ctxId = (rawCtx as string | undefined) ?? 'spectrum'
  const ctx = CONTEXTS[ctxId]
  if (!ctx) return { error: '허용되지 않은 contextId 입니다.', status: 400 }

  if (!Array.isArray(b.items)) return { error: 'items 가 없습니다.', status: 400 }
  const raw = b.items as unknown[]
  // 자르지 않고 400 거부(§8.4)
  if (raw.length > MAX_ITEMS) return { error: `items 는 최대 ${MAX_ITEMS}개까지 보낼 수 있습니다.`, status: 400 }

  const items: Item[] = []
  const seen = new Set<string>()
  for (const r of raw) {
    if (!r || typeof r !== 'object') return { error: 'items 항목 형식이 올바르지 않습니다.', status: 400 }
    const it = r as Record<string, unknown>
    const key = it.key
    if (typeof key !== 'string' || !key) return { error: 'items[].key 가 없습니다.', status: 400 }
    if (!Object.prototype.hasOwnProperty.call(ctx.expect, key)) {
      return { error: `허용되지 않은 key 입니다: ${key}`, status: 400 }
    }
    if (seen.has(key)) return { error: `중복된 key 입니다: ${key}`, status: 400 }
    seen.add(key)

    const kind = it.kind
    if (kind !== 'photo' && kind !== 'text') return { error: 'items[].kind 가 올바르지 않습니다.', status: 400 }
    if (!ctx.kinds.includes(kind)) return { error: `이 실험에서는 ${kind} 항목을 받지 않습니다.`, status: 400 }

    if (kind === 'text') {
      const text = it.text
      if (text !== undefined && typeof text !== 'string') return { error: 'items[].text 형식이 올바르지 않습니다.', status: 400 }
      if (typeof text === 'string' && text.length > MAX_TEXT_CHARS) {
        return { error: `서술은 항목당 ${MAX_TEXT_CHARS}자를 넘을 수 없습니다.`, status: 400 }
      }
      items.push({ key, kind, text: (text as string | undefined) ?? '' })
    } else {
      const img = it.imageBase64
      if (typeof img !== 'string' || !img) return { error: 'items[].imageBase64 가 없습니다.', status: 400 }
      if (img.length > MAX_IMAGE_B64_CHARS) {
        return { error: `사진 한 장은 base64 ${MAX_IMAGE_B64_CHARS}자를 넘을 수 없습니다.`, status: 400 }
      }
      const mt = it.mediaType
      if (mt !== undefined && typeof mt !== 'string') return { error: 'items[].mediaType 형식이 올바르지 않습니다.', status: 400 }
      const mediaType = (mt as string | undefined) || 'image/jpeg'
      if (!ALLOWED_MEDIA.includes(mediaType)) return { error: `허용되지 않은 mediaType 입니다: ${mediaType}`, status: 400 }
      items.push({ key, kind, imageBase64: img, mediaType })
    }
  }
  return { ctx, ctxId, items }
}

/* ─────────────────────── IP 빈도 제한 (인스턴스 로컬) ─────────────────────── */
const hits = new Map<string, number[]>()
export function rateLimited(ip: string, now = Date.now()): boolean {
  const win = now - 60_000
  const arr = (hits.get(ip) || []).filter((t) => t > win)
  arr.push(now)
  hits.set(ip, arr)
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => t > win)) hits.delete(k)
  }
  return arr.length > RATE_PER_MIN
}
/* ═════════════════ PURE VALIDATION END ═════════════════ */

async function getApiKey(): Promise<string | null> {
  const env = Deno.env.get('GEMINI_API_KEY')
  if (env) return env
  try {
    const admin = createClient(SUPA_URL, SERVICE)
    const { data } = await admin.from('app_config').select('gemini_api_key').eq('id', 1).maybeSingle()
    return (data as { gemini_api_key?: string } | null)?.gemini_api_key ?? null
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST만 허용됩니다.' }, 405)
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown'
    if (rateLimited(ip)) return json({ error: '요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요.' }, 429)

    const len = Number(req.headers.get('content-length') || 0)
    if (len > MAX_BODY_BYTES) return json({ error: '요청 본문이 너무 큽니다.' }, 400)

    const rawBody = await req.text()
    if (rawBody.length > MAX_BODY_BYTES) return json({ error: '요청 본문이 너무 큽니다.' }, 400)
    let body: unknown = {}
    try { body = JSON.parse(rawBody) } catch { return json({ error: 'JSON 파싱 실패.' }, 400) }

    const v = validateRequest(body)
    if ('error' in v) return json({ error: v.error }, v.status)
    const { ctx, items } = v
    if (!items.length) return json({ results: [] })

    const apiKey = await getApiKey()
    if (!apiKey) return json({ error: 'Gemini API 키가 설정되지 않았습니다.' }, 400)

    const parts: Record<string, unknown>[] = [{ text: '항목 목록:' }]
    for (const [i, it] of items.entries()) {
      // expect 는 요청값이 아니라 서버 매핑에서만 가져온다(프롬프트 주입 차단)
      parts.push({ text: `\n[${i + 1}] key=${it.key} / 확인할 것: ${ctx.expect[it.key] || ''}` })
      if (it.kind === 'photo' && it.imageBase64) {
        parts.push({ inlineData: { mimeType: it.mediaType || 'image/jpeg', data: it.imageBase64 } })
      } else if (it.kind === 'text') {
        parts.push({ text: `학생 응답: ${JSON.stringify(it.text ?? '')}` })
      }
    }

    const gReq = {
      systemInstruction: { parts: [{ text: ctx.system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(gReq),
    })
    const out = await r.json()
    if (!r.ok) return json({ error: 'Gemini API 오류: ' + (out?.error?.message || r.status) }, 400)

    const cand = out?.candidates?.[0]
    if (cand?.finishReason && cand.finishReason !== 'STOP') {
      // SAFETY / RECITATION / MAX_TOKENS 등으로 중단된 경우
      return json({ error: 'Gemini 응답이 중단되었습니다(' + cand.finishReason + ').' }, 400)
    }
    const text: string = (cand?.content?.parts || [])
      .map((p: { text?: string }) => p.text || '')
      .join('')
    if (!text) return json({ error: '확인 결과가 비어있습니다.' }, 400)

    let parsed: { results?: unknown }
    try {
      parsed = JSON.parse(text)
    } catch {
      return json({ error: '결과 파싱 실패.' }, 400)
    }
    // 응답 검증: 요청 items 에 없는 key·중복은 버린다(클라이언트가 unavailable 처리)
    const allowed = new Set(items.map((i) => i.key))
    const got = new Set<string>()
    const results = (Array.isArray(parsed.results) ? parsed.results : []).filter((x: unknown) => {
      const o = x as { key?: unknown; ok?: unknown }
      if (typeof o?.key !== 'string' || typeof o?.ok !== 'boolean') return false
      if (!allowed.has(o.key) || got.has(o.key)) return false
      got.add(o.key)
      return true
    })
    return json({ results })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
