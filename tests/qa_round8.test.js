// QA ronda 8: ningún tipo de error del evaluador se muestra en inglés al aprendiz.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {} } }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');
const TYPES = ['conceptual', 'prerequisite', 'formula_selection', 'variable_identification', 'units', 'algebra', 'arithmetic', 'procedure', 'interpretation', 'memory', 'application', 'transfer', 'attention', 'none'];
for (const t of TYPES) {
  const label = p.humanLabel(t);
  assert.notEqual(label, t, 'sin traducir: ' + t);
  assert.match(label, /^[a-záéíóúñ ]+$/, 'etiqueta en español para ' + t);
}
assert.equal(p.humanReason('El intento mostró attention.'), 'El intento mostró una dificultad de atención.');
console.log('qa_round8.test.js OK');
