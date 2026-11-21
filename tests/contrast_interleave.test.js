// contrast_interleave_v1: el intercalado solo cambia el orden (temas confundibles antes que la fecha) y el contraste
// es exposición formativa: CONTRAST_SHOWN no crea evidencia, no entra en EXPOSURE_TYPES ni en isStudyAnswer,
// y sin par no se emite nada. Función pura, sin navegador ni proveedor.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; }, setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, style: {} }; }
global.document = { getElementById: () => element('main'), createElement: t => element(t), documentElement: { dataset: {}, setAttribute() {} }, head: { append() {} } };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 20, 12);

for (const name of ['mixedCandidates', 'contrastNodeIds', 'contrastEvents', 'orderDiscriminationItems', 'lastExposure', 'isStudyAnswer']) {
  assert.equal(typeof p[name], 'function', 'exporta ' + name);
}
assert.equal(p.CONTRAST_VERSION, 'contrast_interleave_v1');

// Meta sintética: 'a' tiene repaso vencido (fecha); 'b' y 'c' no. 'c' fue expuesto más recientemente.
const baseGoal = () => ({
  id: 'g', profile_id: 'profile-test', goal: 'Meta',
  nodes: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
  reviews: [{ id: 'a', due: NOW - DAY, step: 1, history: [] }, { id: 'b', due: NOW + 9 * DAY, step: 1, history: [] }, { id: 'c', due: NOW + 9 * DAY, step: 1, history: [] }],
  events: [
    { type: 'TEACHING_EXPOSURE', node_id: 'a', at: 1000 },
    { type: 'TEACHING_EXPOSURE', node_id: 'b', at: 2000 },
    { type: 'TEACHING_EXPOSURE', node_id: 'c', at: 3000 },
  ],
});

// (1) Sin confundibles el orden es el de siempre: repaso vencido primero, luego exposición más antigua.
{
  const g = baseGoal();
  assert.deepEqual(p.mixedCandidates(g, NOW), ['a', 'b', 'c'], 'orden por fecha intacto');
  assert.deepEqual(p.mixedCandidates(g, NOW, null), ['a', 'b', 'c'], 'sin conjunto confundible, igual que antes');
  assert.equal(p.contrastNodeIds(g).size, 0, 'sin eventos de contraste no hay temas confundibles');
}

// (2) Un tema confundible va antes que el repaso vencido: la prioridad confundible gana a la fecha.
{
  const g = baseGoal();
  assert.deepEqual(p.mixedCandidates(g, NOW, new Set(['c'])), ['c', 'a', 'b'], 'confundible antes que la fecha');
}

// (3) CONTRAST_SHOWN marca temas confundibles pero no cambia la exposición, la evidencia ni los eventos de exposición.
{
  const g = baseGoal();
  const before = p.lastExposure(g, 'c');
  const ev = { type: 'CONTRAST_SHOWN', version: 'contrast_interleave_v1', node_id: 'c', pair_id: 'p1', confused_node_id: 'b', attempt_id: 't1', at: 9000, creates_evidence: false };
  g.events.push(ev);
  assert.deepEqual([...p.contrastNodeIds(g)].sort(), ['b', 'c']);
  assert.equal(p.lastExposure(g, 'c'), before, 'CONTRAST_SHOWN no cambia la última exposición');
  assert.equal(p.EXPOSURE_TYPES.includes('CONTRAST_SHOWN'), false, 'no es exposición');
  assert.equal(p.TEACHING_REF_TYPES.includes('CONTRAST_SHOWN'), false, 'no es referencia de enseñanza');
  assert.equal(p.isStudyAnswer(ev), false, 'no cuenta como respuesta de estudio');
}

// (4) Sin par no se emite nada: ni sin contraste en la pregunta ni con lista vacía.
{
  const g = baseGoal();
  assert.deepEqual(p.contrastEvents(g, { item_id: 'x', node_id: 'a' }, 't1', NOW), []);
  assert.deepEqual(p.contrastEvents(g, { item_id: 'x', node_id: 'a', contrast: [] }, 't1', NOW), []);
}

// (5) Con par se emite un evento formativo, sin evidencia, y no se duplica para el mismo intento.
{
  const g = baseGoal();
  const item = { item_id: 'disc-1', node_id: 'a', contrast: [{ pair_id: 'disc-1|b', confused_ref: 'b', confused_node_id: 'b' }] };
  const evs = p.contrastEvents(g, item, 't1', NOW);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].type, 'CONTRAST_SHOWN');
  assert.equal(evs[0].version, 'contrast_interleave_v1');
  assert.equal(evs[0].node_id, 'a');
  assert.equal(evs[0].pair_id, 'disc-1|b');
  assert.equal(evs[0].creates_evidence, false);
  g.events.push(...evs);
  assert.deepEqual(p.contrastEvents(g, item, 't1', NOW), [], 'idempotente por intento y par');
  assert.equal(p.contrastEvents(g, item, 't2', NOW).length, 1, 'otro intento sí registra');
}

// (6) El intercalado ordena los ítems según el orden de temas de la sesión.
{
  const items = [{ item_id: '1', node_id: 'b' }, { item_id: '2', node_id: 'a' }, { item_id: '3', node_id: 'c' }];
  assert.deepEqual(p.orderDiscriminationItems(items, ['c', 'a', 'b']).map(x => x.item_id), ['3', '2', '1']);
}

console.log('contrast_interleave.test.js OK');
