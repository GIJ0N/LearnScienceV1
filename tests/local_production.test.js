// local_production_v1 (cliente): disponibilidad, obtención, y registro por el camino central de evidencia.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute() {} }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');
const DAY = 86400000;

let calls = [], script = {};
global.fetch = async (route, options) => {
  const body = JSON.parse(options.body);
  calls.push({ route, body });
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  if (route === '/api/practice/produce') {
    const out = script[body.kind];
    if (out instanceof Error) return { ok: false, json: async () => ({ error: out.message }) };
    return { ok: true, json: async () => out };
  }
  throw Error('Ruta inesperada ' + route);
};

const node = (id, i = 0) => ({ id, name: id, level: i, prerequisites: [], outcome: 'Resolver', probe: { prompt: 'Explica ' + id, kind: 'explanation' } });
function goal(dimensions = ['direct_application', 'procedure']) {
  return {
    id: 'g', profile_id: 'profile-test', goal: 'Pintura en polvo', nodes: [node('a'), node('b', 1)], learner: {}, reviews: [{ id: 'a', due: Date.now() + DAY, step: 0, history: [] }],
    events: [{ type: 'TEACHING_EXPOSURE', node_id: 'a', at: Date.now() - DAY }],
    coverage: ['a', 'b'].map(id => ({ id, name: id, status: 'UNKNOWN', confidence: 0, dimensions: dimensions.map(d => ({ id: d, name: d, required: true, status: 'UNKNOWN', evidence: [] })) })),
    lessons: {}, session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 },
  };
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
const numericRes = (extra = {}) => ({ schema_version: 'local_production_v1', item_id: 'prod-1', node_id: 'a', kind: 'numeric', prompt: 'Calcula la masa por área.', ...extra });
const orderingRes = () => ({ schema_version: 'local_production_v1', item_id: 'prod-2', node_id: 'a', kind: 'ordering', prompt: 'Ordena.', steps: [{ id: 's1', text: 'Aplicar' }, { id: 's2', text: 'Limpiar' }, { id: 's3', text: 'Curar' }] });
const verdict = (status, extra = {}) => ({ schema_version: 'local_production_v1', status, item_id: 'prod-1', node_id: 'a', kind: 'numeric', solution: '120/2', correct_value: 60, correct_unit: 'g/m²', error_type: status === 'CORRECT' ? 'none' : status === 'UNKNOWN' ? 'lack_of_exposure' : 'arithmetic', evaluator_version: 'local-production-v1', ...extra });

(async () => {
  // Disponibilidad: tema expuesto con repaso; no con otra práctica activa ni sin tema.
  let g = attach(goal());
  assert.equal(p.productionAvailable(g), true);
  assert.equal(p.productionAvailable(attach(Object.assign(goal(), { events: [], reviews: [] }))), false);
  assert.equal(p.productionAvailable(attach(Object.assign(goal(), { mixed: { status: 'active' } }))), false);
  assert.equal(p.productionAvailable(attach(Object.assign(goal(), { beto: { status: 'active' } }))), false);
  g = attach(goal());
  const started = p.startProduction(g);
  assert.equal(started.node_id, 'a');
  assert.equal(p.productionAvailable(g), false, 'ya hay una práctica en curso');
  assert.throws(() => p.startProduction(g), e => e.code === 'PRODUCTION_ACTIVE');
  assert.equal(p.mixedAvailable(g), false, 'otras prácticas no se ofrecen durante la de cálculo');
  assert.throws(() => p.startProduction(attach(Object.assign(goal(), { events: [], reviews: [] }))), e => e.code === 'PRODUCTION_UNAVAILABLE');

  // Obtención: numérico primero; si no aplica, orden; si tampoco, no disponible sin error.
  g = attach(goal()); p.startProduction(g); script = { numeric: numericRes(), ordering: orderingRes() }; calls = [];
  assert.equal(await p.fetchProduction(g), true);
  assert.deepEqual(calls.filter(c => c.route === '/api/practice/produce').map(c => c.body.kind), ['numeric']);
  assert.equal(g.production.kind, 'numeric');
  g = attach(goal()); p.startProduction(g); script = { numeric: Error('PRODUCTION_NOT_APPLICABLE: este tema no admite ese tipo de práctica.'), ordering: orderingRes() }; calls = [];
  assert.equal(await p.fetchProduction(g), true);
  assert.deepEqual(calls.filter(c => c.route === '/api/practice/produce').map(c => c.body.kind), ['numeric', 'ordering']);
  assert.equal(g.production.item.steps.length, 3);
  g = attach(goal()); p.startProduction(g); script = { numeric: Error('PRODUCTION_NOT_APPLICABLE: x'), ordering: Error('PRODUCTION_NOT_APPLICABLE: y') };
  assert.equal(await p.fetchProduction(g), false);
  assert.equal(g.production.unavailable, true);
  assert.equal(g.production.item, null);
  g = attach(goal()); p.startProduction(g); script = { numeric: Error('La práctica no cumplió el contrato; no se guardó nada.') };
  await assert.rejects(p.fetchProduction(g), /contrato/);

  // Respuesta correcta sin ayuda: EVIDENCE independiente por el camino central, con confianza y confianza del evaluador.
  g = attach(goal()); p.startProduction(g); script = { numeric: numericRes() }; await p.fetchProduction(g);
  assert.equal(p.applyProductionResult(g, verdict('CORRECT'), 'att-1', '60 g/m²', 85), true);
  let ev = g.events.filter(e => e.type === 'EVIDENCE');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].phase, 'INDEPENDENT');
  assert.equal(ev[0].result, 'CORRECT');
  assert.equal(ev[0].is_independent, true);
  assert.equal(ev[0].help_used, 0);
  assert.equal(ev[0].evaluator_trust, 'deterministic');
  assert.equal(ev[0].evaluator_version, 'local-production-v1');
  assert.equal(ev[0].learner_confidence, 85);
  assert.deepEqual(ev[0].observed_dimensions, ['direct_application']);
  assert.equal(g.coverage[0].dimensions.find(d => d.id === 'direct_application').evidence.filter(x => x.type !== 'TRUST').length, 1);
  assert.equal(g.coverage[0].dimensions.every(d => d.evidence.some(x => x.type === 'TRUST')), true, 'ancla creada por producción correcta');
  assert.equal(g.events.filter(e => e.type === 'TRUST_ANCHOR' && e.source === 'PRODUCTION').length, 1);
  assert.equal(g.production.status, 'done');
  // Idempotente: aplicar de nuevo no duplica evidencia.
  assert.equal(p.applyProductionResult(g, verdict('CORRECT'), 'att-1', '60 g/m²', 85), false);
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 1);

  // Fallo: cuenta como fallo de aprendizaje y no es independiente.
  g = attach(goal()); p.startProduction(g); script = { numeric: numericRes() }; await p.fetchProduction(g);
  p.applyProductionResult(g, verdict('MISCONCEPTION'), 'att-2', '62 g/m²', 90);
  ev = g.events.filter(e => e.type === 'EVIDENCE')[0];
  assert.equal(ev.counts_as_learning_failure, true);
  assert.equal(ev.is_independent, false);
  assert.equal(ev.calibration_signal, 'committed_misconception');

  // UNKNOWN nunca suma: ni independiente, ni éxito.
  g = attach(goal()); p.startProduction(g); script = { numeric: numericRes() }; await p.fetchProduction(g);
  p.applyProductionResult(g, verdict('UNKNOWN'), 'att-3', 'No sé', 95);
  ev = g.events.filter(e => e.type === 'EVIDENCE')[0];
  assert.equal(ev.result, 'UNKNOWN');
  assert.equal(ev.is_independent, false);
  assert.equal(ev.learner_confidence, null);
  assert.equal(p.independentSuccesses(g.coverage[0].dimensions[0]).length, 0);

  // Orden: dimensión «procedure».
  g = attach(goal()); p.startProduction(g); script = { numeric: Error('PRODUCTION_NOT_APPLICABLE: x'), ordering: orderingRes() }; await p.fetchProduction(g);
  p.applyProductionResult(g, verdict('CORRECT', { item_id: 'prod-2', kind: 'ordering', correct_order: [{ id: 's2', text: 'Limpiar' }] }), 'att-4', 'Limpiar → Aplicar → Curar', null);
  ev = g.events.filter(e => e.type === 'EVIDENCE')[0];
  assert.deepEqual(ev.observed_dimensions, ['procedure']);
  assert.equal(ev.activity_kind, 'procedure');

  // Tema sin la dimensión en su cobertura: el evento no acredita ninguna dimensión.
  g = attach(goal(['conceptual'])); p.startProduction(g); script = { numeric: numericRes() }; await p.fetchProduction(g);
  p.applyProductionResult(g, verdict('CORRECT'), 'att-5', '60 g/m²', 80);
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 1);
  assert.ok(g.coverage.every(c => c.dimensions.every(d => d.evidence.filter(x => x.type !== 'TRUST').length === 0)), 'ninguna dimensión recibió evidencia');
  assert.equal(p.verified(g, 'a'), false);

  // Resultado que no corresponde a la práctica: se rechaza sin registrar nada.
  g = attach(goal()); p.startProduction(g); script = { numeric: numericRes() }; await p.fetchProduction(g);
  for (const bad of [verdict('CORRECT', { item_id: 'otra' }), verdict('CORRECT', { node_id: 'b' }), verdict('CORRECT', { schema_version: 'placement_v1' }), verdict('PARTIAL'), null]) {
    assert.throws(() => p.applyProductionResult(g, bad, 'att-6', 'x', 50), e => e.code === 'INVALID_PRODUCTION_RESULT');
  }
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0);
  assert.equal(g.production.status, 'active');

  // Sin práctica activa, no hay nada que aplicar.
  g = attach(goal());
  assert.throws(() => p.applyProductionResult(g, verdict('CORRECT'), 'att-7', 'x', 50), e => e.code === 'STALE_PRODUCTION');

  // Humo de la vista: numérica, de orden y de resultado se dibujan sin error y con sus controles.
  const find = (label, root = roots.app) => { if (root && root.textContent === label) return root; for (const c of (root && root.children) || []) { const f = find(label, c); if (f) return f; } return null; };
  const has = (needle, root = roots.app) => { if (root && String(root.textContent || '').includes(needle)) return true; return ((root && root.children) || []).some(c => has(needle, c)); };
  g = attach(goal()); p.startProduction(g); script = { numeric: numericRes() }; await p.fetchProduction(g); g.session.mode = 'DIAGNOSTIC';
  await p.session();
  assert.ok(has('Calcula la masa por área.'));
  assert.ok(find('Comprobar') && find('No sé') && find('Salir sin responder'));
  assert.equal(find('Subir'), null);
  g = attach(goal()); p.startProduction(g); script = { numeric: Error('PRODUCTION_NOT_APPLICABLE: x'), ordering: orderingRes() }; await p.fetchProduction(g);
  await p.session();
  assert.ok(find('Subir') && find('Bajar') && find('Comprobar orden'));
  assert.ok(has('Limpiar'));
  g = attach(goal()); p.startProduction(g); script = { numeric: numericRes() }; await p.fetchProduction(g);
  p.applyProductionResult(g, verdict('MISCONCEPTION'), 'att-ui', '62 g/m²', 50);
  await p.session();
  assert.ok(has('No coincide') && has('Resultado: 60 g/m²') && find('Volver al mapa'));
  assert.equal(find('Comprobar'), null, 'tras responder no se vuelve a pedir');

  console.log('local_production: OK');
})().catch(e => { console.error(e); process.exit(1); });
