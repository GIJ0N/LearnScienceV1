// delayed_mastery_v1 (L2a, revisión): C2 completo (settled en los puntos de la lista), C1 (helper de exposición)
// y C6 (timestamps futuros se descartan). La zona horaria se fija aquí y en CI.
process.env.TZ = 'America/Mexico_City';
const assert = require('node:assert/strict');
const fs = require('node:fs');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, append(...xs) { this.children.push(...xs); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...xs) { this.children = xs; }, setAttribute() {}, addEventListener() {} }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id] || element('main'), createElement: element };
global.localStorage = { getItem: () => null, setItem() {} };
global.confirm = () => true;
global.fetch = async route => { throw Error('Ruta inesperada ' + route); };
const p = require('../app.js');
const mx = (d, h = 0, mi = 0) => Date.UTC(2026, 10, d, h + 6, mi);
const NOW = mx(20, 12);
p.setClockForTests(() => NOW);
const textOf = el => el ? [el.textContent || '', ...(el.children || []).map(textOf)].join(' ') : '';

let seq = 0;
// Práctica escrita local, sin ayuda, de otro día o del mismo según el instante.
const ok = (node, at, extra = {}) => { seq++; return { type: 'EVIDENCE', evidence_id: 'e' + seq, attempt_id: 'att' + seq, activity_id: 'act' + seq, node_id: node, phase: 'INDEPENDENT', result: 'CORRECT', status: 'CORRECT', is_independent: true, help_used: 0, observed_dimensions: ['direct_application'], question: { prompt: 'Problema ' + seq }, timestamp: at, evidence_role: 'learning', evaluator_trust: 'deterministic', evaluator_version: 'local-production-v1', purpose: 'practice', ...extra }; };
const teach = (node, at) => ({ type: 'TEACHING_EXPOSURE', node_id: node, at, policy_version: 'retrieval_gap_v1' });
// nodes: [{id, prerequisites?}]. Cada tema tiene una dimensión requerida con sus eventos.
function mkGoal({ nodes, events = [], areas = [] }) {
  return {
    id: 'g', profile_id: 'profile-test', goal: 'Meta', learner: {}, reviews: [], lessons: {}, events, areas,
    nodes: nodes.map(n => ({ id: n.id, name: n.id, level: 0, prerequisites: n.prerequisites || [], outcome: 'Resolver' })),
    coverage: nodes.map(n => ({ id: n.id, name: n.id, dimensions: [{ id: 'direct_application', name: 'Aplicación', required: true, evidence: events.filter(e => e.type === 'EVIDENCE' && e.node_id === n.id) }] })),
    session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 }
  };
}
// Awaiting: dos aciertos escritos del mismo día que la enseñanza; suficiente, pero sin confirmar otro día.
const awaitingEvents = id => [teach(id, mx(10, 9)), ok(id, mx(10, 10)), ok(id, mx(10, 11))];
// Verified: un acierto escrito de otro día tras la enseñanza.
const verifiedEvents = id => [teach(id, mx(10, 9)), ok(id, mx(10, 10)), ok(id, mx(11, 10))];

// (1) C2 - áreas: los temas por confirmar no bloquean la expansión.
{
  const nodes = ['a1', 'a2', 'a3'].map(id => ({ id }));
  const areas = [{ id: 'x', name: 'X', status: 'expanded', node_ids: ['a1', 'a2', 'a3'], estimated_topics: 3 }, { id: 'y', name: 'Y', status: 'pending', estimated_topics: 5 }];
  const awaiting = mkGoal({ nodes, areas, events: ['a1', 'a2', 'a3'].flatMap(awaitingEvents) });
  assert.equal(p.incompleteTopics(awaiting).length, 0, 'los temas por confirmar no son incompletos');
  assert.equal(p.shouldAutoExpand(awaiting), true, 'el área siguiente se abre aunque haya tres temas por confirmar');
  const fresh = mkGoal({ nodes, areas, events: [] });
  assert.equal(p.incompleteTopics(fresh).length, 3);
  assert.equal(p.shouldAutoExpand(fresh), false, 'control: sin evidencia el límite sigue frenando la expansión');
}

// (2) C2 - renderAreas: un tema continuado y otro por confirmar cuentan como aproximados, no como abiertos.
{
  const nodes = [{ id: 'c' }, { id: 'w' }];
  const areas = [{ id: 'x', name: 'X', status: 'expanded', node_ids: ['c', 'w'] }];
  const events = [{ type: 'CURRICULUM_CONTINUED', node_id: 'c', at: mx(10, 9), policy_version: 'x' }, ...awaitingEvents('w')];
  const box = element();
  p.renderAreas(box, mkGoal({ nodes, areas, events }));
  const text = textOf(box);
  assert.match(text, /≈ X/, 'continuado + por confirmar = aproximado');
  assert.doesNotMatch(text, /→ X/, 'no aparece como área abierta');
}

// (3) C2 - botón «Comprobar evidencia»: nunca lleva a un tema que ya espera confirmación.
{
  const nodes = [{ id: 'aw' }, { id: 'vf' }, { id: 'nu' }];
  const events = [...awaitingEvents('aw'), ...verifiedEvents('vf')];
  const g = mkGoal({ nodes, events });
  assert.equal(p.canOfferEvidenceCheck(g, 'aw'), false, 'un tema por confirmar no ofrece comprobación');
  assert.equal(p.canOfferEvidenceCheck(g, 'vf'), false, 'un tema dominado no ofrece comprobación');
  assert.equal(p.canOfferEvidenceCheck(g, 'nu'), true, 'un tema sin evidencia sí ofrece comprobación');
}

// (4) C2 - prerrequisitos: un prerrequisito por confirmar no se propone para repaso.
{
  const nodes = [{ id: 'pre' }, { id: 'b', prerequisites: ['pre'] }];
  assert.deepEqual(p.prqCandidates(mkGoal({ nodes, events: awaitingEvents('pre') }), 'b'), [], 'por confirmar no se propone');
  assert.deepEqual(p.prqCandidates(mkGoal({ nodes, events: [] }), 'b'), ['pre'], 'control: sin evidencia sí se propone');
}

// (5) C1 - el helper escribe el mismo evento y es el único punto de escritura de TEACHING_EXPOSURE.
{
  const g = mkGoal({ nodes: [{ id: 'a' }], events: [] });
  p.noteTeachingExposure(g, 'a', mx(10, 9));
  const ev = g.events.at(-1);
  assert.equal(ev.type, 'TEACHING_EXPOSURE'); assert.equal(ev.node_id, 'a'); assert.equal(ev.at, mx(10, 9)); assert.ok(ev.policy_version);
  const src = fs.readFileSync(require.resolve('../app.js'), 'utf8');
  assert.equal((src.match(/events\.push\(\{type:'TEACHING_EXPOSURE'/g) || []).length, 1, 'ninguna escritura directa fuera del helper');
}

// (6) C6 - timestamps futuros (más de unos minutos) no cuentan; un margen corto sí.
{
  assert.equal(p.eventTime({ timestamp: NOW + 10 * 60000 }), null, 'futuro de 10 min: descartado');
  assert.equal(p.eventTime({ timestamp: NOW + 60000 }), NOW + 60000, 'margen de 1 min: aceptado');
  assert.equal(p.eventTime({ timestamp: NOW - 60000 }), NOW - 60000, 'pasado: aceptado');
  assert.equal(p.eventTime({ timestamp: 'x' }), null, 'cadena: descartada');
  // Un acierto con fecha futura no puede confirmar el dominio diferido.
  const future = mkGoal({ nodes: [{ id: 'a' }], events: [teach('a', mx(10, 9)), ok('a', mx(10, 10)), ok('a', mx(10, 11)), ok('a', mx(20, 15))] });
  assert.equal(p.verified(future, 'a'), false, 'un acierto futuro no confirma');
}

console.log('delayed_mastery_settled.test.js OK');
