// §8.4 Edge Function 검증 테스트 (배포 없이 로컬)
//   node tests-idealgas/edge-validate.test.mjs
// index.ts 의 PURE VALIDATION BEGIN~END 구간을 그대로 잘라 Node 로 실행한다
// (= 테스트한 코드와 배포되는 코드가 문자 단위로 동일). Deno API 는 그 구간에 없다.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'supabase', 'functions', 'check-experiment-response', 'index.ts');
const BEGIN = '/* ═════════════════ PURE VALIDATION BEGIN';
const END = '/* ═════════════════ PURE VALIDATION END ═════════════════ */';

const full = fs.readFileSync(SRC, 'utf8');
const a = full.indexOf(BEGIN), b = full.indexOf(END);
if (a < 0 || b < 0) { console.error('PURE VALIDATION 마커를 찾지 못했습니다.'); process.exit(1); }
const block = full.slice(a, b + END.length);
if (/\bDeno\s*\./.test(block)) { console.error('순수 구간에 Deno API 가 섞였습니다.'); process.exit(1); }

const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'edgeval-')), 'pure.ts');
fs.writeFileSync(tmp, block + '\nexport { MAX_ITEMS, MAX_TEXT_CHARS, MAX_IMAGE_B64_CHARS, MAX_BODY_BYTES, ALLOWED_MEDIA, RATE_PER_MIN, CONTEXTS };\n');
const M = await import(pathToFileURL(tmp).href);
const { validateRequest, rateLimited, MAX_ITEMS, MAX_TEXT_CHARS, MAX_IMAGE_B64_CHARS, MAX_BODY_BYTES, ALLOWED_MEDIA, RATE_PER_MIN, CONTEXTS } = M;

let pass = 0, fail = 0;
const results = [];
function t(name, fn) {
  try { fn(); pass++; results.push({ name, ok: true }); console.log('  ✔ ' + name); }
  catch (e) { fail++; results.push({ name, ok: false, err: e.message }); console.log('  ✘ ' + name + '  → ' + e.message); }
}
function eq(got, want, what) { if (got !== want) throw new Error((what || '') + ' 기대 ' + JSON.stringify(want) + ' 실제 ' + JSON.stringify(got)); }
function isErr(r, needle) {
  if (!('error' in r)) throw new Error('400 을 기대했는데 통과함');
  if (needle && !r.error.includes(needle)) throw new Error('메시지에 "' + needle + '" 없음: ' + r.error);
  eq(r.status, 400, 'status');
}
function isOk(r) { if ('error' in r) throw new Error('통과를 기대했는데 거부: ' + r.error); }

const b64 = (n) => 'A'.repeat(n);

console.log('■ 확정 상한: items≤%d, text≤%d자, imageBase64≤%s자, 본문≤%s MB, mediaType=[%s], rate=%d/분',
  MAX_ITEMS, MAX_TEXT_CHARS, MAX_IMAGE_B64_CHARS.toLocaleString(), (MAX_BODY_BYTES / 1048576).toFixed(0), ALLOWED_MEDIA.join(', '), RATE_PER_MIN);

console.log('\n■ 하위 호환 — 현행 스펙트럼 페이지가 만드는 대표 payload (contextId 미전송)');
// 현행 페이지: FileReader.readAsDataURL 원본 사진 4장(리사이즈 없음) + 텍스트 2개
const PHOTO_BYTES = 5_000_000;                       // 대표 원본 사진 크기 — 장당 상한(7,000,000자)에 근접한 최악값
const PHOTO_B64 = Math.ceil(PHOTO_BYTES / 3) * 4;    // base64 팽창 ≈ 1.333배
const legacyPayload = {
  items: [
    { key: 'slitWide', kind: 'photo', imageBase64: b64(PHOTO_B64), mediaType: 'image/jpeg', expect: '클라이언트가 보낸 문구 — 서버는 무시해야 함' },
    { key: 'slitNarrow', kind: 'photo', imageBase64: b64(PHOTO_B64), mediaType: 'image/jpeg', expect: '무시' },
    { key: 'bulb', kind: 'photo', imageBase64: b64(PHOTO_B64), mediaType: 'image/png', expect: '무시' },
    { key: 'sun', kind: 'photo', imageBase64: b64(PHOTO_B64), mediaType: 'image/jpeg', expect: '무시' },
    { key: 'obsCommon', kind: 'text', text: '둘 다 여러 색이 이어진 띠로 보였다.', expect: '무시' },
    { key: 'obsDiff', kind: 'text', text: '태양 쪽에 검은 선이 보였다.', expect: '무시' },
  ],
};
const legacyBytes = Buffer.byteLength(JSON.stringify(legacyPayload));
console.log('   대표 payload: 사진 4장 × %s bytes(원본) → base64 %s자/장, 본문 %s MB',
  PHOTO_BYTES.toLocaleString(), PHOTO_B64.toLocaleString(), (legacyBytes / 1048576).toFixed(2));

t('contextId 미전송 → spectrum 폴백으로 통과', () => {
  const r = validateRequest(legacyPayload);
  isOk(r); eq(r.ctxId, 'spectrum'); eq(r.items.length, 6);
});
t('사진 4장 payload 가 imageBase64 상한 안에 있음', () => {
  if (PHOTO_B64 > MAX_IMAGE_B64_CHARS) throw new Error('사진 1장이 상한 초과');
});
t('사진 4장 payload 가 본문 상한 안에 있음', () => {
  if (legacyBytes > MAX_BODY_BYTES) throw new Error('본문 ' + (legacyBytes / 1048576).toFixed(1) + ' MB > 상한 ' + (MAX_BODY_BYTES / 1048576) + ' MB');
});
t('클라이언트가 보낸 expect 는 버려짐(서버가 contextId+key 로 선택)', () => {
  const r = validateRequest(legacyPayload);
  isOk(r);
  r.items.forEach((it) => { if ('expect' in it && it.expect !== undefined) throw new Error('expect 가 남아 있음'); });
  eq(r.ctx.expect.slitWide, "간이 분광기 슬릿을 '넓게' 두고 빛(광원)을 촬영해 스펙트럼 띠가 보이는 사진");
});
t('contextId:"spectrum" 명시도 동일하게 통과', () => {
  const r = validateRequest({ contextId: 'spectrum', items: legacyPayload.items });
  isOk(r); eq(r.ctxId, 'spectrum');
});
t('spectrum 시스템 지침에 사진 판정 규칙이 남아 있음', () => {
  if (!CONTEXTS.spectrum.system.includes('사진은 실제로 그 대상')) throw new Error('사진 규칙 누락');
  if (!CONTEXTS.spectrum.system.includes('스펙트럼 관찰')) throw new Error('실험명 누락');
});

console.log('\n■ ideal_gas');
// predict.reason(옛 공용 키)은 캐시된 구버전 클라이언트 호환용으로 유지, v1.15부터 문항별 3키 사용
const IG_KEYS = ['predict.reason', 'predict.reasonPv', 'predict.reasonVt', 'predict.reasonPt', 'boyle.q1', 'boyle.q2', 'charles.relation', 'gaylussac.relation', 'assess.a1', 'assess.a2', 'assess.a3'];
const igItems = IG_KEYS.map((k) => ({ key: k, kind: 'text', text: '입자가 더 자주 부딪혀서 그렇다고 생각한다.' }));
t('11개 key 전부 통과', () => { const r = validateRequest({ contextId: 'ideal_gas', items: igItems }); isOk(r); eq(r.items.length, 11); });
t('expect 매핑 11개가 §8.4 표와 일치', () => {
  const got = Object.keys(CONTEXTS.ideal_gas.expect).sort();
  eq(JSON.stringify(got), JSON.stringify(IG_KEYS.slice().sort()));
  eq(CONTEXTS.ideal_gas.expect['boyle.q2'], '표의 P×V 값이 어떻게 되는지(경향)에 대한 답');
  eq(CONTEXTS.ideal_gas.expect['charles.relation'], '온도를 올리면 부피가 왜 커지는지를 입자 운동으로 설명하려는 시도');
});
t('ideal_gas 판정 정책 = 정확성 채점 안 함 · expect 는 관련성 맥락', () => {
  const s = CONTEXTS.ideal_gas.system;
  if (!s.includes('과학적으로 정확한지는 채점하지 마')) throw new Error('상위 정책 누락');
  if (!s.includes('관련성 맥락')) throw new Error('expect 성격 설명 누락');
  if (!s.includes('과학적으로 틀린 관계를 쓴 답이라도')) throw new Error('오답 허용 문구 누락');
});
t('ideal_gas 는 photo 항목 거부 (kind 허용목록)', () => {
  isErr(validateRequest({ contextId: 'ideal_gas', items: [{ key: 'boyle.q1', kind: 'photo', imageBase64: b64(100), mediaType: 'image/jpeg' }] }), 'photo');
});
t('ideal_gas 에 spectrum key 를 보내면 거부', () => {
  isErr(validateRequest({ contextId: 'ideal_gas', items: [{ key: 'bulb', kind: 'text', text: 'x' }] }), '허용되지 않은 key');
});

console.log('\n■ 서버 검증 (공개 anon 함수 방어)');
t('허용목록 밖 contextId → 400', () => isErr(validateRequest({ contextId: 'hacked', items: igItems }), 'contextId'));
t('비정상 길이 contextId → 400', () => isErr(validateRequest({ contextId: 'x'.repeat(33), items: igItems }), 'contextId'));
t('contextId 가 문자열이 아니면 → 400', () => isErr(validateRequest({ contextId: 123, items: igItems }), 'contextId'));
t('items 12개 초과 → 자르지 않고 400', () => {
  const many = [];
  for (let i = 0; i < 13; i++) many.push({ key: IG_KEYS[i % 8], kind: 'text', text: 'a' });
  isErr(validateRequest({ contextId: 'ideal_gas', items: many }), MAX_ITEMS + '개');
});
t('items 정확히 12개는 통과(중복 없을 때만 가능하므로 11개로 확인)', () => {
  isOk(validateRequest({ contextId: 'ideal_gas', items: igItems }));
});
t('중복 key → 400', () => {
  isErr(validateRequest({ contextId: 'ideal_gas', items: [igItems[0], igItems[0]] }), '중복된 key');
});
t('허용목록 밖 kind → 400', () => {
  isErr(validateRequest({ contextId: 'ideal_gas', items: [{ key: 'boyle.q1', kind: 'video', text: 'a' }] }), 'kind');
});
t('text 2,000자 = 통과 / 2,001자 = 400', () => {
  isOk(validateRequest({ contextId: 'ideal_gas', items: [{ key: 'boyle.q1', kind: 'text', text: 'a'.repeat(MAX_TEXT_CHARS) }] }));
  isErr(validateRequest({ contextId: 'ideal_gas', items: [{ key: 'boyle.q1', kind: 'text', text: 'a'.repeat(MAX_TEXT_CHARS + 1) }] }), String(MAX_TEXT_CHARS));
});
t('imageBase64 7,000,000자 = 통과 / +1자 = 400', () => {
  isOk(validateRequest({ items: [{ key: 'bulb', kind: 'photo', imageBase64: b64(MAX_IMAGE_B64_CHARS), mediaType: 'image/jpeg' }] }));
  isErr(validateRequest({ items: [{ key: 'bulb', kind: 'photo', imageBase64: b64(MAX_IMAGE_B64_CHARS + 1), mediaType: 'image/jpeg' }] }), 'base64');
});
t('mediaType 허용목록 — jpeg/png/webp 통과, gif/svg 거부', () => {
  ['image/jpeg', 'image/png', 'image/webp'].forEach((mt) => {
    isOk(validateRequest({ items: [{ key: 'bulb', kind: 'photo', imageBase64: b64(10), mediaType: mt }] }));
  });
  ['image/gif', 'image/svg+xml', 'text/html'].forEach((mt) => {
    isErr(validateRequest({ items: [{ key: 'bulb', kind: 'photo', imageBase64: b64(10), mediaType: mt }] }), 'mediaType');
  });
});
t('mediaType 미전송 → image/jpeg 기본값', () => {
  const r = validateRequest({ items: [{ key: 'bulb', kind: 'photo', imageBase64: b64(10) }] });
  isOk(r); eq(r.items[0].mediaType, 'image/jpeg');
});
t('items 없음 / 배열 아님 → 400', () => {
  isErr(validateRequest({ contextId: 'ideal_gas' }), 'items');
  isErr(validateRequest({ contextId: 'ideal_gas', items: 'x' }), 'items');
});
t('items 빈 배열은 통과(호출부가 results:[] 반환)', () => {
  const r = validateRequest({ contextId: 'ideal_gas', items: [] }); isOk(r); eq(r.items.length, 0);
});

console.log('\n■ IP 빈도 제한 (분당 %d회)', RATE_PER_MIN);
t('분당 120회까지 허용, 121회째 차단', () => {
  const now = 1_700_000_000_000;
  for (let i = 0; i < RATE_PER_MIN; i++) {
    if (rateLimited('10.0.0.1', now + i)) throw new Error((i + 1) + '회째에 이미 차단됨');
  }
  if (!rateLimited('10.0.0.1', now + RATE_PER_MIN)) throw new Error('121회째가 차단되지 않음');
});
t('1분이 지나면 창이 비워짐', () => {
  const now = 1_800_000_000_000;
  for (let i = 0; i < RATE_PER_MIN; i++) rateLimited('10.0.0.2', now + i);
  if (!rateLimited('10.0.0.2', now + RATE_PER_MIN)) throw new Error('차단되어야 함');
  if (rateLimited('10.0.0.2', now + 61_000)) throw new Error('1분 뒤에도 차단됨');
});
t('IP 별로 독립', () => {
  const now = 1_900_000_000_000;
  for (let i = 0; i < RATE_PER_MIN + 5; i++) rateLimited('10.0.0.3', now + i);
  if (rateLimited('10.0.0.4', now)) throw new Error('다른 IP 가 영향을 받음');
});

console.log('\n════════════════════════════════════════════');
console.log(' Edge Function 검증: %d 통과 / %d 실패', pass, fail);
console.log('════════════════════════════════════════════');
process.exit(fail ? 1 : 0);
