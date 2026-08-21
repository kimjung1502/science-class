// 기기·브라우저를 바꿔도 이어지게 하는 §3.4 의 유일한 판단 규칙을 검사한다.
//   node tests-idealgas/sync-merge.test.mjs
//
// 배포되는 HTML 에서 함수를 그대로 떼어 평가한다(load-engine.js 와 같은 방식) —
// 여기서 틀리면 학생이 하던 걸 덮어써서 날린다. 그 사고만큼은 조용히 나면 안 된다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { DEFAULT_HTML } = createRequire(import.meta.url)('./load-engine.js');

const html = fs.readFileSync(DEFAULT_HTML, 'utf8');
const m = html.match(/function shouldAdoptRemote\(mineIso, theirsIso, dirty\) \{[\s\S]*?\n\}/);
assert.ok(m, 'shouldAdoptRemote 를 찾지 못했습니다 — 이름이 바뀌었다면 이 테스트도 함께 고칠 것');
const shouldAdoptRemote = new Function('return (' + m[0] + ')')();

const T1 = '2026-08-21T09:00:00.000Z';
const T2 = '2026-08-21T10:00:00.000Z';

// 다음 시간에 다른 컴퓨터에서 열었다 — 이 기기엔 기록이 없다
assert.equal(shouldAdoptRemote(null, T1, false), true);
// 서버 쪽이 더 나중 것
assert.equal(shouldAdoptRemote(T1, T2, false), true);
// 이 기기 것이 더 나중 것 → 지킨다
assert.equal(shouldAdoptRemote(T2, T1, false), false);
// 같은 시각이면 굳이 갈아끼우지 않는다
assert.equal(shouldAdoptRemote(T1, T1, false), false);
// 기다리는 사이 학생이 입력했으면 무슨 일이 있어도 덮어쓰지 않는다
assert.equal(shouldAdoptRemote(T1, T2, true), false);
// 서버에 기록이 없으면 가져올 것도 없다
assert.equal(shouldAdoptRemote(T1, null, false), false);
// 기기 시계가 망가져 시각을 못 읽으면 서버 쪽을 믿는다
assert.equal(shouldAdoptRemote('언젠가', T1, false), true);

console.log('✔ §3.4 이어하기 병합 규칙 7건 통과');
