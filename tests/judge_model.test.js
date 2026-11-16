// judge_model_v1 (cliente): el evento guarda qué modelo juzgó, sin inventarlo, sin cambiar la evidencia, y la pantalla avisa si el mismo modelo genera y califica.
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
global.fetch = async () => ({ ok: true, json: async () => ({}) });
const policy = require('../app.js');

function contract() {
  return policy.normalizeActivityContract({ activity_id: 'activity-n1', node_id: 'n1', stage: 'INDEPENDENT', kind: 'application',
    observable_dimensions: ['direct_application'], supports_independence: true, supports_transfer: false, role: 'independent_practice' });
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
const assessment = (status, extra = {}) => ({ status, error_type: 'none', feedback: 'f', hint: '', ...extra });

// 1. El evento lleva judge_model cuando el servidor lo informó.
{
  const g = attach(goal());
  const event = policy.record(g, 'n1', 'INDEPENDENT', 'r', assessment('CORRECT', { judge_model: 'gemini-3.1-pro' }), 0, contract(), 'j-1');
  assert.equal(event.judge_model, 'gemini-3.1-pro');
  assert.equal(g.events.find(e => e.type === 'EVIDENCE').judge_model, 'gemini-3.1-pro');
}

// 2. Evento legacy / sin campo: no se inventa; y el valor no cambia la evidencia.
{
  const withModel = attach(goal());
  const a = policy.record(withModel, 'n1', 'INDEPENDENT', 'r', assessment('CORRECT', { judge_model: 'otro' }), 0, contract(), 'j-2');
  const plain = attach(goal());
  const b = policy.record(plain, 'n1', 'INDEPENDENT', 'r', assessment('CORRECT'), 0, contract(), 'j-2');
  assert.equal('judge_model' in b, false, 'sin dato no se inventa el campo');
  assert.equal(a.is_independent, b.is_independent);
  assert.equal(a.result, b.result);
  assert.equal(a.evidence_role, b.evidence_role);
}

// 3. Valores no válidos se descartan (no se guardan cadenas arbitrarias).
for (const bad of ['', 'x y', 'a'.repeat(65), '../x', 7, null, {}, '<script>']) {
  assert.equal(policy.judgeModelName(bad), null, String(bad));
  const g = attach(goal());
  const event = policy.record(g, 'n1', 'INDEPENDENT', 'r', assessment('CORRECT', { judge_model: bad }), 0, contract(), 'j-bad-' + String(bad).length);
  assert.equal('judge_model' in event, false);
}
assert.equal(policy.judgeModelName('gemini-3.1-pro_v2'), 'gemini-3.1-pro_v2');

// 4. Un veredicto UNKNOWN con judge_model no se vuelve evidencia positiva.
{
  const g = attach(goal());
  const event = policy.record(g, 'n1', 'INDEPENDENT', 'r', assessment('UNKNOWN', { judge_model: 'gemini-3.1-pro' }), 0, contract(), 'j-3');
  assert.notEqual(event.result, 'CORRECT');
  assert.equal(event.is_independent, false);
}

// 5. Líneas y avisos de la pantalla.
{
  const same = policy.modelRoleLines({ roles_configurable: true, generate: 'm', audit: 'm', judge: 'm', errors: [] });
  assert.equal(same.lines.length, 3);
  assert.ok(same.lines.some(l => l.includes('Califica') && l.endsWith('m')));
  assert.ok(same.warnings.some(w => w.includes('genera, audita y califica') && w.includes('un error puede pasar dos veces')));
  const split = policy.modelRoleLines({ roles_configurable: true, generate: 'barato', audit: 'fuerte', judge: 'fuerte', errors: [] });
  assert.deepEqual(split.warnings, []);
  const judgeSame = policy.modelRoleLines({ roles_configurable: true, generate: 'barato', audit: 'fuerte', judge: 'barato', errors: [] });
  assert.deepEqual(judgeSame.warnings, ['El mismo modelo genera y califica: un error puede pasar dos veces.']);
  const bad = policy.modelRoleLines({ roles_configurable: true, generate: 'barato', audit: 'fuerte', judge: null, errors: ['x'] });
  assert.ok(bad.lines.some(l => l.endsWith('no válido')));
  assert.ok(bad.warnings.some(w => w.includes('no válida')));
  const anthropic = policy.modelRoleLines({ roles_configurable: false, generate: 'c', audit: 'c', judge: 'c', errors: [] });
  assert.ok(anthropic.warnings.some(w => w.includes('no se pueden separar')));
  assert.deepEqual(policy.modelRoleLines(null), { lines: [], warnings: [] });
}
// 6. La corrección manual de la persona no se atribuye al modelo; el evento original del evaluador conserva su modelo.
for (const marks of [{ _source: 'manual_correction' }, { _actor: 'user' }]) {
  const g = attach(goal());
  const event = policy.record(g, 'n1', 'INDEPENDENT', 'r', assessment('CORRECT', { judge_model: 'gemini-3.1-pro', ...marks }), 0, contract(), 'j-manual-' + Object.keys(marks)[0]);
  assert.equal('judge_model' in event, false, JSON.stringify(marks));
}
{
  const g = attach(goal());
  g.coverage[0].dimensions = [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }];
  const activity = policy.activityContract({ kind: 'explanation' }, 'n1', 'comprehension_check');
  g.session = { mode: 'COMPREHENSION', node: 'n1', stack: [], tries: 0, hints: 0 };
  const original = { ...assessment('CORRECT', { judge_model: 'gemini-3.1-pro' }), _activity: activity, _attempt_id: 'orig-1', _decision: 'accepted' };
  assert.equal(policy.applyResult(g, 'n1', 'COMPREHENSION', 'x', original), true);
  assert.equal(policy.applyManualCorrection(g, 'n1', 'COMPREHENSION', 'x', original, 'PARTIAL', 'corr-1'), true);
  const evidence = g.events.filter(e => e.type === 'EVIDENCE');
  assert.equal(evidence[0].judge_model, 'gemini-3.1-pro', 'el veredicto del modelo conserva su modelo');
  assert.equal(evidence.at(-1).source, 'manual_correction');
  assert.equal('judge_model' in evidence.at(-1), false, 'la corrección manual no se atribuye al juez');
}
console.log('judge_model.test.js OK');
