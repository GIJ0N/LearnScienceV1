const assert = require('node:assert/strict');

function element(type = 'div') {
  return { type, textContent: '', value: '', disabled: false, children: [], className: '', append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; }, setAttribute() {}, prepend() {} };
}
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: id => (id === 'app' ? roots.app : roots.status), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const policy = require('../app.js');
const DAY = 24 * 60 * 60 * 1000;

function node(id, prerequisites = [], level = 0) {
  return { id, name: id, outcome: 'Usar ' + id, level, prerequisites, kind: 'concept', probe: { prompt: 'Explica ' + id, kind: 'explanation' } };
}
// Cadena n0..n4 y una hoja n5 que depende de n0: dos hojas, seis temas.
function goal() {
  const nodes = [node('n0', [], 0), node('n1', ['n0'], 1), node('n2', ['n1'], 2), node('n3', ['n2'], 3), node('n4', ['n3'], 4), node('n5', ['n0'], 1)];
  return {
    id: 'goal-skip', profile_id: 'profile-test', goal: 'Meta', nodes, learner: {}, events: [], reviews: [], lessons: {},
    coverage: nodes.map(n => ({ id: n.id, name: n.id, status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] })),
    session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 },
  };
}
let counter = 0;
function answer(g, nodeId, status, confidence) {
  const item = { item_id: 'item-' + (++counter), node_id: nodeId, prompt: '¿' + nodeId + '?', options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }] };
  g.placement.items[item.item_id] = { ...item, used: false };
  const result = { status, item_id: item.item_id, node_id: nodeId, correct_option_id: 'a', explanation: 'e', error_type: 'none' };
  assert.equal(policy.applyPlacementAnswer(g, item, result, 'att-' + counter, 'a', confidence), true);
}
function placed(setup) {
  const g = goal();
  policy.setStoreForTests({ goals: [g], active: g.id });
  if (setup) setup(g);
  policy.startPlacement(g);
  answer(g, 'n4', 'CORRECT', 90);
  answer(g, 'n5', 'CORRECT', 100);
  return g;
}

// 6 temas saltados -> 6 repasos con vencimientos de 1 a 5 días, repartidos.
{
  const g = placed();
  const snapshot = JSON.stringify(g.coverage);
  const evidenceBefore = g.events.filter(e => e.type === 'EVIDENCE').length;
  const before = Date.now();
  const out = policy.finishPlacement(g, 'resolved', false);
  assert.equal(out.skipped.length, 6);
  assert.equal(g.reviews.length, 6);
  const days = g.reviews.map(r => Math.round((r.due - before) / DAY));
  assert.ok(days.every(d => d >= 1 && d <= 5), 'vencimientos entre 1 y 5 días: ' + days);
  assert.ok(new Set(days).size >= 4, 'repartidos, no todos el mismo día');
  assert.ok(g.reviews.every(r => r.step === 0 && r.history.length === 0));
  const events = g.events.filter(e => e.type === 'PLACEMENT_REVIEW_SCHEDULED');
  assert.equal(events.length, 6);
  for (const e of events) {
    assert.equal(e.due, g.reviews.find(r => r.id === e.node_id).due);
    assert.ok(typeof e.at === 'number');
  }
  // Programar no es evidencia: ni dominio, ni cobertura, ni habilidades con evidencia.
  for (const n of g.nodes) assert.equal(policy.verified(g, n.id), false);
  assert.equal(JSON.stringify(g.coverage), snapshot);
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, evidenceBefore);
}

// Un tema con repaso previo no cambia.
{
  const prior = { id: 'n2', due: 123456, step: 1, question: null, history: [{ at: 1 }], origin_attempt_id: null };
  const g = placed(x => { x.reviews.push(prior); });
  policy.finishPlacement(g, 'resolved', false);
  const same = g.reviews.filter(r => r.id === 'n2');
  assert.equal(same.length, 1);
  assert.equal(same[0], prior);
  assert.equal(prior.due, 123456);
  assert.equal(prior.step, 1);
  assert.ok(!g.events.some(e => e.type === 'PLACEMENT_REVIEW_SCHEDULED' && e.node_id === 'n2'));
  assert.equal(g.reviews.length, 6);
}

// Sin temas saltados no se programa nada.
{
  const g = goal();
  policy.setStoreForTests({ goals: [g], active: g.id });
  policy.startPlacement(g);
  policy.finishPlacement(g, 'learner_stopped', false);
  assert.equal(g.reviews.length, 0);
  assert.ok(!g.events.some(e => e.type === 'PLACEMENT_REVIEW_SCHEDULED'));
}

console.log('placement_skip_review: OK');
