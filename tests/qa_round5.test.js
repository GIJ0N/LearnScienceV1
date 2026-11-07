// QA ronda 5: reintento automático del diagnóstico y etiquetas en español.
const assert = require('node:assert/strict');
const fs = require('node:fs');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; }, addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {} } }; }
global.document = { getElementById: () => element(), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');
const realError = console.error; console.error = () => {};

(async () => {
  const goal = { placement: { items: {} } };
  const good = { item_id: 'placement-1', node_id: 'a', prompt: 'q', options: [], used: false };
  // Falla la primera vez (no devuelve el tema) y sirve a la segunda: una pregunta sin intervención.
  let calls = 0;
  let item = await p.ensurePlacementItem(goal, 'a', async g => { calls += 1; if (calls === 2) g.placement.items[good.item_id] = { ...good }; });
  assert.equal(calls, 2, 'reintenta una vez');
  assert.equal(item.item_id, 'placement-1');
  // Si falla dos veces, no hay un tercer intento (acota el gasto) y devuelve vacío.
  calls = 0;
  item = await p.ensurePlacementItem({ placement: { items: {} } }, 'a', async () => { calls += 1; });
  assert.equal(calls, 2, 'máximo dos llamadas');
  assert.equal(item, undefined);
  // Si falla el proveedor (lanza), tampoco explota: task() lo absorbe y se agota igual.
  calls = 0;
  item = await p.ensurePlacementItem({ placement: { items: {} } }, 'a', async () => { calls += 1; throw Error('429'); });
  assert.equal(calls, 2);
  assert.equal(item, undefined);
  // Si ya hay una pregunta sin usar, no llama al modelo.
  calls = 0;
  const ready = { placement: { items: { x: { item_id: 'x', node_id: 'a', prompt: 'q', used: false } } } };
  item = await p.ensurePlacementItem(ready, 'a', async () => { calls += 1; });
  assert.equal(calls, 0);
  assert.equal(item.item_id, 'x');
  // Una pregunta usada o reportada no cuenta como disponible.
  calls = 0;
  const used = { placement: { items: { x: { item_id: 'x', node_id: 'a', prompt: 'q', used: true, reported: true } } } };
  item = await p.ensurePlacementItem(used, 'a', async () => { calls += 1; });
  assert.equal(calls, 2);

  // Etiquetas: ninguna clave técnica de dimensión debe verse cruda en las vistas de cobertura.
  const src = fs.readFileSync(require.resolve('../app.js'), 'utf8');
  for (const bad of ["map(d=>(d.name||d.id)+': '", "${d.name||d.id}: ${coverageLabel", "map(d=>d.name+': '+coverageLabel", "E('strong',dim.name||dim.id)", "observed_dimensions.join(', ')||'ninguna declarada'"])
    assert.ok(!src.includes(bad), 'sin etiqueta cruda: ' + bad);
  for (const k of ['conceptual', 'interpretation', 'procedure', 'equation_manipulation', 'transfer', 'contextual_application'])
    assert.notEqual(p.humanLabel(k), k, 'tiene etiqueta en español: ' + k);
  console.error = realError;
  console.log('qa_round5: OK');
})();
