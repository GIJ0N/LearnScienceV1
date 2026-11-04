// spaced_practice_v1: calendario sensible a la calidad del acierto + práctica intercalada sin EVIDENCE.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; } }; }
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: id => (id === 'app' ? roots.app : roots.status), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');
const DAY = 86400000;

// A. Calendario
assert.equal(p.nextReviewStep(2, true, 0, null), 3, 'acierto limpio sube');
assert.equal(p.nextReviewStep(2, true, 0, 80), 3);
assert.equal(p.nextReviewStep(2, true, 1, 95), 2, 'con ayuda no sube');
assert.equal(p.nextReviewStep(2, true, 0, 30), 2, 'acierto frágil se mantiene');
assert.equal(p.nextReviewStep(6, true, 0, 90), 6, 'tope de la escalera');
assert.equal(p.nextReviewStep(4, false, 0, 40), 2, 'fallo normal: retroceso parcial');
assert.equal(p.nextReviewStep(4, false, 0, null), 2);
assert.equal(p.nextReviewStep(4, false, 0, 90), 0, 'creencia firme errónea: desde cero');
assert.equal(p.nextReviewStep(0, false, 0, 10), 0);
assert.equal(p.nextReviewStep('x', true), 1, 'entrada corrupta no rompe');

// B. Fixtures
const node = (id, prereq = []) => ({ id, name: 'T-' + id, outcome: 'o-' + id, level: 0, prerequisites: prereq, kind: 'concept', probe: { prompt: 'p', kind: 'explanation' } });
function goal(extra = {}) {
  const t = Date.now();
  return { id: 'g1', goal: 'M', nodes: [node('a'), node('b'), node('c'), node('d')], learner: {}, coverage: [], reviews: [],
    events: [{ type: 'TEACHING_EXPOSURE', node_id: 'a', at: t - 5 * DAY }, { type: 'TEACHING_EXPOSURE', node_id: 'b', at: t - 9 * DAY }, { type: 'TEACHING_EXPOSURE', node_id: 'c', at: t - 2 * DAY }],
    lessons: {}, session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 }, ...extra };
}
const review = (id, step, due) => ({ id, due, step, question: null, history: [] });
const attach = g => { p.setStoreForTests({ goals: [g], active: g.id }); return g; };
const item = (n, id) => ({ item_id: 'disc-' + n, node_id: id, prompt: 'q', options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }] });
const res = (status, it, extra = {}) => ({ status, item_id: it.item_id, node_id: it.node_id, selected_misconception: status === 'MISCONCEPTION' ? 'confunde A con B' : '', ...extra });

(() => {
  // Selección: sin reviews ni verificación nadie califica; sin exposición tampoco.
  let g = attach(goal());
  assert.deepEqual(p.mixedCandidates(g), []);
  assert.equal(p.mixedAvailable(g), false);
  assert.throws(() => p.startMixed(g), /suficientes/);

  // Con repasos: vencidos primero (más viejo antes), luego el resto por exposición más antigua; d (sin exposición) nunca.
  const t = Date.now();
  g = attach(goal({ reviews: [review('a', 2, t - DAY), review('b', 1, t - 3 * DAY), review('c', 3, t + 5 * DAY), review('d', 1, t - 9 * DAY)] }));
  assert.deepEqual(p.mixedCandidates(g, t), ['b', 'a', 'c']);

  // Un solo candidato: no se ofrece.
  g = attach(goal({ reviews: [review('a', 2, t - DAY)] }));
  assert.equal(p.mixedAvailable(g), false);
})();

(() => {
  const t = Date.now();
  let g = attach(goal({ reviews: [review('a', 4, t + 10 * DAY), review('b', 1, t - DAY)] }));
  const m = p.startMixed(g);
  assert.equal(m.status, 'active');
  assert.deepEqual(m.node_ids.sort(), ['a', 'b']);
  // Sin preguntas cargadas no se puede aplicar nada.
  assert.throws(() => p.applyDiscrimination(g, item(1, 'a'), res('CORRECT', item(1, 'a')), 'x1', 'a', 80), /ya no está activa/);
  m.items = [item(1, 'a'), item(2, 'b')];
  // Pregunta fuera de turno y resultado ajeno se rechazan.
  assert.throws(() => p.applyDiscrimination(g, m.items[1], res('CORRECT', m.items[1]), 'x2', 'a', 80), /ya no está activa/);
  assert.throws(() => p.applyDiscrimination(g, m.items[0], { ...res('CORRECT', m.items[0]), node_id: 'b' }, 'x3', 'a', 80), /no corresponde/);
  assert.throws(() => p.applyDiscrimination(g, m.items[0], { ...res('CORRECT', m.items[0]), status: 'OK' }, 'x4', 'a', 80), /no corresponde/);

  // Acierto: no sube el peldaño ni crea EVIDENCE.
  const before = JSON.stringify(g.reviews.find(r => r.id === 'a'));
  assert.equal(p.applyDiscrimination(g, m.items[0], res('CORRECT', m.items[0]), 'at1', 'a', 90), true);
  assert.equal(JSON.stringify(g.reviews.find(r => r.id === 'a')), before);
  assert.equal(m.index, 1);
  // Repetir el mismo attempt_id no duplica.
  assert.equal(p.applyDiscrimination(g, m.items[1], res('MISCONCEPTION', m.items[1]), 'at1', 'b', 90), false);
  assert.equal(m.index, 1);

  // Fallo: retroceso parcial y vencimiento más cercano, nunca más lejano.
  const rb = g.reviews.find(r => r.id === 'b');
  rb.step = 3; rb.due = t + 20 * DAY;
  assert.equal(p.applyDiscrimination(g, m.items[1], res('MISCONCEPTION', m.items[1]), 'at2', 'b', 95), true);
  assert.equal(rb.step, 1);
  assert.ok(rb.due <= Date.now() + 3 * DAY + 1000);
  assert.equal(m.status, 'done');
  const ev = g.events.filter(e => e.type === 'DISCRIMINATION');
  assert.equal(ev.length, 2);
  assert.equal(ev[1].calibration_signal, 'committed_misconception');
  assert.equal(ev[1].confusion, 'confunde A con B');
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0);

  // Un fallo sobre un tema sin repaso programado no inventa uno.
  assert.equal(p.lapseReview(g, 'zzz', t), false);
  p.endMixed(g);
  assert.equal(g.mixed, null);

  // lapseReview nunca atrasa un vencimiento.
  const near = { id: 'q', step: 1, due: t + 1000, question: null, history: [] };
  g.reviews.push(near);
  p.lapseReview(g, 'q', t);
  assert.ok(near.due <= t + 1000);
})();
console.log('OK: spaced practice scheduler and interleaving');
