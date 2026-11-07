// local_confirmation_v1: lo provisional puede abrir la puerta a evidencia firme solo con una pregunta de clave privada.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; }, addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {} } }; }
global.document = { getElementById: () => element(), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');
const DAY = 86400000;
const node = id => ({ id, name: 'T-' + id, outcome: 'o', level: 0, prerequisites: [], kind: 'concept', probe: { prompt: 'p', kind: 'explanation' } });
const goal = (events = []) => ({ id: 'g1', goal: 'M', nodes: [node('a'), node('b')], learner: {}, coverage: [], lessons: {},
  reviews: [{ id: 'a', due: Date.now() + 9 * DAY, step: 4, question: null, history: [] }],
  session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 }, events: [{ type: 'TEACHING_EXPOSURE', node_id: 'a', at: Date.now() - 5 * DAY }, ...events] });
const attach = g => { p.setStoreForTests({ goals: [g], active: g.id }); return g; };
const chal = (status, attempt = 'c1') => ({ type: 'CHALLENGE_REPORT', node_id: 'a', attempt_id: attempt, status, provisional: true, at: Date.now() });
const conf = (status, type, attempt) => ({ type: 'CONFIRMATION', node_id: 'a', confirms_type: type, confirms_attempt_id: attempt, status, at: Date.now() });
const src = { node_id: 'a', source_type: 'CHALLENGE_REPORT', source_attempt_id: 'c1' };

(() => {
  // 1. startMixed
  let g = attach(goal([chal('CORRECT')]));
  assert.throws(() => p.startMixed(g, 'confirm'), /origen/);
  assert.throws(() => p.startMixed(g, 'confirm', { node_id: 'a' }), /origen/);
  const m = p.startMixed(g, 'confirm', src);
  assert.equal(m.kind, 'confirm');
  assert.deepEqual(m.node_ids, ['a']);
  assert.equal(m.source_type, 'CHALLENGE_REPORT');
  assert.equal(m.source_attempt_id, 'c1');
  g = attach(goal([chal('CORRECT'), conf('CORRECT', 'CHALLENGE_REPORT', 'c1')]));
  assert.throws(() => p.startMixed(g, 'confirm', src), e => e.code === 'ALREADY_CONFIRMED' || /ya tiene confirmación/.test(e.message));

  // 2. applyDiscrimination crea CONFIRMATION, nunca EVIDENCE
  g = attach(goal([chal('CORRECT')]));
  const mm = p.startMixed(g, 'confirm', src);
  const item = { item_id: 'conf-1', node_id: 'a', prompt: 'q', options: [] };
  mm.items = [item];
  const ok = p.applyDiscrimination(g, item, { status: 'CORRECT', item_id: 'conf-1', node_id: 'a' }, 'att-1', 'x', 80);
  assert.equal(ok, true);
  const ev = g.events.filter(e => e.type === 'CONFIRMATION');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].confirms_type, 'CHALLENGE_REPORT');
  assert.equal(ev[0].confirms_attempt_id, 'c1');
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0, 'nunca se crea EVIDENCE');
  assert.throws(() => p.applyDiscrimination(g, item, { status: 'CORRECT', item_id: 'conf-1', node_id: 'a' }, 'att-1', 'x', 80), /ya no está activa/, 'tras terminar no se vuelve a aplicar');
  assert.equal(g.events.filter(e => e.type === 'CONFIRMATION').length, 1, 'un solo evento');

  // 3. expertOutcome
  assert.equal(p.expertOutcome({ type: 'CONFIRMATION', status: 'CORRECT' }), true);
  assert.equal(p.expertOutcome({ type: 'CONFIRMATION', status: 'MISCONCEPTION' }), false);
  assert.equal(p.expertOutcome({ type: 'CONFIRMATION', status: 'UNKNOWN' }), null);

  // 4. transferencia
  const tr = (events) => p.expertLayers(attach(goal(events)), 'a').layers.transfer;
  assert.equal(tr([chal('CORRECT'), conf('CORRECT', 'CHALLENGE_REPORT', 'c1')]), 'met');
  assert.equal(tr([chal('PARTIAL'), conf('CORRECT', 'CHALLENGE_REPORT', 'c1')]), 'partial');
  assert.notEqual(tr([conf('CORRECT', 'CHALLENGE_REPORT', 'c1')]), 'met', 'sin reto de origen no cuenta');
  assert.equal(tr([chal('CORRECT'), conf('MISCONCEPTION', 'CHALLENGE_REPORT', 'c1')]), 'none');
  assert.equal(tr([chal('CORRECT')]), 'none', 'solo el reto provisional no cambia la capa');
  assert.equal(tr([chal('CORRECT', 'c1'), conf('CORRECT', 'CHALLENGE_REPORT', 'otro')]), 'none', 'la confirmación debe apuntar a su reto');

  // 5. comprensión
  const comp = (events) => p.expertLayers(attach(goal(events)), 'a').layers.comprehension;
  assert.equal(comp([{ type: 'BETO_SESSION', node_id: 'a', session_id: 'b1', status: 'CORRECT', provisional: true }, conf('CORRECT', 'BETO_SESSION', 'b1')]), 'met');
  assert.equal(comp([{ type: 'BETO_SESSION', node_id: 'a', session_id: 'b1', status: 'CORRECT', provisional: true }]), 'none', 'Beto solo no cuenta');
  assert.equal(comp([conf('CORRECT', 'ERROR_FIX', 'f1')]), 'met');
  assert.equal(comp([conf('UNKNOWN', 'ERROR_FIX', 'f1')]), 'none', 'No lo sé no cuenta');
  assert.equal(comp([conf('MISCONCEPTION', 'ERROR_FIX', 'f1')]), 'partial');

  // 6. un fallo adelanta el repaso
  g = attach(goal([chal('CORRECT')]));
  const m3 = p.startMixed(g, 'confirm', src);
  const it3 = { item_id: 'conf-2', node_id: 'a', prompt: 'q', options: [] };
  m3.items = [it3];
  const before = g.reviews[0].due;
  p.applyDiscrimination(g, it3, { status: 'MISCONCEPTION', item_id: 'conf-2', node_id: 'a', selected_misconception: 'x' }, 'att-2', 'y', 60);
  assert.ok(g.reviews[0].due < before, 'el repaso se adelanta');

  // 7. etiqueta y botón
  assert.equal(p.humanLabel('CONFIRMATION'), 'Confirmación', 'la etiqueta ya existía para la fase; no se pisa');
  g = attach(goal([chal('CORRECT'), conf('CORRECT', 'CHALLENGE_REPORT', 'c1')]));
  assert.equal(p.confirmButton(g, 'a', 'CHALLENGE_REPORT', 'c1', () => {}), null, 'no se ofrece dos veces');
  assert.ok(p.confirmButton(g, 'a', 'CHALLENGE_REPORT', 'c2', () => {}), 'se ofrece si no hay confirmación');
  console.log('local_confirmation: OK');
})();
