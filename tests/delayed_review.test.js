const assert = require('node:assert/strict');

function element(type = 'div') {
  return { type, textContent: '', value: '', disabled: false, children: [], append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); return item; }, replaceChildren(...items) { this.children = items; } };
}

const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: id => id === 'app' ? roots.app : roots.status, createElement: type => element(type) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;

const policy = require('../app.js');
let currentTime = 1700000000000;
policy.setClockForTests(() => currentTime);

function activity(kind, stage, role, nodeId = 'n1') {
  const dimensions = kind === 'recall' ? ['memory'] : kind === 'application' ? ['direct_application'] : ['contextual_application', 'interpretation'];
  return policy.activityContract({ activity_id: `${stage}-${kind}`, node_id: nodeId, stage, kind, prompt: 'Recuerda', reference: 'respuesta', observable_dimensions: dimensions }, nodeId, role);
}

function goal(dimensions = ['direct_application', 'memory']) {
  return {
    id: 'goal-1', goal: 'Meta', nodes: [{ id: 'n1', name: 'Habilidad', outcome: 'Resolver', level: 0, prerequisites: [] }], learner: {},
    coverage: [{ id: 'n1', name: 'Habilidad', status: 'UNKNOWN', confidence: 0, dimensions: dimensions.map(id => ({ id, name: id, required: true, status: 'UNKNOWN', evidence: [] })) }],
    events: [], reviews: [], lessons: {}, session: { mode: 'DIAGNOSTIC', node: 'n1', stack: [], tries: 0, hints: 0 },
  };
}

function result(activityContract, attemptId, status = 'CORRECT') {
  return { status, error_type: 'none', feedback: 'ok', hint: '', _activity: activityContract, _attempt_id: attemptId };
}

function newReview(at = currentTime, target = 'memory') {
  const g = goal();
  const origin = { timestamp: at, attempt_id: 'origin-1' };
  policy.schedule(g, 'n1', origin, target);
  g.reviews[0].question = { prompt: 'Recuerda', reference: 'respuesta', kind: target === 'memory' ? 'recall' : target, observable_dimensions: [target] };
  g.session.mode = 'REVIEW';
  policy.setStoreForTests({ goals: [g], active: g.id });
  return g;
}

// 1. El caso que estaba bloqueado ahora programa el primer repaso sin cambiar sufficient().
{
  const g = goal();
  policy.setStoreForTests({ goals: [g], active: g.id });
  const integrate = activity('context_case', 'INTEGRATE', 'integration');
  policy.applyResult(g, 'n1', 'INTEGRATE', 'respuesta', result(integrate, 'integrate-1'));
  assert.equal(g.session.mode, 'CONFIRMATION');
  assert.equal(g.reviews.length, 1);
  assert.equal(g.reviews[0].target_dimension, 'memory');
  assert.equal(g.reviews[0].origin_attempt_id, 'integrate-1');
  assert.equal(policy.sufficient(g.coverage[0].dimensions[1]), false);
}

// 2. Programar dos veces no crea dos repasos ni cambia el origen.
{
  const g = goal();
  const first = policy.schedule(g, 'n1', { timestamp: currentTime, attempt_id: 'a1' }, 'memory');
  const second = policy.schedule(g, 'n1', { timestamp: currentTime + 1000, attempt_id: 'a2' }, 'memory');
  assert.equal(first, second);
  assert.equal(g.reviews.length, 1);
  assert.equal(g.reviews[0].origin_attempt_id, 'a1');
}

// 3. Antes, en y después del vencimiento se clasifican sin alterar la política de dominio.
for (const [label, offset, expected] of [['before', 12 * 60 * 60 * 1000, 'PRACTICE_IMMEDIATE'], ['at', 24 * 60 * 60 * 1000, 'DELAYED_RETRIEVAL_OBSERVED'], ['after', 2 * 24 * 60 * 60 * 1000, 'DELAYED_RETRIEVAL_OBSERVED']]) {
  const origin = currentTime;
  const g = newReview(origin, 'memory');
  currentTime = origin + offset;
  const a = activity('recall', 'REVIEW', 'spaced_review');
  policy.applyResult(g, 'n1', 'REVIEW', 'respuesta', result(a, `review-${label}`));
  const event = g.events.find(x => x.type === 'EVIDENCE' && x.attempt_id === `review-${label}`);
  assert.equal(event.temporal_classification, expected);
  assert.equal(event.temporal_policy_version, 'delayed_review_v1');
  assert.equal(event.observed_dimensions.includes('memory'), true);
}

// 4. Ayuda, UNKNOWN, fechas inválidas y fechas futuras nunca se presentan como recuperación sin apoyo.
{
  const origin = currentTime;
  const helped = newReview(origin, 'memory');
  currentTime = origin + 2 * 24 * 60 * 60 * 1000;
  helped.session.hints = 1;
  const a = activity('recall', 'REVIEW', 'spaced_review');
  policy.applyResult(helped, 'n1', 'REVIEW', 'respuesta', result(a, 'helped-review'));
  let event = helped.events.find(x => x.type === 'EVIDENCE' && x.attempt_id === 'helped-review');
  assert.equal(event.temporal_classification, 'DELAY_UNVERIFIABLE');
  assert.equal(event.is_independent, false);

  const unknown = newReview(currentTime, 'memory');
  policy.applyResult(unknown, 'n1', 'REVIEW', 'no sé', result(activity('recall', 'REVIEW', 'spaced_review'), 'unknown-review', 'UNKNOWN'));
  event = unknown.events.find(x => x.type === 'EVIDENCE' && x.attempt_id === 'unknown-review');
  assert.equal(event.result, 'UNKNOWN');
  assert.equal(policy.sufficient(unknown.coverage[0].dimensions.find(x => x.id === 'memory')), false);

  const future = newReview(currentTime + 3 * 24 * 60 * 60 * 1000, 'memory');
  future.reviews[0].origin_at = currentTime + 3 * 24 * 60 * 60 * 1000;
  future.reviews[0].last_exposure_at = currentTime + 3 * 24 * 60 * 60 * 1000;
  const invalidEvent = policy.prepareRecord(future, 'n1', 'REVIEW', 'respuesta', { status: 'CORRECT' }, 0, activity('recall', 'REVIEW', 'spaced_review'), 'future-review').event;
  assert.equal(invalidEvent.temporal_classification, 'DELAY_UNVERIFIABLE');
}

// 5. Una exposición posterior no borra el origen; el evento conserva ambos intervalos y sobrevive a la normalización.
{
  const origin = currentTime;
  const exposed = newReview(origin, 'memory');
  exposed.reviews[0].last_exposure_at = origin + 12 * 60 * 60 * 1000;
  currentTime = origin + 3 * 24 * 60 * 60 * 1000;
  policy.applyResult(exposed, 'n1', 'REVIEW', 'respuesta', result(activity('recall', 'REVIEW', 'spaced_review'), 'exposure-review'));
  const event = exposed.events.find(x => x.type === 'EVIDENCE' && x.attempt_id === 'exposure-review');
  assert.equal(event.temporal_classification, 'DELAYED_RETRIEVAL_OBSERVED');
  assert.equal(event.delay_ms_from_origin, 3 * 24 * 60 * 60 * 1000);
  assert.equal(event.delay_ms_from_last_exposure, 2.5 * 24 * 60 * 60 * 1000);
  const restored = policy.normalizeImportedStore(JSON.parse(JSON.stringify({ goals: [exposed], active: exposed.id })));
  assert.equal(restored.goals[0].reviews[0].origin_attempt_id, 'origin-1');
  assert.equal(restored.goals[0].reviews[0].target_dimension, 'memory');
  assert.equal(restored.goals[0].events.some(x => x.attempt_id === 'exposure-review'), true);
}

// 6. Los contratos dirigidos siguen siendo exactos y una familia incompatible no acredita memory.
{
  const units = policy.activityContract({ kind: 'units', observable_dimensions: ['units'] }, 'n1', 'spaced_review');
  assert.deepEqual(units.observable_dimensions, ['units']);
  const incompatible = policy.activityContract({ kind: 'application', observable_dimensions: ['memory'] }, 'n1', 'spaced_review');
  assert.deepEqual(incompatible.observable_dimensions, []);
}

// 7. Importación legacy conserva la ausencia de ancla; no se inventan fechas.
{
  const raw = { id: 'legacy', nodes: [{ id: 'n1', name: 'Habilidad', prerequisites: [] }], coverage: [], learner: {}, reviews: [{ id: 'n1', due: currentTime, question: null, history: [] }], lessons: {}, session: {} };
  const normalized = policy.normalizeGoal(raw);
  assert.equal(normalized.reviews[0].origin_attempt_id, null);
  assert.equal(normalized.reviews[0].origin_at, null);
  assert.equal(normalized.reviews[0].temporal_invalid, false);
  assert.equal(normalized.reviews[0].temporal_policy_version, 'delayed_review_v1');
  const futureRaw = { ...raw, reviews: [{ id: 'n1', origin_at: currentTime + 1000, last_exposure_at: currentTime + 1000 }] };
  assert.equal(policy.normalizeGoal(futureRaw).reviews[0].temporal_invalid, true);
}

console.log('OK: delayed review scheduling, temporal classification, contracts, UNKNOWN, help, idempotency and legacy compatibility');
