// teach_beto_v1: estado de la conversación, resultado provisional y conservador, sin EVIDENCE.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; } }; }
global.document = { getElementById: () => element(), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');
const DAY = 86400000;
const node = id => ({ id, name: 'T-' + id, outcome: 'o', level: 0, prerequisites: [], kind: 'concept', probe: { prompt: 'p', kind: 'explanation' } });
const goal = (reviews = [{ id: 'a', due: Date.now() + 9 * DAY, step: 4, question: null, history: [] }]) => ({ id: 'g1', goal: 'M', nodes: [node('a'), node('b')], learner: {}, coverage: [], reviews, lessons: {},
  session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 }, events: [{ type: 'TEACHING_EXPOSURE', node_id: 'a', at: Date.now() - 5 * DAY }] });
const attach = g => { p.setStoreForTests({ goals: [g], active: g.id }); return g; };
const reply = (b, turn, status, extra = {}) => ({ item_id: b.item_id, node_id: b.node_id, turn, status, beto_reply: 'Beto: ' + status, final: false, provisional: true, ...extra });
const finalExtra = { final: true, correct_idea: 'La idea correcta.', learner_issues: ['Faltó la densidad'], debrief: 'Resumen.' };

(() => {
  let g = attach(goal([]));
  assert.equal(p.betoAvailable(g), false, 'sin un tema aprendido no se ofrece');
  assert.throws(() => p.startBeto(g), /tema aprendido/);

  g = attach(goal());
  assert.equal(p.betoAvailable(g), true, 'basta con un tema');
  const b = p.startBeto(g);
  assert.equal(b.status, 'active');
  assert.equal(b.node_id, 'a');
  assert.equal(p.betoAvailable(g), false, 'no se ofrece con una conversación en curso');
  assert.throws(() => p.startBeto(g), /en curso/);
  assert.equal(p.mixedAvailable(g) || p.errorHuntAvailable(g), false, 'las demás prácticas esperan a que termine Beto');

  // Sin sesión del servidor no se acepta ningún turno.
  assert.throws(() => p.applyBetoTurn(g, reply({ item_id: 'x', node_id: 'a' }, 1, 'PARTIAL'), 'a1', 'hola'), /ya no está activa/);
  b.item_id = 'beto-1'; b.turns = [{ role: 'beto', text: 'Hola, creo algo raro.' }];

  // Validaciones.
  assert.throws(() => p.applyBetoTurn(g, { ...reply(b, 1, 'PARTIAL'), item_id: 'beto-otro' }, 'a1', 'm'), /no corresponde a esta conversación/);
  assert.throws(() => p.applyBetoTurn(g, { ...reply(b, 1, 'PARTIAL'), node_id: 'b' }, 'a1', 'm'), /no corresponde a esta conversación/);
  assert.throws(() => p.applyBetoTurn(g, reply(b, 1, 'GENIAL'), 'a1', 'm'), /no corresponde a esta conversación/);
  assert.throws(() => p.applyBetoTurn(g, reply(b, 2, 'PARTIAL'), 'a1', 'm'), /no corresponde al turno/);

  // Turno intermedio: guarda el diálogo y no registra ningún evento.
  assert.equal(p.applyBetoTurn(g, reply(b, 1, 'PARTIAL'), 'a1', '  Explico con densidad  '), true);
  assert.deepEqual(b.turns.map(t => t.role), ['beto', 'learner', 'beto']);
  assert.equal(b.turns[1].text, 'Explico con densidad');
  assert.equal(b.status, 'active');
  assert.equal(g.events.filter(e => e.type === 'BETO_SESSION').length, 0);
  assert.equal(p.applyBetoTurn(g, reply(b, 1, 'PARTIAL'), 'a1', 'otra vez'), false, 'idempotente por attempt_id');
  assert.equal(b.turns.length, 3);

  // Final convencido: evento provisional, sin EVIDENCE, sin tocar el repaso.
  const before = JSON.stringify(g.reviews);
  assert.equal(p.applyBetoTurn(g, reply(b, 2, 'CORRECTED', finalExtra), 'a2', 'Ya sí lo explico bien'), true);
  assert.equal(b.status, 'done');
  assert.equal(b.summary.status, 'CORRECTED');
  assert.equal(b.summary.correct_idea, 'La idea correcta.');
  const ev = g.events.find(e => e.type === 'BETO_SESSION');
  assert.deepEqual([ev.status, ev.turns, ev.provisional, ev.policy_version], ['CORRECT', 2, true, 'teach_beto_v1']);
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0);
  assert.equal(JSON.stringify(g.reviews), before, 'convencer a Beto no retrasa ni adelanta el repaso');
  assert.equal(p.expertOutcome(ev), null, 'el panel experto ignora la calificación provisional');
  assert.throws(() => p.applyBetoTurn(g, reply(b, 3, 'PARTIAL'), 'a3', 'x'), /ya no está activa/);

  // Final sin convencer: adelanta el repaso, nunca lo aleja.
  g = attach(goal());
  const b2 = p.startBeto(g);
  b2.item_id = 'beto-2'; b2.turns = [{ role: 'beto', text: 'Hola' }];
  const due = g.reviews[0].due, step = g.reviews[0].step;
  assert.equal(p.applyBetoTurn(g, reply(b2, 1, 'PERSISTS', finalExtra), 'z1', 'No sé muy bien'), true);
  assert.equal(g.events.find(e => e.type === 'BETO_SESSION').status, 'MISCONCEPTION');
  assert.ok(g.reviews[0].due <= due && g.reviews[0].step <= step);
  assert.ok(g.reviews[0].due < due, 'el repaso se adelantó');
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0);

  const src = require('node:fs').readFileSync(__dirname + '/../app.js', 'utf8');
  assert.ok(src.includes("'/api/beto/start'") && src.includes("'/api/beto/turn'"), 'rutas cableadas');
  assert.ok(src.includes("B('Enséñale a Beto'") && src.includes('betoSession(goal)'), 'botón y sesión cableados');
  console.log('OK: Enséñale a Beto (estado, provisional, repaso conservador, sin evidencia).');
})();
