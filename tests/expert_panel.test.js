// expert_panel_v1: lectura derivada de las 7 capas; nunca escribe eventos ni cambia dominio.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; } }; }
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: id => (id === 'app' ? roots.app : roots.status), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');
const DAY = 86400000;
// L2a: la independencia lee la cobertura; el fixture refleja los eventos del tema a en la dimensión de aplicación.
const goal = events => ({ id: 'g1', goal: 'M', nodes: [{ id: 'a', name: 'A', outcome: 'o', prerequisites: [] }, { id: 'b', name: 'B', outcome: 'o', prerequisites: [] }], learner: {}, coverage: [{ id: 'a', name: 'A', dimensions: [{ id: 'direct_application', required: true, evidence: events.filter(e => e.node_id === 'a' && e.type === 'EVIDENCE') }] }], reviews: [], lessons: {}, events,
  session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 } });
let n = 0;
const ev = (extra) => ({ type: 'EVIDENCE', node_id: 'a', evidence_role: 'learning', result: 'CORRECT', status: 'CORRECT', help_used: 0, activity_id: 'act' + (++n), ...extra });
const layers = (events, id = 'a') => p.expertLayers(goal(events), id);

// Sin datos: todo «none», etiqueta «Sin medir», primera capa como siguiente paso.
let r = layers([]);
assert.ok(Object.values(r.layers).every(v => v === 'none'));
assert.equal(r.label, 'Sin medir');
assert.equal(r.next.layer, 'comprehension');
// Algo parcial (sin ninguna capa lograda) se llama «Iniciando», no «Sin medir».
assert.equal(layers([ev({ phase: 'COMPREHENSION', result: 'MISCONCEPTION', status: 'MISCONCEPTION' })]).label, 'Iniciando');
assert.equal(p.EXPERT_LAYERS.length, 7);

// 1 Comprensión
assert.equal(layers([ev({ phase: 'COMPREHENSION', result: 'MISCONCEPTION', status: 'MISCONCEPTION' })]).layers.comprehension, 'partial');
assert.equal(layers([ev({ phase: 'COMPREHENSION' })]).layers.comprehension, 'met');
assert.equal(layers([ev({ phase: 'COMPREHENSION', result: 'UNKNOWN', status: 'UNKNOWN' })]).layers.comprehension, 'none', 'UNKNOWN no es dato');
// El diagnóstico y otros temas no cuentan como comprensión.
assert.equal(layers([ev({ phase: 'COMPREHENSION', evidence_role: 'diagnostic' })]).layers.comprehension, 'none');
assert.equal(layers([ev({ phase: 'COMPREHENSION', node_id: 'b' })]).layers.comprehension, 'none');

// 2 Independencia: dos actividades distintas; la misma actividad dos veces no basta.
assert.equal(layers([ev({ is_independent: true })]).layers.independence, 'partial');
// L2a: dos aciertos seguidos no bastan; hace falta además un acierto escrito local de otro día.
const T0 = Date.UTC(2026, 10, 10, 12), DAYT = 86400000;
const indep = (at, n) => ev({ is_independent: true, timestamp: at, observed_dimensions: ['direct_application'], attempt_id: 'i' + n, question: { prompt: 'Problema independiente ' + n } });
const written = (at, n) => ({ ...indep(at, n), evaluator_trust: 'deterministic', evaluator_version: 'local-production-v1', production_kind: 'numeric', purpose: 'practice' });
assert.equal(layers([indep(T0, 1), indep(T0, 2)]).layers.independence, 'partial', 'mismo día: parcial');
assert.equal(layers([indep(T0 - DAYT, 1), indep(T0 - DAYT, 2), written(T0, 3)]).layers.independence, 'met', 'con confirmación de otro día: cumplida');
assert.equal(layers([ev({ is_independent: true, activity_id: 'x' }), ev({ is_independent: true, activity_id: 'x' })]).layers.independence, 'partial');
assert.equal(layers([ev({ is_independent: false }), ev({ is_independent: false })]).layers.independence, 'none');

// 3 Retención: demora y sin ayuda.
assert.equal(layers([ev({ phase: 'REVIEW', delay_ms_from_last_exposure: 31 * DAY })]).layers.retention, 'met');
assert.equal(layers([ev({ phase: 'REVIEW', delay_ms_from_last_exposure: 8 * DAY })]).layers.retention, 'partial');
assert.equal(layers([ev({ phase: 'REVIEW', delay_ms_from_last_exposure: 30 * DAY, help_used: 1 })]).layers.retention, 'none', 'con ayuda no cuenta');
assert.equal(layers([ev({ phase: 'REVIEW', delay_ms_from_last_exposure: 30 * DAY, result: 'MISCONCEPTION', status: 'MISCONCEPTION' })]).layers.retention, 'none');
assert.equal(layers([ev({ phase: 'REVIEW' })]).layers.retention, 'none', 'sin demora verificable no cuenta');

// 4 y 5 Discriminación / composición
const d = (status, type = 'DISCRIMINATION') => ({ type, node_id: 'a', status });
assert.equal(layers([d('CORRECT')]).layers.discrimination, 'partial');
assert.equal(layers([d('CORRECT'), d('CORRECT')]).layers.discrimination, 'met');
assert.equal(layers([d('CORRECT'), d('CORRECT'), d('MISCONCEPTION')]).layers.discrimination, 'partial', 'el último fallo la baja');
assert.equal(layers([d('MISCONCEPTION')]).layers.discrimination, 'none');
assert.equal(layers([d('UNKNOWN'), d('CORRECT'), d('CORRECT')]).layers.discrimination, 'met');
assert.equal(layers([d('CORRECT', 'COMPOSITION'), d('CORRECT', 'COMPOSITION')]).layers.composition, 'met');
assert.equal(layers([d('CORRECT', 'COMPOSITION'), d('CORRECT', 'COMPOSITION')]).layers.discrimination, 'none', 'no se mezclan');

// 6 Transferencia
// transfer_probe_v1 (L2b): la capa de transferencia exige un sondeo determinista; la novedad de integración sola no la cubre.
const probe = { transfer_probe_version: 'transfer_probe_v1', evaluator_trust: 'deterministic' };
assert.equal(layers([ev({ is_novel_variant: true, is_independent: true, ...probe })]).layers.transfer, 'met');
assert.equal(layers([ev({ is_novel_variant: true, is_independent: true })]).layers.transfer, 'none', 'la novedad sin sondeo no cubre la capa');
assert.equal(layers([ev({ is_novel_variant: true, is_independent: false, help_used: 1, ...probe })]).layers.transfer, 'partial');
assert.equal(layers([ev({ is_independent: true })]).layers.transfer, 'none');

// 7 Calibración
const c = (status, conf, type = 'STEP_CHECK') => ({ type, node_id: 'a', status, learner_confidence: conf });
assert.equal(layers([c('CORRECT', 90), c('MISCONCEPTION', 20), c('CORRECT', 80), c('MISCONCEPTION', 10)]).layers.calibration, 'met');
assert.equal(layers([c('CORRECT', 90), c('MISCONCEPTION', 20)]).layers.calibration, 'partial');
assert.equal(layers([c('MISCONCEPTION', 90), c('MISCONCEPTION', 95), c('CORRECT', 90), c('CORRECT', 90)]).layers.calibration, 'partial', '50 % de coincidencia no cumple la capa');
assert.equal(layers([c('CORRECT', 55), c('CORRECT', 60), c('MISCONCEPTION', 50), c('CORRECT', 45)]).layers.calibration, 'none', 'las intermedias no son decisivas');
const cal = p.calibrationSummary(goal([c('MISCONCEPTION', 90), c('CORRECT', 30), c('CORRECT', 85), c('UNKNOWN', 90), { type: 'STEP_CHECK', node_id: 'a', status: 'CORRECT', learner_confidence: null }]));
assert.equal(cal.answered, 3);
assert.equal(cal.decisive, 3);
assert.equal(cal.aligned, 1);
assert.equal(cal.overconfident, 1);
assert.equal(cal.underconfident, 1);
assert.equal(cal.bands[2].n, 2);
assert.equal(cal.bands[2].correct, 1);
assert.equal(p.calibrationSummary(goal([])).rate, null);
// Incluye el diagnóstico en calibración, no en las capas 1–6.
const diag = ev({ phase: 'DIAGNOSTIC', evidence_role: 'diagnostic', learner_confidence: 90 });
assert.equal(p.calibrationSummary(goal([diag])).answered, 1);
assert.equal(p.calibrationSummary(goal([{ ...diag, evidence_role: 'evaluation' }])).answered, 0, 'las auditorías no cuentan');

// Etiquetas por cantidad de capas y siguiente paso.
// L2a: la independencia exige una confirmación escrita local de otro día: dos independientes antiguos y uno escrito posterior.
const fullInd = (at, n) => ev({ is_independent: true, timestamp: at, observed_dimensions: ['direct_application'], attempt_id: 'f' + n, question: { prompt: 'Completo ' + n } });
const full = [ev({ phase: 'COMPREHENSION' }), fullInd(T0 - DAYT, 1), fullInd(T0 - DAYT, 2), { ...fullInd(T0, 3), evaluator_trust: 'deterministic', evaluator_version: 'local-production-v1', production_kind: 'numeric', purpose: 'practice' }, ev({ phase: 'REVIEW', delay_ms_from_last_exposure: 31 * DAY }),
  d('CORRECT'), d('CORRECT'), d('CORRECT', 'COMPOSITION'), d('CORRECT', 'COMPOSITION'), ev({ is_novel_variant: true, is_independent: true, transfer_probe_version: 'transfer_probe_v1', evaluator_trust: 'deterministic' }),
  c('CORRECT', 90), c('CORRECT', 95), c('MISCONCEPTION', 10), c('MISCONCEPTION', 5)];
r = layers(full);
assert.equal(r.met, 7);
assert.match(r.label, /^Experto/);
assert.equal(r.next, null);
// L2a: el acierto escrito de otro día ocupa la cuarta posición; los cortes se ajustan para conservar cada escenario.
assert.equal(layers(full.slice(0, 4)).label, 'Base');
assert.equal(layers(full.slice(0, 5)).next.layer, 'discrimination', 'la primera capa sin cumplir es el siguiente paso');

// Solo lectura: no muta ni agrega eventos.
const g = goal(full);
const snapshot = JSON.stringify(g);
p.expertPanel(g);
assert.equal(JSON.stringify(g), snapshot);
// Panel por tema aísla nodos.
assert.equal(p.expertPanel(g).find(x => x.node.id === 'b').met, 0);
// La vista se construye sin lanzar.
p.setStoreForTests({ goals: [g], active: g.id });
p.expertView();
console.log('OK: expert panel');
