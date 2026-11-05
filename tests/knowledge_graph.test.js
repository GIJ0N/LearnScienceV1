// knowledge_graph_v1 (cliente): estado del grafo, extracción no bloqueante y composición sin EVIDENCE.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; } }; }
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: id => (id === 'app' ? roots.app : roots.status), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');
const DAY = 86400000;
const node = id => ({ id, name: 'T-' + id, outcome: 'o', level: 0, prerequisites: [], kind: 'concept', probe: { prompt: 'p', kind: 'explanation' } });
function goal(extra = {}) {
  const t = Date.now();
  return { id: 'g1', goal: 'M', nodes: [node('a'), node('b')], learner: {}, coverage: [], reviews: [{ id: 'a', due: t - DAY, step: 3, question: null, history: [] }],
    events: [{ type: 'TEACHING_EXPOSURE', node_id: 'a', at: t - 3 * DAY }, { type: 'TEACHING_EXPOSURE', node_id: 'b', at: t - 4 * DAY }],
    lessons: { a: { explanation: 'Explicación A', example: 'Ejemplo A', common_error: 'Error A', steps: [{ resolution: 'R1', body: 'B1' }] } },
    session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 }, ...extra };
}
const attach = g => { p.setStoreForTests({ goals: [g], active: g.id }); return g; };
const item = (n, nodeId, chainId) => ({ item_id: 'comp-' + n, node_id: nodeId, chain_id: chainId, prompt: 'q', options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }] });
const res = (status, it) => ({ status, item_id: it.item_id, node_id: it.node_id, selected_misconception: status === 'MISCONCEPTION' ? 'omite una premisa' : '' });

(async () => {
  // Material y referencia estables.
  const g0 = goal();
  const material = p.lessonMaterial(g0.lessons.a);
  assert.ok(material.includes('Explicación A') && material.includes('B1') && material.includes('R1'));
  assert.equal(p.lessonRef(material), p.lessonRef(material));
  assert.notEqual(p.lessonRef(material), p.lessonRef(material + '!'));
  assert.equal(p.lessonMaterial(null), '');

  // Aplicar extracción: solo cadenas del tema, con premisas suficientes, sin duplicar.
  let g = attach(goal());
  const server = { chains: [{ chain_id: 'c1', node_id: 'a', premises: ['p1', 'p2'], conclusion: 'p3' }, { chain_id: 'cx', node_id: 'otro', premises: ['p1', 'p2'], conclusion: 'p3' },
    { chain_id: 'c2', node_id: 'a', premises: ['p1'], conclusion: 'p3' }, null] };
  assert.equal(p.applyGraphExtraction(g, 'a', 'ref1', server), 1);
  assert.equal(p.applyGraphExtraction(g, 'a', 'ref1', server), 1);
  assert.deepEqual(g.graph.chains, [{ chain_id: 'c1', node_id: 'a' }], 'no duplica ni acepta cadenas ajenas');
  assert.equal(g.graph.extracted.a, 'ref1');
  assert.equal(p.applyGraphExtraction(g, 'a', 'ref2', null), 0, 'respuesta corrupta no rompe');

  // La extracción no bloquea ni lanza si el servidor no responde.
  g = attach(goal());
  global.fetch = async () => { throw new TypeError('offline'); };
  assert.equal(await p.extractLessonGraph(g, 'a'), false);
  assert.ok(!g.graph || !g.graph.extracted.a, 'un fallo no marca la lección como extraída');
  // Con servidor: se guarda y no se repite para el mismo contenido.
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, json: async () => server }; };
  assert.equal(await p.extractLessonGraph(g, 'a'), true);
  assert.equal(await p.extractLessonGraph(g, 'a'), false);
  assert.equal(calls, 1);
  assert.deepEqual(g.graph.chains.map(c => c.chain_id), ['c1']);
  // Tema sin lección: nada.
  assert.equal(await p.extractLessonGraph(g, 'b'), false);

  // Composición: no disponible sin cadenas ni exposición.
  g = attach(goal());
  assert.deepEqual(p.compositionChains(g), []);
  assert.equal(p.compositionAvailable(g), false);
  assert.throws(() => p.startMixed(g, 'composition'), /cadenas/);
  g = attach(goal({ graph: { chains: [{ chain_id: 'c1', node_id: 'a' }, { chain_id: 'c9', node_id: 'a' }, { chain_id: 'c2', node_id: 'b' }, { chain_id: 'c3', node_id: 'sin-exposicion' }], extracted: {} } }));
  assert.deepEqual(p.compositionChains(g), ['c1', 'c2'], 'una cadena por tema y solo temas enseñados');
  assert.equal(p.compositionAvailable(g), true);

  // Sesión de composición: eventos COMPOSITION, sin EVIDENCE, retroceso del repaso del tema.
  const m = p.startMixed(g, 'composition');
  assert.equal(m.kind, 'composition');
  assert.deepEqual(m.chain_ids, ['c1', 'c2']);
  assert.equal(p.compositionAvailable(g), false, 'no se ofrece mientras hay una sesión');
  m.items = [item(1, 'a', 'c1'), item(2, 'b', 'c2')];
  const ra = g.reviews.find(r => r.id === 'a');
  assert.equal(p.applyDiscrimination(g, m.items[0], res('MISCONCEPTION', m.items[0]), 'k1', 'b', 90), true);
  assert.equal(ra.step, 1, 'retroceso parcial del tema de la cadena');
  assert.equal(p.applyDiscrimination(g, m.items[0], res('MISCONCEPTION', m.items[0]), 'k1', 'b', 90), false, 'idempotente');
  assert.equal(p.applyDiscrimination(g, m.items[1], res('CORRECT', m.items[1]), 'k2', 'a', 80), true);
  const ev = g.events.filter(e => e.type === 'COMPOSITION');
  assert.equal(ev.length, 2);
  assert.equal(ev[0].chain_id, 'c1');
  assert.equal(ev[0].calibration_signal, 'committed_misconception');
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE' || e.type === 'DISCRIMINATION').length, 0);
  assert.equal(m.status, 'done');
  console.log('OK: knowledge graph client');
})().catch(e => { console.error(e); process.exit(1); });
