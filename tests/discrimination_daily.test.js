// discrimination_daily_v1: el conteo diario de aciertos (dailySummary.correct) no incluye DISCRIMINATION; distinguir ideas no es recordarlas. Otros tipos sí cuentan.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {} } }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
let health = { ok: true, daily_limit: 30, calls_today: 3 };
global.fetch = async (route) => {
  if (route === '/api/health') return { ok: true, json: async () => health };
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  throw Error('Ruta inesperada ' + route);
};
console.error = () => {};
const p = require('../app.js');
const DAY = 86400000;
const T0 = Date.UTC(2026, 10, 10, 12);

const node = (id, i = 0) => ({ id, name: id, level: i, prerequisites: [], outcome: 'Resolver', probe: { prompt: 'Explica ' + id, kind: 'explanation' } });
function goal() {
  return {
    id: 'g', profile_id: 'profile-test', goal: 'Pintura en polvo', nodes: [node('a'), node('b', 1)], learner: {},
    reviews: [{ id: 'a', due: T0 + 2 * DAY, step: 0, history: [] }],
    events: [], coverage: [], lessons: {}, session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 },
  };
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
function withDaily(g) {
  p.ensureDaily(g, T0, { lowQuota: false });
  g.daily.started_at = T0 - 1000;
  return g;
}

p.setClockForTests(() => T0);

// Acierto de discriminación (intercalada) con la forma que guarda applyDiscrimination.
const discCorrect = (n, at) => ({ type: 'DISCRIMINATION', node_id: 'a', item_id: 'i' + n, attempt_id: 'att-d' + n, session_id: 'mixed-1', status: 'CORRECT', confusion: '', learner_confidence: null, calibration_signal: null, reasoning_text: '', at, policy_version: 'mixed_v1' });
const otherCorrect = (type, n, at) => ({ type, node_id: 'a', item_id: 'o' + n, attempt_id: 'att-' + type + n, status: 'CORRECT', at, policy_version: 'x_v1' });

(async () => {
  // Base: sin eventos, el resumen cuenta cero aciertos.
  const g0 = withDaily(attach(goal()));
  assert.equal(p.dailySummary(g0, T0 + 5000).correct, 0);

  // Un acierto DISCRIMINATION no aumenta el conteo.
  const g1 = withDaily(attach(goal()));
  g1.events.push(discCorrect(1, T0 + 1000));
  assert.equal(p.dailySummary(g1, T0 + 5000).correct, 0, 'DISCRIMINATION no debe contar como acierto diario');

  // Un acierto de otro tipo sí aumenta el conteo (EVIDENCE de aprendizaje y COMPOSITION).
  const g2 = withDaily(attach(goal()));
  g2.events.push({ type: 'EVIDENCE', evidence_role: 'learning', node_id: 'a', result: 'CORRECT', status: 'CORRECT', timestamp: T0 + 1000 });
  assert.equal(p.dailySummary(g2, T0 + 5000).correct, 1);
  g2.events.push(otherCorrect('COMPOSITION', 1, T0 + 2000));
  assert.equal(p.dailySummary(g2, T0 + 5000).correct, 2, 'COMPOSITION sigue contando');

  // Mezcla: DISCRIMINATION no suma ni resta sobre lo que ya contaba.
  g2.events.push(discCorrect(2, T0 + 3000));
  assert.equal(p.dailySummary(g2, T0 + 5000).correct, 2);

  // Eventos anteriores al inicio de la sesión de hoy no cuentan (sin cambios de comportamiento).
  const g3 = withDaily(attach(goal()));
  g3.events.push(otherCorrect('COMPOSITION', 2, T0 - 5000));
  assert.equal(p.dailySummary(g3, T0 + 5000).correct, 0);

  // Vista: con el plan completo, el panel no muestra los aciertos de discriminación como acierto de dominio.
  const g4 = withDaily(attach(goal()));
  g4.events.push(discCorrect(3, T0 + 1000));
  g4.daily.plan.forEach(b => { b.status = 'done'; });
  g4.daily.index = g4.daily.plan.length;
  const box = element();
  p.dailyPanel(box, g4);
  const texts = box.children.map(c => c.textContent || '').join('\n');
  assert.match(texts, /Aciertos: 0\./);
  assert.doesNotMatch(texts, /Aciertos: 1\./);

  console.log('discrimination_daily ok');
})().catch(e => { console.error = console.log; console.error(e); process.exit(1); });
