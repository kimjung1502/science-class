// safeUrl() 자체 검사.  실행: node test/safe-url.test.js
//
// db.js 는 IIFE 라 import 가 안 된다. rubric-merge 처럼 복사해 두면 저쪽을 고쳤을 때
// 여기가 조용히 낡는다 — 그래서 db.js 소스에서 safeUrl 정의만 떼어 내 그대로 돌린다.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'db.js'), 'utf8');
const m = src.match(/const safeUrl = \(u\) => \{[\s\S]*?\n  \};/);
assert(m, 'db.js 에서 safeUrl 정의를 찾지 못했다 — 이름이나 모양이 바뀌었나?');

// 브라우저 전역 stub. https 로 서빙되는 페이지를 가정한다.
const location = { href: 'https://example.org/과목-홈.html', protocol: 'https:' };
const safeUrl = eval(`(() => { ${m[0]} return safeUrl; })()`);

const ok = [
  ['https://drive.google.com/file/d/abc', 'https 그대로'],
  ['http://example.org/a.pdf', 'http 그대로'],
  ['단원-상세.html?u=1', '상대 경로'],
  ['/공개-실험자료/x.html', '루트 상대 경로'],
];
for (const [u, why] of ok) assert.strictEqual(safeUrl(u), u, `허용돼야 한다(${why}): ${u}`);

const blocked = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  '  javascript:alert(1)  ',            // URL 파서가 앞뒤 공백을 떼고도 스킴을 알아본다
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'blob:https://example.org/deadbeef',  // 우리가 만든 blob 은 .href 로 직접 넣는다
];
for (const u of blocked) assert.strictEqual(safeUrl(u), '#', `막아야 한다: ${u}`);

// 값이 없거나 이상해도 터지지 않는다
for (const u of [null, undefined, '', {}, []]) assert.strictEqual(typeof safeUrl(u), 'string');

console.log('safeUrl 검사 통과 —', ok.length, '허용 /', blocked.length, '차단');
