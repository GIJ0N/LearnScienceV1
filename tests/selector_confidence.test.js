// selector_confidence_v1: un fallo dado con mucha seguridad se repara antes de seguir. Decisión de ruta, no evidencia.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute() {} }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');
const NOW = 1_800_000_000_000;

const node = (id, i, prerequisites = []) => ({ id, name: id, level: i, prerequisites, outcome: 'Resolver', probe: { prompt: 'Explica ' + id, kind: 'explanation' } });
function goal(events = []) {
  return {
    id: 'g', goal: 'Meta', nodes: [node('a', 0), node('b', 1, ['a'])], learner: {}, reviews: [], lessons: {}, events,
    // Sin evidencia en cobertura: la dificultad por dimensión no se activa; solo el evento del historial cuenta.
    coverage: ['a', 'b'].map(id => ({ id, name: id, status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] })),
    session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 },
  };
}
let n = 0;
function evidence(result, confidence, extra = {}) {
  const signal = p.calibrationSignal(result, confidence);
  return { type: 'EVIDENCE', node_id: 'a', evidence_role: 'learning', evidence_id: 'e' + (++n), attempt_id: 'att' + n, result, status: result, timestamp: NOW - 1000 * (100 - n),
    learner_confidence: confidence, calibration_signal: signal, learner_signal_version: 'learner-signals-v1', ...extra };
}
const decide = g => p.selectTutorAction(g, NOW, { reselect: true });

assert.equal(typeof p.calibrationSignal, 'function');

// Fallo con confianza 90 → REPAIR con el motivo nuevo.
let g = goal([evidence('MISCONCEPTION', 90)]);
assert.equal(p.learningState(g, 'a', NOW).committed_misconception, true);
let d = decide(g);
assert.equal(d.action, 'REPAIR');
assert.equal(d.node_id, 'a');
assert.equal(d.reason, 'Respondiste con mucha seguridad algo incorrecto: lo revisamos antes de avanzar.');

// Fallo con confianza 30 → la decisión de hoy (sin REPAIR por esta regla).
g = goal([evidence('MISCONCEPTION', 30)]);
assert.equal(p.learningState(g, 'a', NOW).committed_misconception, false);
d = decide(g);
assert.notEqual(d.action, 'REPAIR');
assert.equal(d.action, 'TEACH');

// Fallo con confianza 90 seguido de acierto → sin REPAIR por esta regla.
g = goal([evidence('MISCONCEPTION', 90), evidence('CORRECT', 80)]);
assert.equal(p.learningState(g, 'a', NOW).committed_misconception, false);
assert.notEqual(decide(g).action, 'REPAIR');

// Un UNKNOWN posterior no borra el fallo seguro (UNKNOWN nunca es evidencia positiva).
g = goal([evidence('MISCONCEPTION', 90), evidence('UNKNOWN', null)]);
assert.equal(p.learningState(g, 'a', NOW).committed_misconception, true);

// Evento legacy sin learner_signal_version → sin cambio.
const legacy = evidence('MISCONCEPTION', 90);
delete legacy.learner_signal_version;
g = goal([legacy]);
assert.equal(p.learningState(g, 'a', NOW).committed_misconception, false);
assert.equal(decide(g).action, 'TEACH');

// Una evaluación supersedida no cuenta.
const first = evidence('MISCONCEPTION', 90);
const fix = evidence('CORRECT', 60, { correction_of: first.evidence_id });
g = goal([first, fix]);
assert.equal(p.learningState(g, 'a', NOW).committed_misconception, false);

// La reparación abierta sigue teniendo prioridad.
g = goal([evidence('MISCONCEPTION', 90)]);
g.contextStack = [{ context_id: 'ctx' }];
assert.equal(decide(g).action, 'RESUME_REPAIR');

// Con foco explícito en otro tema, la regla se aplica a ese tema.
g = goal([evidence('MISCONCEPTION', 90, { node_id: 'b' })]);
d = p.selectTutorAction(g, NOW, { reselect: true, focus: 'b' });
assert.equal(d.action, 'REPAIR');
assert.equal(d.node_id, 'b');

// El selector no modifica sus entradas.
g = goal([evidence('MISCONCEPTION', 90)]);
const before = JSON.stringify(g);
decide(g);
assert.equal(JSON.stringify(g), before);

// QA ronda 8: el fallo seguro está en un tema posterior al primer pendiente → igual se repara ese tema.
{
  const three = goal([]); three.nodes = [node('a', 0), node('b', 1), node('c', 2)];
  three.coverage = ['a', 'b', 'c'].map(id => ({ id, name: id, status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] }));
  three.events = [evidence('MISCONCEPTION', 95, { node_id: 'c' })];
  const dd = decide(three);
  assert.equal(dd.action, 'REPAIR');
  assert.equal(dd.node_id, 'c', 'repara el tema del fallo, no el primer pendiente');
  assert.ok(p.learningState(three, 'c', NOW).committed_at > 0);
  // Con foco explícito en otro tema se respeta el foco.
  assert.notEqual(p.selectTutorAction(three, NOW, { reselect: true, focus: 'a' }).node_id, 'c');
  // Si luego acierta ese tema deja de mandar a reparar.
  three.events.push(evidence('CORRECT', 80, { node_id: 'c' }));
  assert.notEqual(decide(three).action, 'REPAIR');
}

console.log('selector_confidence: OK');
