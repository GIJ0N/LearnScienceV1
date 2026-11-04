const assert = require('node:assert/strict');

function element(type = 'div') {
  return {
    type, textContent: '', value: '', disabled: false, children: [], className: '',
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    replaceChildren(...items) { this.children = items; },
    setAttribute() {}, prepend() {},
  };
}
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: (id) => (id === 'app' ? roots.app : roots.status), createElement: (type) => element(type) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;

const policy = require('../app.js');

// Chain a -> b -> c -> d (d is the goal), plus e depending on b.
function node(id, prerequisites = [], level = 0) {
  return { id, name: id, outcome: 'Usar ' + id, level, prerequisites, kind: 'concept', probe: { prompt: 'Explica ' + id, kind: 'explanation' } };
}
function goal() {
  const nodes = [node('a', [], 0), node('b', ['a'], 1), node('c', ['b'], 2), node('e', ['b'], 2), node('d', ['c'], 3)];
  return {
    id: 'goal-p', profile_id: 'profile-test', goal: 'Meta', nodes, learner: {}, events: [], reviews: [], lessons: {},
    coverage: nodes.map(n => ({ id: n.id, name: n.id, status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] })),
    session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 },
  };
}
function attach(g) { policy.setStoreForTests({ goals: [g], active: g.id }); return g; }
let counter = 0;
function answer(g, nodeId, status, confidence = null) {
  const item = { item_id: 'item-' + (++counter), node_id: nodeId, prompt: '¿' + nodeId + '?', options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }] };
  g.placement.items[item.item_id] = { ...item, used: false };
  const result = { status, item_id: item.item_id, node_id: nodeId, correct_option_id: 'a', explanation: 'e', error_type: status === 'CORRECT' ? 'none' : 'conceptual' };
  const selected = status === 'UNKNOWN' ? null : status === 'CORRECT' ? 'a' : 'b';
  assert.equal(policy.applyPlacementAnswer(g, item, result, 'att-' + counter, selected, confidence), true);
  return 'att-' + counter;
}

// Probed status rules.
assert.equal(policy.probedPlacementStatus([{ status: 'CORRECT', learner_confidence: 90 }]), 'held');
assert.equal(policy.probedPlacementStatus([{ status: 'CORRECT', learner_confidence: null }]), 'fragile', 'Un acierto sin confianza puede ser suerte');
assert.equal(policy.probedPlacementStatus([{ status: 'CORRECT', learner_confidence: 30 }, { status: 'CORRECT', learner_confidence: 40 }]), 'held');
assert.equal(policy.probedPlacementStatus([{ status: 'MISCONCEPTION', learner_confidence: 95 }]), 'misconception');
assert.equal(policy.probedPlacementStatus([{ status: 'UNKNOWN', learner_confidence: null }]), 'gap');
assert.equal(policy.probedPlacementStatus([{ status: 'CORRECT', learner_confidence: 90 }, { status: 'MISCONCEPTION', learner_confidence: 20 }]), 'fragile');

// First question enters at the most advanced topic.
{
  const g = attach(goal()); policy.startPlacement(g);
  assert.equal(policy.nextPlacementNode(g), 'd');
}

// Confident success on the goal resolves the whole chain in one question; skips do not grant mastery.
{
  const g = attach(goal()); policy.startPlacement(g);
  answer(g, 'd', 'CORRECT', 90);
  const st = policy.placementStatuses(g);
  assert.equal(st.d, 'held'); assert.equal(st.a, 'inferred_held'); assert.equal(st.c, 'inferred_held');
  assert.equal(st.e, 'unprobed', 'e no es prerrequisito de d: no se deduce');
  assert.equal(policy.nextPlacementNode(g), 'e');
  answer(g, 'e', 'CORRECT', 100);
  assert.equal(policy.nextPlacementNode(g), null);
  const out = policy.finishPlacement(g, 'resolved', false);
  assert.deepEqual(out.skipped.sort(), ['a', 'b', 'c', 'd', 'e']);
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    assert.equal(policy.verified(g, id), false, 'Saltar por diagnóstico no es dominio');
    assert.equal(policy.readyToAdvance(g, id), true);
  }
  const diag = g.events.filter(e => e.type === 'EVIDENCE');
  assert.equal(diag.length, 2);
  assert.ok(diag.every(e => e.phase === 'DIAGNOSTIC' && e.is_independent === false && e.counts_as_learning_failure === false));
}

// A miss at the top walks down by halving; misconception propagates as a gap to dependents.
{
  const g = attach(goal()); policy.startPlacement(g);
  answer(g, 'd', 'MISCONCEPTION', 90);
  const second = policy.nextPlacementNode(g);
  assert.notEqual(second, 'd');
  assert.ok(['b', 'c'].includes(second), 'Elige el tema que mejor divide lo pendiente');
  answer(g, 'b', 'UNKNOWN');
  const st = policy.placementStatuses(g);
  assert.equal(st.d, 'misconception'); assert.equal(st.b, 'gap');
  assert.equal(st.c, 'inferred_gap'); assert.equal(st.e, 'inferred_gap');
  assert.equal(policy.nextPlacementNode(g), 'a');
  answer(g, 'a', 'CORRECT', 80);
  assert.equal(policy.nextPlacementNode(g), null);
  const out = policy.finishPlacement(g, 'resolved', false);
  assert.deepEqual(out.skipped, ['a']);
  assert.equal(out.start, 'b', 'Empieza en el primer tema no sostenido');
}

// Low-confidence success does not propagate and is reconfirmed at the end.
{
  const g = attach(goal()); policy.startPlacement(g);
  answer(g, 'd', 'CORRECT', 30);
  const st = policy.placementStatuses(g);
  assert.equal(st.d, 'fragile'); assert.equal(st.c, 'unprobed');
  let next = policy.nextPlacementNode(g), asked = 0;
  while (next && next !== 'd') { answer(g, next, 'CORRECT', 90); asked += 1; next = policy.nextPlacementNode(g); }
  assert.ok(asked >= 1 && asked < 4, 'Las deducciones ahorran preguntas');
  const before = policy.placementStatuses(g);
  assert.ok(['unprobed', 'conflict'].every(s => !Object.values(before).includes(s)), 'Ya no quedan temas sin ubicar');
  assert.equal(next, 'd', 'Repregunta el tema frágil cuando no queda otro');
}

// Conflict: a held dependent and a gap below a shared topic force a direct question.
{
  const g = attach(goal()); policy.startPlacement(g);
  answer(g, 'a', 'UNKNOWN');
  answer(g, 'c', 'CORRECT', 90);
  const st = policy.placementStatuses(g);
  assert.equal(st.b, 'conflict');
  assert.equal(policy.nextPlacementNode(g), 'b');
}

// Topics with prior evidence are not probed (existing goals).
{
  const g = attach(goal());
  policy.record(g, 'a', 'INDEPENDENT', 'r', { status: 'CORRECT', error_type: 'none', feedback: '', hint: '' }, 0,
    policy.normalizeActivityContract({ activity_id: 'act-a', node_id: 'a', stage: 'INDEPENDENT', kind: 'application', observable_dimensions: ['conceptual'], supports_independence: true, role: 'independent_practice' }), 'prior-a');
  policy.startPlacement(g);
  assert.deepEqual(g.placement.evidenced_nodes, ['a']);
  assert.equal(policy.placementStatuses(g).a, 'evidenced');
}

// Skips are revoked by later learning failures on the topic or prerequisite errors above it.
{
  const g = attach(goal()); policy.startPlacement(g);
  answer(g, 'd', 'CORRECT', 95); answer(g, 'e', 'CORRECT', 95);
  policy.finishPlacement(g, 'resolved', false);
  assert.equal(policy.placementSkipped(g, 'b'), true);
  const contract = id => policy.normalizeActivityContract({ activity_id: 'act-' + id, node_id: id, stage: 'INDEPENDENT', kind: 'application', observable_dimensions: ['conceptual'], supports_independence: true, role: 'independent_practice' });
  policy.record(g, 'c', 'INDEPENDENT', 'r', { status: 'PARTIAL', error_type: 'prerequisite', feedback: '', hint: '' }, 0, contract('c'), 'later-c');
  assert.equal(policy.placementSkipped(g, 'b'), false, 'Un error de prerrequisito en c reabre b');
  assert.equal(policy.placementSkipped(g, 'c'), false, 'El fallo en c reabre c');
  assert.equal(policy.placementSkipped(g, 'a'), true, 'a no se ve afectado');
}

// Idempotency, inactive placement and mismatched results.
{
  const g = attach(goal()); policy.startPlacement(g);
  const item = { item_id: 'x1', node_id: 'd', prompt: 'p', options: [{ id: 'a', text: 'x' }] };
  const result = { status: 'CORRECT', item_id: 'x1', node_id: 'd', correct_option_id: 'a', explanation: 'e' };
  assert.equal(policy.applyPlacementAnswer(g, item, result, 'same', 'a', 90), true);
  assert.equal(policy.applyPlacementAnswer(g, item, result, 'same', 'a', 90), false);
  assert.equal(g.placement.answers.length, 1);
  assert.throws(() => policy.applyPlacementAnswer(g, item, { ...result, node_id: 'a' }, 'other', 'a', 90), /no corresponde/);
  policy.finishPlacement(g, 'learner_stopped', false);
  assert.throws(() => policy.applyPlacementAnswer(g, item, result, 'late', 'a', 90), /ya no está activo/);
}

// Safety limit is high; feedback names a confident mistake.
assert.equal(policy.placementLimit({ nodes: new Array(5) }), 40);
assert.equal(policy.placementLimit({ nodes: new Array(30) }), 120);
assert.match(policy.placementFeedbackText({ status: 'MISCONCEPTION', correct_option_id: 'b' }, 90), /bastante seguro/);
assert.match(policy.placementFeedbackText({ status: 'CORRECT', correct_option_id: 'b' }, 20), /confirmaremos/);

// The question view renders options, confidence, reasoning and both answer buttons without a browser.
{
  const g = attach(goal()); policy.startPlacement(g);
  const box = element('section');
  const view = policy.renderPlacementItem(box, g, { item_id: 'v1', node_id: 'd', prompt: '¿Cuál?', options: [{ id: 'a', text: 'uno' }, { id: 'b', text: 'dos' }, { id: 'c', text: 'tres' }] });
  assert.equal(view.choices.children.length, 3);
  assert.ok(box.children.some(c => c.type === 'select'), 'Incluye el selector de confianza');
  assert.ok(box.children.some(c => c.type === 'textarea'), 'Incluye el razonamiento en voz alta');
  assert.ok(view.attemptId);
}

console.log('OK: diagnóstico por acotamiento (selección, deducción, saltos revocables, sin dominio).');
