// §10 검증 — 결정론 / P_측정 통계 / 방향 / 피스톤 정착
//   node tests-idealgas/verify.js            (배포 HTML 의 엔진 블록을 그대로 검증)
//   node tests-idealgas/verify.js <html경로>
//   --json  : 결과를 JSON 으로만 출력
const { load } = require('./load-engine');

const args = process.argv.slice(2);
const jsonOnly = args.includes('--json');
const htmlArg = args.filter((a) => !a.startsWith('--'))[0];
const { engine: E, htmlPath } = load(htmlArg);
const C = E.C;

const SEEDS = [1, 7, 13, 42, 101, 257, 1009, 65537];   // §10 고정 seed 8개
const T_CRIT_DF7 = 2.365;                              // 95% 양측, 자유도 7
const WARMUP = 2;            // s — 측정에서 제외
const BASE_MEASURE = 25;     // s — seed 당 측정 구간
const MIN_COLLISIONS = 2050; // 조합별 8개 seed 합산 하한

const out = { htmlPath, constants: {}, determinism: {}, pMeasured: {}, direction: {}, settle: {} };
const log = (...a) => { if (!jsonOnly) console.log(...a); };
const f = (x, d = 4) => (x === null || x === undefined ? '—' : Number(x).toFixed(d));

/* ───────────────────────── 상수 요약 ───────────────────────── */
out.constants = {
  W_INT: C.W_INT, H_PER_L: C.H_PER_L, SIGMA2_PER_K: C.SIGMA2_PER_K,
  PRESSURE_CAL: C.PRESSURE_CAL, DT: C.DT, OMEGA: C.OMEGA,
  R_GAS: C.R_GAS, PARTICLES_PER_MOL: C.PARTICLES_PER_MOL,
  baseVolume: C.R_GAS * 273 / 1.0, windowSec: C.WINDOW_SEC, nbins: C.NBINS
};
log('■ 엔진 상수  W=%d, H_PER_L=%s, σ²/K=%d, 보정상수=%s, dt=1/%d, ω=%d',
  C.W_INT, f(C.H_PER_L, 3), C.SIGMA2_PER_K, f(C.PRESSURE_CAL, 8), Math.round(1 / C.DT), C.OMEGA);
log('  기본상태 n=1,T=273,P=1 → V=%s L (표시 22.4 L)\n', f(out.constants.baseVolume, 4));

/* ─────────────── 1) 결정론 검사 : 등온 P×V, 등적 P/T (±3%) ─────────────── */
function spread(vals) {                    // 평균 대비 최대 상대 편차
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { mean: m, maxDev: Math.max(...vals.map((v) => Math.abs(v - m) / m)) };
}

// 등온: 추를 실제로 올리고 피스톤 ODE 가 정착할 때까지 돌린 뒤 V 를 읽는다.
{
  const sim = new E.Sim({ mode: 'isothermal', t: 273, n: 1, p: 1.0, seed: 20250726 });
  const rows = [];
  for (let p = C.P_IN_MIN; p <= C.P_IN_MAX + 1e-9; p += C.P_STEP) {
    sim.setPExternal(Number(p.toFixed(4)));
    const steps = sim.stepsToSettle();
    rows.push({ p: sim.pExt, v: sim.V, pv: sim.pExt * sim.V, steps });
  }
  const s = spread(rows.map((r) => r.pv));
  out.determinism.isothermal = { rows, mean: s.mean, maxDev: s.maxDev, tol: 0.03, pass: s.maxDev <= 0.03 };
  log('■ 결정론 ① 등온 P×V (T=273 K, n=1)');
  rows.forEach((r) => log('   P=%s atm  V=%s L  P×V=%s  (정착 %d step)', f(r.p, 2), f(r.v, 4), f(r.pv, 6), r.steps));
  log('   평균 P×V = %s,  최대 상대편차 = %s%%  (허용 ±3%%)  → %s\n',
    f(s.mean, 6), f(s.maxDev * 100, 4), s.maxDev <= 0.03 ? '합격' : '불합격');
}

// 등적: 피스톤 잠금 상태에서 가열/냉각하며 P_이론 을 읽는다.
{
  const V0 = C.R_GAS * 273 / 1.0;
  const sim = new E.Sim({ mode: 'isochoric', t: 273, n: 1, p: 1.0, v: V0, seed: 20250726 });
  const rows = [];
  for (let t = C.T_MIN; t <= C.T_MAX + 1e-9; t += C.T_STEP) {
    sim.setTemperature(t);
    sim.advance(0.05);
    rows.push({ t, p: sim.pTheory(), pt: sim.pTheory() / t });
  }
  const s = spread(rows.map((r) => r.pt));
  out.determinism.isochoric = {
    rows: rows.filter((_, i) => i % 4 === 0 || i === rows.length - 1),
    count: rows.length, mean: s.mean, maxDev: s.maxDev, tol: 0.03, pass: s.maxDev <= 0.03
  };
  log('■ 결정론 ② 등적 P/T (V=%s L 고정, n=1, T=100~600 K, %d개 점)', f(V0, 4), rows.length);
  out.determinism.isochoric.rows.forEach((r) => log('   T=%d K  P=%s atm  P/T=%s', r.t, f(r.p, 4), f(r.pt, 8)));
  log('   평균 P/T = %s,  최대 상대편차 = %s%%  (허용 ±3%%)  → %s\n',
    f(s.mean, 8), f(s.maxDev * 100, 4), s.maxDev <= 0.03 ? '합격' : '불합격');
}

/* ─────────────── 2) P_측정 검사 : 조합 8개 × seed 8개 × t-CI ─────────────── */
const COMBOS = [
  { name: 'C1 기본',        n: 1.00, t: 273, p: 1.0 },
  { name: 'C2 등온압축',    n: 1.00, t: 273, p: 4.0 },
  { name: 'C3 저온',        n: 1.00, t: 100, p: 1.0 },
  { name: 'C4 고온',        n: 1.00, t: 600, p: 1.0 },
  { name: 'C5 소량 n=0.25', n: 0.25, t: 273, p: 1.0 },
  { name: 'C6 다량 n=2',    n: 2.00, t: 273, p: 1.0 },
  { name: 'C7 등적 고온',   n: 1.00, t: 600, v: 22.4133 },
  { name: 'C8 등적 저n',    n: 0.50, t: 200, v: 20.0 }
];

function runCombo(c, measureSec) {
  const v = c.v !== undefined ? c.v : E.volumeOf(c.n, c.t, c.p);
  const rs = [], per = [];
  let coll = 0;
  for (const seed of SEEDS) {
    const m = E.measure({ n: c.n, t: c.t, v, p: c.p || (c.n * C.R_GAS * c.t / v), seed, warmup: WARMUP, measure: measureSec });
    rs.push(m.ratio); coll += m.collisions;
    per.push({ seed, ratio: m.ratio, collisions: m.collisions, freq: m.freq });
  }
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / (rs.length - 1));
  const half = T_CRIT_DF7 * sd / Math.sqrt(rs.length);
  return {
    name: c.name, n: c.n, t: c.t, v, pTheory: c.n * C.R_GAS * c.t / v,
    measureSec, collisions: coll, ratios: rs, per,
    mean, sd, ciHalf: half, ciLo: mean - half, ciHi: mean + half,
    enoughN: coll >= MIN_COLLISIONS,
    ciOk: half <= 0.05,
    pass: Math.abs(mean - 1) <= 0.05 && (mean - half) <= 1 && (mean + half) >= 1 && coll >= MIN_COLLISIONS
  };
}

log('■ P_측정 검사 — 조합 %d개 × 고정 seed %d개, 워밍업 %d s 제외 · 측정 %d s(부족하면 자동 연장)',
  COMBOS.length, SEEDS.length, WARMUP, BASE_MEASURE);
log('   seed 목록: [%s]   합격조건: |r̄−1| ≤ 0.05 이고 95%% t-CI(df=7, %s)가 1.00 포함, 조합별 N ≥ %d\n',
  SEEDS.join(', '), T_CRIT_DF7, MIN_COLLISIONS);

const comboResults = [];
for (const c of COMBOS) {
  let sec = BASE_MEASURE, r = runCombo(c, sec), tries = 0;
  // ① N ≥ 2,050 을 못 채우면 측정 구간 연장(§10)
  while (!r.enoughN && tries < 4) { sec = Math.ceil(sec * (MIN_COLLISIONS * 1.25) / Math.max(r.collisions, 1)); r = runCombo(c, sec); tries++; }
  // ② CI 반폭이 0.05 를 넘으면 판정 보류하고 구간을 늘려 재판정(§10)
  while (!r.ciOk && tries < 7) { sec = Math.ceil(sec * 4); r = runCombo(c, sec); tries++; }
  comboResults.push(r);
  log('  %s  (n=%s mol, T=%d K, V=%s L, P_이론=%s atm)', r.name, f(r.n, 2), r.t, f(r.v, 4), f(r.pTheory, 4));
  log('     측정 %d s/seed · 충돌 N=%d · r̄=%s · s=%s · 95%%CI=[%s, %s] · 반폭=%s',
    r.measureSec, r.collisions, f(r.mean, 4), f(r.sd, 4), f(r.ciLo, 4), f(r.ciHi, 4), f(r.ciHalf, 4));
  log('     seed별 r_i: %s', r.ratios.map((x) => f(x, 3)).join(' '));
  log('     N≥2050 %s · CI가 1.00 포함 %s · |r̄−1|≤0.05 %s  → %s\n',
    r.enoughN ? '✔' : '✘', (r.ciLo <= 1 && r.ciHi >= 1) ? '✔' : '✘',
    Math.abs(r.mean - 1) <= 0.05 ? '✔' : '✘', r.pass ? '합격' : '불합격');
}
out.pMeasured = {
  seeds: SEEDS, warmupSec: WARMUP, baseMeasureSec: BASE_MEASURE, minCollisions: MIN_COLLISIONS,
  tCrit: T_CRIT_DF7, combos: comboResults.map((r) => ({ ...r, per: r.per, ratios: r.ratios })),
  pass: comboResults.every((r) => r.pass)
};

/* ─────────────── 3) 방향 검사 ─────────────── */
function ensemble(cfg) {
  let fr = 0, mi = 0;
  for (const seed of SEEDS) {
    const m = E.measure({ ...cfg, seed, warmup: WARMUP, measure: 15 });
    fr += m.freq; mi += m.meanImpulse;
  }
  return { freq: fr / SEEDS.length, meanImpulse: mi / SEEDS.length };
}
{
  const V1 = C.R_GAS * 273 / 1.0, V2 = C.R_GAS * 273 / 2.0;
  const a = ensemble({ n: 1, t: 273, v: V1, p: 1.0 });
  const b = ensemble({ n: 1, t: 273, v: V2, p: 2.0 });
  const iso = {
    before: a, after: b,
    freqRatio: b.freq / a.freq, impulseRatio: b.meanImpulse / a.meanImpulse,
    pass: (b.freq / a.freq) > 1.05 && Math.abs(b.meanImpulse / a.meanImpulse - 1) <= 0.03
  };
  const c1 = ensemble({ n: 1, t: 273, v: V1, p: 1.0 });
  const c2 = ensemble({ n: 1, t: 546, v: V1, p: 1.0 });
  const isoch = {
    before: c1, after: c2,
    freqRatio: c2.freq / c1.freq, impulseRatio: c2.meanImpulse / c1.meanImpulse,
    pass: (c2.freq / c1.freq) > 1.05 && (c2.meanImpulse / c1.meanImpulse) > 1.05
  };
  out.direction = { isothermalCompress: iso, isochoricHeat: isoch, pass: iso.pass && isoch.pass };
  log('■ 방향 검사 (seed 8개 앙상블 평균, 각 15 s)');
  log('  ① 등온 압축 P 1→2 atm (V %s→%s L, T=273 고정)', f(V1, 3), f(V2, 3));
  log('     충돌 빈도 %s → %s 회/s  (×%s)   평균 충격 %s → %s  (×%s)',
    f(a.freq, 2), f(b.freq, 2), f(iso.freqRatio, 3), f(a.meanImpulse, 2), f(b.meanImpulse, 2), f(iso.impulseRatio, 4));
  log('     빈도만 증가(평균 충격 불변 ±3%%) → %s', iso.pass ? '합격' : '불합격');
  log('  ② 등적 가열 273→546 K (V=%s L 고정)', f(V1, 3));
  log('     충돌 빈도 %s → %s 회/s  (×%s)   평균 충격 %s → %s  (×%s)',
    f(c1.freq, 2), f(c2.freq, 2), f(isoch.freqRatio, 3), f(c1.meanImpulse, 2), f(c2.meanImpulse, 2), f(isoch.impulseRatio, 3));
  log('     빈도·충격 둘 다 증가 → %s\n', isoch.pass ? '합격' : '불합격');
}

/* ─────────────── 4) 피스톤 정착 (§1.3 이산 실측) ─────────────── */
{
  function settleOf(Veq, V0) {
    const s = new E.Sim({ mode: 'isothermal', t: 273, n: 1, p: 1.0, seed: 5 });
    s.Veq = Veq; s.V = V0; s.Vdot = 0; s.settled = false;
    const k = s.stepsToSettle();
    return { A: Math.abs(V0 - Veq) / Veq, steps: k, sec: k * C.DT, tau: (k * C.DT) / C.TAU };
  }
  const a1 = settleOf(C.R_GAS * 273 / 1.0, 2 * (C.R_GAS * 273 / 1.0));
  const a11 = settleOf(5, 60);
  out.settle = { A1: a1, A11: a11 };
  log('■ 피스톤 정착 (세미-임플리시트 오일러, dt=1/120, τ=0.05 s · 조건 |ΔV|/Veq<1e-4 & |dV/dt|/Veq<1e-3)');
  log('   A=%s : %d step = %s s (%sτ)', f(a1.A, 1), a1.steps, f(a1.sec, 3), f(a1.tau, 1));
  log('   A=%s : %d step = %s s (%sτ)\n', f(a11.A, 0), a11.steps, f(a11.sec, 3), f(a11.tau, 1));
}

/* ─────────────── 종합 ─────────────── */
out.pass = out.determinism.isothermal.pass && out.determinism.isochoric.pass &&
  out.pMeasured.pass && out.direction.pass;
if (jsonOnly) console.log(JSON.stringify(out, null, 2));
else {
  log('════════════════════════════════════════════');
  log(' 결정론 등온 P×V : %s', out.determinism.isothermal.pass ? '합격' : '불합격');
  log(' 결정론 등적 P/T : %s', out.determinism.isochoric.pass ? '합격' : '불합격');
  log(' P_측정 (조합 %d개) : %s', COMBOS.length, out.pMeasured.pass ? '합격' : '불합격');
  log(' 방향 검사        : %s', out.direction.pass ? '합격' : '불합격');
  log(' 종합             : %s', out.pass ? '✅ 전체 합격' : '❌ 불합격 항목 있음');
  log('════════════════════════════════════════════');
}
process.exit(out.pass ? 0 : 1);
