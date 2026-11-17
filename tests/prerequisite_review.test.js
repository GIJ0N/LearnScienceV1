// prerequisite_review_v1 (cliente): >=2 fallos de aprendizaje de X con error_type=prerequisite, en intentos distintos y posteriores al
// último acierto independiente de X, proponen revisar P SOLO si la arista X->P ya existe. Sin evidencia, sin aristas nuevas, sin red.
const assert = require('node:assert/strict');

function element(type = 'div') {
  return { type, textContent: '', value: '', disabled: false, children: [], className: '', append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; }, setAttribute() {}, setProperty() {}, style: {}, onclick: null };
}
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: id => (id === 'app' ? roots.app : roots.status), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
let modelCalls = 0;
global.fetch = async () => { modelCalls += 1; throw new Error('La prueba no permite red.'); };
const policy = require('../app.js');
const DAY = 24 * 60 * 60 * 1000;
let clockValue = 1_800_000_000_000;
policy.setClockForTests(() => clockValue);
const tick = (ms = 60_000) => { clockValue += ms; };

function node(id, name, prerequisites = [], level = 0) {
  return { id, name, outcome: 'Usar ' + name, level, prerequisites, kind: 'concept', probe: { prompt: 'Explica ' + name, kind: 'explanation' } };
}
// p <- x <- y ; z es independiente (sin arista con x).
function goal({ edge = true, profile = 'perfil-a', id = 'goal-prq' } = {}) {
  const nodes = [node('p', 'Fracciones', [], 0), node('x', 'Proporciones', edge ? ['p'] : [], 1), node('y', 'Escalas', ['x'], 2), node('z', 'Unidades', [], 0)];
  const g = {
    id, profile_id: profile, goal: 'Meta', nodes, learner: {}, events: [], reviews: [], lessons: {},
    coverage: nodes.map(n => ({ id: n.id, name: n.name, status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] })),
    session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 },
  };
  policy.setStoreForTests({ goals: [g], active: g.id });
  return g;
}
let seq = 0;
const contract = (id, stage = 'INDEPENDENT', role = 'independent_practice') => policy.normalizeActivityContract({ activity_id: 'act-' + id + '-' + (++seq), node_id: id, stage, kind: 'application', observable_dimensions: ['conceptual'], supports_independence: true, role });
function fail(g, id, attempt, errorType = 'prerequisite', status = 'PARTIAL', stage = 'INDEPENDENT', role = 'independent_practice') {
  tick();
  return policy.record(g, id, stage, 'r', { status, error_type: errorType, feedback: '', hint: '' }, 0, contract(id, stage, role), attempt);
}
function ok(g, id, attempt) { tick(); return policy.record(g, id, 'INDEPENDENT', 'r', { status: 'CORRECT', error_type: 'none', feedback: '', hint: '' }, 0, contract(id), attempt); }
// P saltado por el diagnóstico, con su repaso programado en 4 días.
function skipP(g) {
  tick();
  g.events.push({ type: 'PLACEMENT_SKIP', node_id: 'p', basis: 'probed', at: clockValue, policy_version: 'placement_v1' });
  g.reviews.push({ id: 'p', due: clockValue + 4 * DAY, step: 0, history: [], question: null, origin_attempt_id: null });
}
const proposals = g => g.events.filter(e => e.type === 'PREREQUISITE_REVIEW');
const revokes = g => g.events.filter(e => e.type === 'PREREQUISITE_REVIEW_REVOKED');

// 1. Un solo fallo NO dispara (regla única: antes un fallo reabría el salto); P sigue saltado.
{
  const g = goal(); skipP(g);
  fail(g, 'x', 'a1');
  assert.equal(policy.prqFailures(g, 'x').length, 1);
  assert.equal(proposals(g).length, 0);
  assert.equal(policy.placementSkipped(g, 'p'), true, 'un fallo ya no anula el salto');
  assert.deepEqual(policy.prerequisiteReviews(g), []);
}

// 2. Dos fallos en intentos distintos: propuesta, evento sin node_id y sin evidencia, P pasa de skipped a ready, repaso adelantado.
{
  const g = goal(); skipP(g);
  const dueBefore = g.reviews[0].due, evidenceBefore = g.events.filter(e => e.type === 'EVIDENCE' && e.node_id === 'p').length;
  fail(g, 'x', 'a1'); fail(g, 'x', 'a2');
  const props = proposals(g);
  assert.equal(props.length, 1);
  const ev = props[0];
  assert.equal(ev.node_id, undefined, 'el evento no lleva node_id');
  assert.equal('node_id' in ev, false);
  assert.equal(ev.creates_evidence, false);
  assert.equal(ev.source_node_id, 'x'); assert.equal(ev.prerequisite_node_id, 'p');
  assert.deepEqual(ev.source_attempt_ids, ['a1', 'a2']); assert.equal(ev.action, 'unskip'); assert.equal(ev.policy_version, 'prerequisite_review_v1');
  assert.equal(policy.placementSkipped(g, 'p'), false);
  assert.ok(g.reviews[0].due < dueBefore, 'el repaso programado se adelanta');
  assert.equal(g.reviews[0].due, ev.review_to_due); assert.equal(ev.review_from_due, dueBefore);
  // Nunca crea evidencia, cobertura ni dominio en P; no borra la evidencia ni los eventos de P.
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE' && e.node_id === 'p').length, evidenceBefore);
  assert.equal(g.events.filter(e => e.type === 'PLACEMENT_SKIP' && e.node_id === 'p').length, 1, 'PLACEMENT_SKIP no se borra');
  assert.equal(JSON.stringify(g.coverage.find(c => c.id === 'p')), JSON.stringify({ id: 'p', name: 'Fracciones', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] }));
  assert.equal(policy.verified(g, 'p'), false);
  // Idempotente: repetir la sincronización o un tercer fallo no duplica la propuesta.
  policy.prerequisiteReviewSync(g); policy.prerequisiteReviewSync(g); fail(g, 'x', 'a3');
  assert.equal(proposals(g).length, 1);
  // Todos los eventos nuevos son del libro mayor: ninguno con node_id.
  assert.ok(g.events.filter(e => /^PREREQUISITE_REVIEW/.test(e.type)).every(e => !('node_id' in e) && e.creates_evidence === false));
}

// 3. Estado y texto: P `ready`; X y sus dependientes NO `locked` con evidencia propia; frase llana sin números; el selector pone P antes.
{
  const g = goal(); skipP(g);
  fail(g, 'x', 'a1');
  let plan = policy.studyPlan(g, clockValue);
  const t = id => plan.groups.flatMap(x => x.topics).find(x => x.node_id === id);
  assert.equal(t('p').state, 'skipped');
  assert.equal(t('x').state, 'ready', 'sin propuesta, P saltado deja X listo (comportamiento anterior)'); assert.deepEqual(t('x').missing, []);
  fail(g, 'x', 'a2');
  plan = policy.studyPlan(g, clockValue);
  assert.equal(t('p').state, 'ready', 'P pasa de skipped a ready');
  assert.deepEqual(t('x').missing, [{ id: 'p', name: 'Fracciones' }], 'P vuelve a faltar como prerrequisito');
  assert.notEqual(t('x').state, 'locked', 'X tiene evidencia propia: no se ve bloqueado');
  assert.notEqual(t('y').state, 'locked', 'los dependientes de X tampoco');
  assert.equal(t('z').state, 'ready');
  const sentence = 'Vamos a repasar «Fracciones» antes porque «Proporciones» depende de «Fracciones».';
  assert.equal(t('p').review_reason, sentence);
  assert.ok(!/\d/.test(t('p').review_reason), 'sin números técnicos');
  assert.equal(t('x').review_reason, null);
  const decision = policy.selectTutorAction(g, clockValue, { reselect: true });
  assert.equal(decision.node_id, 'p', 'el selector pone P antes que X');
  assert.equal(decision.reason, sentence);
  assert.ok(['REVIEW', 'PREREQUISITE', 'INTRODUCE'].includes(decision.action));
  assert.equal(plan.next.node_id, 'p');
}

// 4. Sin disparador el selector NO mueve P antes que X (solo el caso del disparador).
{
  const g = goal(); skipP(g); fail(g, 'x', 'a1');
  const d = policy.selectTutorAction(g, clockValue, { reselect: true });
  assert.ok(!/Vamos a repasar/.test(d.reason));
  const g2 = goal(); fail(g2, 'x', 'b1', 'algebra'); fail(g2, 'x', 'b2', 'algebra');
  assert.equal(proposals(g2).length, 0, 'otro error_type no dispara');
}

// 5. Lo que NO cuenta: diagnóstico, UNKNOWN, otro error_type, duplicado, tras un acierto independiente.
{
  const g = goal(); skipP(g);
  fail(g, 'x', 'd1', 'prerequisite', 'MISCONCEPTION', 'DIAGNOSTIC', 'diagnostic_probe');
  fail(g, 'x', 'd2', 'prerequisite', 'MISCONCEPTION', 'DIAGNOSTIC', 'diagnostic_probe');
  fail(g, 'x', 'u1', 'prerequisite', 'UNKNOWN'); fail(g, 'x', 'u2', 'prerequisite', 'UNKNOWN');
  assert.equal(policy.prqFailures(g, 'x').length, 0); assert.equal(proposals(g).length, 0);
  const dupAct = contract('x'), dupResult = { status: 'PARTIAL', error_type: 'prerequisite', feedback: '', hint: '' };
  tick(); policy.record(g, 'x', 'INDEPENDENT', 'r', dupResult, 0, dupAct, 'dup1');
  assert.throws(() => policy.record(g, 'x', 'INDEPENDENT', 'r', dupResult, 0, dupAct, 'dup1'), error => error.code === 'DUPLICATE_ATTEMPT');
  assert.equal(policy.prqFailures(g, 'x').length, 1); assert.equal(proposals(g).length, 0, 'el duplicado no cuenta dos veces');
  ok(g, 'x', 'ind1'); // acierto independiente: los fallos anteriores ya no cuentan
  fail(g, 'x', 'late1');
  assert.deepEqual(policy.prqFailures(g, 'x'), ['late1']); assert.equal(proposals(g).length, 0);
  fail(g, 'x', 'late2');
  assert.equal(proposals(g).length, 1); assert.deepEqual(proposals(g)[0].source_attempt_ids, ['late1', 'late2']);
}

// 6. Corrección manual que anula el disparador: revoca (sin node_id, sin evidencia), restaura el repaso y devuelve el salto.
{
  const g = goal(); skipP(g); const originalDue = g.reviews[0].due;
  const act = contract('x');
  const base = { status: 'PARTIAL', error_type: 'prerequisite', feedback: '', hint: '', _activity: act, _attempt_id: 'c1' };
  tick(); policy.record(g, 'x', 'INDEPENDENT', 'r', base, 0, act, 'c1'); fail(g, 'x', 'c2');
  assert.equal(proposals(g).length, 1); assert.equal(policy.placementSkipped(g, 'p'), false);
  tick(); policy.applyManualCorrection(g, 'x', 'INDEPENDENT', 'r', base, 'CORRECT', 'c1-fix');
  assert.equal(revokes(g).length, 1);
  const rv = revokes(g)[0];
  assert.equal('node_id' in rv, false); assert.equal(rv.creates_evidence, false); assert.equal(rv.proposal_id, proposals(g)[0].proposal_id);
  assert.equal(policy.prerequisiteReviews(g).length, 0);
  assert.equal(policy.placementSkipped(g, 'p'), true, 'el salto vuelve al revocarse');
  assert.equal(g.reviews[0].due, originalDue, 'el repaso adelantado vuelve a su fecha');
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE' && e.node_id === 'p').length, 0);
  // La corrección no cuenta dos veces: un fallo original corregido a otro fallo sigue siendo UN solo intento.
  const h = goal(); skipP(h);
  const act2 = contract('x'), base2 = { status: 'PARTIAL', error_type: 'prerequisite', feedback: '', hint: '', _activity: act2, _attempt_id: 'k1' };
  tick(); policy.record(h, 'x', 'INDEPENDENT', 'r', base2, 0, act2, 'k1');
  tick(); policy.applyManualCorrection(h, 'x', 'INDEPENDENT', 'r', base2, 'MISCONCEPTION', 'k1-fix');
  assert.deepEqual(policy.prqFailures(h, 'x'), ['k1'], 'original y corrección = un intento');
  assert.equal(proposals(h).length, 0);
}

// 7. Sin arista X->P no hay propuesta (no se adivina P); otra meta / otro perfil no ven nada.
{
  const g = goal({ edge: false }); skipP(g);
  fail(g, 'x', 'n1'); fail(g, 'x', 'n2');
  assert.equal(proposals(g).length, 0); assert.equal(policy.placementSkipped(g, 'p'), true);
  assert.deepEqual(g.nodes.find(n => n.id === 'x').prerequisites, [], 'no se crean aristas');
  const a = goal({ profile: 'perfil-a' }); skipP(a); fail(a, 'x', 'q1'); fail(a, 'x', 'q2');
  const b = goal({ profile: 'perfil-b', id: 'goal-b' }); skipP(b);
  assert.equal(proposals(b).length, 0); assert.equal(policy.placementSkipped(b, 'p'), true);
  // Eventos de otro perfil dentro de la meta no cuentan.
  const c = goal({ profile: 'perfil-c', id: 'goal-c' }); skipP(c);
  for (const att of ['o1', 'o2']) c.events.push({ type: 'EVIDENCE', node_id: 'x', profile_id: 'otro', attempt_id: att, evidence_id: 'ev-' + att, evidence_role: 'learning', counts_as_learning_failure: true, error_type: 'prerequisite', result: 'PARTIAL', timestamp: clockValue });
  policy.prerequisiteReviewSync(c); assert.equal(proposals(c).length, 0);
}

// 8. Datos legacy y P con evidencia propia: nada se inventa ni se borra; cero llamadas al modelo.
{
  const legacy = goal(); delete legacy.events; delete legacy.reviews;
  assert.doesNotThrow(() => policy.prerequisiteReviewSync(legacy));
  assert.deepEqual(policy.prerequisiteReviews({ nodes: legacy.nodes }), []);
  const g = goal(); ok(g, 'p', 'pok'); const pEvents = JSON.stringify(g.events.filter(e => e.node_id === 'p'));
  fail(g, 'x', 'v1'); fail(g, 'x', 'v2');
  assert.equal(JSON.stringify(g.events.filter(e => e.node_id === 'p')), pEvents, 'la evidencia de P queda intacta');
  assert.equal(proposals(g)[0].action, 'check', 'P sin salto: se marca para comprobación');
  assert.equal(proposals(g)[0].review_to_due, null);
  assert.equal(modelCalls, 0, 'el disparador no llama al modelo');
}
console.log('prerequisite_review.test.js OK');
