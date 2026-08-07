// 수행평가 계획서 PDF → 수행평가 공지 폼 자동 채우기 (Claude API).
//
// 교사 전용이다. 학생은 부를 수 없고(관리자 JWT 검사), 학생 입력이 들어올 경로도 없다.
// 그래서 학생당 호출 쿼터는 두지 않았다 — 쓰는 사람이 선생님 한 명뿐이다.
//
// API 키: Vault 에 있고 get_api_key() 는 service_role 전용이라 여기서만 꺼낼 수 있다.
// 키는 응답에도 로그에도 절대 싣지 않는다. Anthropic 오류 메시지는 그대로 흘리지 않고
// 상태 코드만 전한다(오류 본문에 요청 일부가 되비칠 수 있어서).
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
  const { data: byEmail } = await admin.from('admins').select('email').eq('email', user.email).maybeSingle()
  if (byEmail) return true
  const { data: byUid } = await admin.from('admins').select('email').eq('auth_user_id', user.id).maybeSingle()
  return !!byUid
}

// 폼이 그대로 받아 쓰는 모양. 값을 못 찾으면 빈 문자열/빈 배열 — 지어내지 말라고 프롬프트에 박아 둔다.
const SCHEMA = {
  type: 'object',
  properties: {
    title:      { type: 'string', description: '수행평가 제목. 문서 제목 그대로.' },
    summary:    { type: 'string', description: '목록 카드에 보일 한두 문장 소개(300자 이내).' },
    status:     { type: 'string', enum: ['ongoing', 'upcoming', 'closed', ''], description: '문서에 시기가 없으면 빈 문자열.' },
    weight:     { type: 'string', description: '반영 비율. 예: "15%". 없으면 빈 문자열.' },
    tags:       { type: 'array', items: { type: 'string' }, description: '유형 태그. 예: ["보고서","실험"]. 3개 이내.' },
    start_date: { type: 'string', description: 'YYYY-MM-DD. 명시된 날짜가 없으면 빈 문자열(주차·월만 적혀 있으면 비운다).' },
    due_date:   { type: 'string', description: 'YYYY-MM-DD. 위와 같음.' },
    unit_name:  { type: 'string', description: '주어진 단원 목록에 있는 대단원 이름과 정확히 일치해야 한다. 못 고르면 빈 문자열.' },
    mid_name:   { type: 'string', description: '중단원 이름. 위와 같음.' },
    sub_name:   { type: 'string', description: '소단원 이름. 위와 같음.' },
    body:       { type: 'string', description: '세부 안내 — 평가 목적·방법·절차·유의사항을 학생이 읽을 문장으로. 문서에 있는 내용만.' },
    rubric: {
      type: 'array',
      description: '채점 기준표. 표의 가장 작은 칸 하나가 한 항목이다. 문서에 표가 없으면 빈 배열.',
      items: {
        type: 'object',
        properties: {
          group:    { type: 'string', description: '여러 줄에 걸쳐 병합된 상위 칸(예: "논술1", "실험 수행"). 병합 칸이 없으면 빈 문자열.' },
          element:  { type: 'string', description: '평가 요소. group 에 넣은 말은 여기 되풀이하지 않는다.' },
          points:   { type: 'string', description: '배점. 예: "10점"' },
          criteria: { type: 'string', description: '채점 기준' },
        },
        required: ['group', 'element', 'points', 'criteria'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'summary', 'status', 'weight', 'tags', 'start_date', 'due_date', 'unit_name', 'mid_name', 'sub_name', 'body', 'rubric'],
  additionalProperties: false,
}

function prompt(units: unknown, todayKst: string): string {
  return [
    '너는 고등학교 과학 교사의 조교다. 첨부한 PDF 는 수행평가 계획서다.',
    '이 문서에서 수행평가 공지에 넣을 항목을 뽑아 정해진 JSON 으로만 답하라.',
    '',
    '규칙:',
    '· 문서에 없는 내용은 지어내지 마라. 모르면 빈 문자열("") 또는 빈 배열([])을 넣는다.',
    '· 날짜는 문서에 연·월·일이 분명히 적힌 경우에만 YYYY-MM-DD 로 적는다.',
    '  "9월 3주", "2학기 중" 처럼 확정 날짜가 아니면 비워라.',
    `· 오늘은 ${todayKst}(한국 시간)이다. status 는 문서의 시기를 오늘 기준으로 판단해 정한다.`,
    '· body(세부 안내)는 학생이 읽을 글이다. 문서의 목적·방법·절차·유의사항을 정리하되,',
    '  표를 그대로 옮기지 말고 문장으로 풀어 써라. 채점 기준표는 rubric 에 따로 넣는다.',
    '· summary 는 목록에 짧게 뜨는 소개다. 한두 문장, 300자 이내.',
    '',
    'rubric(채점 기준표) 은 원본 표의 병합을 그대로 살려야 한다:',
    '· 한 칸이 여러 줄에 걸쳐 병합돼 있으면(예: "논술1" 이 두 줄을 덮는 경우)',
    '  그 줄들 전부의 group 에 같은 값("논술1")을 넣어라. 화면에서 다시 한 칸으로 합쳐진다.',
    '· group 에 넣은 말을 element 에 또 쓰지 마라. "논술1 - 화학이 …" 처럼 붙이지 말고',
    '  group="논술1", element="화학이 …" 로 나눈다.',
    '· 배점도 병합돼 있으면(여러 줄이 한 배점을 공유) 그 줄들에 같은 값을 되풀이해 넣어라.',
    '· 병합이 전혀 없는 표면 group 을 전부 빈 문자열로 둔다.',
    '',
    '단원 이름은 아래 목록에 있는 것과 글자까지 똑같이 골라야 한다.',
    '해당하는 단원이 없으면 비워라 — 비슷한 것을 억지로 고르지 마라.',
    JSON.stringify(units ?? [], null, 1),
  ].join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(url, service)
    if (!(await isAdminReq(req, admin))) return json({ error: '관리자만 사용할 수 있습니다.' }, 403)

    const body = await req.json().catch(() => ({}))
    const pdf = String(body.pdf_base64 || '')
    if (!pdf) return json({ error: 'PDF 가 없습니다.' }, 400)
    // base64 는 원본의 약 4/3. 15MB ≈ 원본 11MB 쯤 — 계획서 한 부로는 충분히 넉넉하다.
    if (pdf.length > 15 * 1024 * 1024) return json({ error: 'PDF 가 너무 큽니다(약 11MB 이하로 줄여 주세요).' }, 400)

    const { data: apiKey } = await admin.rpc('get_api_key', { p_provider: 'claude' })
    if (!apiKey) return json({ error: 'Claude API 키가 등록되어 있지 않습니다. 관리자 › API 키 탭에서 먼저 등록하세요.' }, 400)

    const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-opus-5',
        max_tokens: 16000,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } },
            { type: 'text', text: prompt(body.units, todayKst) },
          ],
        }],
      }),
    })

    if (!r.ok) {
      // 오류 본문에는 요청 내용이 되비칠 수 있어 그대로 넘기지 않는다.
      const detail = r.status === 401 ? 'API 키가 거부됐습니다(키를 다시 등록해 주세요).'
        : r.status === 429 ? '요청이 몰렸거나 사용 한도에 걸렸습니다. 잠시 뒤 다시 시도하세요.'
        : r.status === 400 ? 'PDF 를 읽지 못했습니다(암호가 걸렸거나 페이지가 너무 많은지 확인하세요).'
        : `Claude 응답 오류 (${r.status})`
      return json({ error: detail }, 502)
    }

    const out = await r.json()
    // 사고(thinking) 블록이 앞에 올 수 있어 content[0] 이 아니라 text 블록을 찾는다.
    const text = (out.content || []).find((b: any) => b.type === 'text')?.text || ''
    let data: any
    try { data = JSON.parse(text) } catch { return json({ error: 'Claude 응답을 해석하지 못했습니다. 다시 시도해 주세요.' }, 502) }

    return json({ ok: true, data, usage: out.usage || null })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
