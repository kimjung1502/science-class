// 실험 페이지 정적 점검 — 구문 검사만으로는 못 잡는 '로드 시 터지는' 실수를 막는다.
//   node tests-idealgas/page-lint.mjs
//
// 실제로 겪은 회귀:
//   applyReadOnly 에서 $$(...) 가 $(...) 로 바뀌어 .forEach 가 null 에 걸렸고,
//   init() 이 중단되면서 requestAnimationFrame 이 호출되지 않아 캔버스가 전부 빈 화면이 됐다.
//   구문은 멀쩡했기 때문에 new Function() 검사로는 잡히지 않았다.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { DEFAULT_HTML } = createRequire(import.meta.url)('./load-engine.js');

const html = fs.readFileSync(DEFAULT_HTML, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let fail = 0;
const check = (name, bad, hint) => {
  if (bad.length) {
    fail++;
    console.log('  ✘ ' + name);
    bad.slice(0, 6).forEach((b) => console.log('      ' + b));
    if (hint) console.log('      → ' + hint);
  } else console.log('  ✔ ' + name);
};

console.log('■ 실험 페이지 정적 점검:', DEFAULT_HTML.split(/[\\/]/).slice(-1)[0]);

/* 1) 구문 */
const syntax = [];
scripts.forEach((src, i) => { try { new Function(src); } catch (e) { syntax.push('script#' + (i + 1) + ': ' + e.message); } });
check('인라인 스크립트 구문', syntax);

/* 2) 단일 선택자 $() 결과에 배열 메서드를 쓰는 실수 ($$ 오타) */
const body = scripts.join('\n');
const arrayMisuse = [...body.matchAll(/(^|[^$\w])\$\([^;]*?\)\.(forEach|map|filter|slice|some|every|reduce)\b/g)]
  .map((m) => m[0].trim().slice(0, 90));
check('$() 결과에 배열 메서드 사용 없음', arrayMisuse, '$$() 오타일 가능성 — querySelector 는 배열이 아님');

/* 3) 코드가 참조하는 #id 가 마크업에 실제로 있는지(삭제된 요소 참조 방지) */
const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const declaredIds = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const referenced = new Set([
  ...[...body.matchAll(/\$\('#([A-Za-z][\w.-]*)'\)/g)].map((m) => m[1]),
  ...[...body.matchAll(/getElementById\('([A-Za-z][\w.-]*)'\)/g)].map((m) => m[1]),
]);
// 런타임에 만들어 붙이는 id 는 제외(템플릿 문자열로 생성됨)
const runtimeIds = [...body.matchAll(/id="([A-Za-z][\w.-]*)"/g)].map((m) => m[1]);
runtimeIds.forEach((id) => declaredIds.add(id));
// AI 배지(ai-<key>)는 마크업에 개별 id 로 존재하므로 위에서 잡힘
const missing = [...referenced].filter((id) => !declaredIds.has(id) && !/^ai-/.test(id));
check('코드가 참조하는 #id 가 마크업에 존재', missing, '삭제된 요소를 아직 참조하고 있음');

/* 4) 자립형 제약 — 외부 자산 0 (§9.2) */
const external = [...html.matchAll(/(?:src|href)="https?:[^"]*"/g)].map((m) => m[0]);
check('외부 CDN·자산 참조 없음', external);

/* 5) 엔진 블록 마커 존재 (테스트가 잘라 쓰는 구간) */
check('엔진 블록 마커', html.includes('IDEALGAS ENGINE BEGIN') && html.includes('IDEALGAS ENGINE END') ? [] : ['마커 없음']);

/* 6) 렌더 루프가 초기화 실패에 휘말리지 않도록 먼저 시작하는지 */
const initIdx = body.indexOf('function init()');
const rafIdx = body.indexOf('requestAnimationFrame(frame)', initIdx);
const hydrateIdx = body.indexOf('hydrate();', initIdx);
check('init() 에서 렌더 루프를 hydrate 보다 먼저 시작',
  (initIdx >= 0 && rafIdx >= 0 && hydrateIdx >= 0 && rafIdx < hydrateIdx) ? [] : ['rAF 가 hydrate 뒤에 있음'],
  '초기화 중 예외가 나면 캔버스가 전부 빈 화면이 된다');

/* 7) 단계 진행 gate() 를 같은 스코프의 상태 객체로 덮어쓰지 않는지
      (var gate = {...} 는 함수 선언을 런타임에 객체로 바꿔 시작 버튼을 멈추게 한다) */
const gateShadow = /\bfunction\s+gate\s*\(/.test(body) && /\bvar\s+gate\s*=/.test(body)
  ? ['function gate() 와 var gate 가 함께 선언됨']
  : [];
check('단계 진행 gate() 이름 충돌 없음', gateShadow, '제출 가능 상태 객체는 submitGate 같은 별도 이름을 사용');

/* 8) ① 관찰 응답 → 즉시 전송 요청 + 수업 진행을 막지 않는 체크포인트 배선 */
const introWiring = [
  ['#introConditions 마크업', declaredIds.has('introConditions')],
  ['intro.conditions 입력 저장', /bindText\('#introConditions',\s*'intro\.conditions'\)/.test(body)],
  ['① 단계의 빈 답안 차단', /step\s*===\s*1[\s\S]{0,300}tx\(s\.intro\.conditions\)/.test(body)],
  ['통과한 단계의 textarea 잠금', /\$\$\('textarea,\s*input\[type=text\],\s*input\[type=radio\]'.*el\.disabled\s*=\s*lock/.test(body)],
  ['교사용 결과 열', /path:\s*'intro\.conditions'/.test(body)],
  ['시작 버튼의 즉시 제출 호출', /startBtn[\s\S]{0,120}submitIntro\(this\)/.test(body)],
  ['교사 계정의 빈 답안 우회', /function\s+submitIntro\(btn\)\s*\{\s*if\s*\(IS_ADMIN\)[\s\S]{0,220}proceed\(1\)[\s\S]{0,100}if\s*\(!tx\(state\.intro\.conditions\)\)/.test(body)],
  ['도입 응답 서버 전송', /function\s+sendIntroCheckpoint\(\)[\s\S]{0,700}sendResult\(\)\.then/.test(body)],
  ['전송 요청 직후 단계 이동', /function\s+submitIntro\(btn\)[\s\S]{0,700}sendIntroCheckpoint\(\);\s*proceed\(1\)/.test(body)],
  ['전송 상태 안내', declaredIds.has('introSubmitNote') && declaredIds.has('introSubmitText')],
  ['실패 시 다시 제출', declaredIds.has('introRetryBtn') && /introRetryBtn[\s\S]{0,140}sendIntroCheckpoint\(\)/.test(body)],
  ['다음 접속 자동 재시도', /state\.intro\.started[\s\S]{0,160}!state\.intro\.submittedAt[\s\S]{0,100}sendIntroCheckpoint\(\)/.test(body)],
].filter(([, ok]) => !ok).map(([name]) => name + ' 없음');
check('① 응답의 비차단 제출과 단계 이동 배선', introWiring);

/* 9) 제출 토큰은 현재 사이트 프로젝트·현재 부모 세션만 사용해야 한다.
      localStorage 의 첫 auth-token 을 쓰면 다른 Supabase 프로젝트 토큰으로 401 이 난다. */
const authWiring = [
  ['현재 부모 세션 조회', /function\s+freshSiteToken\(\)[\s\S]{0,550}window\.parent\.DB\.supabase\.auth\.getSession\(\)/.test(body)],
  ['현재 프로젝트 저장 키 사용', /localStorage\.getItem\('sb-'\s*\+\s*ref\s*\+\s*'-auth-token'\)/.test(body)],
  ['임의 auth-token 전체 순회 제거', !/for\s*\([^)]*localStorage\.length[\s\S]{0,240}\^sb-/.test(body)],
  ['도입 응답 전송에 최신 토큰 사용', /function\s+sendResult\(\)[\s\S]{0,240}freshSiteToken\(\)\.then/.test(body)],
].filter(([, ok]) => !ok).map(([name]) => name + ' 없음');
check('현재 로그인 세션을 사용하는 제출 인증', authWiring);

console.log('\n════════════════════════════════════');
console.log(fail ? ' 정적 점검: ' + fail + '건 실패' : ' 정적 점검: 통과');
console.log('════════════════════════════════════');
process.exit(fail ? 1 : 0);
