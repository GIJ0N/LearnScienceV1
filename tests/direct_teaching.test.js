// direct_teaching_v1 (cliente): un «No sé» declarado abre una enseñanza corta; nunca crea evidencia positiva y la respuesta posterior cuenta con ayuda.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute() {}, prepend() {} }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');

let calls = [], directResponse = null, directError = null;
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const checkItem = () => ({ schema_version: 'direct_teaching_v1', item_id: 'direct-1', node_id: 'a', prompt: '¿Qué controla el espesor de película?', options: [{ id: 'a', text: 'La cobertura y el curado' }, { id: 'b', text: 'El color final' }, { id: 'c', text: 'La carga de la pistola' }] });
const goodPackage = () => ({ schema_version: 'direct_teaching_v1', needs: ['Qué es el espesor', 'Por qué cambia el curado'], steps: [{ body: 'El espesor es la altura de la capa curada, medida en micras.' }, { body: 'Una capa más gruesa tarda más en curar porque el calor atraviesa más material.' }],
  worked: { prompt: 'Una lámina recibe 80 micras y otra 160. ¿Cuál cura más lento?', steps: ['Comparar espesores.', 'El calor atraviesa el doble.', 'Cura más lento la de 160.'] }, check: checkItem(), content_check: { checked: true } });
global.fetch = async (route, options) => {
  const body = JSON.parse(options.body);
  calls.push({ route, body });
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  if (route === '/api/evaluate') {
    if (body.answer === 'No sé') return { ok: true, json: async () => ({ status: 'UNKNOWN', feedback: 'Está bien no saberlo aún. Vamos a construirlo.', error_type: 'lack_of_exposure', hint: '', evaluator_version: 'local-fixture' }) };
    if (body.answer === 'Incierto') return { ok: true, json: async () => ({ status: 'UNKNOWN', feedback: 'No pude evaluarlo.', error_type: 'attention', hint: '', evaluator_version: 'local-fixture' }) };
    return { ok: true, json: async () => ({ status: 'CORRECT', feedback: 'Correcto', error_type: 'none', hint: '', evaluator_version: 'local-fixture' }) };
  }
  if (route === '/api/teach/direct') {
    if (directError) return { ok: false, json: async () => ({ error: directError }) };
    return { ok: true, json: async () => directResponse };
  }
  if (route === '/api/teach/direct/answer') return { ok: true, json: async () => ({ schema_version: 'direct_teaching_v1', status: body.selected_option_id === 'a' ? 'CORRECT' : body.selected_option_id ? 'MISCONCEPTION' : 'UNKNOWN', item_id: body.item_id, node_id: 'a', correct_option_id: 'a', explanation: 'Porque el espesor define el curado.', selected_misconception: '', error_type: 'none' }) };
  if (route === '/api/lesson/steps') return { ok: false, json: async () => ({ error: 'sin pasos en la prueba' }) };
  throw Error('Ruta inesperada ' + route);
};

const node = { id: 'a', name: 'Espesor', level: 0, prerequisites: [], outcome: 'Controlar el espesor', probe: { prompt: 'Explica', kind: 'explanation' } };
const Q = { check: { prompt: '¿Por qué medir el espesor?', reference: 'Porque controla el curado', kind: 'explanation' }, guided: { prompt: 'Guiada', reference: 'r', kind: 'application' }, independent: { prompt: '¿Qué espesor da cobertura?', reference: 'Entre 60 y 80 micras', kind: 'application' }, integration: { prompt: 'Integra', reference: 'r', kind: 'context_case' } };
function goal(mode = 'COMPREHENSION', extra = {}) {
  return {
    id: 'g', profile_id: 'profile-test', goal: 'Pintura', nodes: [node], learner: {}, reviews: [], events: [],
    coverage: [{ id: 'a', name: 'a', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] }],
    lessons: { a: { explanation: 'Explicación', example: 'Ejemplo', common_error: 'Error', ...Q, adaptation_mode: 'initial' } },
    session: { mode, node: 'a', stack: [], tries: 0, hints: 0 }, ...extra,
  };
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
const find = (label, root = roots.app) => { if (root && root.textContent === label) return root; for (const c of (root && root.children) || []) { const f = find(label, c); if (f) return f; } return null; };
const has = (needle, root = roots.app) => { if (root && String(root.textContent || '').includes(needle)) return true; return ((root && root.children) || []).some(c => has(needle, c)); };
const evidence = g => g.events.filter(e => e.type === 'EVIDENCE');
const ROLE = { COMPREHENSION: 'comprehension_check', GUIDED: 'guided_practice', INDEPENDENT: 'independent_practice', INTEGRATE: 'integration', REVIEW: 'spaced_review' };
const KEY = { COMPREHENSION: 'check', GUIDED: 'guided', INDEPENDENT: 'independent', INTEGRATE: 'integration' };

// Responde la pregunta de la fase como lo haría la persona: texto -> evaluar -> Continuar.
async function answer(g, phase, text, question) {
  await settle(20);
  const q = question || g.lessons.a[KEY[phase]], box = element();
  const ui = p.renderQuestion(box, q, 'a', phase, ROLE[phase]);
  assert.equal(ui.ok, true);
  const run = text === 'No sé' ? ui.dontKnow : ui.submit;
  ui.answer.value = text;
  await run.onclick();
  const go = find('Continuar', ui.feedback);
  assert.ok(go, 'hay botón Continuar');
  go.onclick();
  await settle();
  return ui;
}

(async () => {
  directResponse = goodPackage();
  // 0. El botón «No sé» existe en las fases de práctica y no en el diagnóstico ni la confirmación.
  for (const phase of ['COMPREHENSION', 'GUIDED', 'INDEPENDENT', 'INTEGRATE', 'REVIEW']) {
    const g = attach(goal(phase)); const box = element();
    const ui = p.renderQuestion(box, Q.check, 'a', phase, ROLE[phase]);
    assert.ok(box.children.includes(ui.dontKnow), 'botón No sé en ' + phase);
    assert.equal(ui.dontKnow.textContent, 'No sé');
  }
  for (const [phase, role] of [['DIAGNOSTIC', 'diagnostic_probe'], ['CONFIRMATION', 'evidence_confirmation']]) {
    attach(goal(phase)); const box = element();
    const ui = p.renderQuestion(box, Q.check, 'a', phase, role);
    assert.equal(box.children.includes(ui.dontKnow), false, 'sin botón duplicado en ' + phase);
  }

  // 1. «No sé» declarado: se crea s.direct y DIRECT_TEACHING; el único EVIDENCE es el UNKNOWN ya registrado.
  for (const phase of ['COMPREHENSION', 'GUIDED', 'INDEPENDENT', 'INTEGRATE']) {
    const g = attach(goal(phase)); calls = [];
    await answer(g, phase, 'No sé');
    assert.equal(calls.filter(c => c.route === '/api/evaluate')[0].body.answer, 'No sé');
    assert.ok(g.session.direct, 'se abre la enseñanza en ' + phase);
    assert.ok(['pending', 'ready'].includes(g.session.direct.status));
    assert.equal(g.session.direct.version, 'direct_teaching_v1');
    assert.equal(g.session.direct.question_prompt, g.lessons.a[KEY[phase]].prompt);
    assert.ok(g.session.direct.source_attempt_id);
    assert.equal(g.events.filter(e => e.type === 'DIRECT_TEACHING').length, 1);
    assert.equal(evidence(g).length, 1);
    assert.equal(evidence(g)[0].result, 'UNKNOWN');
    assert.equal(evidence(g)[0].is_independent, false);
    assert.equal(p.verified(g, 'a'), false);
    assert.deepEqual(g.coverage[0].dimensions[0].evidence.filter(e => e && e.status === 'CORRECT'), []);
  }

  // 2. UNKNOWN con otro error_type (evaluación incierta): comportamiento anterior, sin s.direct.
  {
    const g = attach(goal('INDEPENDENT')); calls = [];
    await answer(g, 'INDEPENDENT', 'Incierto');
    assert.ok(!g.session.direct);
    assert.equal(g.events.filter(e => e.type === 'DIRECT_TEACHING').length, 0);
    assert.equal(evidence(g).length, 1);
  }

  // 3. Flujo completo: pasos uno por pantalla, ejemplo, comprobación formativa y regreso con ayuda.
  {
    const g = attach(goal('INDEPENDENT')); calls = []; directResponse = goodPackage(); directError = null;
    await answer(g, 'INDEPENDENT', 'No sé');
    roots.app.children = []; await p.session();
    assert.equal(calls.filter(c => c.route === '/api/teach/direct').length, 1);
    const sent = calls.find(c => c.route === '/api/teach/direct').body;
    assert.equal(sent.node_id, 'a'); assert.equal(sent.question.prompt, Q.independent.prompt); assert.equal(sent.question.reference, Q.independent.reference);
    assert.equal(g.session.direct.status, 'ready');
    roots.app.children = []; await p.session();
    assert.ok(has('Lo que hace falta para responder')); assert.ok(has('Qué es el espesor'));
    assert.equal(g.events.filter(e => e.type === 'TEACHING_EXPOSURE').length, 0, 'aún no se muestra un paso');
    find('Empezar').onclick(); roots.app.children = []; await p.session();
    assert.ok(has('Paso 1 de 2')); assert.ok(has('El espesor es la altura')); assert.equal(has('Paso 2 de 2'), false, 'un paso por pantalla');
    assert.equal(g.events.filter(e => e.type === 'TEACHING_EXPOSURE').length, 1);
    find('Siguiente').onclick(); roots.app.children = []; await p.session();
    assert.ok(has('Paso 2 de 2'));
    find('Siguiente').onclick(); roots.app.children = []; await p.session();
    assert.ok(has('Un ejemplo parecido')); assert.ok(has('Una lámina recibe 80 micras'));
    find('Siguiente').onclick(); roots.app.children = []; await p.session();
    assert.ok(has('Comprueba una idea')); assert.equal(find('Volver a la pregunta'), null, 'primero se responde la comprobación');
    assert.equal(g.events.filter(e => e.type === 'TEACHING_EXPOSURE').length, 1, 'exposición una sola vez');
    const before = evidence(g).length;
    // Responde la comprobación con la opción correcta.
    const box = roots.app;
    const optionA = (function walk(n) { if (n && String(n.textContent).startsWith('a) ')) return n; for (const c of (n && n.children) || []) { const f = walk(c); if (f) return f; } return null; })(box);
    optionA.onclick();
    await find('Responder').onclick();
    assert.equal(g.events.filter(e => e.type === 'DIRECT_CHECK').length, 1);
    assert.equal(g.events.find(e => e.type === 'DIRECT_CHECK').status, 'CORRECT');
    assert.equal(evidence(g).length, before, 'DIRECT_CHECK es formativo: no crea EVIDENCE');
    assert.equal(p.verified(g, 'a'), false);
    find('Volver a la pregunta').onclick();
    assert.equal(g.session.direct, null);
    assert.ok(g.session.hints >= 1, 'la siguiente respuesta cuenta con ayuda');
    // Un acierto a esa misma pregunta ya no es independiente.
    await answer(g, 'INDEPENDENT', 'Entre 60 y 80 micras');
    const last = evidence(g).at(-1);
    assert.equal(last.result, 'CORRECT');
    assert.equal(last.is_independent, false);
    assert.ok(last.help_used >= 1);
  }

  // 3b. Línea base: sin enseñanza directa, el mismo acierto en INDEPENDENT sí es independiente.
  {
    const g = attach(goal('INDEPENDENT')); calls = [];
    await answer(g, 'INDEPENDENT', 'Entre 60 y 80 micras');
    const last = evidence(g).at(-1);
    assert.equal(last.result, 'CORRECT'); assert.equal(last.is_independent, true); assert.equal(last.help_used, 0);
  }

  // 4. Segundo «No sé» a la misma pregunta: oferta de lección completa, sin segunda llamada a la ruta.
  {
    const g = attach(goal('INDEPENDENT')); calls = []; directResponse = goodPackage(); directError = null;
    await answer(g, 'INDEPENDENT', 'No sé');
    roots.app.children = []; await p.session();
    g.session.direct = null; g.session.hints = 0; // la persona volvió a la pregunta
    const routeCalls = () => calls.filter(c => c.route === '/api/teach/direct').length;
    assert.equal(routeCalls(), 1);
    await answer(g, 'INDEPENDENT', 'No sé');
    assert.equal(g.session.direct.status, 'repeat');
    assert.equal(g.events.filter(e => e.type === 'DIRECT_TEACHING').length, 1, 'no se registra otra enseñanza');
    roots.app.children = []; await p.session();
    assert.ok(has('Ya vimos una explicación corta de esto'));
    assert.ok(find('Ver la lección completa')); assert.ok(find('Seguir con otro tema'));
    assert.equal(routeCalls(), 1, 'sin segunda llamada');
    find('Ver la lección completa').onclick();
    assert.equal(g.session.direct, null);
    assert.equal(g.session.mode, 'TEACH');
  }

  // 5. Fallo de la ruta: la sesión sigue utilizable.
  for (const failure of ['El servidor falló', 'La enseñanza no cumplió el contrato']) {
    const g = attach(goal('GUIDED')); calls = []; directResponse = goodPackage(); directError = failure;
    await answer(g, 'GUIDED', 'No sé');
    roots.app.children = []; await p.session();
    assert.equal(g.session.direct.status, 'failed');
    roots.app.children = []; await p.session();
    assert.ok(has('No pude preparar la explicación ahora.'));
    assert.ok(find('Ver la lección completa')); assert.ok(find('Reintentar'));
    assert.equal(evidence(g).length, 1);
    directError = null;
    find('Reintentar').onclick();
    assert.equal(g.session.direct.status, 'pending');
    roots.app.children = []; await p.session();
    assert.equal(g.session.direct.status, 'ready');
  }

  // 5b. Respuesta mal formada del servidor: se trata como fallo, no como contenido.
  {
    const g = attach(goal('GUIDED')); calls = []; directError = null; directResponse = { ...goodPackage(), steps: [{ body: 'solo uno' }] };
    await answer(g, 'GUIDED', 'No sé');
    roots.app.children = []; await p.session();
    assert.equal(g.session.direct.status, 'failed');
    assert.equal(g.session.direct.package, undefined);
  }

  // 6. REVIEW: «No sé» no cambia el calendario.
  {
    const review = { id: 'a', due: 1000, step: 2, origin_attempt_id: 'orig', target_dimension: 'conceptual', question: { prompt: '¿Qué mide el espesor?', reference: 'Altura de la capa', kind: 'explanation' }, history: [] };
    const g = attach(goal('REVIEW', { reviews: [review] })); calls = []; directResponse = goodPackage(); directError = null;
    const snapshot = JSON.stringify({ due: review.due, step: review.step, history: review.history });
    const box = element();
    const ui = p.renderQuestion(box, review.question, 'a', 'REVIEW', 'spaced_review');
    ui.answer.value = 'No sé'; await ui.dontKnow.onclick(); find('Continuar', ui.feedback).onclick();
    assert.ok(g.session.direct, 'REVIEW abre la enseñanza');
    assert.equal(g.session.direct.phase, 'REVIEW');
    assert.equal(JSON.stringify({ due: review.due, step: review.step, history: review.history }), snapshot, 'el calendario no cambia');
    assert.ok(review.question, 'la pregunta de repaso se conserva');
    assert.equal(evidence(g).length, 1);
  }

  // 7. «Seguir con otro tema» limpia la enseñanza.
  {
    const g = attach(goal('INDEPENDENT')); calls = []; directResponse = goodPackage(); directError = null;
    await answer(g, 'INDEPENDENT', 'No sé');
    g.session.direct_prompts = [g.session.direct.node_id + '|' + g.session.direct.question_prompt];
    await answer(g, 'INDEPENDENT', 'No sé');
    roots.app.children = []; await p.session();
    find('Seguir con otro tema').onclick();
    assert.ok(!g.session.direct);
  }
  console.log('direct_teaching.test.js OK');
})().catch(e => { console.error(e); process.exit(1); });
