// topic_closure_v1 (cliente): cierre de tema con «Ideas clave», conexiones y autoexplicación.
// Sin navegador: DOM simulado como lesson_ui.test.js. No llama a ningún proveedor: /api/graph/get se sustituye.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, className: '', append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute() {}, prepend() {}, focus() {} }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element, documentElement: { dataset: {} } };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.confirm = () => true;
const calls = [];
let graphMode = 'ok';
const GRAPH = {
  schema_version: 'knowledge_graph_v1',
  propositions: [
    { prop_id: 'p1', statement: 'El espesor controla el curado.', node_ids: ['a'], lesson_refs: ['L1'] },
    { prop_id: 'p2', statement: 'Entre 60 y 80 micras cubre bien.', node_ids: ['a'], lesson_refs: ['L1'] },
    { prop_id: 'p3', statement: 'Un curado parejo evita el desprendimiento.', node_ids: ['a'], lesson_refs: ['L1'] },
    { prop_id: 'p4', statement: 'Otra idea del tema.', node_ids: ['a'], lesson_refs: ['L0'] },
    { prop_id: 'p5', statement: 'Idea compartida con Pintura básica.', node_ids: ['a', 'zz'], lesson_refs: ['L1'] },
    { prop_id: 'p6', statement: 'Idea del tema vecino.', node_ids: ['b'], lesson_refs: ['L9'] },
    { prop_id: 'p7', statement: '<img src=x onerror=alert(1)> enunciado hostil.', node_ids: ['a'], lesson_refs: ['L1'] },
    { prop_id: 'p8', statement: 'Octava idea que sobra.', node_ids: ['a'], lesson_refs: ['L1'] },
    { prop_id: 'p10', statement: 'Décima idea del tema, de otra lección.', node_ids: ['a'], lesson_refs: ['L0'] },
  ],
  chains: [
    { chain_id: 'c1', node_id: 'a', premises: ['p1', 'p2'], conclusion: 'p3' },
    { chain_id: 'c2', node_id: 'a', premises: ['p9', 'p2'], conclusion: 'p3' },
    { chain_id: 'c3', node_id: 'b', premises: ['p6', 'p2'], conclusion: 'p3' },
  ],
};
global.fetch = async (route, options) => {
  calls.push(route);
  const body = options && options.body ? JSON.parse(options.body) : {};
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  if (route === '/api/graph/get') {
    if (graphMode === 'fail') throw new Error('red caída en la prueba');
    const ids = new Set(GRAPH.chains.filter(c => c.node_id === body.node_id).flatMap(c => [...c.premises, c.conclusion]));
    const props = GRAPH.propositions.filter(p => p.node_ids.includes(body.node_id) || ids.has(p.prop_id));
    return { ok: true, json: async () => ({ schema_version: GRAPH.schema_version, propositions: props, chains: GRAPH.chains.filter(c => c.node_id === body.node_id) }) };
  }
  if (route === '/api/evaluate') return { ok: true, json: async () => ({ status: 'CORRECT', feedback: 'ok', error_type: 'none', hint: '', evaluator_version: 'local-fixture' }) };
  throw Error('Ruta inesperada ' + route);
};
console.error = () => {};
const p = require('../app.js');
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const walk = (root, fn) => { fn(root); for (const c of (root && root.children) || []) walk(c, fn); };
const findAll = (pred, root = roots.app) => { const out = []; walk(root, e => { if (pred(e)) out.push(e); }); return out; };
const has = (needle, root = roots.app) => findAll(e => String(e.textContent || '').includes(needle), root).length > 0;
const cls = (c, root = roots.app) => findAll(e => String(e.className || '').split(/\s+/).includes(c), root);
const texts = (root = roots.app) => { const out = []; walk(root, e => { if (e.textContent) out.push(e.textContent); }); return out; };

const nodes = [{ id: 'a', name: 'Espesor', level: 0, prerequisites: [], outcome: 'Controlar el espesor', probe: { prompt: 'Explica', kind: 'explanation' } },
  { id: 'b', name: 'Vecino', level: 0, prerequisites: [], outcome: 'x', probe: { prompt: 'x', kind: 'explanation' } }];
const Q = { check: { prompt: '¿Por qué medir el espesor?', reference: 'Porque controla el curado', kind: 'explanation' }, guided: { prompt: 'Guiada', reference: 'r', kind: 'application' }, independent: { prompt: '¿Qué espesor da cobertura?', reference: 'Entre 60 y 80 micras', kind: 'application' }, integration: { prompt: 'Integra', reference: 'r', kind: 'application' } };
function goal(mode = 'COMPREHENSION', extra = {}) {
  return {
    id: 'g', profile_id: 'profile-test', goal: 'Pintura', nodes: nodes, learner: {}, reviews: [], events: [],
    coverage: [{ id: 'a', name: 'a', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] }],
    lessons: { a: { explanation: 'Explicación', example: 'Ejemplo', common_error: 'Error', ...Q, adaptation_mode: 'initial', memory_reason: 'm', adaptation_reason: 'a' } },
    session: { mode, node: 'a', stack: [], tries: 0, hints: 0 }, ...extra,
  };
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
const PAYLOAD_EXAMPLE = { propositions: GRAPH.propositions.slice(0, 2).map(x => ({ prop_id: x.prop_id, statement: x.statement, node_ids: x.node_ids, lesson_refs: x.lesson_refs })), chains: [] };

(async () => {
  // 1. Fuente grafo: solo proposiciones del tema, tope de 7, cadenas con referencias desconocidas descartadas, prioridad de lesson_ref.
  {
    const g = goal('COMPREHENSION', { graph: { chains: [], extracted: { a: 'L1' } } });
    const payload = { propositions: GRAPH.propositions.filter(x => x.node_ids.includes('a')), chains: GRAPH.chains.filter(c => c.node_id === 'a') };
    const out = p.closureIdeas(g, 'a', payload, g.lessons.a);
    assert.equal(out.source, 'graph');
    assert.ok(out.ideas.length <= 7, 'tope de 7 ideas');
    assert.ok(!out.ideas.some(i => i.text.includes('vecino')), 'no entran ideas de otro tema');
    assert.equal(out.ideas.length, 7, 'con 8 candidatas en el tema, el tope recorta a 7');
    assert.equal(out.ideas[0].prop_id, 'p3', 'primero la conclusión de una cadena de la lección actual');
    assert.ok(out.ideas.slice(0, 5).every(i => i.lesson_ref === 'L1'), 'la lección actual va antes');
    assert.equal(out.chains.length, 1, 'la cadena con referencia desconocida (p9) se descarta');
    assert.equal(out.chains[0].conclusion_text, 'Un curado parejo evita el desprendimiento.');
    assert.equal(new Set(out.ideas.map(i => i.prop_id)).size, out.ideas.length, 'sin duplicados');
    assert.ok(out.ideas.length >= 2, 'entre 2 y 7 ideas');
  }

  // 2. Respaldo: lección por pasos (primera oración por paso, máx 5); clásica sin partir $…$ (máx 3); caso none.
  {
    const steps = [{ resolution: 'Mide el espesor. Anótalo.' }, { body: 'Compara con la tabla. Otra frase.' }];
    const g1 = goal();
    const out1 = p.closureIdeas(g1, 'a', null, { ...g1.lessons.a, steps });
    assert.equal(out1.source, 'lesson');
    assert.deepEqual(out1.ideas.map(i => i.text), ['Mide el espesor.', 'Compara con la tabla.']);
    const g2 = goal();
    const out2 = p.closureIdeas(g2, 'a', null, { explanation: 'Usa $a. b$ para medir. Luego compara. Después ajusta. Por último revisa.' });
    assert.equal(out2.source, 'lesson');
    assert.equal(out2.ideas.length, 3);
    assert.ok(out2.ideas[0].text.includes('$a. b$'), 'no parte la fórmula');
    const out3 = p.closureIdeas(goal(), 'a', null, null);
    assert.equal(out3.source, 'none');
    assert.deepEqual(out3.ideas, []);
  }

  // 3. Vecinos: solo de la misma meta; node_ids ajenos (zz) no cuentan como compartidos.
  {
    const g = goal('COMPREHENSION', { graph: { chains: [], extracted: { a: 'L1' } } });
    const payload = { propositions: GRAPH.propositions.filter(x => x.node_ids.includes('a')), chains: [] };
    const out = p.closureIdeas(g, 'a', payload, g.lessons.a);
    assert.ok(out.shared.every(s => s.nodes.every(n => g.nodes.some(m => m.id === n))), 'solo nodos de la meta');
    assert.ok(!out.shared.some(s => s.nodes.includes('zz')), 'node_ids ajenos ignorados');
  }

  // 4. Fetch del grafo por tema: una sola ruta /api/graph/get.
  {
    calls.length = 0; graphMode = 'ok';
    const g = attach(goal());
    const payload = await p.fetchClosureGraph(g, 'a');
    assert.ok(payload && Array.isArray(payload.propositions));
    assert.deepEqual(calls.filter(c => c !== '/api/profile/save'), ['/api/graph/get']);
  }

  // 5. Tras INTEGRATE correcto (completado o por confirmar) aparece la tarjeta; tras REVIEW correcto no aparece sola.
  {
    const g = attach(goal('INTEGRATE'));
    p.setClosureForTests(null);
    p.closureFromPractice(g, 'a', 'awaiting_delayed', 'att-1');
    assert.equal(p.closureActive(g), false, 'sin último EVIDENCE con ese attempt_id no está activa');
    g.events.push({ type: 'EVIDENCE', attempt_id: 'att-1', node_id: 'a', result: 'CORRECT' });
    assert.equal(p.closureActive(g), true);
    await p.session(); await settle();
    assert.ok(cls('closure').length > 0, 'la tarjeta se muestra en la sesión');
    assert.ok(has('Seguir'));
    p.setClosureForTests(null);
    const r = attach(goal('REVIEW'));
    r.events.push({ type: 'EVIDENCE', attempt_id: 'rev-1', node_id: 'a', result: 'CORRECT' });
    await p.session(); await settle();
    assert.equal(cls('closure').length, 0, 'tras REVIEW correcto no aparece sola');
  }

  // 6. PARTIAL no abre el cierre.
  {
    const g = attach(goal('INTEGRATE'));
    p.setClosureForTests(null);
    await p.applyResult(g, 'a', 'INTEGRATE', 'respuesta', { status: 'PARTIAL', feedback: 'Falta una parte', error_type: 'units', _activity: p.activityContract(g, 'a', 'integration'), _attempt_id: 'att-partial' }).catch(() => {});
    assert.equal(p.closureActive(g), false, 'PARTIAL no muestra el cierre');
  }

  // 7. Lectura del grafo falla: respaldo con lección, sin bucle ni mensaje de error.
  {
    graphMode = 'fail'; calls.length = 0;
    const g = attach(goal());
    const payload = await p.fetchClosureGraph(g, 'a');
    assert.equal(payload, null);
    const out = p.closureIdeas(g, 'a', payload, g.lessons.a);
    assert.equal(out.source, 'lesson');
    assert.equal(calls.filter(c => c === '/api/graph/get').length, 1, 'sin reintentos en bucle');
    graphMode = 'ok';
  }

  // 8. Autoexplicación: exactamente un evento; el resto del estado queda igual; el texto no sale a /api/evaluate.
  {
    calls.length = 0;
    const g = attach(goal());
    const snap = () => JSON.stringify({ c: g.coverage, r: g.reviews, l: g.lessons, s: g.session, n: g.events.length });
    const before = snap();
    const bodies = [];
    const orig = global.fetch;
    global.fetch = async (route, options) => { if (options && options.body) bodies.push({ route, body: options.body }); return orig(route, options); };
    await p.saveTopicExplanation(g, 'a', 'Mi explicación con el espesor y el curado.', 'cl-1', 'closure');
    global.fetch = orig;
    const selfEvents = g.events.filter(e => e.type === 'TOPIC_SELF_EXPLANATION');
    assert.equal(selfEvents.length, 1);
    assert.equal(selfEvents[0].creates_evidence, false);
    assert.equal(selfEvents[0].text, 'Mi explicación con el espesor y el curado.');
    const after = JSON.parse(snap()); const prev = JSON.parse(before);
    assert.equal(after.n, prev.n + 1, 'exactamente un evento nuevo');
    assert.deepEqual({ c: after.c, r: after.r, l: after.l, s: after.s }, { c: prev.c, r: prev.r, l: prev.l, s: prev.s }, 'cobertura, repasos, lecciones y sesión sin cambios');
    assert.ok(!bodies.some(b => b.route !== '/api/profile/save' && b.body.includes('Mi explicación')), 'el texto no sale a otra ruta');
  }

  // 9. Bloqueo al reabrir: repaso pendiente o sesión en REVIEW → sin ideas; abrir registra un evento solo al pulsar.
  {
    const g = attach(goal('REVIEW'));
    assert.match(p.topicClosureBlock(g, 'a') || '', /repaso pendiente/);
    const g2 = attach(goal('COMPREHENSION'));
    const n0 = g2.events.length;
    p.setClosureForTests(null);
    assert.equal(p.topicClosureBlock(g2, 'a'), null);
    await p.session(); await settle();
    assert.equal(g2.events.length, n0, 'pintar no escribe nada');
    p.openTopicClosure(g2, 'a', 'map', 'plan');
    assert.equal(g2.events.filter(e => e.type === 'TOPIC_CLOSURE_OPENED').length, 1);
    assert.equal(g2.events.find(e => e.type === 'TOPIC_CLOSURE_OPENED').creates_evidence, false);
  }

  // 10. Enunciado hostil se pinta como texto; el código del cierre no usa innerHTML.
  {
    graphMode = 'ok';
    const g = attach(goal('COMPREHENSION', { graph: { chains: [], extracted: { a: 'L1' } } }));
    p.openTopicClosure(g, 'a', 'path', 'plan');
    await settle(20);
    assert.ok(texts().some(t => t.includes('<img src=x onerror=alert(1)>')), 'se muestra como texto');
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const block = src.slice(src.indexOf('// topic_closure_v1 BEGIN'), src.indexOf('// topic_closure_v1 END'));
    assert.ok(block.length > 200, 'el bloque del cierre existe');
    assert.ok(!block.includes('innerHTML'), 'sin innerHTML en el cierre');
  }

  // 11. Meta legacy sin grafo ni lección: no hay botón ni ruta de cierre.
  {
    const legacy = { id: 'g', profile_id: 'profile-test', goal: 'Legacy', nodes, learner: {}, reviews: [], events: [], coverage: [], lessons: {}, session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 } };
    assert.equal(p.closureAvailable(legacy, 'a'), false);
  }

  console.log('topic_closure.test.js: OK');
})().catch(err => { process.stderr.write(String(err && err.stack || err) + '\n'); process.exit(1); });
