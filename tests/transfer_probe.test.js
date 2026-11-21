// transfer_probe_v1 (L2b): la transferencia solo se acredita con un sondeo determinista, emitido por el servidor,
// en otro contexto. Zona horaria fija y respuestas controladas: no se llama a ningún proveedor.
process.env.TZ = 'America/Mexico_City';
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, append(...xs) { this.children.push(...xs); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...xs) { this.children = xs; }, setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, dataset: {} }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id] || element('main'), createElement: element };
global.localStorage = { getItem: () => null, setItem() {} };
global.confirm = () => true;
let fetchLog = [];
let fetchReply = async () => ({});
global.fetch = async (route, opts) => {
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  fetchLog.push({ route, body });
  if (route === '/api/profile/save') return { ok: true, status: 200, json: async () => ({ ok: true, revision: 2 }) };
  const reply = await fetchReply(route, body);
  return { ok: (reply.status || 200) < 400, status: reply.status || 200, json: async () => reply.json };
};
const p = require('../app.js');
const DAY = 86400000;
const mx = (d, h = 0, mi = 0) => Date.UTC(2026, 10, d, h + 6, mi); // America/Mexico_City: UTC-6 fijo desde 2022
let NOW = mx(20, 12);
p.setClockForTests(() => NOW);
(async () => {

let seq = 0;
const id = pfx => pfx + (++seq);
// Producción escrita determinista, independiente, de otro día: la que confirma lo diferido.
const written = (at, prompt, extra = {}) => ({ type: 'EVIDENCE', evidence_id: id('e'), attempt_id: id('att'), activity_id: id('act'), node_id: 'a', phase: 'INDEPENDENT', result: 'CORRECT', status: 'CORRECT', is_independent: true, help_used: 0, evidence_role: 'learning', observed_dimensions: ['direct_application'], question: { prompt }, timestamp: at, evaluator_trust: 'deterministic', evaluator_version: 'local-production-v1', production_kind: 'numeric', ...extra });
const teach = (at, node = 'a') => ({ type: 'TEACHING_EXPOSURE', node_id: node, at, policy_version: 'retrieval_gap_v1' });
// Sondeo emitido por el servidor y corregido localmente.
const probe = (at, result = 'CORRECT', extra = {}) => ({ type: 'EVIDENCE', evidence_id: id('e'), attempt_id: id('att'), activity_id: id('act'), node_id: 'a', phase: 'TRANSFER_PROBE', result, status: result, is_independent: result === 'CORRECT', help_used: 0, evidence_role: 'learning', observed_dimensions: ['transfer'], question: { prompt: 'Sondeo ' + id('s') }, timestamp: at, evaluator_trust: 'deterministic', evaluator_version: 'local-production-v1', production_kind: 'numeric', is_novel_variant: true, transfer_probe_version: p.TRANSFER_VERSION, context_family: 'hogar', ...extra });
// Transferencia por integración con novedad declarada: la regla anterior la daba por buena.
const legacyNovel = at => ({ type: 'EVIDENCE', evidence_id: id('e'), attempt_id: id('att'), activity_id: id('act'), node_id: 'a', phase: 'INTEGRATE', result: 'CORRECT', status: 'CORRECT', is_independent: true, help_used: 0, evidence_role: 'learning', observed_dimensions: ['transfer'], question: { prompt: 'Integra ' + id('i') }, timestamp: at, evaluator_trust: 'deterministic', evaluator_version: 'integration-v1', is_novel_variant: true });
const TRANSFER_DIM = { id: 'transfer', name: 'Transferencia', required: true, evidence: [] };
function goalOf(events, { dims, extraNodes = [], production = null, lessons = {} } = {}) {
  const coverage = [{ id: 'a', name: 'Tema A', dimensions: dims || [] }, ...extraNodes];
  for (const c of coverage) for (const d of c.dimensions) d.evidence = d.evidence || [];
  coverage[0].dimensions.forEach(d => { d.evidence = events.filter(e => e.type === 'EVIDENCE' && e.node_id === 'a' && (e.observed_dimensions || []).includes(d.id)); });
  return { id: 'g', profile_id: 'profile-test', goal: 'Meta', nodes: [{ id: 'a', name: 'Tema A', level: 0, prerequisites: [], outcome: 'Resolver' }, { id: 'b', name: 'Tema B', level: 1, prerequisites: [], outcome: 'Resolver' }], learner: {}, reviews: [], lessons, events, coverage, production, mixed: null, beto: null, challenge: null, contextStack: [], session: { mode: 'DIAGNOSTIC', node: null, stack: [], stage: 'teach', tries: 0 } };
}
// Tema con las dimensiones de aplicación ya suficientes y diferidas confirmadas; transferencia pendiente.
const appDims = () => [{ id: 'direct_application', name: 'Aplicación', required: true, evidence: [] }, { ...TRANSFER_DIM, evidence: [] }];
const readyEvents = (extra = []) => [teach(mx(10, 9)), written(mx(11, 10), 'p1'), written(mx(11, 11), 'p2'), ...extra];
const issued = (at, item = id('prod'), node = 'a') => ({ type: 'TRANSFER_PROBE_ISSUED', node_id: node, item_id: item, context_family: 'hogar', at, policy_version: p.TRANSFER_VERSION });
const blockOf = (goal, at = NOW, node = 'a') => p.transferBlock(goal, node, at);

// (1) Dos sondeos deterministas acreditan transferencia; la novedad de integración ya no basta (legacy solo con opción).
{
  const d = { id: 'transfer', evidence: [legacyNovel(mx(11, 12)), legacyNovel(mx(11, 13))] };
  assert.equal(p.sufficient(d), false, 'dos novedades de integración no bastan');
  assert.equal(p.sufficient(d, { legacyTransfer: true }), true, 'la regla anterior solo se conserva para medir impacto');
  const probes = { id: 'transfer', evidence: [probe(mx(11, 12)), probe(mx(12, 10))] };
  assert.equal(p.sufficient(probes), true, 'dos sondeos deterministas acreditan transferencia');
}

// (2) Un sondeo con confianza de modelo, o sin la versión del sondeo, no acredita transferencia.
{
  const model = { id: 'transfer', evidence: [probe(mx(11, 12), 'CORRECT', { evaluator_trust: 'model_single' }), probe(mx(12, 10), 'CORRECT', { evaluator_trust: 'model_single' })] };
  assert.equal(p.sufficient(model), false, 'la confianza de modelo no cuenta');
  const unversioned = { id: 'transfer', evidence: [probe(mx(11, 12), 'CORRECT', { transfer_probe_version: undefined }), probe(mx(12, 10), 'CORRECT', { transfer_probe_version: undefined })] };
  assert.equal(p.sufficient(unversioned), false, 'sin transfer_probe_v1 no cuenta');
}

// (3) Emitir y corregir: rol propio, sin ancla, sin pistas, dimensión transfer.
{
  const g = goalOf(readyEvents(), { dims: appDims() });
  g.production = { version: p.PROD_VERSION, id: 'prod-x', node_id: 'a', kind: 'numeric', status: 'active', result: null, unavailable: false, purpose: 'transfer', item: { item_id: 'prod-1', kind: 'numeric', prompt: 'Sondeo', steps: null, difficulty_band: 'standard', expected_unit: 'm²/h', context_family: 'hogar' } };
  const trustBefore = g.events.filter(e => e.type === 'TRUST').length;
  const ok = p.applyProductionResult(g, { schema_version: p.PROD_VERSION, item_id: 'prod-1', node_id: 'a', kind: 'numeric', status: 'CORRECT', error_type: 'none', solution: 'x' }, 'att-probe-1', '15 m²/h', null);
  assert.equal(ok, true);
  const ev = g.events.filter(e => e.type === 'EVIDENCE' && e.attempt_id === 'att-probe-1')[0];
  assert.deepEqual(ev.observed_dimensions, ['transfer']);
  assert.equal(ev.transfer_probe_version, p.TRANSFER_VERSION);
  assert.equal(ev.evaluator_trust, 'deterministic');
  assert.equal(ev.purpose, 'transfer');
  assert.equal(ev.is_novel_variant, true);
  assert.equal(ev.is_independent, true);
  assert.equal(ev.help_used, 0);
  assert.equal(ev.context_family, 'hogar');
  assert.equal(g.events.filter(e => e.type === 'TRUST').length, trustBefore, 'el sondeo nunca crea ancla');
}

// (4) Un fallo de transferencia solo activa enfriamiento: sin REPAIR, sin borrar lecciones, sin reabrir la lección.
{
  const lesson = { check: { prompt: 'c' }, example: 'e' };
  const g = goalOf([...readyEvents(), probe(mx(11, 12), 'MISCONCEPTION')], { dims: appDims(), lessons: { a: lesson } });
  g.repairEpisodes = [];
  g.production = { version: p.PROD_VERSION, id: 'prod-y', node_id: 'a', kind: 'numeric', status: 'active', result: null, unavailable: false, purpose: 'transfer', item: { item_id: 'prod-2', kind: 'numeric', prompt: 'S', steps: null, difficulty_band: 'standard', expected_unit: 'u', context_family: 'taller' } };
  NOW = mx(11, 12); // el fallo ocurre a las 12:00 del día 11
  p.applyProductionResult(g, { schema_version: p.PROD_VERSION, item_id: 'prod-2', node_id: 'a', kind: 'numeric', status: 'MISCONCEPTION', error_type: 'units', solution: 'x' }, 'att-probe-2', '1', null);
  assert.equal(g.repairEpisodes.length, 0, 'un fallo de transferencia no abre reparación');
  assert.deepEqual(g.lessons.a, lesson, 'la lección no se borra ni se reescribe');
  assert.equal(g.session.mode, 'DIAGNOSTIC', 'la sesión no se reabre');
  assert.equal(blockOf(g, mx(11, 14)), 'TRANSFER_COOLING', 'el fallo enfría la transferencia');
  assert.equal(blockOf(g, mx(12, 15)), null, 'pasadas 24 h sin nueva enseñanza el enfriamiento termina');
}

// (5) Cuándo: exige dominio diferido y el resto de dimensiones requeridas; una sola vez por día local por tema.
{
  const sameDay = goalOf([teach(mx(10, 9)), written(mx(10, 10), 'p1'), written(mx(10, 11), 'p2')], { dims: appDims() });
  assert.equal(blockOf(sameDay), 'TRANSFER_NOT_DUE', 'sin confirmación de otro día no se sondea');
  const g = goalOf(readyEvents([issued(mx(11, 15), 'prod-a')]), { dims: appDims() });
  assert.equal(blockOf(g, mx(11, 20)), 'TRANSFER_TODAY', 'un sondeo por día local por tema');
  assert.equal(blockOf(g, mx(12, 9)), null, 'al día siguiente vuelve a estar disponible');
}

// (6) Tope de cuatro por tema, válvula por enseñanza nueva o siete días desde el último sondeo.
{
  const sondeos = [issued(mx(11, 12), 'p-1'), issued(mx(12, 12), 'p-2'), issued(mx(13, 12), 'p-3'), issued(mx(14, 12), 'p-4')];
  const g = goalOf(readyEvents(sondeos), { dims: appDims() });
  assert.equal(blockOf(g, mx(15, 12)), 'TRANSFER_LIMIT', 'el quinto sondeo del tema se bloquea');
  assert.equal(blockOf(g, mx(14, 12) + 7 * DAY + 1), null, 'siete días desde el último sondeo liberan el tope');
  const relearned = goalOf([...readyEvents(sondeos), teach(mx(15, 9))], { dims: appDims() });
  assert.equal(blockOf(relearned, mx(15, 12)), null, 'una nueva enseñanza libera el tope');
}

// (7) Ocupado: ninguna otra actividad activa.
{
  const g = goalOf(readyEvents(), { dims: appDims(), production: { status: 'active', purpose: 'practice', node_id: 'b' } });
  assert.equal(blockOf(g), 'TRANSFER_BUSY');
}

// (8) Cliente: emitir, reutilizar sin duplicar, nunca enviar ancla ni banda distinta de standard.
{
  const g = goalOf(readyEvents(), { dims: appDims() });
  fetchLog = [];
  fetchReply = async () => ({ status: 200, json: { schema_version: p.PROD_VERSION, item_id: 'prod-9', node_id: 'a', kind: 'numeric', prompt: 'Sondeo nuevo', purpose: 'transfer', difficulty_band: 'challenge', context_family: 'hogar', transfer_probe_version: p.TRANSFER_VERSION, expected_unit: 'm²/h' } });
  p.startTransferProbe(g, 'a');
  assert.equal(g.production.purpose, 'transfer');
  assert.equal(await p.fetchTransferProbe(g), true);
  assert.equal(fetchLog[0].route, '/api/practice/transfer');
  assert.equal('anchor_for_attempt_id' in fetchLog[0].body, false);
  assert.equal('kind' in fetchLog[0].body, false, 'el servidor elige el tipo');
  assert.equal(g.production.item.difficulty_band, 'standard', 'el cliente fuerza banda standard');
  assert.equal(g.events.filter(e => e.type === 'TRANSFER_PROBE_ISSUED' && e.item_id === 'prod-9').length, 1);
  g.production = { ...g.production, status: 'active', item: null, kind: null };
  await p.fetchTransferProbe(g);
  assert.equal(g.events.filter(e => e.type === 'TRANSFER_PROBE_ISSUED' && e.item_id === 'prod-9').length, 1, 'reutilizar no duplica el registro');
}

// (9) D5: sin cálculo ni orden, la transferencia queda pendiente, una vez registrada; reintento solo una vez.
{
  const g = goalOf(readyEvents(), { dims: appDims() });
  const unavailable = { status: 400, json: { error: 'TRANSFER_UNAVAILABLE: este tema no admite un sondeo escrito.' } };
  fetchReply = async () => unavailable;
  p.startTransferProbe(g, 'a');
  assert.equal(await p.fetchTransferProbe(g), false);
  assert.equal(g.production.unavailable, true);
  assert.equal(g.events.filter(e => e.type === 'TRANSFER_UNAVAILABLE' && e.node_id === 'a').length, 1);
  assert.equal(g.events.find(e => e.type === 'TRANSFER_UNAVAILABLE').retry_used, false);
  g.production = null;
  p.startTransferProbe(g, 'a', { retry: true });
  assert.equal(await p.fetchTransferProbe(g), false);
  assert.equal(g.events.filter(e => e.type === 'TRANSFER_UNAVAILABLE' && e.node_id === 'a').length, 2);
  assert.equal(g.events.filter(e => e.type === 'TRANSFER_UNAVAILABLE').at(-1).retry_used, true);
  g.production = null;
  assert.throws(() => p.startTransferProbe(g, 'a', { retry: true }), err => err.code === 'TRANSFER_UNAVAILABLE_RETRY_USED', 'Intentar de nuevo solo una vez');
  assert.equal(g.events.filter(e => e.type === 'TRANSFER_UNAVAILABLE').length, 2, 'nada se duplica');
}

// (10) Aviso L3: tras L1 y L2, idempotente, sin borrar nada.
{
  const dimsA = [{ id: 'direct_application', name: 'Aplicación', required: true, evidence: [] }, { ...TRANSFER_DIM, evidence: [] }];
  const legacyEvents = [teach(mx(10, 9)), written(mx(11, 10), 'p1'), written(mx(11, 11), 'p2'), legacyNovel(mx(11, 12)), legacyNovel(mx(11, 13))];
  const sameDayB = [teach(mx(10, 9), 'b'), written(mx(10, 10), 'pb1', { node_id: 'b' }), written(mx(10, 11), 'pb2', { node_id: 'b' })];
  const g = goalOf([...legacyEvents, ...sameDayB], {
    dims: dimsA,
    extraNodes: [{ id: 'b', name: 'Tema B', dimensions: [{ id: 'direct_application', name: 'Aplicación', required: true, evidence: [] }] }],
  });
  g.coverage[1].dimensions[0].evidence = sameDayB.filter(e => e.type === 'EVIDENCE');
  const first = p.policyNoticeView(g);
  assert.ok(first, 'hay aviso');
  assert.doesNotMatch(JSON.stringify(first), /la aplicación a situaciones nuevas/, 'L2 va antes que L3');
  assert.match(JSON.stringify(first), /Cambiamos otra regla/);
  assert.equal(p.transferImpact(g).some(r => r.node_id === 'a'), true);
  p.acknowledgePolicyNotice(g, mx(20, 10), p.DELAYED_VERSION);
  const l3 = p.policyNoticeView(g);
  assert.ok(l3, 'tras reconocer L2 aparece L3');
  assert.match(JSON.stringify(l3.children || l3), /la aplicación a situaciones nuevas/);
  p.acknowledgePolicyNotice(g, mx(20, 10), p.TRANSFER_VERSION);
  p.acknowledgePolicyNotice(g, mx(20, 11), p.TRANSFER_VERSION);
  assert.equal(g.events.filter(e => e.type === 'POLICY_NOTICE_ACK' && e.policy_version === p.TRANSFER_VERSION).length, 1, 'acuse idempotente');
  assert.equal(p.policyNoticeView(g), null);
  assert.ok(g.events.some(e => e.type === 'EVIDENCE' && e.attempt_id), 'no se borró evidencia');
}

// (11) Panel: la capa de transferencia usa el mismo filtro.
{
  const legacyOnly = goalOf([teach(mx(10, 9)), legacyNovel(mx(11, 12)), legacyNovel(mx(11, 13))], { dims: appDims() });
  assert.notEqual(p.expertLayers(legacyOnly, 'a').layers.transfer, 'met', 'la novedad de integración no cubre la capa');
  const withProbes = goalOf([teach(mx(10, 9)), probe(mx(11, 12)), probe(mx(12, 10))], { dims: appDims() });
  assert.equal(p.expertLayers(withProbes, 'a').layers.transfer, 'met', 'dos sondeos cubren la capa');
}

// (12) Oferta visible (D5): sin práctica escrita posible queda pendiente, con «Seguir con la ruta» una sola vez.
{
  const g = goalOf(readyEvents(), { dims: appDims() });
  const offer = p.transferOffer(g, 'a');
  assert.match(JSON.stringify(offer), /Comprobar transferencia/);
  g.events.push({ type: 'TRANSFER_UNAVAILABLE', node_id: 'a', retry_used: true, at: mx(11, 16), policy_version: p.TRANSFER_VERSION });
  const pending = p.transferOffer(g, 'a');
  assert.match(JSON.stringify(pending), /Seguir con la ruta/, 'la salida de transferencia pendiente está visible');
  assert.doesNotMatch(JSON.stringify(pending), /Comprobar transferencia/);
  const cont = pending.children.find(x => x && x.textContent === 'Seguir con la ruta');
  cont.onclick();
  cont.onclick();
  assert.equal(g.events.filter(e => e.type === 'CURRICULUM_CONTINUED' && e.source === 'TRANSFER_PENDING').length, 1, 'seguir con la ruta no duplica el registro');
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE' && e.transfer_probe_version).length, 0, 'seguir con la ruta no crea evidencia');
}

console.log('transfer_probe.test.js OK');
})().catch(error => { console.error(error); process.exit(1); });
