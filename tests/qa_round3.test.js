// Ronda QA 3: pasos en líneas separadas, pista visible junto al aviso de ayuda, etiquetas, recarga en criterios.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', className: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; }, setAttribute() {} }; }
global.document = { getElementById: () => element(), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
const p = require('../app.js');
const fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const legacy = fs.readFileSync(path.join(__dirname, '..', 'app_legacy.py'), 'utf8');

// 1. El enunciado de una pregunta conserva sus saltos de línea («Paso 1:», «Paso 2:»…).
const box = element();
p.renderPlacementItem(box, { id: 'g1', nodes: [] }, { item_id: 'err-1', node_id: 'a', prompt: 'Problema\nPaso 1: x\nPaso 2: y', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }, {});
const heading = box.children.find(c => c.type === 'h3');
assert.equal(heading.className, 'item-prompt');
assert.ok(legacy.includes('.item-prompt{white-space:pre-line}'), 'la página servida respeta los saltos de línea');

// 2. Etiquetas internas traducidas.
for (const [code, text] of [['MICRO_TUTOR', 'Microlección'], ['INTEGRATE', 'Integrar con la meta'], ['DIAGNOSING', 'buscando la causa'],
  ['PARENT_RETEST', 'volviendo al problema original'], ['conceptual', 'comprensión'], ['direct_application', 'aplicación directa']]) assert.equal(p.humanLabel(code), text, code);
assert.ok(!src.includes('Episodio ${episode.episode_id} · ${episode.status}'), 'no se muestra el id ni el estado crudo del episodio');
assert.ok(src.includes("observed_dimensions||[]).map(humanLabel)"), 'las dimensiones se traducen');
assert.ok(src.includes("'una dificultad de '+humanLabel(event.error_type)"), 'no queda «El intento mostró conceptual.»');

// 3. La práctica de criterios sobrevive a la recarga y la pista se ve junto al aviso de ayuda.
assert.ok(p.RESTORABLE_PAGES.has('criteria'));
assert.ok(src.includes('feedback.replaceChildren(used,helped)'), 'pista y aviso «Ayuda usada» aparecen juntos');
assert.ok(src.includes("hint_text:String(draft.hint_text||'')"), 'la pista mostrada se recupera al retomar');

// 4. El mapa explica por qué faltan prácticas y la confirmación de un reporte es visible.
assert.ok(src.includes('Continuar la práctica en curso'));
assert.ok(src.includes('Reporte guardado.'));
assert.ok(/render\(\);note\('Reporte guardado\./.test(src), 'la nota se pone después de render, que limpia el estado');
console.log('qa_round3.test.js OK');
