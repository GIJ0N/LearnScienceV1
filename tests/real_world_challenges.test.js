// real_world_challenges_v1: estado del reto, predicción bloqueada, resultado provisional, sin EVIDENCE.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; } }; }
global.document = { getElementById: () => element(), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');
const DAY = 86400000;
const node = id => ({ id, name: 'T-' + id, outcome: 'o', level: 0, prerequisites: [], kind: 'concept', probe: { prompt: 'p', kind: 'explanation' } });
const goal = (reviews = [{ id: 'a', due: Date.now() + 9 * DAY, step: 4, question: null, history: [] }]) => ({ id: 'g1', goal: 'M', nodes: [node('a'), node('b')], learner: {}, coverage: [], reviews, lessons: {},
  session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 }, events: [{ type: 'TEACHING_EXPOSURE', node_id: 'a', at: Date.now() - 5 * DAY }] });
const attach = g => { p.setStoreForTests({ goals: [g], active: g.id }); return g; };
const commitRes = c => ({ item_id: c.item_id, node_id: c.node_id, stage: 'commit', prediction: 'Creo que caerá más rápido la pesada', confidence: 70,
  materials: ['hoja', 'libro'], steps: ['Suelta ambos', 'Mide el tiempo'], evidence_fields: [{ id: 'tiempo', label: 'Tiempo' }, { id: 'orden', label: 'Cuál cayó primero' }], safety_note: 'Hazlo a poca altura.' });
const reportRes = (c, status, extra = {}) => ({ item_id: c.item_id, node_id: c.node_id, stage: 'report', status, prediction_match: 'YES', feedback: 'Bien por el dato.', next_step: 'Repite con otro objeto.', provisional: true, ...extra });
const ready = g => { const c = p.startChallenge(g); c.item_id = 'chal-1'; c.pub = { title: 'Caída', scenario: 's', prediction_prompt: '¿Cuál cae primero?', minutes: 15 }; c.stage = 'prediction'; return c; };

(() => {
  let g = attach(goal([]));
  assert.equal(p.challengeAvailable(g), false, 'sin tema aprendido no se ofrece');
  assert.throws(() => p.startChallenge(g), /tema aprendido/);

  g = attach(goal());
  assert.equal(p.challengeAvailable(g), true);
  const c = ready(g);
  assert.equal(c.status, 'active');
  assert.equal(p.challengeAvailable(g), false, 'no se ofrece con un reto en curso');
  assert.throws(() => p.startChallenge(g), /en curso/);
  assert.equal(p.betoAvailable(g) || p.mixedAvailable(g) || p.errorHuntAvailable(g), false, 'las demás prácticas esperan');

  // La predicción debe bloquearse antes de poder informar.
  assert.throws(() => p.applyChallengeReport(g, reportRes(c, 'SUPPORTED'), 'r0'), /no espera un informe/);
  assert.throws(() => p.applyChallengeCommit(g, { ...commitRes(c), item_id: 'otro' }, 'c1'), /no corresponde/);
  assert.throws(() => p.applyChallengeCommit(g, { ...commitRes(c), stage: 'report' }, 'c1'), /no corresponde/);
  assert.throws(() => p.applyChallengeCommit(g, { ...commitRes(c), steps: null }, 'c1'), /no corresponde/);
  assert.equal(p.applyChallengeCommit(g, commitRes(c), 'c1'), true);
  assert.equal(c.stage, 'doing');
  assert.equal(c.commit_attempt_id, 'c1');
  assert.equal(c.task.steps.length, 2);
  assert.throws(() => p.applyChallengeCommit(g, commitRes(c), 'c2'), /no espera una predicción/, 'no se puede re-bloquear');

  // Datos insuficientes: sin evento y se puede reenviar.
  assert.equal(p.applyChallengeReport(g, reportRes(c, 'INSUFFICIENT', { feedback: 'Faltan datos.' }), 'r1'), 'INSUFFICIENT');
  assert.equal(c.stage, 'doing');
  assert.equal(c.note, 'Faltan datos.');
  assert.equal(g.events.filter(e => e.type === 'CHALLENGE_REPORT').length, 0);
  assert.throws(() => p.applyChallengeReport(g, reportRes(c, 'GENIAL'), 'r1'), /no corresponde/);

  // Respaldado: evento provisional, nunca EVIDENCE, no toca el repaso.
  const before = JSON.stringify(g.reviews);
  assert.equal(p.applyChallengeReport(g, reportRes(c, 'SUPPORTED'), 'r2'), true);
  assert.equal(c.stage, 'done');
  const ev = g.events.find(e => e.type === 'CHALLENGE_REPORT');
  assert.deepEqual([ev.status, ev.provisional, ev.prediction_confidence, ev.prediction_match, ev.policy_version], ['CORRECT', true, 70, 'YES', 'real_world_challenges_v1']);
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0);
  assert.equal(JSON.stringify(g.reviews), before);
  assert.equal(p.expertOutcome(ev), null, 'el panel experto ignora lo provisional');
  assert.throws(() => p.applyChallengeReport(g, reportRes(c, 'SUPPORTED'), 'r2'), /no espera un informe/);
})();

(() => {
  // NOT_SUPPORTED adelanta el repaso; PARTIAL no lo toca.
  let g = attach(goal());
  let c = ready(g); p.applyChallengeCommit(g, commitRes(c), 'c1');
  const due0 = g.reviews[0].due;
  p.applyChallengeReport(g, reportRes(c, 'NOT_SUPPORTED', { prediction_match: 'NO' }), 'r1');
  assert.equal(g.events.at(-1).status, 'MISCONCEPTION');
  assert.ok(g.reviews[0].due < due0, 'adelanta el repaso');

  g = attach(goal());
  c = ready(g); p.applyChallengeCommit(g, commitRes(c), 'c1');
  const due1 = g.reviews[0].due;
  p.applyChallengeReport(g, reportRes(c, 'PARTIAL', { prediction_match: 'PARTIAL' }), 'r1');
  assert.equal(g.events.at(-1).status, 'PARTIAL');
  assert.equal(g.reviews[0].due, due1);
  assert.equal(g.events.some(e => e.type === 'EVIDENCE'), false);
})();
console.log('real_world_challenges.test.js OK');
