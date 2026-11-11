// study_plan_v1 (cliente): el plan es una función pura sobre el estado; no cambia el selector, la cobertura ni el calendario.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute() {}, prepend() {} }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
let confirmCalls = 0;
global.confirm = () => { confirmCalls++; return true; };
global.fetch = async (route, options) => {
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  return { ok: false, json: async () => ({ error: 'sin ruta en la prueba: ' + route }) };
};
const p = require('../app.js');
const DAY = 86400000, AT = 1700000000000;
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const find = (label, root = roots.app) => { if (root && root.textContent === label) return root; for (const c of (root && root.children) || []) { const f = find(label, c); if (f) return f; } return null; };
const has = (needle, root = roots.app) => { if (root && String(root.textContent || '').includes(needle)) return true; return ((root && root.children) || []).some(c => has(needle, c)); };

const node = (id, prerequisites, level) => ({ id, name: 'Tema ' + id.toUpperCase(), outcome: 'Resultado ' + id, level, prerequisites, kind: 'procedure', probe: { prompt: 'Sonda ' + id, reference: 'r', kind: 'explanation' } });
function goal(withAreas = true) {
  const nodes = [node('a', [], 0), node('b', ['a'], 1), node('c', ['a'], 1), node('d', ['a'], 1), node('e', ['a'], 1), node('f', ['a'], 1), node('g', ['b'], 2)];
  const g = {
    id: 'g1', profile_id: 'profile-test', goal: 'Pintura en polvo', nodes, learner: {}, reviews: [], events: [], lessons: {},
    coverage: nodes.map(n => ({ id: n.id, name: n.name, status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'units', name: 'u', required: true, status: 'UNKNOWN', evidence: [] }] })),
    session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 },
  };
  if (withAreas) g.areas = [
    { id: 'ar1', name: 'Fundamentos', status: 'expanded', node_ids: ['a', 'b', 'c', 'd'] },
    { id: 'ar2', name: 'Aplicaciones', status: 'expanded', node_ids: ['e', 'f', 'g'] },
    { id: 'ar3', name: 'Avanzado', status: 'pending', estimated_topics: 6 },
  ];
  return g;
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
let serial = 0;
function record(g, id, status = 'CORRECT', help = 0) {
  const question = { prompt: 'Pregunta ' + (++serial), reference: 'Criterio', kind: p.CONFIRMATION_KINDS.units, observable_dimensions: ['units'] };
  return p.record(g, id, 'CONFIRMATION', 'Respuesta', { status, evaluator_version: 'local-fixture', error_type: status === 'MISCONCEPTION' ? 'units' : 'none' }, help, p.activityContract(question, id, 'evidence_confirmation'), 'attempt-' + serial);
}
const verifyNode = (g, id) => { record(g, id); record(g, id); assert.equal(p.verified(g, id), true, 'preparación: ' + id + ' verificado'); };
const topics = plan => plan.groups.flatMap(x => x.topics);
const t = (plan, id) => topics(plan).find(x => x.node_id === id);

(async () => {
  // Determinista y de solo lectura.
  {
    const g = attach(goal()); const before = JSON.stringify(g);
    const one = p.studyPlan(g, AT), two = p.studyPlan(g, AT);
    assert.deepEqual(one, two); assert.equal(JSON.stringify(g), before, 'construir el plan no escribe nada');
    assert.equal(one.version, 'study_plan_v1');
    assert.deepEqual(one.groups.map(x => x.name), ['Fundamentos', 'Aplicaciones', 'Avanzado']);
    assert.deepEqual(one.groups.map(x => x.status), ['open', 'open', 'pending']);
    assert.deepEqual(one.groups[0].topics.map(x => x.node_id), ['a', 'b', 'c', 'd']);
    assert.equal(one.groups[2].estimated_topics, 6); assert.deepEqual(one.groups[2].topics, []);
    assert.equal(one.remaining, 7 + 6, 'siete temas abiertos más ≈6 sin abrir');
  }

  // Bloqueado por un prerrequisito sin completar; al completarlo pasa a listo.
  {
    const g = attach(goal());
    let plan = p.studyPlan(g, AT);
    assert.equal(t(plan, 'a').state, 'ready'); assert.equal(t(plan, 'b').state, 'locked');
    assert.deepEqual(t(plan, 'b').missing, [{ id: 'a', name: 'Tema A' }]);
    assert.deepEqual(t(plan, 'a').missing, []);
    verifyNode(g, 'a');
    plan = p.studyPlan(g, AT);
    assert.equal(t(plan, 'a').state, 'done'); assert.equal(t(plan, 'b').state, 'ready'); assert.deepEqual(t(plan, 'b').missing, []);
    assert.equal(t(plan, 'g').state, 'locked'); assert.deepEqual(t(plan, 'g').missing, [{ id: 'b', name: 'Tema B' }]);
  }
  // Continuar con pendientes desbloquea sin declarar dominio.
  {
    const g = attach(goal()); g.events.push({ type: 'CURRICULUM_CONTINUED', node_id: 'a', at: AT - 5 });
    const plan = p.studyPlan(g, AT);
    assert.equal(t(plan, 'a').state, 'ready'); assert.equal(t(plan, 'a').continued, true); assert.equal(t(plan, 'b').state, 'ready');
    assert.equal(p.verified(g, 'a'), false);
  }

  // `next` coincide con el selector (no se duplica su lógica).
  for (const prepare of [() => {}, g => verifyNode(g, 'a'), g => { record(g, 'a'); record(g, 'a', 'MISCONCEPTION'); }]) {
    const g = attach(goal()); prepare(g);
    const decision = p.selectTutorAction(g, AT, { reselect: true }), plan = p.studyPlan(g, AT);
    assert.ok(plan.next); assert.equal(plan.next.node_id, decision.node_id); assert.equal(plan.next.reason, decision.reason);
  }
  { // Todo verificado: el selector propone un desafío sobre un tema ya hecho; el plan lo refleja sin inventar otro.
    const g = attach(goal()); for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) verifyNode(g, id);
    const decision = p.selectTutorAction(g, AT, { reselect: true }), plan = p.studyPlan(g, AT);
    assert.equal(decision.action, 'CHALLENGE'); assert.equal(plan.next.node_id, decision.node_id); assert.equal(t(plan, plan.next.node_id).state, 'done');
  }
  { // Si el selector no devuelve ningún tema, se usa el primer «ready».
    const g = attach(goal()); for (const n of g.nodes) g.events.push({ type: 'CURRICULUM_CONTINUED', node_id: n.id, at: 1 });
    const decision = p.selectTutorAction(g, AT, { reselect: true }); assert.equal(decision.node_id, null);
    const plan = p.studyPlan(g, AT); assert.equal(plan.next.node_id, 'a'); assert.match(plan.next.reason, /primer tema/);
    assert.equal(t(plan, plan.next.node_id).state, 'ready');
  }

  // Saltado por diagnóstico: nunca «done».
  {
    const g = attach(goal()); g.events.push({ type: 'PLACEMENT_SKIP', node_id: 'a', at: AT - 10 });
    const plan = p.studyPlan(g, AT);
    assert.equal(t(plan, 'a').state, 'skipped'); assert.notEqual(t(plan, 'a').state, 'done'); assert.equal(p.verified(g, 'a'), false);
    assert.equal(t(plan, 'b').state, 'ready', 'saltar desbloquea el siguiente sin conceder dominio');
    assert.equal(p.PLAN_STATE_TEXT.skipped, 'Saltado por diagnóstico');
    assert.equal(plan.remaining, 6 + 6, 'un tema saltado no cuenta como pendiente');
  }

  // Repaso vencido: tema no verificado -> «review»; verificado -> sigue «done» pero lo dice.
  {
    const g = attach(goal()); g.reviews.push({ id: 'c', due: AT - DAY, question: { prompt: 'Repaso c' } });
    let plan = p.studyPlan(g, AT); assert.equal(t(plan, 'c').state, 'review'); assert.equal(t(plan, 'c').review_due, true);
    assert.equal(p.studyPlan(g, AT - 2 * DAY).groups[0].topics.find(x => x.node_id === 'c').review_due, false);
    const h = attach(goal()); verifyNode(h, 'a'); h.reviews.push({ id: 'a', due: AT - DAY, question: { prompt: 'Repaso a' } });
    plan = p.studyPlan(h, AT); assert.equal(t(plan, 'a').state, 'done'); assert.equal(t(plan, 'a').review_due, true);
  }

  // Meta antigua sin áreas: un solo grupo «Ruta». Nodos fuera de toda área abierta no se pierden.
  {
    const g = attach(goal(false)); const plan = p.studyPlan(g, AT);
    assert.equal(plan.groups.length, 1); assert.equal(plan.groups[0].name, 'Ruta'); assert.equal(plan.groups[0].topics.length, 7); assert.equal(plan.remaining, 7);
    const h = attach(goal()); h.areas[1].node_ids = ['e']; const rest = p.studyPlan(h, AT).groups.at(-1);
    assert.equal(rest.name, 'Otros temas'); assert.deepEqual(rest.topics.map(x => x.node_id), ['f', 'g']);
  }

  // `unlocks`: como máximo 3 y solo dependientes directos.
  {
    const plan = p.studyPlan(attach(goal()), AT), a = t(plan, 'a');
    assert.equal(a.unlocks.length, 3); assert.deepEqual(a.unlocks.map(x => x.id), ['b', 'c', 'd']);
    assert.ok(!a.unlocks.some(x => x.id === 'g'), 'g depende de b, no de a');
    assert.deepEqual(t(plan, 'b').unlocks, [{ id: 'g', name: 'Tema G' }]); assert.deepEqual(t(plan, 'g').unlocks, []);
  }

  // Vista: recomendación, estados en palabras, y elegir un tema bloqueado sin confirm().
  {
    const g = attach(goal()); confirmCalls = 0; roots.app.children = []; p.planView();
    assert.ok(has('Te recomiendo seguir con: Tema A')); assert.ok(has('Por qué: ')); assert.ok(find('Empezar lo recomendado'));
    for (const text of ['Fundamentos', 'Aplicaciones', 'Avanzado', 'Listo para empezar', 'Te conviene esperar', 'Necesitas antes: Tema A', 'Te prepara para: Tema B, Tema C, Tema D']) assert.ok(has(text), text);
    assert.ok(has('≈6 temas · se abre al terminar el área anterior')); assert.ok(find('Abrir ahora'));
    // La fila bloqueada de Tema B: «Estudiar este tema» abre la oferta en la misma fila.
    const rows = []; (function walk(n) { if (n && n.className && String(n.className).startsWith('plan-topic')) rows.push(n); for (const c of (n && n.children) || []) walk(c); })(roots.app);
    const rowB = rows.find(r => r.children[0].textContent === 'Tema B'); assert.ok(rowB.className.includes('is-locked'));
    find('Estudiar este tema', rowB).onclick();
    assert.ok(has('Te conviene primero: Tema A', rowB)); assert.ok(find('Ir a Tema A', rowB)); assert.ok(find('Aprender este de todos modos', rowB));
    assert.equal(confirmCalls, 0, 'sin confirm()');
  }

  // «Aprender este de todos modos»: solo PLAN_OVERRIDE (más la decisión del tutor); cobertura, verified y repasos intactos.
  {
    const g = attach(goal()); g.reviews.push({ id: 'c', due: AT + DAY, question: { prompt: 'Repaso c' } });
    roots.app.children = []; p.planView();
    const rows = []; (function walk(n) { if (n && n.className && String(n.className).startsWith('plan-topic')) rows.push(n); for (const c of (n && n.children) || []) walk(c); })(roots.app);
    const rowB = rows.find(r => r.children[0].textContent === 'Tema B');
    const cov = JSON.stringify(g.coverage), rev = JSON.stringify(g.reviews), ver = g.nodes.map(n => p.verified(g, n.id)), evBefore = g.events.length;
    find('Estudiar este tema', rowB).onclick(); find('Aprender este de todos modos', rowB).onclick(); await settle();
    assert.equal(JSON.stringify(g.coverage), cov); assert.equal(JSON.stringify(g.reviews), rev); assert.deepEqual(g.nodes.map(n => p.verified(g, n.id)), ver);
    const added = g.events.slice(evBefore);
    assert.deepEqual(added.map(e => e.type).filter(x => x !== 'TUTOR_DECISION'), ['PLAN_OVERRIDE']);
    assert.equal(added.filter(e => e.type === 'EVIDENCE').length, 0);
    const o = added.find(e => e.type === 'PLAN_OVERRIDE'); assert.equal(o.node_id, 'b'); assert.deepEqual(o.missing, ['a']); assert.ok(Number.isFinite(o.at));
    assert.equal(g.session.node, 'b', 'usa la entrada de foco existente');
  }
  {
    const g = attach(goal()); roots.app.children = []; p.planView(); find('Empezar lo recomendado').onclick(); await settle();
    assert.equal(g.session.node, p.studyPlan(g, Date.now()).next.node_id); assert.equal(g.events.filter(e => e.type === 'PLAN_OVERRIDE').length, 0);
  }

  // Inicio de la meta: resumen del plan y enlace a la página completa.
  {
    const g = attach(goal()); roots.app.children = []; p.dashboard();
    assert.ok(has('Te recomiendo seguir con: Tema A')); assert.ok(find('Ver el plan completo')); assert.ok(find('Plan'), 'entrada «Plan» en la navegación');
  }
  console.log('study_plan.test.js OK');
})().catch(e => { console.error(e); process.exit(1); });
