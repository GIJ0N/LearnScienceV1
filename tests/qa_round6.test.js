// QA ronda 6: al reportar una pregunta, lo que sigue (p. ej. pedir otra) debe ocurrir DESPUÉS de terminar la tarea de envío.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; }, addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {} } }; }
global.document = { getElementById: () => element(), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const calls = [];
global.fetch = async (route, opts) => { calls.push(route); return { ok: true, json: async () => ({ saved: true }) }; };
const p = require('../app.js');

(async () => {
  const goal = { id: 'g1', profile_id: 'p1', placement: { items: { 'placement-1': { item_id: 'placement-1', node_id: 'a', prompt: 'q', used: false } } } };
  let fetched = 0, found = null;
  const box = element();
  // Al enviarse el reporte se marca la pregunta y se pide otra, igual que en el diagnóstico.
  p.reportButton(box, goal, 'a', 'placement', 'q', async () => {
    p.markPlacementReported(goal, 'placement-1');
    found = await p.ensurePlacementItem(goal, 'a', async g => { fetched += 1; g.placement.items['placement-2'] = { item_id: 'placement-2', node_id: 'a', prompt: 'otra', used: false }; });
  }, 'placement-1');
  const open = box.children[0];
  open.onclick();
  const holder = box.children[1];
  const send = holder.children[1];
  await send.onclick();
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(calls, ['/api/content/report'], 'el reporte se envió una vez');
  assert.equal(fetched, 1, 'tras el reporte SÍ se pidió otra pregunta (antes la tarea ocupada lo impedía)');
  assert.equal(found && found.item_id, 'placement-2');
  assert.equal(goal.placement.items['placement-1'].reported, true);
  // Si el envío del reporte falla, no se marca ni se pide otra.
  calls.length = 0; fetched = 0;
  global.fetch = async () => ({ ok: false, json: async () => ({ error: 'falló' }) });
  const realError = console.error; console.error = () => {};
  let sent = false;
  const box2 = element();
  p.reportButton(box2, goal, 'a', 'placement', 'q', () => { sent = true; }, 'placement-2');
  box2.children[0].onclick();
  await box2.children[1].children[1].onclick();
  console.error = realError;
  assert.equal(sent, false, 'si falla el envío no se ejecuta la acción posterior');
  const src = require('node:fs').readFileSync(require.resolve('../app.js'), 'utf8');
  assert.ok(src.includes('Encuentra el error, Enséñale a Beto, los retos y las confirmaciones se resumen en «Informe».'), 'Aprendizaje explica dónde están las otras modalidades');
  console.log('qa_round6: OK');
})();
