// stuck_exits_v1: salidas cuando la reparación no ayuda. Ninguna crea EVIDENCE.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute() {}, prepend() {} }; }
const roots = { app: element('main'), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
global.fetch = async (route, options) => {
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  return { ok: false, json: async () => ({ error: 'sin ruta en la prueba: ' + route }) };
};
const find = (label, root = roots.app) => { if (root && root.textContent === label) return root; for (const c of (root && root.children) || []) { const f = find(label, c); if (f) return f; } return null; };
const has = (needle, root = roots.app) => { if (root && String(root.textContent || '').includes(needle)) return true; return ((root && root.children) || []).some(c => has(needle, c)); };
const question = (prompt, reference, kind, dims) => ({ prompt, reference, kind, observable_dimensions: dims });
function goal() {
  const parent = question('Resuelve 2x + 3 = 7', 'x = 2', 'application', ['direct_application']);
  return {
    id: 'goal-s', profile_id: 'profile-test', goal: 'Álgebra',
    nodes: [
      { id: 'n0', name: 'Operaciones inversas', outcome: 'Aislar variables', level: 0, prerequisites: [], kind: 'procedure', probe: question('¿Qué deshace sumar?', 'Restar', 'explanation', ['conceptual']) },
      { id: 'n1', name: 'Ecuaciones', outcome: 'Resolver ecuaciones', level: 0, prerequisites: ['n0'], kind: 'procedure', probe: question('¿Qué es despejar?', 'Aislar', 'explanation', ['conceptual']) },
    ], learner: {}, coverage: [{ id: 'n1', name: 'Ecuaciones', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'direct_application', required: true, status: 'UNKNOWN', evidence: [] }] }],
    events: [], reviews: [{ id: 'n0', last_exposure_at: 10, question: { prompt: 'Repaso n0' }, answered_at: null }], lessons: { n1: { explanation: 'E', example: 'X', common_error: 'C', independent: { ...parent, activity_id: 'parent-activity' } } },
    repairEpisodes: [], contextStack: [], session: { mode: 'INDEPENDENT', node: 'n1', stack: [], stage: 'teach', tries: 0, hints: 0 },
  };
}
function diagnosis() {
  return { plan_version: p.REPAIR_TEACHING_VERSION, suspected_gaps: [{ gap_id: 'gap-inverse', node_id: 'n0', concept: 'Operaciones inversas', reason: 'No aisló la variable', motivating_evidence: 'Sumó en vez de restar', confidence: 0.9, status: 'SUSPECTED' }],
    diagnostic_checks: [{ gap_id: 'gap-inverse', question: question('¿Qué operación deshace sumar cinco?', 'Restar cinco', 'explanation', ['conceptual']) }] };
}
let seq = 0;
function open(value) {
  p.setStoreForTests({ goals: [value], active: value.id }); p.setProfileForTests({ profile_id: 'profile-test' });
  const activity = p.activityContract(value.lessons.n1.independent, 'n1', 'independent_practice');
  const event = p.record(value, 'n1', 'INDEPENDENT', 'Sumé tres', { status: 'PARTIAL', error_type: 'prerequisite', feedback: 'Revisa la operación inversa', evaluator_version: 'local-fixture' }, 0, activity, 'parent-s');
  const episode = p.createRepairEpisode(value, { activity_id: event.activity_id, attempt_id: event.attempt_id, node_id: 'n1', question: value.lessons.n1.independent, response: 'Sumé tres', evaluation: { status: 'PARTIAL', error_type: 'prerequisite', feedback: 'Revisa la operación inversa' }, help_used: 0, context_snapshot: { mode: 'INDEPENDENT', node: 'n1', stack: [], stage: 'teach', tries: 0 } }, diagnosis());
  p.pushContext(value, { context_id: 'ctx-s', episode_id: episode.episode_id, status: 'ACTIVE', history: [] });
  return episode;
}
function diagnose(value, episode, status) {
  const current = p.episodeActivity(episode); assert.ok(current);
  return p.applyResult(value, 'n1', current.activity.stage, 'No lo sé', { status, error_type: status === 'CORRECT' ? 'none' : 'procedure', feedback: 'f', hint: '', evaluator_version: 'local-fixture', _activity: current.activity, _attempt_id: `s-${++seq}`, _episode_id: episode.episode_id, _repair_stage: current.phase, _help_used: 0 });
}
const evidence = g => g.events.filter(e => e.type === 'EVIDENCE');

(async () => {
  // 1. Diagnóstico incierto -> PARTIAL sin enseñanza -> s.stuck y la oferta, sin EVIDENCE de más.
  {
    const value = goal(), episode = open(value); const before = evidence(value).length;
    diagnose(value, episode, 'UNKNOWN');
    assert.equal(episode.status, 'PARTIAL'); assert.match(episode.close_reason, /incierto/);
    assert.ok(value.session.stuck, 'queda registrada la salida');
    assert.equal(value.session.stuck.node_id, 'n1'); assert.equal(value.session.stuck.phase, 'INDEPENDENT');
    assert.equal(value.session.stuck.question_prompt, 'Resuelve 2x + 3 = 7'); assert.equal(value.session.stuck.source_attempt_id, 'parent-s');
    assert.equal(value.session.stuck.episode_id, episode.episode_id);
    assert.equal(value.session.mode, 'INDEPENDENT', 'vuelve a la pregunta original');
    assert.equal(evidence(value).length, before + 1, 'solo el intento de diagnóstico, nada positivo');
    roots.app.children = []; await p.session();
    assert.ok(has('El diagnóstico no encontró la causa. ¿Te lo enseño paso a paso?')); assert.ok(find('Enséñamelo')); assert.ok(find('Ahora no'));
    assert.ok(has('Sobre: Resuelve 2x + 3 = 7'));
    // Aceptar abre la enseñanza directa para esa pregunta, con el intento que abrió la reparación.
    const count = evidence(value).length;
    await settle(); find('Enséñamelo').onclick(); await settle();
    assert.equal(value.session.stuck, null);
    assert.ok(value.session.direct, 'se abre la enseñanza directa');
    assert.equal(value.session.direct.source_attempt_id, 'parent-s'); assert.equal(value.session.direct.question_prompt, 'Resuelve 2x + 3 = 7');
    assert.equal(value.session.direct.phase, 'INDEPENDENT'); assert.equal(value.session.direct.question.reference, 'x = 2');
    assert.equal(evidence(value).length, count, 'aceptar no crea EVIDENCE');
    const offers = value.events.filter(e => e.type === 'STUCK_OFFER'); assert.equal(offers.length, 1); assert.equal(offers[0].accepted, true); assert.equal(offers[0].episode_id, episode.episode_id);
    assert.equal(value.events.filter(e => e.type === 'DIRECT_TEACHING').length, 1);
    assert.equal(p.verified(value, 'n1'), false);
  }

  // 2. «Ahora no» registra accepted:false y no abre la enseñanza.
  {
    const value = goal(), episode = open(value); diagnose(value, episode, 'UNKNOWN');
    roots.app.children = []; await p.session(); await settle();
    find('Ahora no').onclick(); await settle();
    assert.equal(value.session.stuck, null); assert.ok(!value.session.direct);
    assert.equal(value.events.filter(e => e.type === 'STUCK_OFFER').at(-1).accepted, false);
  }

  // 3. Sin oferta cuando sí hay enseñanza (laguna confirmada) o cuando el cierre no es un diagnóstico sin causa.
  {
    const value = goal(), episode = open(value); diagnose(value, episode, 'PARTIAL');
    assert.equal(episode.selected_gap.status, 'CONFIRMED'); assert.equal(episode.status, 'REPAIRING');
    assert.ok(!value.session.stuck, 'una laguna confirmada enseña: sin oferta');
  }
  for (const status of ['ABANDONED', 'PARTIAL', 'COMPLETED']) {
    const value = goal(), episode = open(value); p.closeRepairEpisode(value, episode, status, 'cierre de prueba');
    assert.ok(!value.session.stuck, 'closeRepairEpisode ' + status + ' no ofrece enseñanza');
    assert.equal(p.markStuck(value, episode), true, 'markStuck solo se llama desde stuckClose');
  }

  // 4. Contestar la pregunta o cambiar de tema borra la oferta.
  {
    const value = goal(), episode = open(value); diagnose(value, episode, 'UNKNOWN'); assert.ok(value.session.stuck);
    const activity = p.activityContract(value.lessons.n1.independent, 'n1', 'independent_practice');
    p.applyResult(value, 'n1', 'INDEPENDENT', 'x = 2', { status: 'CORRECT', error_type: 'none', feedback: 'ok', hint: '', evaluator_version: 'local-fixture', _activity: activity, _attempt_id: 'answer-after-stuck' });
    assert.equal(value.session.stuck, null);
  }
  {
    const value = goal(), episode = open(value); diagnose(value, episode, 'UNKNOWN'); assert.ok(value.session.stuck);
    p.chooseNext(value, { reselect: true }); assert.equal(value.session.stuck, null);
  }

  // 5. «Abandonar reparación» desde el inicio deja el mismo estado que «Abandonar episodio».
  const project = value => ({
    status: value.repairEpisodes[0].status, closed: Boolean(value.repairEpisodes[0].closed_at), stack: value.contextStack.length,
    mode: value.session.mode, node: value.session.node, events: value.events.map(e => e.type + ':' + (e.status || '')), evidence: evidence(value).length,
    covered: value.coverage.filter(c => c.id === 'n1').map(c => c.status + ':' + c.dimensions.map(d => d.status + d.evidence.length).join(',')).join(';'), reviews: JSON.stringify(value.reviews),
  });
  {
    p.setClockForTests(() => 5000);
    const a = goal(); open(a); roots.app.children = []; p.dashboard();
    assert.ok(has('Continuar reparación')); const abandon = find('Abandonar reparación'); assert.ok(abandon, 'botón junto a Continuar reparación');
    abandon.onclick(); await settle();
    const b = goal(), eb = open(b); eb.unsupported_plan_version = true; eb.plan_version = 'repair_teaching_v99';
    const box = element('section'); p.contextScreen(box, b); const old = find('Abandonar episodio', box); assert.ok(old, 'el botón existente sigue ahí');
    old.onclick(); await settle();
    assert.deepEqual(project(a), project(b));
    assert.equal(a.repairEpisodes[0].status, 'ABANDONED'); assert.equal(a.contextStack.length, 0); assert.ok(!a.session.stuck);
    assert.equal(evidence(a).length, evidence(b).length, 'abandonar no crea evidencia');
    p.setClockForTests();
  }
  // Sin episodio abierto no hay botón de abandono.
  {
    const value = goal(); p.setStoreForTests({ goals: [value], active: value.id }); roots.app.children = []; p.dashboard();
    assert.equal(find('Abandonar reparación'), null);
  }
  console.log('stuck_exits.test.js OK');
})().catch(e => { console.error(e); process.exit(1); });
