// step_lessons_v1: la máquina de estados del paso nunca crea EVIDENCE y es idempotente.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; } }; }
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: id => (id === 'app' ? roots.app : roots.status), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');

const check = (n, id = 'step-' + n) => ({ item_id: id, node_id: 'n1', prompt: 'Caso ' + n, options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }] });
const step = n => ({ step_id: 's' + n, predict: { prompt: '¿Qué pasa ' + n + '?' }, resolution: 'Res ' + n, body: 'Cuerpo ' + n, check: check(n) });
function goal(steps = [step(1), step(2)]) {
  return { id: 'g1', goal: 'M', nodes: [{ id: 'n1', name: 'n1', prerequisites: [] }], learner: {}, coverage: [], events: [], reviews: [],
    lessons: { n1: { explanation: 'e', example: 'x', common_error: 'c', steps } }, session: { mode: 'TEACH', node: 'n1', stack: [], tries: 0, hints: 0 } };
}
const attach = g => { p.setStoreForTests({ goals: [g], active: g.id }); return g; };
const result = (status, item, extra = {}) => ({ status, item_id: item.item_id, node_id: 'n1', selected_misconception: status === 'MISCONCEPTION' ? 'idea errónea' : '', ...extra });
const types = g => g.events.map(e => e.type);
const noEvidence = g => assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0);

(() => {
  // Lección válida vs incompleta.
  assert.equal(p.stepsReady(goal().lessons.n1), true);
  assert.equal(p.stepsReady({ steps: [step(1)] }), false, 'una sola pieza no es una secuencia');
  assert.equal(p.stepsReady({ steps: [step(1), { ...step(2), check: null }] }), false);
  assert.equal(p.stepsReady({}), false);

  // Camino feliz: predecir → enseñar → comprobar → avanzar, sin EVIDENCE.
  const g = attach(goal());
  assert.equal(p.stepState(g, 'n1').stage, 'predict');
  assert.throws(() => p.openStepCheck(g, 'n1'), /ya no está activo/);
  p.submitStepPrediction(g, 'n1', 'creo que flota', 80);
  assert.equal(p.stepState(g, 'n1').stage, 'teach');
  assert.throws(() => p.submitStepPrediction(g, 'n1', 'otra', 50), /ya no está activo/);
  p.openStepCheck(g, 'n1');
  const c1 = p.activeStepCheck(g, 'n1');
  assert.equal(p.applyStepCheck(g, 'n1', c1, result('CORRECT', c1), 'at1', 'a', 90), true);
  assert.equal(p.stepState(g, 'n1').index, 1);
  assert.equal(p.stepState(g, 'n1').stage, 'predict');
  noEvidence(g);
  const ev = g.events.find(e => e.type === 'STEP_CHECK');
  assert.equal(ev.status, 'CORRECT');
  assert.equal(ev.learner_confidence, 90);
  assert.ok(ev.calibration_signal);

  // «No sé» en la predicción se registra sin confianza y no es un fallo.
  p.submitStepPrediction(g, 'n1', '', 99);
  const pred = g.events.filter(e => e.type === 'PREDICTION').pop();
  assert.equal(pred.dont_know, true);
  assert.equal(pred.learner_confidence, null);
  p.openStepCheck(g, 'n1');
  const c2 = p.activeStepCheck(g, 'n1');

  // Comprobación incorrecta de otro ítem o resultado ajeno se rechaza.
  assert.throws(() => p.applyStepCheck(g, 'n1', check(9), result('CORRECT', check(9)), 'bad', 'a', 50), /ya no está activa/);
  assert.throws(() => p.applyStepCheck(g, 'n1', c2, { ...result('CORRECT', c2), item_id: 'otro' }, 'bad2', 'a', 50), /no corresponde/);
  assert.throws(() => p.applyStepCheck(g, 'n1', c2, { ...result('CORRECT', c2), status: 'MAYBE' }, 'bad3', 'a', 50), /no corresponde/);

  // Fallo → reparación (con nueva comprobación) → acierto.
  assert.equal(p.applyStepCheck(g, 'n1', c2, result('MISCONCEPTION', c2), 'at2', 'b', 95), true);
  assert.equal(p.stepState(g, 'n1').stage, 'repair');
  assert.equal(p.applyStepCheck(g, 'n1', c2, result('MISCONCEPTION', c2), 'at2', 'b', 95), false, 'mismo attempt_id no duplica');
  assert.throws(() => p.applyStepCheck(g, 'n1', c2, result('CORRECT', c2), 'at3', 'a', 50), /ya no está activa/, 'en reparación no se acepta el ítem viejo');
  assert.equal(g.events.filter(e => e.type === 'STEP_CHECK' && e.attempt_id === 'at2').length, 1);
  assert.equal(g.events.filter(e => e.type === 'STEP_CHECK').pop().calibration_signal, 'committed_misconception');
  assert.throws(() => p.applyStepRepair(g, 'n1', { body: '', check: check(7) }), /incompleta/);
  p.applyStepRepair(g, 'n1', { body: 'Otra forma', check: check(7, 'rep-7') });
  assert.equal(p.stepState(g, 'n1').stage, 'teach');
  p.openStepCheck(g, 'n1');
  const rep = p.activeStepCheck(g, 'n1');
  assert.equal(rep.item_id, 'rep-7');
  p.applyStepCheck(g, 'n1', rep, result('CORRECT', rep), 'at4', 'a', 60);
  assert.equal(p.stepFinished(g, 'n1'), true);
  noEvidence(g);

  // Terminar fija COMPREHENSION; antes de tiempo se rechaza.
  p.finishStepLesson(g, 'n1');
  assert.equal(g.session.mode, 'COMPREHENSION');
  assert.equal(g.session.step, null);
  noEvidence(g);
})();

(() => {
  // Tras MAX reparaciones el paso queda sin resolver y la lección continúa.
  const g = attach(goal());
  p.submitStepPrediction(g, 'n1', 'x', 50);
  p.openStepCheck(g, 'n1');
  for (let i = 0; i <= p.STEP_MAX_REPAIRS; i++) {
    const c = p.activeStepCheck(g, 'n1');
    p.applyStepCheck(g, 'n1', c, result('MISCONCEPTION', c), 'f' + i, 'b', 90);
    if (i < p.STEP_MAX_REPAIRS) { p.applyStepRepair(g, 'n1', { body: 'r' + i, check: check(50 + i) }); p.openStepCheck(g, 'n1'); }
  }
  assert.ok(g.events.some(e => e.type === 'STEP_UNRESOLVED' && e.step_id === 's1'));
  assert.equal(p.stepState(g, 'n1').index, 1, 'avanza al siguiente paso');
  assert.deepEqual(p.stepState(g, 'n1').unresolved, ['s1']);
  assert.throws(() => p.finishStepLesson(g, 'n1'), /Faltan/);
  noEvidence(g);
})();

(() => {
  // Si la lección regenerada cambia, el estado de pasos se reinicia (no hereda índice).
  const g = attach(goal());
  p.submitStepPrediction(g, 'n1', 'x', 50);
  g.lessons.n1.steps = [step(11), step(12)];
  assert.equal(p.stepState(g, 'n1').index, 0);
  assert.equal(p.stepState(g, 'n1').stage, 'predict');
})();
console.log('OK: step lessons state machine');
