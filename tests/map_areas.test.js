// map_areas_v1 (cliente): la expansión solo agrega, valida identidades y prerrequisitos, y se dispara sin bloquear.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; } }; }
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: id => (id === 'app' ? roots.app : roots.status), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');

const node = (id, deps = []) => ({ id, name: id, outcome: 'o', level: 0, prerequisites: deps, kind: 'concept', probe: { prompt: 'p', kind: 'explanation' } });
const cov = id => ({ id, name: id, kind: 'concept', priority: 'important', prerequisites: [], contexts: [], status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }], updates: [] });
function goal() {
  const ids = ['area-1-n1', 'area-1-n2', 'area-1-n3', 'area-1-n4'];
  return { id: 'g1', goal: 'Dominar química', context: '', nodes: ids.map((id, i) => node(id, i ? [ids[i - 1]] : [])), coverage: ids.map(cov), learner: {}, reviews: [], events: [], lessons: {}, map_updates: [],
    areas: [{ id: 'area-1', name: 'Base', outcome: 'o', estimated_topics: 4, status: 'expanded', node_ids: ids }, { id: 'area-2', name: 'Reacciones', outcome: 'o', estimated_topics: 6, status: 'pending', node_ids: [] },
      { id: 'area-3', name: 'Síntesis', outcome: 'o', estimated_topics: 8, status: 'pending', node_ids: [] }],
    session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 } };
}
const attach = g => { p.setStoreForTests({ goals: [g], active: g.id }); return g; };
const expansion = (areaId = 'area-2', extra = {}) => {
  const ids = [1, 2, 3, 4].map(i => `${areaId}-n${i}`);
  return { area_id: areaId, nodes: ids.map((id, i) => node(id, i ? [ids[i - 1]] : ['area-1-n4'])), coverage: ids.map(cov), ...extra };
};
const evidence = (g, id) => g.events.push({ type: 'CURRICULUM_CONTINUED', node_id: id });

(async () => {
  let g = attach(goal());
  assert.equal(p.goalAreas(g).length, 3);
  assert.deepEqual(p.pendingAreas(g).map(a => a.id), ['area-2', 'area-3']);
  assert.equal(p.areaEstimate(g), 4 + 6 + 8);
  assert.equal(p.goalAreas({}).length, 0, 'metas antiguas sin áreas');
  assert.equal(p.shouldAutoExpand({ nodes: [], events: [] }), false);

  // Disparo automático: solo cuando quedan ≤ 2 temas sin completar.
  assert.equal(p.incompleteTopics(g).length, 4);
  assert.equal(p.shouldAutoExpand(g), false);
  evidence(g, 'area-1-n1'); evidence(g, 'area-1-n2');
  assert.equal(p.incompleteTopics(g).length, 2);
  assert.equal(p.shouldAutoExpand(g), true);

  // Expansión válida: solo agrega, los temas existentes no cambian.
  const before = JSON.stringify(g.nodes.slice(0, 4));
  assert.equal(p.applyAreaExpansion(g, 'area-2', expansion()), true);
  assert.equal(g.nodes.length, 8);
  assert.equal(JSON.stringify(g.nodes.slice(0, 4)), before);
  assert.equal(g.coverage.length, 8);
  assert.equal(g.areas[1].status, 'expanded');
  assert.equal(g.areas[1].node_ids.length, 4);
  assert.equal(g.map_updates.at(-1).type, 'AREA_EXPANDED');
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0, 'abrir un área no concede nada');
  assert.equal(p.applyAreaExpansion(g, 'area-2', expansion()), false, 'idempotente');
  assert.equal(g.nodes.length, 8);

  // Rechazos: nada se agrega.
  g = attach(goal());
  const bad = (extra, msg) => { const snap = JSON.stringify(g); assert.throws(() => p.applyAreaExpansion(g, 'area-2', extra), msg); assert.equal(JSON.stringify(g), snap, 'no deja estado a medias'); };
  bad(expansion('area-2', { area_id: 'area-3' }), /no corresponde/);
  bad({ ...expansion(), nodes: expansion().nodes.slice(0, 3) }, /no corresponde/);
  bad({ ...expansion(), nodes: expansion().nodes.map(n => ({ ...n, id: n.id.replace('area-2', 'area-3') })), coverage: [] }, /identidades/);
  bad({ ...expansion(), nodes: [node('area-1-n1'), ...expansion().nodes.slice(1)] }, /identidades/);
  bad({ ...expansion(), nodes: expansion().nodes.map((n, i) => i === 2 ? { ...n, prerequisites: ['area-9-n1'] } : n) }, /prerrequisitos/);
  bad({ ...expansion(), nodes: expansion().nodes.map((n, i) => i === 0 ? { ...n, prerequisites: [n.id] } : n) }, /prerrequisitos/);
  bad({ ...expansion(), coverage: [cov('area-2-n9')] }, /cobertura/);
  assert.throws(() => p.applyAreaExpansion(g, 'area-77', expansion('area-77')), /no pertenece/);

  // expandArea: llama al servidor con el contexto, aplica y no repite.
  g = attach(goal());
  let calls = [];
  global.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => expansion() }; };
  assert.equal(await p.expandArea(g, 'area-2'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/map/expand');
  assert.equal(calls[0].body.area_id, 'area-2');
  assert.equal(calls[0].body.existing_nodes.length, 4);
  assert.equal(calls[0].body.areas.length, 3);
  assert.equal(await p.expandArea(g, 'area-2'), false, 'ya abierta');
  assert.equal(calls.length, 1);

  // Fallo del servidor: no rompe, queda pendiente y no se reintenta de inmediato.
  g = attach(goal());
  global.fetch = async () => { throw new TypeError('offline'); };
  assert.equal(await p.expandArea(g, 'area-2'), false);
  assert.equal(g.areas[1].status, 'pending');
  let hits = 0;
  global.fetch = async () => { hits++; return { ok: true, json: async () => expansion() }; };
  assert.equal(await p.expandArea(g, 'area-2'), false, 'espera antes de reintentar');
  assert.equal(hits, 0);
  // Respuesta inválida: tampoco agrega nada.
  g = attach(goal());
  global.fetch = async () => ({ ok: true, json: async () => ({ area_id: 'area-3', nodes: [], coverage: [] }) });
  assert.equal(await p.expandArea(g, 'area-3'), false);
  assert.equal(g.nodes.length, 4);

  // maybeExpandArea solo actúa cuando corresponde.
  g = attach({ ...goal(), id: 'g-auto' });
  hits = 0;
  global.fetch = async () => { hits++; return { ok: true, json: async () => expansion('area-2') }; };
  assert.equal(await p.maybeExpandArea(g), false);
  assert.equal(hits, 0, 'aún quedan muchos temas');
  for (const id of ['area-1-n1', 'area-1-n2', 'area-1-n3']) evidence(g, id);
  assert.equal(await p.maybeExpandArea(g), true);
  assert.equal(hits, 1);
  assert.equal(g.areas[1].status, 'expanded');
  assert.equal(g.areas[2].status, 'pending', 'una a la vez');
  console.log('OK: map areas client');
})().catch(e => { console.error(e); process.exit(1); });
