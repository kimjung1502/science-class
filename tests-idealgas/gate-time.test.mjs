// submitGate(supabase/functions/submit-work/index.ts)의 시각 계산만 떼어 낸 검사.
// UTC로 도는 Edge 런타임에서 'KST 벽시계' 를 제대로 읽는지(±9시간 부호)와
// 수업 시간 판정·종료 시각 환산이 맞는지 확인한다. node tests-idealgas/gate-time.test.mjs
import assert from 'node:assert/strict';

const GRACE_MIN = 5;
const toMin = (t) => { const a = String(t).split(':'); return (+a[0]) * 60 + (+a[1]); };

function gate(nowMs, slots, periods, win = {}) {    // index.ts 의 submitGate 와 같은 식
  const closeAt = win.close_at || null;
  const classOnly = win.class_time_only === true;
  if (closeAt && new Date(closeAt).getTime() < nowMs) return { open: false, until: closeAt };
  if (!classOnly) return { open: true, until: closeAt };   // 체크 안 했으면 시간표를 안 본다
  const pmap = new Map(periods.map((p) => [p.period, p]));
  const kst = new Date(nowMs + 9 * 3600 * 1000);
  const wd = kst.getUTCDay() === 0 ? 7 : kst.getUTCDay();
  const mins = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const today = slots.filter((s) => s.weekday === wd).map((s) => pmap.get(s.period)).filter(Boolean);
  for (const p of today) {
    if (mins >= toMin(p.start_time) && mins <= toMin(p.end_time) + GRACE_MIN) {
      const end = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 0, toMin(p.end_time)) - 9 * 3600 * 1000);
      const until = closeAt && new Date(closeAt).getTime() < end.getTime() ? closeAt : end.toISOString();
      return { open: true, until };
    }
  }
  return { open: false };
}

const PERIODS = [{ period: 3, start_time: '10:40:00', end_time: '11:30:00' }];
const SLOTS = [{ weekday: 2, period: 3 }];          // 화요일 3교시
const kstIso = (s) => Date.parse(s + '+09:00');     // KST 벽시계 → epoch
const ONLY = { class_time_only: true };            // 교사가 '수업 시간에만 제출하기' 를 켜 둔 경우
const onlyGate = (now, slots, periods, win = ONLY) => gate(now, slots, periods, win);

// 2026-07-28 은 화요일
assert.equal(onlyGate(kstIso('2026-07-28T10:39'), SLOTS, PERIODS).open, false, '시작 1분 전엔 닫힘');
assert.equal(onlyGate(kstIso('2026-07-28T10:40'), SLOTS, PERIODS).open, true,  '시작 정각엔 열림');
assert.equal(onlyGate(kstIso('2026-07-28T11:00'), SLOTS, PERIODS).open, true,  '수업 중엔 열림');
assert.equal(onlyGate(kstIso('2026-07-28T11:35'), SLOTS, PERIODS).open, true,  '종료 +5분(정리 시간)까진 열림');
assert.equal(onlyGate(kstIso('2026-07-28T11:36'), SLOTS, PERIODS).open, false, '그 뒤엔 닫힘');
assert.equal(onlyGate(kstIso('2026-07-27T11:00'), SLOTS, PERIODS).open, false, '요일이 다르면 닫힘(월)');
assert.equal(onlyGate(kstIso('2026-08-02T11:00'), SLOTS, PERIODS).open, false, '일요일=7 로 접히는지');

// until 은 그날 KST 11:30 = UTC 02:30 이어야 한다
assert.equal(onlyGate(kstIso('2026-07-28T11:00'), SLOTS, PERIODS).until, '2026-07-28T02:30:00.000Z');
// 자정 근처: KST 날짜가 UTC 날짜보다 하루 앞서는 시점에도 KST 기준 요일로 판정
assert.equal(onlyGate(kstIso('2026-07-28T00:30'), [{ weekday: 2, period: 1 }], [{ period: 1, start_time: '00:00:00', end_time: '01:00:00' }]).open, true, 'UTC로는 전날이어도 KST 화요일로 본다');

// 수업 시간 제한은 체크해야만 걸린다 — 기본값은 시간표를 무시한다
assert.equal(gate(kstIso('2026-07-27T23:00'), SLOTS, PERIODS).open, true, '체크 안 했으면 수업 밖 시간에도 열림');
assert.equal(onlyGate(kstIso('2026-07-27T23:00'), SLOTS, PERIODS).open, false, '체크하면 수업 밖 시간에는 닫힘');

// 기한은 체크 여부와 상관없이 먼저 막는다
const PAST = { close_at: new Date(kstIso('2026-07-28T09:00')).toISOString() };
assert.equal(gate(kstIso('2026-07-28T11:00'), SLOTS, PERIODS, PAST).open, false, '기한이 지나면 닫힘');
assert.equal(gate(kstIso('2026-07-28T11:00'), SLOTS, PERIODS, { ...PAST, class_time_only: true }).open, false, '수업 중이어도 기한이 우선');

// 둘 다 켜 두면 더 이른 쪽이 until 이 된다
const EARLY = { close_at: new Date(kstIso('2026-07-28T11:10')).toISOString(), class_time_only: true };
assert.equal(gate(kstIso('2026-07-28T11:00'), SLOTS, PERIODS, EARLY).until, EARLY.close_at, '기한이 수업 끝보다 이르면 기한이 until');
assert.equal(gate(kstIso('2026-07-28T11:00'), SLOTS, PERIODS, { close_at: new Date(kstIso('2026-07-28T18:00')).toISOString(), class_time_only: true }).until, '2026-07-28T02:30:00.000Z', '기한이 늦으면 수업 끝이 until');

console.log('gate 시각 계산 검사 — 전부 통과');
