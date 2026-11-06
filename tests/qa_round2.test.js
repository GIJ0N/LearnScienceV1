// Ronda QA 2: ninguna etiqueta interna llega a la pantalla sin traducir.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; } }; }
global.document = { getElementById: () => element(), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
const p = require('../app.js');
for (const [code, text] of [['INTEGRATE_WITH_GOAL', 'Integrar con la meta'], ['INDEPENDENT_EVIDENCE', 'Evidencia independiente'], ['SPACED_REVIEW', 'Repaso espaciado'],
  ['PROBE_PREREQUISITE', 'Explorar un prerrequisito'], ['NOT_EVALUATED', 'Sin evaluar'], ['INDEPENDENT', 'Práctica independiente']]) {
  assert.equal(p.humanLabel(code), text, code);
}
assert.equal(p.humanLabel('CODIGO_NUEVO'), 'CODIGO_NUEVO', 'un código desconocido no se rompe');
const fs = require('node:fs');
const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
assert.ok(src.includes("humanLabel(activity.phase)"), 'la fase de la actividad se traduce');
assert.ok(!/activity\.help\?\.critical\)\{criterionActivityState\.help_used/.test(src), 'la pista de criterios nunca queda muda');
console.log('qa_round2.test.js OK');
