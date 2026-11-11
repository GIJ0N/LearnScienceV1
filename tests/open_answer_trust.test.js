// open_answer_trust_v1: los aciertos calificados solo por el modelo cuentan para suficiencia si el tema tiene un ancla local.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; }, addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {} } }; }
global.document = { getElementById: () => element('main'), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');
const NOW = Date.UTC(2026, 10, 10, 12);
p.setClockForTests(() => NOW);

let n = 0;
const ok = extra => { n++; return { type: 'EVIDENCE', evidence_id: 'e' + n, attempt_id: 'a' + n, activity_id: 'act' + n, node_id: 'a', phase: 'INDEPENDENT', result: 'CORRECT', status: 'CORRECT', is_independent: true, help_used: 0, observed_dimensions: ['conceptual'], question: { prompt: 'pregunta distinta ' + n }, timestamp: NOW - 1000 + n, evidence_role: 'learning', ...extra }; };
const model = () => ok({ evaluator_trust: 'model_single', trust_policy_version: p.TRUST_POLICY_VERSION });
const local = () => ok({ evaluator_trust: 'deterministic', trust_policy_version: p.TRUST_POLICY_VERSION });
const legacy = () => ok({});
const fail = () => { n++; return { type: 'EVIDENCE', evidence_id: 'f' + n, attempt_id: 'f' + n, node_id: 'a', result: 'MISCONCEPTION', status: 'MISCONCEPTION', observed_dimensions: ['conceptual'], timestamp: NOW - 1000 + n }; };
const anchor = (id = 'src') => ({ type: 'TRUST', status: 'CORRECT', source_attempt_id: id, timestamp: NOW - 1000 + (++n) });
const dim = evidence => ({ id: 'conceptual', name: 'Comprensión', required: true, evidence });

assert.equal(p.TRUST_POLICY_VERSION, 'open_answer_trust_v1');

// 2 aciertos model_single nuevos sin ancla → no suficiente; con ancla → suficiente.
assert.equal(p.sufficient(dim([model(), model()])), false);
assert.equal(p.sufficient(dim([model(), model(), anchor()])), true);
assert.equal(p.sufficient(dim([anchor(), model(), model()])), true);

// Ancla, contradicción, 2 aciertos → no suficiente hasta ancla nueva.
assert.equal(p.sufficient(dim([anchor(), fail(), model(), model()])), false);
assert.equal(p.sufficient(dim([anchor(), fail(), model(), model(), anchor('src2')])), true);

// Eventos anteriores a esta política (sin trust_policy_version) cuentan como hoy.
assert.equal(p.sufficient(dim([legacy(), legacy()])), true);

// Aciertos deterministas cuentan sin ancla.
assert.equal(p.sufficient(dim([local(), local()])), true);

// El marcador no es contradicción, ni acierto, ni intento.
const marker = anchor();
assert.equal(p.sufficient(dim([marker])), false);
assert.equal(p.independentSuccesses(dim([marker])).length, 0, 'el marcador no es un intento');
assert.equal(p.independentSuccesses(dim([marker, model()])).length, 1);
assert.equal(p.independentSuccesses(dim([model(), marker])).length, 1);
const cov = { dimensions: [dim([marker])] };
const derived = p.deriveCoverage(cov);
assert.equal(derived.dimensions[0].status, 'UNKNOWN', 'un marcador solo no es un acierto');
// el marcador no tapa una dificultad reciente en learningState
const g0 = { id: 'g', nodes: [{ id: 'a', name: 'A', outcome: 'o', prerequisites: [] }], events: [], reviews: [], coverage: [{ id: 'a', dimensions: [dim([fail(), anchor()])] }] };
const st = p.learningState(g0, 'a', NOW);
assert.ok(st.dimensions ? st.dimensions.some(d => d.difficulty) : JSON.stringify(st).includes('RECENT_DIFFICULTY'));

// activityEvidence marca la confianza y la versión de política.
const ev1 = p.activityEvidence({ prompt: 'p', kind: 'explanation' }, { status: 'CORRECT' }, 0, {});
assert.equal(ev1.evaluator_trust, 'model_single');
assert.equal(ev1.trust_policy_version, 'open_answer_trust_v1');
assert.equal(p.activityEvidence({ prompt: 'p' }, { status: 'CORRECT', evaluator_version: 'local-production-v1' }, 0, {}).evaluator_trust, 'deterministic');
assert.equal(p.activityEvidence({ prompt: 'p' }, { status: 'CORRECT', evaluator_version: 'placement-key-v1' }, 0, {}).evaluator_trust, 'deterministic');
assert.equal(p.activityEvidence({ prompt: 'p' }, { status: 'CORRECT' }, 0, { corrected: true }).evaluator_trust, 'user');

// createTrustAnchor: evento + marcador en todas las dimensiones; idempotente; otro tema no se ve afectado.
const goal = { id: 'g', nodes: [{ id: 'a', name: 'A', outcome: 'o', prerequisites: [] }, { id: 'b', name: 'B', outcome: 'o', prerequisites: [] }], events: [], reviews: [], coverage: [] };
assert.equal(p.createTrustAnchor(goal, 'a', 'PRODUCTION', 'att1', NOW), true);
assert.equal(p.createTrustAnchor(goal, 'a', 'PRODUCTION', 'att1', NOW), false);
const anchors = goal.events.filter(e => e.type === 'TRUST_ANCHOR');
assert.equal(anchors.length, 1);
assert.equal(anchors[0].source, 'PRODUCTION');
const cA = goal.coverage.find(c => c.id === 'a');
assert.ok(cA.dimensions.length >= 2);
for (const d of cA.dimensions) assert.equal(d.evidence.filter(x => x.type === 'TRUST').length, 1);
assert.equal(p.trustAnchored(goal, 'a'), true);
assert.equal(p.trustAnchored(goal, 'b'), false, 'ancla de otro tema no sirve');
assert.equal(goal.events.filter(e => e.type === 'EVIDENCE').length, 0, 'el ancla no es un intento');

// anchorNeed: 2 aciertos del modelo sin ancla ofrecen confirmar; con ancla o confirmación hecha no.
const g2 = { id: 'g', nodes: goal.nodes, events: [], reviews: [], coverage: [{ id: 'a', dimensions: [dim([model(), model()])] }] };
const need = p.anchorNeed(g2, 'a');
assert.ok(need);
g2.events.push({ type: 'CONFIRMATION', confirms_type: 'OPEN_ANSWER', confirms_attempt_id: need, status: 'MISCONCEPTION', node_id: 'a' });
assert.equal(p.anchorNeed(g2, 'a'), null, 'ya confirmada esa respuesta');
assert.equal(p.trustAnchored(g2, 'a'), false, 'MISCONCEPTION no crea ancla');
const g3 = { id: 'g', nodes: goal.nodes, events: [], reviews: [], coverage: [{ id: 'a', dimensions: [dim([model(), model(), anchor()])] }] };
assert.equal(p.anchorNeed(g3, 'a'), null);

// Auditoría del plan: el ancla nace por el flujo real de confirmación (applyDiscrimination), solo con OPEN_ANSWER y CORRECT.
{
  p.setProfileForTests({ profile_id: 'profile-test', name: 'S', preferences: {} }, 1);
  const mk = () => { const g = { id: 'g', profile_id: 'profile-test', goal: 'Meta', nodes: goal.nodes, learner: {}, reviews: [{ id: 'a', due: NOW + 9 * 86400000, step: 1, history: [] }], lessons: {}, events: [], coverage: [{ id: 'a', name: 'a', dimensions: [dim([model(), model()])] }], session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 } }; p.setStoreForTests({ goals: [g], active: g.id }); return g; };
  const run = (g, type, status, n) => { const m = p.startMixed(g, 'confirm', { node_id: 'a', source_type: type, source_attempt_id: 'src-' + n }); const item = { item_id: 'conf-' + n, node_id: 'a', prompt: 'q', options: [] }; m.items = [item]; p.applyDiscrimination(g, item, { status, item_id: item.item_id, node_id: 'a' }, 'att-' + n, status === 'UNKNOWN' ? null : 'x', 80); g.mixed = null; };
  let g = mk();
  run(g, 'OPEN_ANSWER', 'MISCONCEPTION', 1);
  assert.equal(p.trustAnchored(g, 'a'), false, 'MISCONCEPTION no crea ancla');
  assert.ok(g.reviews[0].due <= NOW + 86400000, 'el fallo adelanta el repaso');
  run(g, 'OPEN_ANSWER', 'UNKNOWN', 2);
  assert.equal(p.trustAnchored(g, 'a'), false, 'UNKNOWN no crea ancla');
  run(g, 'BETO_SESSION', 'CORRECT', 3);
  assert.equal(p.trustAnchored(g, 'a'), false, 'otro confirms_type no crea ancla');
  assert.equal(p.sufficient(g.coverage[0].dimensions[0]), false);
  g = mk();
  run(g, 'OPEN_ANSWER', 'CORRECT', 4);
  assert.equal(p.trustAnchored(g, 'a'), true);
  assert.equal(g.events.filter(e => e.type === 'TRUST_ANCHOR' && e.source === 'CONFIRMATION' && e.source_attempt_id === 'src-4').length, 1);
  assert.equal(p.sufficient(g.coverage[0].dimensions[0]), true, 'con ancla los dos aciertos del modelo ya cuentan');
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0, 'la confirmación nunca crea EVIDENCE');
}

// Auditoría del plan: tras UN acierto abierto en práctica independiente, integración o repaso se ofrece confirmar (sin esperar al segundo).
{
  const open = (phase, extra = {}) => ({ ...model(), phase, ...extra });
  const mk = ev => ({ id: 'g', nodes: goal.nodes, reviews: [], events: [ev], coverage: [{ id: 'a', dimensions: [dim([ev])] }] });
  for (const phase of ['INDEPENDENT', 'INTEGRATE', 'REVIEW']) assert.ok(p.anchorSuggest(mk(open(phase)), 'a'), phase);
  assert.equal(p.anchorSuggest(mk(open('GUIDED')), 'a'), null, 'la práctica guiada no lo ofrece');
  assert.equal(p.anchorSuggest(mk(open('INDEPENDENT', { result: 'MISCONCEPTION', status: 'MISCONCEPTION' })), 'a'), null);
  assert.equal(p.anchorSuggest(mk({ ...local(), phase: 'INDEPENDENT' }), 'a'), null, 'acierto determinista no necesita confirmación');
  assert.equal(p.anchorSuggest(mk({ ...legacy(), phase: 'INDEPENDENT' }), 'a'), null, 'eventos anteriores a la política no la piden');
  const anchoredGoal = mk(open('INDEPENDENT')); anchoredGoal.coverage[0].dimensions[0].evidence.push(anchor());
  assert.equal(p.anchorSuggest(anchoredGoal, 'a'), null, 'con ancla no se ofrece');
  const done = mk(open('INDEPENDENT')); done.events.push({ type: 'CONFIRMATION', confirms_attempt_id: done.events[0].attempt_id, status: 'MISCONCEPTION', node_id: 'a' });
  assert.equal(p.anchorSuggest(done, 'a'), null, 'esa respuesta ya se confirmó');
  // Con otra práctica activa no se ofrece; sin ella sí, y solo el caso de 2 aciertos muestra «Falta…».
  const el = () => ({ textContent: '', children: [], append(...x) { this.children.push(...x); } });
  const one = mk(open('INDEPENDENT'));
  const offer = p.anchorOffer(one, 'a');
  assert.ok(offer.children.some(c => c.textContent === 'Confirma con una pregunta rápida'));
  assert.equal(offer.children.some(c => c.textContent === 'Falta una confirmación rápida'), false);
  assert.equal(p.anchorOffer({ ...one, mixed: { status: 'active' } }, 'a'), null);
  const two = { id: 'g', nodes: goal.nodes, reviews: [], events: [], coverage: [{ id: 'a', dimensions: [dim([model(), model()])] }] };
  assert.ok(p.anchorOffer(two, 'a').children.some(c => c.textContent === 'Falta una confirmación rápida'));
}

console.log('OK open_answer_trust');
