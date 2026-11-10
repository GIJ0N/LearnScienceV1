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

console.log('OK open_answer_trust');
