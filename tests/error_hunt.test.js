// error_hunt_v1: disponibilidad con un solo tema, evento DISCRIMINATION con variante, sin EVIDENCE.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; } }; }
global.document = { getElementById: () => element(), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');
const DAY = 86400000;
const node = id => ({ id, name: 'T-' + id, outcome: 'o', level: 0, prerequisites: [], kind: 'concept', probe: { prompt: 'p', kind: 'explanation' } });
const goal = (reviews = []) => ({ id: 'g1', goal: 'M', nodes: [node('a'), node('b')], learner: {}, coverage: [], reviews, lessons: {}, session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 },
  events: [{ type: 'TEACHING_EXPOSURE', node_id: 'a', at: Date.now() - 5 * DAY }] });
const attach = g => { p.setStoreForTests({ goals: [g], active: g.id }); return g; };
const item = id => ({ item_id: 'err-' + id, node_id: 'a', prompt: 'Paso 1: x', options: [{ id: 'a', text: 'paso 1' }, { id: 'b', text: 'paso 2' }, { id: 'c', text: 'paso 3' }] });
const res = (status, it) => ({ status, item_id: it.item_id, node_id: it.node_id, selected_misconception: status === 'MISCONCEPTION' ? 'confunde dividir con multiplicar' : '' });

(() => {
  // Sin ningún tema repasable no se ofrece y no arranca.
  let g = attach(goal());
  assert.equal(p.errorHuntAvailable(g), false);
  assert.throws(() => p.startMixed(g, 'error_hunt'), /tema aprendido/);

  // Con UN solo tema ya se puede (la práctica intercalada exige dos).
  g = attach(goal([{ id: 'a', due: Date.now() - DAY, step: 1, question: null, history: [] }]));
  assert.equal(p.mixedAvailable(g), false);
  assert.equal(p.errorHuntAvailable(g), true);
  const m = p.startMixed(g, 'error_hunt');
  assert.equal(m.kind, 'error_hunt');
  assert.deepEqual(m.node_ids, ['a']);
  assert.equal(p.errorHuntAvailable(g), false, 'no se ofrece mientras hay otra práctica activa');

  m.items = [item(1), item(2)];
  assert.equal(p.applyDiscrimination(g, m.items[0], res('CORRECT', m.items[0]), 'h1', 'a', 85), true);
  const ev = g.events.find(e => e.attempt_id === 'h1');
  assert.equal(ev.type, 'DISCRIMINATION');
  assert.equal(ev.variant, 'error_hunt');
  assert.equal(ev.policy_version, 'spaced_practice_v1');
  assert.equal(ev.learner_confidence, 85);

  // Un fallo adelanta el repaso y no crea EVIDENCE; repetir el intento no duplica.
  assert.equal(p.applyDiscrimination(g, m.items[1], res('MISCONCEPTION', m.items[1]), 'h2', 'b', 90), true);
  assert.equal(m.status, 'done');
  assert.throws(() => p.applyDiscrimination(g, m.items[1], res('MISCONCEPTION', m.items[1]), 'h2', 'b', 90), /ya no está activa/, 'terminada la práctica no se acepta nada más');
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0, 'encontrar un error no es evidencia de dominio');
  assert.equal(g.events.filter(e => e.type === 'DISCRIMINATION').length, 2);

  // Corrección escrita: evento propio, provisional, sin EVIDENCE, sin tocar el repaso y sin entrar al panel experto.
  g = attach(goal([{ id: 'a', due: Date.now() - DAY, step: 1, question: null, history: [] }]));
  const hm = p.startMixed(g, 'error_hunt');
  hm.items = [item(7)];
  const reviewBefore = JSON.stringify(g.reviews);
  const fixRes = (status, it, extra = {}) => ({ status, item_id: it.item_id, node_id: it.node_id, ...extra });
  assert.equal(p.applyDiscrimination(g, hm.items[0], { ...res('CORRECT', hm.items[0]), needs_fix: true }, 'q1', 'a', 80), true);
  assert.equal(hm.status, 'done', 'la corrección llega cuando la práctica ya avanzó: no exige que siga activa');
  assert.equal(p.applyErrorFix(g, hm.items[0], fixRes('PARTIAL', hm.items[0]), 'fx1', '  Paso 2: 15 × 5 = 75  '), true);
  const fx = g.events.find(e => e.type === 'ERROR_FIX');
  assert.equal(fx.status, 'PARTIAL');
  assert.equal(fx.provisional, true);
  assert.equal(fx.answer_text, 'Paso 2: 15 × 5 = 75');
  assert.equal(fx.attempt_id, 'fx1');
  assert.equal(p.applyErrorFix(g, hm.items[0], fixRes('PARTIAL', hm.items[0]), 'fx1', 'x'), false, 'idempotente por attempt_id');
  assert.equal(g.events.filter(e => e.type === 'ERROR_FIX').length, 1);
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0);
  assert.equal(JSON.stringify(g.reviews), reviewBefore, 'la corrección no mueve el repaso');
  assert.equal(p.expertOutcome(fx), null, 'una calificación provisional no cuenta para el panel experto');
  assert.throws(() => p.applyErrorFix(g, item(99), fixRes('CORRECT', item(99)), 'fx2', 'x'), /ya no corresponde/);
  assert.throws(() => p.applyErrorFix(g, hm.items[0], fixRes('UNKNOWN', hm.items[0]), 'fx3', 'x'), /no corresponde a la corrección/);
  assert.throws(() => p.applyErrorFix(g, hm.items[0], { ...fixRes('CORRECT', hm.items[0]), node_id: 'zzz' }, 'fx4', 'x'), /no corresponde a la corrección/);

  // Una práctica de discriminación normal no lleva variante.
  g = attach(goal([{ id: 'a', due: Date.now() - DAY, step: 1, question: null, history: [] }, { id: 'b', due: Date.now() - DAY, step: 1, question: null, history: [] }]));
  g.events.push({ type: 'TEACHING_EXPOSURE', node_id: 'b', at: Date.now() - 4 * DAY });
  const d = p.startMixed(g);
  d.items = [item(3), { ...item(4), node_id: 'b' }];
  p.applyDiscrimination(g, d.items[0], res('CORRECT', d.items[0]), 'd1', 'a', 80);
  assert.equal(g.events.find(e => e.attempt_id === 'd1').variant, undefined);

  const src = require('node:fs').readFileSync(__dirname + '/../app.js', 'utf8');
  assert.ok(src.includes("'/api/practice/error'") && src.includes("'/api/practice/error/answer'"), 'las rutas están cableadas');
  assert.ok(src.includes("B('Encuentra el error'"), 'el botón existe en el mapa');
  assert.ok(src.includes("'/api/practice/error/fix'") && src.includes('after:errorFixPanel'), 'el panel de corrección está cableado');
  console.log('OK: Encuentra el error (disponibilidad, evento con variante, sin evidencia).');
})();
