const assert = require('node:assert/strict');

function element(type = 'div') {
  return {
    type, textContent: '', value: '', disabled: false, children: [],
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    replaceChildren(...items) { this.children = items; },
  };
}
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: (id) => (id === 'app' ? roots.app : roots.status), createElement: (type) => element(type) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;

const policy = require('../app.js');

function contract(overrides = {}) {
  return policy.normalizeActivityContract({
    activity_id: 'activity-n1', node_id: 'n1', stage: 'INDEPENDENT', kind: 'application',
    observable_dimensions: ['direct_application'], supports_independence: true,
    supports_transfer: false, role: 'independent_practice', ...overrides,
  });
}
function goal() {
  return {
    id: 'goal-n1', goal: 'Meta', learner: {}, events: [], reviews: [], lessons: {},
    nodes: [{ id: 'n1', name: 'n1', outcome: 'Resolver', level: 0, prerequisites: [], kind: 'concept', probe: { prompt: 'Explica', kind: 'explanation' } }],
    coverage: [{ id: 'n1', name: 'n1', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'direct_application', name: 'd', required: true, status: 'UNKNOWN', evidence: [] }] }],
    session: { mode: 'INDEPENDENT', node: 'n1', stack: [], tries: 0, hints: 0 },
  };
}
function attach(g) { policy.setStoreForTests({ goals: [g], active: g.id }); return g; }
function assessment(status, extra = {}) { return { status, error_type: 'none', feedback: 'f', hint: '', ...extra }; }

// Normalization: absent is null, never 0; out-of-range is ignored.
assert.equal(policy.normalizeLearnerConfidence(undefined), null);
assert.equal(policy.normalizeLearnerConfidence(''), null);
assert.equal(policy.normalizeLearnerConfidence(0), 0);
assert.equal(policy.normalizeLearnerConfidence('72.4'), 72);
assert.equal(policy.normalizeLearnerConfidence(140), null);
assert.equal(policy.normalizeLearnerConfidence('mucho'), null);

// Calibration matrix.
assert.equal(policy.calibrationSignal('CORRECT', 90), 'solid');
assert.equal(policy.calibrationSignal('CORRECT', 30), 'fragile');
assert.equal(policy.calibrationSignal('MISCONCEPTION', 95), 'committed_misconception');
assert.equal(policy.calibrationSignal('PARTIAL', 20), 'honest_gap');
assert.equal(policy.calibrationSignal('UNKNOWN', 80), null, '«No sé» no lleva señal de calibración');
assert.equal(policy.calibrationSignal('CORRECT', null), null);

// Signals are stored with the evidence event.
{
  const g = attach(goal());
  const event = policy.record(g, 'n1', 'INDEPENDENT', 'respuesta', assessment('MISCONCEPTION', { _learner_confidence: 95, _reasoning: '  porque la masa se conserva  ' }), 0, contract(), 'sig-1');
  assert.equal(event.learner_confidence, 95);
  assert.equal(event.calibration_signal, 'committed_misconception');
  assert.equal(event.reasoning_text, 'porque la masa se conserva');
  assert.equal(event.learner_signal_version, 'learner-signals-v1');
}

// Confidence never grants independence: help still blocks it even at 100 %.
{
  const g = attach(goal());
  const event = policy.record(g, 'n1', 'INDEPENDENT', 'respuesta', assessment('CORRECT', { _learner_confidence: 100 }), 1, contract(), 'sig-2');
  assert.equal(event.is_independent, false);
  assert.equal(event.calibration_signal, 'solid');
}

// Confidence does not change the independence or coverage of an unaided correct answer.
{
  const withSignal = attach(goal());
  const a = policy.record(withSignal, 'n1', 'INDEPENDENT', 'r', assessment('CORRECT', { _learner_confidence: 10 }), 0, contract(), 'sig-3');
  const coverageWith = JSON.stringify(policy.deriveCoverage(withSignal.coverage[0]).dimensions.map(d => d.status));
  const plain = attach(goal());
  const b = policy.record(plain, 'n1', 'INDEPENDENT', 'r', assessment('CORRECT'), 0, contract(), 'sig-3');
  const coveragePlain = JSON.stringify(policy.deriveCoverage(plain.coverage[0]).dimensions.map(d => d.status));
  assert.equal(a.is_independent, b.is_independent);
  assert.equal(coverageWith, coveragePlain);
  assert.equal(a.calibration_signal, 'fragile');
  assert.equal(b.learner_confidence, null, 'Sin indicar se guarda como null, no como 0');
  assert.equal(b.calibration_signal, null);
}

// A wrong answer stays a learning failure regardless of confidence.
{
  const g = attach(goal());
  const event = policy.record(g, 'n1', 'INDEPENDENT', 'r', assessment('PARTIAL', { _learner_confidence: 5 }), 0, contract(), 'sig-4');
  assert.equal(event.counts_as_learning_failure, true);
  assert.equal(event.calibration_signal, 'honest_gap');
}

// Reasoning is bounded.
{
  const g = attach(goal());
  const event = policy.record(g, 'n1', 'INDEPENDENT', 'r', assessment('CORRECT', { _reasoning: 'x'.repeat(5000) }), 0, contract(), 'sig-5');
  assert.equal(event.reasoning_text.length, 1200);
}

console.log('OK: señales del aprendiz (confianza, razonamiento, calibración) sin efecto en dominio.');
