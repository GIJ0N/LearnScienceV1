// daily_session_v1: plan diario determinista armado en el cliente; no escribe evidencia ni cambia cobertura, verified() ni calendario.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {} } }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
let health = { ok: true, daily_limit: 30, calls_today: 3 };
global.fetch = async (route, options) => {
  if (route === '/api/health') return { ok: true, json: async () => health };
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  throw Error('Ruta inesperada ' + route);
};
console.error = () => {};
const p = require('../app.js');
const DAY = 86400000;
const dayNumber = at => { const d = new Date(at); return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY); };
// Un mediodía local con d%3===0 y otro con d%3===1.
let T0 = Date.UTC(2026, 10, 10, 12); while (dayNumber(T0) % 3 !== 0) T0 += DAY;
const T1 = T0 + DAY;
assert.equal(dayNumber(T1) % 3, 1);

const node = (id, i = 0) => ({ id, name: id, level: i, prerequisites: [], outcome: 'Resolver', probe: { prompt: 'Explica ' + id, kind: 'explanation' } });
function goal(extra = {}) {
  const base = {
    id: 'g', profile_id: 'profile-test', goal: 'Pintura en polvo', nodes: [node('a'), node('b', 1), node('c', 2)], learner: {},
    reviews: [{ id: 'a', due: T0 - 3 * DAY, step: 0, history: [] }, { id: 'b', due: T0 - 1 * DAY, step: 0, history: [] }, { id: 'c', due: T0 + 5 * DAY, step: 0, history: [] }],
    events: ['a', 'b', 'c'].map(id => ({ type: 'TEACHING_EXPOSURE', node_id: id, at: T0 - 4 * DAY })),
    coverage: ['a', 'b', 'c'].map(id => ({ id, name: id, status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] })),
    lessons: {}, session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 },
  };
  return { ...base, ...extra };
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
const kinds = plan => plan.map(b => b.kind);

(async () => {
  assert.equal(p.DAILY_VERSION, 'daily_session_v1');
  p.setClockForTests(() => T0);

  // Mismo estado y misma fecha → mismo plan. Repasos vencidos por fecha (máx. 3), luego mixta, cálculo y lección.
  let g = goal();
  const plan = p.buildDailyPlan(g, T0);
  assert.deepEqual(plan, p.buildDailyPlan(g, T0));
  assert.deepEqual(kinds(plan), ['review', 'review', 'mixed', 'produce', 'learn']);
  assert.deepEqual(plan.filter(b => b.kind === 'review').map(b => b.node_id), ['a', 'b'], 'orden por fecha de vencimiento');
  assert.equal(plan.find(b => b.kind === 'mixed').variant, 'error_hunt', 'd%3===0 → Encuentra el error');
  assert.equal(p.buildDailyPlan(g, T1).find(b => b.kind === 'mixed').variant, 'discrimination');
  assert.ok(plan.every(b => b.status === 'pending'));
  // Máximo 3 repasos.
  const many = goal({ reviews: ['a', 'b', 'c'].map((id, i) => ({ id, due: T0 - (i + 1) * DAY, step: 0, history: [] })), nodes: [node('a'), node('b'), node('c'), node('d')] });
  many.events.push({ type: 'TEACHING_EXPOSURE', node_id: 'd', at: T0 - DAY }); many.reviews.push({ id: 'd', due: T0 - 10 * DAY, step: 0, history: [] });
  assert.equal(p.buildDailyPlan(many, T0).filter(b => b.kind === 'review').length, 3);

  // Tema sin enseñanza nunca aparece en mixed ni produce.
  const fresh = goal({ events: [], reviews: [] });
  assert.deepEqual(kinds(p.buildDailyPlan(fresh, T0)), ['learn']);

  // Reparación abierta → solo resume_repair.
  assert.deepEqual(kinds(p.buildDailyPlan(goal({ contextStack: [{ context_id: 'c1' }] }), T0)), ['resume_repair']);

  // Poca cuota → sin mixed ni produce; se conservan los repasos.
  assert.deepEqual(kinds(p.buildDailyPlan(g, T0, { lowQuota: true })), ['review', 'review', 'learn']);
  assert.equal(p.dailyLowQuota({ daily_limit: 30, calls_today: 26 }), true);
  assert.equal(p.dailyLowQuota({ daily_limit: 30, calls_today: 25 }), false);
  assert.equal(p.dailyLowQuota(null), false);
  assert.equal(p.dailyLowQuota({}), false);

  // Construir o saltar el plan no cambia cobertura, verified() ni calendario.
  g = attach(goal());
  const before = JSON.stringify({ coverage: g.coverage, reviews: g.reviews, v: ['a', 'b', 'c'].map(id => p.verified(g, id)), evid: g.events.filter(e => e.type === 'EVIDENCE') });
  p.ensureDaily(g, T0);
  while (p.dailyCurrent(g)) p.dailySkip(g);
  assert.equal(JSON.stringify({ coverage: g.coverage, reviews: g.reviews, v: ['a', 'b', 'c'].map(id => p.verified(g, id)), evid: g.events.filter(e => e.type === 'EVIDENCE') }), before);
  assert.deepEqual(g.daily.plan.map(b => b.status), ['skipped', 'skipped', 'skipped', 'skipped', 'skipped']);

  // Cambio de fecha → plan nuevo; el anterior queda en el historial de eventos.
  assert.equal(p.ensureDaily(g, T0).date, p.dailyDate(T0), 'misma fecha: no se reconstruye');
  assert.equal(g.events.filter(e => e.type === 'SESSION_PLAN').length, 1);
  p.setClockForTests(() => T1);
  p.ensureDaily(g, T1);
  const plans = g.events.filter(e => e.type === 'SESSION_PLAN');
  assert.equal(plans.length, 2);
  assert.equal(plans[0].date, p.dailyDate(T0));
  assert.equal(plans[1].date, p.dailyDate(T1));
  assert.deepEqual(plans[0].plan, ['review', 'review', 'mixed', 'produce', 'learn']);
  assert.equal(g.daily.index, 0);

  // Un repaso se marca hecho por derivación cuando su fecha se mueve; marcar un bloque avanza.
  p.setClockForTests(() => T0);
  g = attach(goal()); p.ensureDaily(g, T0);
  assert.equal(p.dailySync(g, T0), false);
  g.reviews.find(r => r.id === 'a').due = T0 + 2 * DAY;
  assert.equal(p.dailySync(g, T0), true);
  assert.equal(g.daily.plan[0].status, 'done');
  assert.equal(g.daily.index, 1);
  assert.equal(p.dailyMark(g, 'learn'), false, 'solo se marca el bloque actual');
  g.reviews.find(r => r.id === 'b').due = T0 + 3 * DAY; p.dailySync(g, T0);
  assert.equal(p.dailyCurrent(g).kind, 'mixed');

  // Terminar la práctica mixta (endMixed con status done) y la de cálculo (endProduction) avanzan el plan.
  g.mixed = { status: 'done', kind: 'error_hunt', id: 'm1', items: [], results: [], index: 1 };
  p.endMixed(g);
  assert.equal(g.daily.plan[2].status, 'done');
  assert.equal(p.dailyCurrent(g).kind, 'produce');
  g.production = { status: 'active', node_id: 'a' };
  p.endProduction(g);
  assert.equal(p.dailyCurrent(g).kind, 'produce', 'salir sin responder no marca hecho');
  g.production = { status: 'done', node_id: 'a', result: { status: 'CORRECT' } };
  p.endProduction(g);
  assert.equal(p.dailyCurrent(g).kind, 'learn');

  // El bloque de lección se completa cuando hay evidencia de aprendizaje posterior al inicio.
  const learn = p.dailyCurrent(g); learn.started_at = T0 + 1000;
  assert.equal(p.dailySync(g, T0 + 5000), false);
  g.events.push({ type: 'EVIDENCE', evidence_role: 'learning', node_id: 'a', result: 'CORRECT', status: 'CORRECT', timestamp: T0 + 2000 });
  assert.equal(p.dailySync(g, T0 + 5000), true);
  assert.equal(p.dailyCurrent(g), null);
  const sum = p.dailySummary(g, T0 + 5000);
  assert.equal(sum.reviews_done, 2);
  assert.ok(sum.correct >= 1);
  assert.equal(sum.next_review, p.dailyDate(T0 + 2 * DAY));

  // Interfaz: el panel lista los bloques, avisa de poca cuota y no escribe evidencia.
  const g2 = attach(goal()); p.ensureDaily(g2, T0, { lowQuota: true });
  const box = element(); p.dailyPanel(box, g2);
  const texts = box.children.map(c => c.textContent || '').join('\n');
  assert.match(texts, /Hoy queda poca cuota: solo repasos guardados y lectura/);
  assert.match(texts, /Repaso guardado/);
  assert.doesNotMatch(texts, /Práctica mixta/);
  assert.equal(box.children.some(c => c.textContent === 'Saltar bloque'), true);
  assert.equal(g2.events.filter(e => e.type === 'EVIDENCE').length, 0);
  assert.equal(p.dailyPanel(element(), goal()), false, 'sin plan de hoy no hay panel');

  console.log('OK daily_session');
})().catch(e => { console.error(e); process.exit(1); });
