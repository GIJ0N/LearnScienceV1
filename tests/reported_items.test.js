// reported_items_v1: el diagnóstico ofrece «Esto está mal» y una pregunta reportada deja de usarse.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', className: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; }, setAttribute() {} }; }
global.document = { getElementById: () => element(), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
const p = require('../app.js');
const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');

const goal = { id: 'g1', goal: 'M', nodes: [], placement: { status: 'active', items: { 'placement-1': { item_id: 'placement-1', node_id: 'a', prompt: 'P', used: false }, 'placement-2': { item_id: 'placement-2', node_id: 'a', prompt: 'Q', used: false } }, answers: [] } };
p.setStoreForTests({ goals: [goal], active: goal.id });

// Marcar como reportada la saca de la cola sin contarla como respuesta.
assert.equal(p.markPlacementReported(goal, 'placement-1'), true);
assert.equal(goal.placement.items['placement-1'].used, true);
assert.equal(goal.placement.items['placement-1'].reported, true);
assert.equal(goal.placement.items['placement-2'].used, false, 'las demás siguen disponibles');
assert.equal(goal.placement.answers.length, 0, 'un reporte no es una respuesta');
assert.equal((goal.events || []).length, 0, 'un reporte no crea ni quita evidencia');
assert.equal(p.markPlacementReported(goal, 'no-existe'), false);
assert.equal(p.markPlacementReported({ id: 'x' }, 'placement-1'), false, 'una meta sin diagnóstico no lanza');

// Fuente: el botón solo se ofrece en el diagnóstico (sin ruta propia) y envía el id de la pregunta.
assert.ok(src.includes("if(!opts.route)reportButton(box,goal,item.node_id,'placement',item.prompt"), 'botón solo en el diagnóstico');
assert.ok(src.includes('item_id:itemId'), 'el reporte envía el id de la pregunta');
assert.ok(src.includes("/ITEM_EXCLUDED/.test("), 'una pregunta ya excluida se reemplaza');
assert.ok(src.includes('Esa pregunta fue reportada; te muestro otra.'));
assert.ok(/render\(\);note\('Esa pregunta fue reportada/.test(src), 'la nota va después de render (que la limpia)');
console.log('reported_items.test.js OK');
