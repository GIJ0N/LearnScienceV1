// L2a: correcciones C-a (ancla solo desde ancla), C-b (texto de «sin práctica escrita»), C-c (solo NOT_APPLICABLE
// pasa a ordering) y la producción escrita de confirmación diferida (purpose 'delayed': sin ancla, 4 pasos si es orden).
process.env.TZ = 'America/Mexico_City';
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {} } }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id] || element('main'), createElement: element };
global.localStorage = { getItem: () => null, setItem() {} };
global.confirm = () => true;
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
const p = require('../app.js');
const mx = (d, h = 0, mi = 0) => Date.UTC(2026, 10, d, h + 6, mi);
let NOW = mx(10, 20);
p.setClockForTests(() => NOW);
const textOf = el => el ? [el.textContent || '', ...(el.children || []).map(textOf)].join(' ') : '';
const NOTE = 'Este tema aún no tiene una práctica escrita que pueda corregirse sin el modelo. Por ahora esas respuestas quedan por confirmar y puedes seguir con la ruta.';

const node = (id, i = 0) => ({ id, name: id, level: i, prerequisites: [], outcome: 'Resolver', probe: { prompt: 'Explica ' + id, kind: 'explanation' } });
const dimsOf = evidence => [{ id: 'direct_application', name: 'Aplicación', required: true, status: 'UNKNOWN', evidence }];
// Tema a con enseñanza y repaso; b sin nada. extra.events se añaden al ledger.
function goal(events = [{ type: 'TEACHING_EXPOSURE', node_id: 'a', at: mx(10, 9) }], evidenceA = [], extra = {}) {
  return {
    id: 'g', profile_id: 'profile-test', goal: 'Pintura en polvo', nodes: [node('a'), node('b', 1)], learner: {},
    reviews: [{ id: 'a', due: NOW + 86400000, step: 0, history: [] }], events,
    coverage: [{ id: 'a', name: 'a', status: 'UNKNOWN', confidence: 0, dimensions: dimsOf(evidenceA) }, { id: 'b', name: 'b', status: 'UNKNOWN', confidence: 0, dimensions: dimsOf([]) }],
    lessons: {}, session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 }, ...extra,
  };
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
// Aciertos del modelo sin ancla: sirven para que anchorNeed pida un problema escrito.
const modelEv = (at, attemptId) => ({ type: 'EVIDENCE', evidence_id: 'ev-' + attemptId, attempt_id: attemptId, activity_id: 'act-' + attemptId, node_id: 'a', phase: 'INDEPENDENT', result: 'CORRECT', status: 'CORRECT', is_independent: true, help_used: 0, observed_dimensions: ['direct_application'], question: { prompt: 'Pregunta ' + attemptId }, timestamp: at, evidence_role: 'learning', evaluator_trust: 'model_single', trust_policy_version: p.TRUST_POLICY_VERSION, evaluator_version: 'gemini-eval-v1', purpose: 'practice' });
const detEv = (at, attemptId) => ({ ...modelEv(at, attemptId), evaluator_trust: 'deterministic', evaluator_version: 'local-production-v1', trust_policy_version: undefined });
const anchorGoal = () => { const events = [{ type: 'TEACHING_EXPOSURE', node_id: 'a', at: mx(9, 9) }, modelEv(mx(9, 10), 'm1'), modelEv(mx(9, 11), 'm2')]; return goal(events, [events[1], events[2]]); };
const numericRes = (extra = {}) => ({ schema_version: 'local_production_v1', item_id: 'prod-1', node_id: 'a', kind: 'numeric', prompt: 'Calcula la masa por área.', ...extra });
const orderingRes = (steps = 4) => ({ schema_version: 'local_production_v1', item_id: 'prod-2', node_id: 'a', kind: 'ordering', prompt: 'Ordena.', steps: Array.from({ length: steps }, (_, i) => ({ id: 's' + (i + 1), text: 'Paso ' + (i + 1) })) });
const verdict = (status, extra = {}) => ({ schema_version: 'local_production_v1', status, item_id: 'prod-1', node_id: 'a', kind: 'numeric', solution: '120/2', correct_value: 60, correct_unit: 'g/m²', error_type: status === 'CORRECT' ? 'none' : 'arithmetic', evaluator_version: 'local-production-v1', ...extra });
const anchorEvents = g => g.events.filter(e => e.type === 'TRUST_ANCHOR');

(async () => {
  // C-a: una práctica normal correcta NO crea ancla.
  NOW = mx(10, 20);
  let g = attach(goal());
  p.startProduction(g); script = { numeric: numericRes() }; await p.fetchProduction(g);
  assert.equal(p.applyProductionResult(g, verdict('CORRECT'), 'att-practice', '60', 80), true);
  assert.equal(anchorEvents(g).length, 0, 'práctica normal correcta no ancla');
  assert.equal(g.coverage[0].dimensions[0].evidence.some(x => x.type === 'TRUST'), false);

  // C-a: solo la producción de ancla correcta, sin ayuda y de banda no base, ancla.
  NOW = mx(9, 20);
  g = attach(anchorGoal());
  p.startProduction(g, { node_id: 'a', purpose: 'anchor', source_attempt_id: 'm2' });
  script = { numeric: numericRes() }; await p.fetchProduction(g);
  assert.equal(p.applyProductionResult(g, verdict('CORRECT'), 'att-anchor', '60', 80), true);
  assert.equal(anchorEvents(g).length, 1, 'la producción de ancla correcta sí ancla');
  assert.equal(anchorEvents(g)[0].anchor_policy_version, p.HARDENING_VERSION);

  // C-a: createTrustAnchor exige meta.purpose === 'anchor'.
  g = attach(goal());
  assert.equal(p.createTrustAnchor(g, 'a', 'PRODUCTION', 'x', NOW, { basis: 'numeric' }), false, 'sin propósito de ancla no ancla');
  assert.equal(g.events.filter(e => e.type === 'TRUST_ANCHOR').length, 0);
  assert.equal(p.createTrustAnchor(g, 'a', 'PRODUCTION', 'x', NOW, { basis: 'numeric', purpose: 'anchor' }), true, 'con propósito de ancla sí');

  // C-c: un ítem malformado devuelve false sin marcar «no disponible», sin registrar nada y sin probar orden.
  NOW = mx(9, 20);
  g = attach(anchorGoal());
  p.startProduction(g, { node_id: 'a', purpose: 'anchor', source_attempt_id: 'm2' }); calls = [];
  script = { numeric: numericRes({ item_id: '' }), ordering: orderingRes() };
  assert.equal(await p.fetchProduction(g), false, 'malformado devuelve false');
  assert.deepEqual(calls.filter(c => c.route === '/api/practice/produce').map(c => c.body.kind), ['numeric'], 'no prueba orden');
  assert.equal(g.production.unavailable, false, 'no es un tema sin práctica');
  assert.equal(g.events.filter(e => e.type === 'ANCHOR_UNAVAILABLE').length, 0, 'no se registra como no disponible');

  // C-c: un orden con 3 pasos para el ancla también es malformado.
  g = attach(anchorGoal());
  p.startProduction(g, { node_id: 'a', purpose: 'anchor', source_attempt_id: 'm2' }); calls = [];
  script = { numeric: Error('PRODUCTION_NOT_APPLICABLE: x'), ordering: orderingRes(3) };
  assert.equal(await p.fetchProduction(g), false);
  assert.equal(g.production.unavailable, false);
  assert.equal(g.events.filter(e => e.type === 'ANCHOR_UNAVAILABLE').length, 0);

  // C-c: solo NOT_APPLICABLE en ambos tipos deja el tema sin práctica escrita y lo registra una vez.
  g = attach(anchorGoal());
  p.startProduction(g, { node_id: 'a', purpose: 'anchor', source_attempt_id: 'm2' });
  script = { numeric: Error('PRODUCTION_NOT_APPLICABLE: x'), ordering: Error('PRODUCTION_NOT_APPLICABLE: y') };
  assert.equal(await p.fetchProduction(g), false);
  assert.equal(g.production.unavailable, true);
  assert.equal(g.events.filter(e => e.type === 'ANCHOR_UNAVAILABLE').length, 1);

  // C-b: sin práctica escrita posible, el aviso dice solo eso, y la oferta de ancla explica la situación.
  NOW = mx(11, 10);
  const legacy = goal([{ type: 'TEACHING_EXPOSURE', node_id: 'a', at: mx(10, 9) }, detEv(mx(10, 10), 'd1'), detEv(mx(10, 11), 'd2'), { type: 'ANCHOR_UNAVAILABLE', node_id: 'a', kinds: ['numeric', 'ordering'], retry_used: false, at: mx(10, 12), policy_version: p.HARDENING_VERSION }], [detEv(mx(10, 10), 'd1'), detEv(mx(10, 11), 'd2')]);
  assert.equal(p.ANCHOR_UNAVAILABLE_NOTE, NOTE, 'texto exacto');
  const warning = textOf(p.policyNoticeView(legacy));
  assert.ok(warning.includes(NOTE), 'aviso con el texto exacto');
  assert.equal(warning.includes('problema escrito corto mañana'), false, 'no promete un problema escrito');
  g = attach(anchorGoal());
  p.recordAnchorUnavailable(g, 'a', { retryUsed: true, at: mx(9, 12) });
  const offer = p.anchorOffer(g, 'a');
  assert.ok(offer, 'con reintento agotado la oferta no desaparece sin explicación');
  assert.ok(textOf(offer).includes(NOTE));

  // Práctica diferida: solo tras un acierto de otro día; sin ancla; banda estándar; orden de 4 pasos.
  NOW = mx(10, 20);
  g = attach(goal([{ type: 'TEACHING_EXPOSURE', node_id: 'a', at: mx(10, 9) }, detEv(mx(10, 10), 'd1'), detEv(mx(10, 11), 'd2')], [detEv(mx(10, 10), 'd1'), detEv(mx(10, 11), 'd2')]));
  assert.throws(() => p.startProduction(g, { node_id: 'a', purpose: 'delayed' }), e => e.code === 'DELAYED_NOT_DUE', 'mismo día no se ofrece');
  NOW = mx(11, 10);
  const prod = p.startProduction(g, { node_id: 'a', purpose: 'delayed' });
  assert.equal(prod.purpose, 'delayed');
  calls = [];
  script = { numeric: numericRes() }; await p.fetchProduction(g);
  assert.equal(p.applyProductionResult(g, verdict('CORRECT'), 'att-delayed', '60', 80), true);
  const delayedEvent = g.events.filter(e => e.type === 'EVIDENCE' && e.attempt_id === 'att-delayed')[0];
  assert.equal(delayedEvent.purpose, 'delayed');
  assert.equal(delayedEvent.evaluator_trust, 'deterministic');
  assert.equal(anchorEvents(g).length, 0, 'la confirmación diferida no ancla');
  assert.equal(p.verified(g, 'a'), true, 'el acierto escrito de otro día confirma');

  // Orden de confirmación: 3 pasos no bastan.
  g = attach(goal([{ type: 'TEACHING_EXPOSURE', node_id: 'a', at: mx(10, 9) }, detEv(mx(10, 10), 'd1'), detEv(mx(10, 11), 'd2')], [detEv(mx(10, 10), 'd1'), detEv(mx(10, 11), 'd2')]));
  NOW = mx(11, 10);
  p.startProduction(g, { node_id: 'a', purpose: 'delayed' }); calls = [];
  script = { numeric: Error('PRODUCTION_NOT_APPLICABLE: x'), ordering: orderingRes(3) };
  assert.equal(await p.fetchProduction(g), false);
  assert.equal(g.production.unavailable, false);
  assert.equal(g.events.filter(e => e.type === 'ANCHOR_UNAVAILABLE').length, 0);
  script = { numeric: Error('PRODUCTION_NOT_APPLICABLE: x'), ordering: orderingRes(4) };
  calls = [];
  assert.equal(await p.fetchProduction(g), true, 'orden con 4 pasos sí se ofrece');

  // Sin práctica escrita posible: no confirma, queda por confirmar y se registra una vez.
  g = attach(goal([{ type: 'TEACHING_EXPOSURE', node_id: 'a', at: mx(10, 9) }, detEv(mx(10, 10), 'd1'), detEv(mx(10, 11), 'd2')], [detEv(mx(10, 10), 'd1'), detEv(mx(10, 11), 'd2')]));
  NOW = mx(11, 10);
  p.startProduction(g, { node_id: 'a', purpose: 'delayed' });
  script = { numeric: Error('PRODUCTION_NOT_APPLICABLE: x'), ordering: Error('PRODUCTION_NOT_APPLICABLE: y') };
  assert.equal(await p.fetchProduction(g), false);
  assert.equal(g.production.unavailable, true);
  assert.equal(g.events.filter(e => e.type === 'ANCHOR_UNAVAILABLE').length, 1);
  assert.equal(p.verified(g, 'a'), false);
  assert.equal(p.readyToAdvance(g, 'a'), true, 'queda por confirmar, la ruta sigue');

  console.log('evidence_l2_fixes.test.js OK');
})().catch(err => { console.error(err); process.exit(1); });
