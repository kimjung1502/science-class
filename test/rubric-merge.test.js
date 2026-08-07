// 루브릭 표 병합(rowSpans) 자체 검사.  실행: node test/rubric-merge.test.js
//
// 수행평가-공지.html 의 rowSpans 를 그대로 옮겨 둔 것이다(인라인 스크립트라 import 가 안 된다).
// 저쪽을 고치면 여기도 같이 고쳐야 한다.
//
// 이 검사가 실제로 잡아낸 버그: 경계를 "왼쪽 칸 전부" 로 잡으면
// "같은 영역 / 평가 요소는 다름 / 배점은 하나" 라는, 정작 병합이 제일 필요한 표가 안 합쳐졌다.

function rowSpans(rows, keys, k) {
  const val = (r, x) => String(r[x] || '').trim();
  const sig = (r) => (k === 0 ? '' : val(r, keys[0]) + ' ␟ ') + val(r, keys[k]);
  const out = new Array(rows.length).fill(0);
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    // 빈 칸은 합치지 않는다(빈칸끼리 뭉쳐 보이면 오히려 헷갈린다)
    if (val(rows[i], keys[k])) { const s = sig(rows[i]); while (j < rows.length && sig(rows[j]) === s) j++; }
    out[i] = j - i;
    i = j;
  }
  return out;
}

// ---------------- 검사 ----------------
let failed = 0;
const eq = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log((ok ? '✓ ' : '✗ ') + msg + (ok ? '' : '  기대 ' + JSON.stringify(b) + ' / 실제 ' + JSON.stringify(a)));
  if (!ok) failed++;
};
const K = ['group', 'element', 'points', 'criteria'];
const K3 = ['element', 'points', 'criteria'];

// 실제 계획서에서 뽑힌 모양: 논술1 이 두 줄에 걸쳐 병합
const r1 = [
  { group: '논술1', element: '화학이 현대 사회에 미친 영향', points: '6점',  criteria: 'x' },
  { group: '논술1', element: '하버의 행동에 대한 과학 글',   points: '4점',  criteria: 'y' },
  { group: '논술2', element: '화학 반응의 양적 관계',        points: '10점', criteria: 'z' },
];
eq(rowSpans(r1, K, 0), [2, 0, 1], '영역이 두 줄로 합쳐진다');
eq(rowSpans(r1, K, 1), [1, 1, 1], '평가 요소가 각각 다르면 안 합쳐진다');
eq(rowSpans(r1, K, 2), [1, 1, 1], '배점이 각각 다르면 안 합쳐진다');

// 배점 병합 — 영역 안에서만, 영역이 바뀌면 끊는다
const r2 = [
  { group: 'G1', element: 'A', points: '10점', criteria: 'x' },
  { group: 'G1', element: 'B', points: '10점', criteria: 'y' },
  { group: 'G2', element: 'C', points: '10점', criteria: 'z' },
];
eq(rowSpans(r2, K, 0), [2, 0, 1], '영역 병합');
eq(rowSpans(r2, K, 2), [2, 0, 1], '같은 영역 안에서 배점 병합 (요소가 달라도)');

// 영역 없는 옛 데이터 — 3칸 모드
const r3 = [{ element: 'A', points: '5점', criteria: 'x' }, { element: 'B', points: '5점', criteria: 'y' }];
eq(rowSpans(r3, K3, 0), [1, 1], '영역 없음: 평가 요소 그대로');
eq(rowSpans(r3, K3, 1), [1, 1], '영역 없음: 요소가 다르면 배점 안 합침');

// 빈 칸은 묶지 않는다
const r4 = [{ group: '', element: 'A', points: '', criteria: 'x' }, { group: '', element: 'B', points: '', criteria: 'y' }];
eq(rowSpans(r4, K, 0), [1, 1], '빈 영역끼리는 안 뭉친다');
eq(rowSpans(r4, K, 2), [1, 1], '빈 배점끼리도 안 뭉친다');

// 한 줄짜리
eq(rowSpans([{ group: 'G', element: 'A', points: '3점', criteria: 'x' }], K, 0), [1], '한 줄짜리 표');

// 어떤 표든 rowspan 합계는 줄 수와 같아야 한다(칸이 새거나 겹치지 않음)
for (const [rows, keys, name] of [[r1, K, '①'], [r2, K, '②'], [r3, K3, '③'], [r4, K, '④']])
  for (let k = 0; k < keys.length; k++)
    eq(rowSpans(rows, keys, k).reduce((a, b) => a + b, 0), rows.length, name + ' ' + keys[k] + ' 칸 합계 = 줄 수');

if (failed) { console.log('\n' + failed + '개 실패'); process.exit(1); }
console.log('\n모두 통과');
