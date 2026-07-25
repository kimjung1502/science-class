// 학생이 실험 페이지(예: 스펙트럼 관찰 실험)에 올린 사진·서술형 응답이
// 이 실험과 무관한(장난) 제출인지 Google Gemini(무료 등급)로 가볍게 1차 확인한다.
// 과학적으로 완벽한지 채점하지 않음 — "아무 사진/아무 글"만 걸러내는 용도.
// 실험 페이지는 학생 로그인이 없으므로 인증 없이(공개 anon key만으로) 호출 가능.
//
// Gemini API 키는 Edge Function 시크릿 GEMINI_API_KEY 에 둔다(권장).
//   supabase secrets set GEMINI_API_KEY=... 또는 대시보드 Edge Functions > Secrets
// (없으면 app_config.gemini_api_key 를 서비스롤로 조회해 폴백)
//
// 입력/출력 형식은 이전 Claude 버전과 동일하다({ items: [...] } → { results: [{key, ok, reason}] }).
// 그래서 실험 페이지(HTML) 쪽은 바꿀 필요가 없다.

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

const SYSTEM_TEXT = [
  '너는 과학 실험(스펙트럼 관찰) 활동지를 채점 전에 걸러주는 1차 보조 도구야.',
  "각 항목이 '이 실험과 무관하거나 성의 없이 아무거나 낸 것'인지만 판단해.",
  '과학적으로 정확한지는 채점하지 마 — 실험과 관련 있고 성의 있게 시도한 흔적이 있으면 통과(ok=true).',
  '사진은 실제로 그 대상(빛·스펙트럼 띠·분광기 등)을 찍었는지만 보고, 화질·구도·선명도는 신경 쓰지 마.',
  "글은 한두 글자의 의미 없는 답(예: 'ㅇㅇ', 'ㅁㄴㅇㄹ', '없음', 숫자만, 이모지만)이거나 질문과 전혀 무관한 내용이면 ok=false.",
  '판단이 애매하면 학생에게 불리하지 않게 ok=true로 통과시켜.',
  'reason은 ok=false일 때만 학생이 이해할 한국어 한 줄(20자 이내), ok=true면 빈 문자열.',
  '입력으로 준 각 항목(key)에 대해 정확히 하나씩 결과를 만들어. 항목 순서·key를 그대로 사용해.',
].join('\n')

type Item = {
  key: string
  kind: 'photo' | 'text'
  expect?: string
  text?: string
  imageBase64?: string
  mediaType?: string
}

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
    const body = await req.json().catch(() => ({}))
    const items: Item[] = Array.isArray(body?.items) ? body.items.slice(0, 12) : []
    if (!items.length) return json({ results: [] })

    const apiKey = await getApiKey()
    if (!apiKey) return json({ error: 'Gemini API 키가 설정되지 않았습니다.' }, 400)

    const parts: Record<string, unknown>[] = [{ text: '항목 목록:' }]
    for (const [i, it] of items.entries()) {
      parts.push({ text: `\n[${i + 1}] key=${it.key} / 확인할 것: ${it.expect || ''}` })
      if (it.kind === 'photo' && it.imageBase64) {
        parts.push({
          inlineData: { mimeType: it.mediaType || 'image/jpeg', data: it.imageBase64 },
        })
      } else if (it.kind === 'text') {
        parts.push({ text: `학생 응답: ${JSON.stringify(it.text ?? '')}` })
      }
    }

    const gReq = {
      systemInstruction: { parts: [{ text: SYSTEM_TEXT }] },
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
    return json({ results: parsed.results || [] })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
