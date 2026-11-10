// expert_panel_v1.1: una capa cumplida caduca a «por revalidar» tras 60 días; solo lectura, nunca escribe eventos.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; } }; }
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: id => (id === 'app' ? roots.app : roots.status), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');
const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 10, 12);
p.setClockForTests(() => NOW);
const ago = d => NOW - d * DAY;

const goal = events => ({ id: 'g1', goal: 'M', nodes: [{ id: 'a', name: 'A', outcome: 'o', prerequisites: [] }], learner: {}, events, reviews: [], lessons: {}, coverage: [],
  session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 } });
let n = 0;
const ev = extra => ({ type: 'EVIDENCE', node_id: 'a', evidence_role: 'learning', result: 'CORRECT', status: 'CORRECT', help_used: 0, activity_id: 'act' + (++n), ...extra });
const layers = events => p.expertLayers(goal(events), 'a');
const independent = days => [ev({ is_independent: true, timestamp: ago(days) }), ev({ is_independent: true, timestamp: ago(days) })];

assert.equal(p.EXPERT_VERSION, 'expert_panel_v1.1');
assert.equal(p.EXPERT_STALE_DAYS, 60);

// 61 días: caduca y la etiqueta baja; 59 días: sigue cumplida.
let fresh = layers(independent(59));
let old = layers(independent(61));
assert.equal(fresh.layers.independence, 'met');
assert.equal(old.layers.independence, 'stale');
assert.equal(fresh.met, 1);
assert.equal(old.met, 0, 'stale no cuenta como cumplida');
assert.equal(fresh.label, 'Base');
assert.notEqual(old.label, 'Base');
assert.equal(old.label, 'Iniciando');
assert.equal(old.last_at.independence, ago(61));
assert.equal(p.expertMark('stale'), '↻');
assert.match(p.expertLayerText('stale', 'Independencia'), /Por revalidar/);
assert.doesNotMatch(p.expertLayerText('met', 'Independencia'), /Por revalidar/);

// La siguiente acción de una capa caducada es revalidar con un repaso.
const comp = ev({ phase: 'COMPREHENSION', timestamp: ago(1) });
let r = layers([comp, ...independent(61)]);
assert.equal(r.layers.comprehension, 'met');
assert.equal(r.next.layer, 'independence');
assert.equal(r.next.action, 'Haz un repaso para revalidar');

// Retención: 10 días → parcial; 30 días → cumplida (umbrales 7 y 30).
assert.equal(layers([ev({ phase: 'REVIEW', delay_ms_from_last_exposure: 10 * DAY, timestamp: ago(1) })]).layers.retention, 'partial');
assert.equal(layers([ev({ phase: 'REVIEW', delay_ms_from_last_exposure: 30 * DAY, timestamp: ago(1) })]).layers.retention, 'met');
assert.equal(layers([ev({ phase: 'REVIEW', delay_ms_from_last_exposure: 6 * DAY, timestamp: ago(1) })]).layers.retention, 'none');

// Retención con repaso correcto sin ayuda en los últimos 60 días no caduca; más viejo, sí.
assert.equal(layers([ev({ phase: 'REVIEW', delay_ms_from_last_exposure: 40 * DAY, timestamp: ago(59) })]).layers.retention, 'met');
assert.equal(layers([ev({ phase: 'REVIEW', delay_ms_from_last_exposure: 40 * DAY, timestamp: ago(61) })]).layers.retention, 'stale');
// Un repaso con ayuda reciente no revalida.
assert.equal(layers([ev({ phase: 'REVIEW', delay_ms_from_last_exposure: 40 * DAY, timestamp: ago(61) }), ev({ phase: 'REVIEW', delay_ms_from_last_exposure: 40 * DAY, help_used: 1, timestamp: ago(1) })]).layers.retention, 'stale');

// Sin eventos: «none», nunca «stale».
r = layers([]);
assert.ok(Object.values(r.layers).every(v => v === 'none'));
assert.equal(r.label, 'Sin medir');

// Eventos legacy sin fecha no caducan (no se inventa antigüedad).
r = layers([ev({ is_independent: true }), ev({ is_independent: true })]);
assert.equal(r.layers.independence, 'met');

// Otras capas con fecha: discriminación caduca igual.
const disc = days => [{ type: 'DISCRIMINATION', node_id: 'a', status: 'CORRECT', at: ago(days) }, { type: 'DISCRIMINATION', node_id: 'a', status: 'CORRECT', at: ago(days) }];
assert.equal(layers(disc(61)).layers.discrimination, 'stale');
assert.equal(layers(disc(10)).layers.discrimination, 'met');

// El panel solo lee: no agrega eventos.
const g = goal([...independent(61), comp]);
const before = g.events.length, snapshot = JSON.stringify(g.events);
p.expertPanel(g); p.expertLayers(g, 'a');
assert.equal(g.events.length, before);
assert.equal(JSON.stringify(g.events), snapshot);

console.log('expert_staleness: OK');
