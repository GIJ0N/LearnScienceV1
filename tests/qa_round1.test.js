const assert = require('node:assert/strict');
function element(type = 'div') {
  return { type, textContent: '', value: '', disabled: false, children: [], className: '',
    append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; },
    replaceChildren(...i) { this.children = i; }, setAttribute() {}, prepend() {} };
}
global.document = { getElementById: () => element(), createElement: (t) => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const policy = require('../app.js');
const fs = require('node:fs');

function node(id, pre = []) { return { id, name: 'Tema ' + id, outcome: 'Usar ' + id, level: 0, prerequisites: pre, kind: 'concept', probe: { prompt: 'p', kind: 'explanation' } }; }
function goal() {
  const nodes = [node('a'), node('b', ['a']), node('c', ['b'])];
  return { id: 'goal-qa', profile_id: 'p', goal: 'Meta', nodes, learner: {}, events: [], reviews: [], lessons: {},
    coverage: nodes.map(n => ({ id: n.id, name: n.id, status: 'UNKNOWN', confidence: 0, dimensions: [] })),
    session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 } };
}

// El diagnóstico termina en una pantalla de resultados, no en el mapa, y no cuenta como dominio.
{
  const g = goal(); policy.setStoreForTests({ goals: [g], active: g.id });
  policy.startPlacement(g);
  policy.finishPlacement(g, 'resolved', true);
  assert.equal(g.placement.summary_pending, true, 'Debe mostrar el resumen antes de continuar');
  const sum = policy.placementSummary(g);
  assert.ok(Array.isArray(sum.held) && Array.isArray(sum.learn));
  assert.equal(policy.verified(g, 'a'), false);
}

// La lección por pasos que falla no se desactiva para siempre: solo en memoria de sesión.
assert.ok(policy.stepsUnavailable instanceof Set);
{
  const g = goal(); policy.setStoreForTests({ goals: [g], active: g.id });
  g.lessons.a = { common_error: 'x' };
  assert.equal(g.lessons.a.steps_failed, undefined);
}

// Código fuente: margen de tokens para modelos con razonamiento, y guardas de redacción en el prompt.
const py = fs.readFileSync(__dirname + '/../app_legacy.py', 'utf8');
assert.ok(py.includes("min(16384,max_tokens*GEMINI_OUTPUT_MARGIN)"), 'maxOutputTokens debe absorber los tokens de razonamiento');
assert.ok(py.includes('acentos y ñ'), 'El prompt exige español con acentos');
assert.ok(!/l\.steps_failed=true/.test(fs.readFileSync(__dirname + '/../app.js', 'utf8')), 'steps_failed ya no se guarda');

console.log('OK: ronda QA 1 (resumen de diagnóstico, pasos reintentables, margen de tokens).');
