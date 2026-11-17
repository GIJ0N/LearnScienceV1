// Ejecutor de prerequisite_review.test.py: aplica la lógica real de app.js a escenarios sintéticos y devuelve la meta resultante.
// Sin red: cuenta cualquier intento de llamar al modelo.
const fs = require('node:fs');
function element(type = 'div') {
  return { type, textContent: '', value: '', disabled: false, children: [], className: '', append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; }, setAttribute() {}, setProperty() {}, style: {} };
}
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: id => (id === 'app' ? roots.app : roots.status), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
let modelCalls = 0;
global.fetch = async () => { modelCalls += 1; throw new Error('Sin red.'); };
const policy = require('../app.js');
const DAY = 24 * 60 * 60 * 1000;
let clock = 1_800_000_000_000, seq = 0;
policy.setClockForTests(() => clock);
const tick = () => { clock += 60_000; };
const node = (id, name, prerequisites, level) => ({ id, name, outcome: 'Usar ' + name, level, prerequisites, kind: 'concept', probe: { prompt: 'Explica ' + name, reference: 'Criterio', kind: 'explanation' } });
function build(edge, profile) {
  const nodes = [node('p', 'Fracciones', [], 0), node('x', 'Proporciones', edge ? ['p'] : [], 1), node('y', 'Escalas', ['x'], 2)];
  const g = { id: 'goal-1', profile_id: profile, goal: 'Meta', nodes, learner: {}, events: [], reviews: [], lessons: {}, repairEpisodes: [], contextStack: [], map_updates: [],
    coverage: nodes.map(n => ({ id: n.id, name: n.name, status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] })),
    session: { mode: 'DIAGNOSTIC', node: null, stack: [], stage: 'teach', tries: 0, hints: 0 } };
  policy.setStoreForTests({ goals: [g], active: g.id });
  return g;
}
const contract = (id, stage = 'INDEPENDENT', role = 'independent_practice') => policy.normalizeActivityContract({ activity_id: `act-${id}-${++seq}`, node_id: id, stage, kind: 'application', observable_dimensions: ['conceptual'], supports_independence: true, role });
function fail(g, attempt, { errorType = 'prerequisite', status = 'PARTIAL', stage = 'INDEPENDENT', role = 'independent_practice', activity } = {}) {
  tick(); return policy.record(g, 'x', stage, 'respuesta', { status, error_type: errorType, feedback: '', hint: '' }, 0, activity || contract('x', stage, role), attempt);
}
function skipP(g) { tick(); g.events.push({ type: 'PLACEMENT_SKIP', node_id: 'p', basis: 'probed', at: clock, policy_version: 'placement_v1' }); g.reviews.push({ id: 'p', due: clock + 4 * DAY, step: 0, history: [], question: null, origin_attempt_id: null }); }

const scenarios = {
  two_failures: g => { fail(g, 'a1'); fail(g, 'a2'); },
  one_failure: g => { fail(g, 'a1'); },
  diagnostic_failures: g => { for (const a of ['d1', 'd2', 'd3']) fail(g, a, { stage: 'DIAGNOSTIC', role: 'diagnostic_probe', status: 'MISCONCEPTION' }); },
  unknown_results: g => { fail(g, 'u1', { status: 'UNKNOWN' }); fail(g, 'u2', { status: 'UNKNOWN' }); fail(g, 'u3', { status: 'UNKNOWN' }); },
  duplicate: g => {
    const act = contract('x'), r = { status: 'PARTIAL', error_type: 'prerequisite', feedback: '', hint: '' };
    tick(); policy.record(g, 'x', 'INDEPENDENT', 'r', r, 0, act, 'dup');
    try { policy.record(g, 'x', 'INDEPENDENT', 'r', r, 0, act, 'dup'); } catch (e) { /* esperado */ }
  },
  corrected_away: g => {
    const act = contract('x'), base = { status: 'PARTIAL', error_type: 'prerequisite', feedback: '', hint: '', _activity: act, _attempt_id: 'c1' };
    tick(); policy.record(g, 'x', 'INDEPENDENT', 'r', base, 0, act, 'c1'); fail(g, 'c2');
    tick(); policy.applyManualCorrection(g, 'x', 'INDEPENDENT', 'r', base, 'CORRECT', 'c1-fix');
  },
};
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const g = build(input.edge !== false, input.profile || 'profile-a');
if (input.skip !== false) skipP(g);
if (input.p_evidence) { tick(); policy.record(g, 'p', 'INDEPENDENT', 'r', { status: 'CORRECT', error_type: 'none', feedback: '', hint: '' }, 0, contract('p'), 'p-ok'); }
scenarios[input.scenario](g);
process.stdout.write(JSON.stringify({ goal: g, model_calls: modelCalls, skipped: policy.placementSkipped(g, 'p'), proposals: policy.prerequisiteReviews(g).length }));
