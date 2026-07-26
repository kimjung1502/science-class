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

console.log('\n════════════════════════════════════');
console.log(fail ? ' 정적 점검: ' + fail + '건 실패' : ' 정적 점검: 통과');
console.log('════════════════════════════════════');
process.exit(fail ? 1 : 0);
