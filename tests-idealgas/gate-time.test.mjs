// submitGate(supabase/functions/submit-work/index.ts)의 시각 계산만 떼어 낸 검사.
// UTC로 도는 Edge 런타임에서 'KST 벽시계' 를 제대로 읽는지(±9시간 부호)와
// 수업 시간 판정·종료 시각 환산이 맞는지 확인한다. node tests-idealgas/gate-time.test.mjs
import assert from 'node:assert/strict';

const GRACE_MIN = 5;
const toMin = (t) => { const a = String(t).split(':'); return (+a[0]) * 60 + (+a[1]); };

function gate(nowMs, slots, periods) {              // index.ts 의 ② 분기와 같은 식
  const pmap = new Map(periods.map((p) => [p.period, p]));
  const kst = new Date(nowMs + 9 * 3600 * 1000);
  const wd = kst.getUTCDay() === 0 ? 7 : kst.getUTCDay();
  const mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const today = slots.filter((s) => s.weekday === wd).map((s) => pmap.get(s.period)).filter(Boolean);
  for (const p of today) {
    if (mins >= toMin(p.start_time) && mins <= toMin(p.end_time) + GRACE_MIN) {
      const end = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 0, toMin(p.end_time)) - 9 * 3600 * 1000);
      return { open: true, until: end.toISOString() };
    }
  }
  return { open: false };
}

const PERIODS = [{ period: 3, start_time: '10:40:00', end_time: '11:30:00' }];
const SLOTS = [{ weekday: 2, period: 3 }];          // 화요일 3교시
const kstIso = (s) => Date.parse(s + '+09:00');     // KST 벽시계 → epoch

// 2026-07-28 은 화요일
assert.equal(gate(kstIso('2026-07-28T10:39'), SLOTS, PERIODS).open, false, '시작 1분 전엔 닫힘');
assert.equal(gate(kstIso('2026-07-28T10:40'), SLOTS, PERIODS).open, true,  '시작 정각엔 열림');
assert.equal(gate(kstIso('2026-07-28T11:00'), SLOTS, PERIODS).open, true,  '수업 중엔 열림');
assert.equal(gate(kstIso('2026-07-28T11:35'), SLOTS, PERIODS).open, true,  '종료 +5분(정리 시간)까진 열림');
assert.equal(gate(kstIso('2026-07-28T11:36'), SLOTS, PERIODS).open, false, '그 뒤엔 닫힘');
assert.equal(gate(kstIso('2026-07-27T11:00'), SLOTS, PERIODS).open, false, '요일이 다르면 닫힘(월)');
assert.equal(gate(kstIso('2026-08-02T11:00'), SLOTS, PERIODS).open, false, '일요일=7 로 접히는지');

// until 은 그날 KST 11:30 = UTC 02:30 이어야 한다
assert.equal(gate(kstIso('2026-07-28T11:00'), SLOTS, PERIODS).until, '2026-07-28T02:30:00.000Z');
// 자정 근처: KST 날짜가 UTC 날짜보다 하루 앞서는 시점에도 KST 기준 요일로 판정
assert.equal(gate(kstIso('2026-07-28T00:30'), [{ weekday: 2, period: 1 }], [{ period: 1, start_time: '00:00:00', end_time: '01:00:00' }]).open, true, 'UTC로는 전날이어도 KST 화요일로 본다');

console.log('gate 시각 계산 검사 — 전부 통과');
