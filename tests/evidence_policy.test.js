const assert = require('node:assert/strict');

function element(type = 'div') {
  return {
    type,
    children: [],
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    replaceChildren(...items) { this.children = items; },
  };
}

global.document = {
  getElementById: () => element(),
  createElement: (type) => element(type),
};
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;

const policy = require('../app.js');

function activity(overrides = {}) {
  return policy.normalizeActivityContract({
    activity_id: 'activity-1',
    node_id: 'n1',
    stage: 'INDEPENDENT',
    kind: 'application',
    observable_dimensions: ['direct_application'],
    supports_independence: true,
    supports_transfer: false,
    variant_id: null,
    role: 'independent_practice',
    ...overrides,
  });
}

function assessment(status = 'CORRECT', overrides = {}) {
  return { status, error_type: 'none', ...overrides };
}

function goalWithDimension(dimension = 'conceptual') {
  return {
    nodes: [{ id: 'n1', name: 'Nodo', prerequisites: [] }],
    learner: {},
    coverage: [{
      id: 'n1', name: 'Nodo', required: true, status: 'UNKNOWN', confidence: 0,
      dimensions: [{ id: dimension, name: dimension, required: true, status: 'UNKNOWN', evidence: [] }],
    }],
    events: [], reviews: [], lessons: {},
    session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0 },
  };
}

// A. Ayudas e independencia.
{
  const independent = policy.activityEvidence(activity(), assessment(), 0, { attempt_id: 'a1' });
  assert.equal(independent.is_independent, true);

  const helped = policy.activityEvidence(activity(), assessment(), 1, { attempt_id: 'a2' });
  assert.equal(helped.is_independent, false);
  assert.equal(policy.sufficient({ id: 'direct_application', evidence: [helped] }), false);

  const guided = policy.activityContract({}, 'n1', 'guided_practice');
  const guidedEvidence = policy.activityEvidence(guided, assessment(), 0, { attempt_id: 'a3' });
  assert.equal(guidedEvidence.is_independent, false);
  assert.equal(guidedEvidence.observed_dimensions.includes('transfer'), false);

  const corrected = policy.activityEvidence(activity(), assessment(), 0, {
    attempt_id: 'a4', corrected: true, original_result: 'PARTIAL',
  });
  assert.equal(corrected.is_independent, false);
}

// B. Diagnóstico: conserva evidencia, pero nunca crea fallo de aprendizaje.
for (const status of ['CORRECT', 'UNKNOWN', 'MISCONCEPTION', 'PARTIAL']) {
  const diagnostic = policy.activityContract({ kind: 'explanation' }, 'n1', 'diagnostic_probe');
  const event = policy.activityEvidence(diagnostic, assessment(status), 0, { attempt_id: `diag-${status}` });
  assert.equal(event.counts_as_learning_failure, false);
  assert.equal(event.phase, 'DIAGNOSTIC');
  assert.equal(event.activity_kind, 'explanation');
  assert.equal(event.evidence_role, 'diagnostic');
}
{
  const goal = goalWithDimension('conceptual');
  const diagnostic = policy.activityContract({ kind: 'explanation' }, 'n1', 'diagnostic_probe');
  policy.record(goal, 'n1', 'DIAGNOSTIC', 'No sé', assessment('UNKNOWN', { error_type: 'lack_of_exposure' }), 0, diagnostic, 'diag-record');
  assert.equal(goal.learner.n1.errors.length, 0);
  assert.equal(goal.learner.n1.evidence[0].phase, 'DIAGNOSTIC');
  assert.equal(goal.learner.n1.evidence[0].activity_kind, 'explanation');
}

// C. Solo se acreditan dimensiones declaradas y el fallback es conservador.
{
  const explicit = activity({ observable_dimensions: ['recognition'], kind: 'recognition' });
  const event = policy.activityEvidence(explicit, assessment(), 0, { attempt_id: 'dims-1' });
  assert.deepEqual(event.observed_dimensions, ['recognition']);
  assert.equal(event.observed_dimensions.includes('procedure'), false);

  const fallback = policy.activityContract({ kind: 'unknown' }, 'n1', 'unknown_role');
  assert.equal(fallback.supports_independence, false);
  assert.equal(fallback.supports_transfer, false);
  assert.equal(fallback.observable_dimensions.includes('method_selection'), false);

  const explicitBlock = policy.activityContract({
    kind: 'application', activity_contract: { observable_dimensions: ['direct_application'], supports_independence: false },
  }, 'n1', 'independent_practice');
  assert.equal(explicitBlock.supports_independence, false);
}

// D. Un fallo relevante posterior invalida suficiencia hasta nueva evidencia suficiente.
{
  const dimension = { id: 'direct_application', evidence: [] };
  dimension.evidence.push(policy.activityEvidence(activity(), assessment(), 0, { attempt_id: 'time-1' }));
  assert.equal(policy.sufficient(dimension), true);
  dimension.evidence.push(policy.activityEvidence(activity(), assessment('MISCONCEPTION'), 0, { attempt_id: 'time-2' }));
  assert.equal(policy.sufficient(dimension), false);
  assert.equal(dimension.evidence.length, 2);
}

// E. Idempotencia por attempt_id.
{
  const goal = goalWithDimension('direct_application');
  const contract = activity();
  const first = policy.record(goal, 'n1', 'INDEPENDENT', 'respuesta', assessment(), 0, contract, 'same-attempt');
  const duplicate = policy.record(goal, 'n1', 'INDEPENDENT', 'respuesta', assessment(), 0, contract, 'same-attempt');
  const second = policy.record(goal, 'n1', 'INDEPENDENT', 'otra', assessment(), 0, contract, 'new-attempt');
  assert.ok(first);
  assert.equal(duplicate, null);
  assert.ok(second);
  assert.equal(goal.learner.n1.evidence.length, 2);
  assert.equal(goal.coverage[0].dimensions[0].evidence.length, 2);
}

// La ruta completa de repaso tampoco avanza dos veces el mismo intento.
{
  const goal = goalWithDimension('memory');
  goal.reviews = [{ id: 'n1', due: 0, step: 0, question: { prompt: 'Recuerda X' }, history: [] }];
  goal.session.mode = 'REVIEW';
  goal.session.node = 'n1';
  const contract = policy.activityContract({ kind: 'recall' }, 'n1', 'spaced_review');
  const result = { ...assessment(), _activity: contract, _attempt_id: 'review-attempt' };
  assert.equal(policy.applyResult(goal, 'n1', 'REVIEW', 'X', result), true);
  assert.equal(policy.applyResult(goal, 'n1', 'REVIEW', 'X', result), false);
  assert.equal(goal.reviews[0].step, 1);
  assert.equal(goal.reviews[0].history.length, 1);
}

// F. verified, nextNode y el conteo del dashboard comparten la misma derivación.
{
  const goal = goalWithDimension('conceptual');
  const contract = policy.normalizeActivityContract({
    activity_id: 'concept-1', node_id: 'n1', stage: 'COMPREHENSION', kind: 'explanation',
    observable_dimensions: ['conceptual'], supports_independence: false,
    supports_transfer: false, role: 'comprehension_check',
  });
  policy.record(goal, 'n1', 'COMPREHENSION', 'respuesta', assessment(), 0, contract, 'progress-1');
  assert.equal(policy.verified(goal, 'n1'), true);
  assert.equal(policy.nextNode(goal), null);
  assert.equal(policy.masteredCount(goal), 1);

  const legacy = { id: 'direct_application', evidence: [{ status: 'CORRECT', independent: true }] };
  assert.equal(policy.sufficient(legacy), false);
}

// Las microtutorías disponen de contratos conservadores sin cambiar aún su flujo.
{
  const guided = policy.activityContract({ kind: 'application' }, 'n1', 'microtutor_guided');
  const independent = policy.activityContract({ kind: 'application' }, 'n1', 'microtutor_independent');
  assert.equal(guided.supports_independence, false);
  assert.equal(independent.supports_independence, true);
  assert.equal(independent.supports_transfer, false);
}

console.log('OK: evidence policy invariants');

