// 학생이 실험 페이지(예: 스펙트럼 관찰 실험)에 올린 사진·서술형 응답이
// 이 실험과 무관한(장난) 제출인지 Claude로 가볍게 1차 확인한다.
// 과학적으로 완벽한지 채점하지 않음 — "아무 사진/아무 글"만 걸러내는 용도.
// 실험 페이지는 학생 로그인이 없으므로 인증 없이(공개 anon key만으로) 호출 가능.
// API 키는 assessment-from-pdf와 동일하게 app_config.anthropic_api_key(서비스롤로만 조회)를 사용.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const url = Deno.env.get('SUPABASE_URL')!
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          ok: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['key', 'ok', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
}

type Item = {
  key: string
  kind: 'photo' | 'text'
  expect?: string
  text?: string
  imageBase64?: string
  mediaType?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST만 허용됩니다.' }, 405)
  try {
    const body = await req.json().catch(() => ({}))
    const items: Item[] = Array.isArray(body?.items) ? body.items.slice(0, 12) : []
    if (!items.length) return json({ results: [] })

    const admin = createClient(url, service)
    const { data: cfg } = await admin.from('app_config').select('anthropic_api_key').eq('id', 1).maybeSingle()
    const apiKey = cfg?.anthropic_api_key
    if (!apiKey) return json({ error: 'Anthropic API 키가 설정되지 않았습니다.' }, 400)

    const content: Record<string, unknown>[] = [
      {
        type: 'text',
        text: [
          '너는 과학 실험(스펙트럼 관찰) 활동지를 채점 전에 걸러주는 1차 보조 도구야.',
          "각 항목이 '이 실험과 무관하거나 성의 없이 아무거나 낸 것'인지만 판단해.",
          '과학적으로 정확한지는 채점하지 마 — 실험과 관련 있고 성의 있게 시도한 흔적이 있으면 통과(ok=true).',
          '사진은 실제로 그 대상(빛·스펙트럼 띠·분광기 등)을 찍었는지만 보고, 화질·구도·선명도는 신경 쓰지 마.',
          "글은 한두 글자의 의미 없는 답(예: 'ㅇㅇ', 'ㅁㄴㅇㄹ', '없음', 숫자만, 이모지만)이거나 질문과 전혀 무관한 내용이면 ok=false.",
          '판단이 애매하면 학생에게 불리하지 않게 ok=true로 통과시켜.',
          'reason은 ok=false일 때만 학생이 이해할 한국어 한 줄(20자 이내), ok=true면 빈 문자열.',
          '',
          '항목 목록:',
        ].join('\n'),
      },
    ]
    for (const [i, it] of items.entries()) {
      content.push({ type: 'text', text: `\n[${i + 1}] key=${it.key} / 확인할 것: ${it.expect || ''}` })
      if (it.kind === 'photo' && it.imageBase64) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: it.mediaType || 'image/jpeg', data: it.imageBase64 },
        })
      } else if (it.kind === 'text') {
        content.push({ type: 'text', text: `학생 응답: ${JSON.stringify(it.text ?? '')}` })
      }
    }

    const aReq = {
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      thinking: { type: 'disabled' },
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content }],
    }
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(aReq),
    })
    const out = await r.json()
    if (!r.ok) return json({ error: 'Claude API 오류: ' + (out?.error?.message || r.status) }, 400)
    if (out.stop_reason === 'refusal') return json({ error: 'Claude가 요청을 거절했습니다(안전 정책).' }, 400)
    const textBlock = (out.content || []).find((b: { type: string }) => b.type === 'text')
    if (!textBlock) return json({ error: '확인 결과가 비어있습니다.' }, 400)
    let parsed: { results?: unknown }
    try {
      parsed = JSON.parse(textBlock.text)
    } catch {
      return json({ error: '결과 파싱 실패.' }, 400)
    }
    return json({ results: parsed.results || [] })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
