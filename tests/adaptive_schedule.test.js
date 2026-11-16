// adaptive_schedule_v1: intervalo por tema, factor personal, crédito jerárquico (solo fechas) y tope diario.
const assert = require('node:assert/strict');

function element(type = 'div') {
  return { type, textContent: '', value: '', disabled: false, children: [], style: {}, append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); return item; }, replaceChildren(...items) { this.children = items; }, setAttribute() {}, addEventListener() {} };
}
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: id => id === 'app' ? roots.app : roots.status, createElement: type => element(type) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
global.fetch = async () => ({ ok: true, json: async () => ({ ok: true, revision: 1 }) });
console.error = () => {};

const p = require('../app.js');
const DAY = 86400000;
const T0 = Date.UTC(2026, 10, 10, 15);
let clock = T0;
p.setClockForTests(() => clock);
p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1);

const node = (id, prerequisites = [], i = 0) => ({ id, name: 'Tema ' + id, level: i, prerequisites, outcome: 'Resolver', probe: { prompt: 'Explica ' + id, kind: 'explanation' } });
const coverage = id => ({ id, name: id, status: 'UNKNOWN', confidence: 0, dimensions: ['direct_application', 'memory'].map(d => ({ id: d, name: d, required: true, status: 'UNKNOWN', evidence: [] })) });
function goal(nodes = [node('a'), node('b', ['a'])], extra = {}) {
  return { id: 'g1', profile_id: 'profile-test', goal: 'Meta', nodes, learner: {}, coverage: nodes.map(n => coverage(n.id)), events: [], reviews: [], lessons: {}, session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 }, ...extra };
}
let seq = 0;
// Evento EVIDENCE de repaso, con los campos temporales que escribe prepareRecord.
function ev(nodeId, pass, { at = T0, delay = 3, sched = 3, help = 0, conf, state = 'AFTER_DUE', cls = 'DELAYED_RETRIEVAL_OBSERVED', attempt = 'att-' + (++seq), result } = {}) {
  return { type: 'EVIDENCE', phase: 'REVIEW', node_id: nodeId, attempt_id: attempt, timestamp: at, result: result || (pass ? 'CORRECT' : 'MISCONCEPTION'), help_used: help, learner_confidence: conf, temporal_classification: cls, delay_ms_from_last_exposure: delay * DAY, last_exposure_at: at - delay * DAY, due_at: at - delay * DAY + sched * DAY, review_schedule_state: state };
}
const series = (nodeId, passes, opts = {}) => passes.map((x, i) => ev(nodeId, x, { at: T0 - (passes.length - i) * 10 * DAY, ...opts }));
const days = (g, id, step) => p.scheduleInterval(g, id, step).days;

(async () => {
  assert.equal(p.SCHEDULE_VERSION, 'adaptive_schedule_v1');
  const LADDER = [1, 3, 7, 14, 30, 60, 90];

  // 1. Compatibilidad: sin historial (o con 1 repaso válido) coincide con la escalera fija; datos legacy sin campos nuevos.
  {
    const g = goal();
    for (let s = 0; s <= 6; s++) assert.equal(days(g, 'a', s), LADDER[s], 'sin historial = escalera, peldaño ' + s);
    g.events = [ev('a', true, { delay: 7, sched: 7 })];
    for (let s = 0; s <= 6; s++) assert.equal(days(g, 'a', s), LADDER[s], 'con 1 repaso aún = escalera');
    const legacy = goal(undefined, { events: [{ type: 'EVIDENCE', phase: 'REVIEW', node_id: 'a', attempt_id: 'old1', timestamp: T0 - DAY, result: 'CORRECT' }, { type: 'TEACHING_EXPOSURE', node_id: 'a', at: T0 - 5 * DAY }, { type: 'EVIDENCE', phase: 'REVIEW', node_id: 'a', result: 'CORRECT', timestamp: T0 - 2 * DAY }], reviews: [{ id: 'a', due: T0 - DAY, step: 2, history: [] }] });
    assert.equal(p.scheduleEntries(legacy).length, 0, 'eventos sin clasificación temporal no cuentan');
    assert.equal(days(legacy, 'a', 2), 7);
    assert.equal(p.reviewReasonText(legacy.reviews[0]), 'Primer repaso: poco después de aprenderlo.');
    const q = p.reviewQueue(legacy, T0);
    assert.deepEqual(q.today, ['a']);
    const restored = p.normalizeImportedStore(JSON.parse(JSON.stringify({ goals: [legacy], active: 'g1' })));
    assert.equal(restored.goals[0].reviews[0].schedule_note, undefined, 'no se inventan campos');
  }

  // 2. Crecimiento: aciertos a tiempo crecen; llegar tarde y acertar crece más; un tema difícil crece menos.
  {
    const base = goal(); base.events = series('a', [true, true, true]);
    const late = goal(); late.events = series('a', [true, true, true], { delay: 6, sched: 3 });
    const hard = goal(); hard.events = [...series('a', [false, false]), ...series('a', [true, true, true]).map((e, i) => ({ ...e, timestamp: T0 + i * DAY, last_exposure_at: T0 + i * DAY - 3 * DAY, due_at: T0 + i * DAY }))];
    const sBase = p.scheduleNodeModel(p.scheduleEntries(base)).stretch, sLate = p.scheduleNodeModel(p.scheduleEntries(late)).stretch;
    assert.ok(sBase > 1, 'acierto a tiempo estira');
    assert.ok(sLate > sBase, 'acertar tarde estira más');
    const fresh = goal(); fresh.events = series('a', [true, true]);
    assert.ok(days(base, 'a', 3) > days(fresh, 'a', 3) || days(base, 'a', 3) > 14);
    // mismo número de aciertos, pero con dificultad alta: crece menos que con dificultad baja
    const easy = p.scheduleNodeModel(p.scheduleEntries(Object.assign(goal(), { events: series('a', [true, true, true, true]) })));
    const hardModel = p.scheduleNodeModel([{ pass: false, conf: null, late: 1 }, { pass: true, conf: null, late: 1 }, { pass: true, conf: null, late: 1 }]);
    assert.ok(hardModel.difficulty > easy.difficulty);
    assert.ok(hardModel.stretch < easy.stretch);
    assert.ok(hard.events.length === 5);
    // límites duros
    const many = goal(); many.events = series('a', Array(40).fill(true), { delay: 20, sched: 5 });
    assert.ok(p.scheduleNodeModel(p.scheduleEntries(many)).stretch <= 2);
    assert.ok(days(many, 'a', 6) <= 180);
    const cfg = goal(undefined, { schedule_config: { max_days: 100 } }); cfg.events = many.events;
    assert.ok(days(cfg, 'a', 6) <= 100, 'máximo configurable');
    const bad = goal(undefined, { schedule_config: { max_days: 'x', daily_cap: -3 } });
    assert.equal(p.scheduleConfig(bad).max_days, 180);
    const worst = goal(); worst.events = series('a', Array(20).fill(false));
    assert.equal(p.scheduleNodeModel(p.scheduleEntries(worst)).stretch, 0.5);
    assert.equal(days(worst, 'a', 0), 1, 'mínimo 1 día');
  }

  // 3. Fallo: baja la estabilidad y sube la dificultad; sin volver siempre a 1 día con historial largo.
  {
    const g = goal(); g.events = series('a', [true, true, true, true]);
    const before = days(g, 'a', 4);
    g.events.push(ev('a', false, { at: T0 }));
    const after = p.scheduleInterval(g, 'a', Math.floor(4 / 2));
    assert.ok(p.scheduleNodeModel(p.scheduleEntries(g)).stretch < p.scheduleNodeModel(p.scheduleEntries(Object.assign(goal(), { events: series('a', [true, true, true, true]) }))).stretch);
    assert.ok(after.days > 1 && after.days < before, 'historial largo: baja pero no a 1 día');
    assert.ok(after.difficulty > 0.2);
    assert.equal(p.nextReviewStep(4, false, 0, null), 2, 'la escalera sigue retrocediendo a la mitad');
  }

  // 4. Ayuda no alarga; UNKNOWN, inmediato o inválido no cambian nada; duplicados no cuentan dos veces.
  {
    const g = goal(); g.events = series('a', [true, true]);
    const ref = JSON.stringify(p.scheduleInterval(g, 'a', 3));
    g.events.push(ev('a', true, { help: 1, cls: 'DELAY_UNVERIFIABLE', attempt: 'help1' }));
    g.events.push(ev('a', true, { help: 1, attempt: 'help2' }));
    g.events.push(ev('a', true, { result: 'UNKNOWN', attempt: 'unk1' }));
    g.events.push(ev('a', true, { cls: 'PRACTICE_IMMEDIATE', attempt: 'imm1' }));
    g.events.push({ ...ev('a', true, { attempt: 'aud1' }), audit_only: true });
    g.events.push({ ...ev('a', true, { attempt: 'noat' }), attempt_id: undefined });
    assert.equal(JSON.stringify(p.scheduleInterval(g, 'a', 3)), ref, 'ni ayuda, ni UNKNOWN, ni inmediato, ni auditoría cambian el intervalo');
    const dup = goal(); dup.events = series('a', [true, true]);
    const once = p.scheduleInterval(dup, 'a', 3).node_reviews;
    dup.events.push({ ...dup.events[1] }, { ...dup.events[0] });
    assert.equal(p.scheduleInterval(dup, 'a', 3).node_reviews, once, 'mismo intento no cuenta dos veces');
    const fragile = goal(); fragile.events = [...series('a', [true, true]), ev('a', true, { conf: 20 })];
    assert.equal(p.scheduleInterval(fragile, 'a', 3).stretch, p.scheduleInterval(Object.assign(goal(), { events: series('a', [true, true]) }), 'a', 3).stretch, 'acierto frágil no estira');
    // una corrección que sustituye el evento deja de contar el original
    const corr = goal(); const e1 = { ...ev('a', true, { at: T0 - 20 * DAY }), evidence_id: 'E1' }, e2 = ev('a', true, { at: T0 - 10 * DAY });
    corr.events = [e1, e2, { ...ev('a', false, { at: T0 - 5 * DAY, attempt: 'fix' }), correction_of: 'E1' }];
    assert.equal(p.scheduleEntries(corr).length, 2);
  }

  // 5. Aislamiento por perfil/meta: los eventos de otra meta no afectan.
  {
    const a = goal(), b = Object.assign(goal(), { id: 'g2', profile_id: 'otro' });
    b.events = series('a', Array(30).fill(true), { delay: 9, sched: 3 });
    assert.equal(days(a, 'a', 3), 14);
    assert.equal(p.schedulePersonal(a).n, 0);
    assert.ok(p.schedulePersonal(b).n >= 20);
  }

  // 6. Factor personal: <20 repasos = 1,0; alto acierto alarga; fallo acorta; límites 0,6–1,6; los repasos anticipados no cuentan.
  {
    const g = goal();
    g.events = Array.from({ length: 19 }, (_, i) => ev('a', true, { at: T0 - (40 - i) * DAY }));
    assert.equal(p.schedulePersonal(g).factor, 1);
    assert.equal(p.schedulePersonal(g).active, false);
    assert.match(p.personalText(p.schedulePersonal(g)), /aún ninguno.*19 de 20/);
    g.events.push(ev('a', true, { at: T0 - DAY }));
    const hi = p.schedulePersonal(g);
    assert.equal(hi.active, true); assert.ok(hi.factor > 1 && hi.factor <= 1.6); assert.equal(hi.n, 20);
    const lo = goal(); lo.events = Array.from({ length: 24 }, (_, i) => ev('a', i % 2 === 0, { at: T0 - (50 - i) * DAY }));
    assert.equal(p.schedulePersonal(lo).factor, 0.6);
    const mid = goal(); mid.events = Array.from({ length: 20 }, (_, i) => ev('a', i % 8 !== 0, { at: T0 - (50 - i) * DAY }));
    assert.ok(p.schedulePersonal(mid).factor > 0.6 && p.schedulePersonal(mid).factor < 1.1);
    const early = goal(); early.events = Array.from({ length: 30 }, (_, i) => ev('a', true, { at: T0 - (60 - i) * DAY, state: 'BEFORE_DUE' }));
    assert.equal(p.schedulePersonal(early).active, false, 'repasos anticipados no cuentan como vencidos');
    assert.ok(days(g, 'a', 3) >= 14 && p.scheduleInterval(g, 'a', 3).personal_factor === hi.factor);
    assert.ok(p.scheduleInterval(lo, 'a', 3).days < 14);
  }

  // 7. Determinismo: mismas entradas, mismo resultado; el orden de los eventos no importa.
  {
    const g = goal(); g.events = series('a', [true, false, true, true, true]);
    const r1 = JSON.stringify([p.scheduleInterval(g, 'a', 3), p.schedulePersonal(g), p.reviewQueue(g, T0)]);
    const shuffled = Object.assign(goal(), { events: [...g.events].reverse() });
    assert.equal(JSON.stringify([p.scheduleInterval(shuffled, 'a', 3), p.schedulePersonal(shuffled), p.reviewQueue(shuffled, T0)]), r1);
    assert.equal(JSON.stringify([p.scheduleInterval(g, 'a', 3), p.schedulePersonal(g), p.reviewQueue(g, T0)]), r1);
  }

  // 8. Integración: responder un repaso vencido fija la fecha, guarda el motivo y no cambia nada con UNKNOWN.
  function reviewGoal(nodes, reviews) {
    const g = goal(nodes);
    for (const r of reviews) {
      const rev = { id: r.id, due: r.due, step: r.step ?? 0, history: [], question: null, origin_attempt_id: 'o-' + r.id, origin_at: r.last, last_exposure_at: r.last, scheduled_at: r.last, presented_at: null, answered_at: null, target_dimension: 'memory', temporal_policy_version: 'delayed_review_v1', exposure_before_response: false };
      g.reviews.push(rev);
    }
    p.setStoreForTests({ goals: [g], active: g.id });
    return g;
  }
  const act = (id, nodeId) => p.activityContract({ activity_id: 'r-' + id, node_id: nodeId, stage: 'REVIEW', kind: 'recall', prompt: 'Recuerda ' + nodeId, reference: 'x', observable_dimensions: ['memory'] }, nodeId, 'spaced_review');
  const res = (a, id, status = 'CORRECT') => ({ status, error_type: 'none', feedback: 'ok', hint: '', _activity: a, _attempt_id: id });
  function open(g, id) { const r = g.reviews.find(x => x.id === id); r.question = { prompt: 'Recuerda ' + id, reference: 'x', kind: 'recall', observable_dimensions: ['memory'] }; g.session = { mode: 'REVIEW', node: id, stack: [], tries: 0, hints: 0 }; }
  {
    clock = T0;
    const g = reviewGoal([node('a'), node('b', ['a'])], [{ id: 'a', due: T0 + 2 * DAY, step: 2, last: T0 - 5 * DAY }, { id: 'b', due: T0 - 1 * DAY, step: 2, last: T0 - 8 * DAY }]);
    // UNKNOWN no cambia el calendario
    open(g, 'b'); const snap = JSON.stringify(g.reviews.map(r => ({ ...r, question: null })));
    p.applyResult(g, 'b', 'REVIEW', 'no sé', res(act('b1', 'b'), 'u1', 'UNKNOWN'));
    assert.equal(JSON.stringify(g.reviews.map(r => ({ ...r, question: null }))), snap, 'UNKNOWN no cambia nada');
    // acierto independiente tras el vencimiento: peldaño +1 y fecha = escalera (sin historial suficiente)
    p.applyResult(g, 'b', 'REVIEW', 'respuesta', res(act('b2', 'b'), 'b-ok'));
    const rb = g.reviews.find(r => r.id === 'b');
    assert.equal(rb.step, 3);
    assert.equal(rb.due, T0 + 14 * DAY, 'sin historial suficiente = escalera fija');
    assert.equal(rb.schedule_note.interval_days, 14);
    assert.match(rb.schedule_note.reason, /^Acertaste tras 8 días → 14 días\.$/);
    assert.equal(p.reviewReasonText(rb), rb.schedule_note.reason);
    assert.throws(() => p.applyResult(g, 'b', 'REVIEW', 'respuesta', res(act('b2', 'b'), 'b-ok')), /DUPLICATE|ya fue aplicado/);
    assert.equal(g.events.filter(e => e.attempt_id === 'b-ok').length, 1);
  }

  // 9. Ayuda en un repaso: no alarga (peldaño y fecha iguales a la escalera sin subir).
  {
    clock = T0;
    const g = reviewGoal([node('a'), node('b', ['a'])], [{ id: 'a', due: T0 + 1 * DAY, step: 2, last: T0 - 6 * DAY }, { id: 'b', due: T0 - DAY, step: 2, last: T0 - 8 * DAY }]);
    open(g, 'b'); g.session.hints = 1;
    p.applyResult(g, 'b', 'REVIEW', 'respuesta', res(act('b3', 'b'), 'b-help'));
    const rb = g.reviews.find(r => r.id === 'b'), ea = g.events.find(e => e.attempt_id === 'b-help');
    assert.equal(ea.is_independent, false);
    assert.equal(rb.step, 2, 'con ayuda no sube');
    assert.equal(rb.due, T0 + 7 * DAY);
    assert.match(rb.schedule_note.reason, /Acertaste con ayuda: no alarga/);
    assert.equal(g.reviews.find(r => r.id === 'a').due, T0 + DAY, 'con ayuda no hay crédito jerárquico');
    assert.equal(g.events.some(e => e.type === 'REVIEW_DEFERRED'), false);
  }

  // 10. Crédito jerárquico: solo pospone la fecha del prerrequisito directo; no crea evidencia ni toca otra meta.
  {
    clock = T0;
    const other = Object.assign(goal([node('a'), node('z', ['a'])]), { id: 'g2', reviews: [{ id: 'a', due: T0 + DAY, step: 3, history: [] }] });
    const g = reviewGoal([node('a'), node('b', ['a']), node('c', ['b'])], [{ id: 'a', due: T0 + 2 * DAY, step: 4, last: T0 - 28 * DAY }, { id: 'b', due: T0 - DAY, step: 2, last: T0 - 8 * DAY }, { id: 'c', due: T0 + 3 * DAY, step: 2, last: T0 - 4 * DAY }]);
    p.setStoreForTests({ goals: [g, other], active: g.id });
    g.relations = [{ id: 'rel', from: 'a' }];
    const otherSnap = JSON.stringify(other);
    const a0 = JSON.parse(JSON.stringify(g.reviews.find(r => r.id === 'a'))), c0 = JSON.stringify(g.reviews.find(r => r.id === 'c')), cov0 = JSON.stringify(g.coverage.filter(c => c.id !== 'b')), learner0 = JSON.stringify(g.learner.a ?? null), evidence0 = g.events.filter(e => e.type === 'EVIDENCE').length;
    open(g, 'b');
    p.applyResult(g, 'b', 'REVIEW', 'respuesta', res(act('b4', 'b'), 'b-credit'));
    const ra = g.reviews.find(r => r.id === 'a');
    assert.ok(ra.due > a0.due, 'el repaso del prerrequisito se pospone');
    assert.ok(ra.due - a0.due >= DAY, 'al menos un día')
    assert.ok(ra.due - a0.due <= 14 * DAY + 0, 'tope de 14 días');
    for (const k of ['step', 'history', 'question', 'last_exposure_at', 'answered_at', 'origin_at', 'origin_attempt_id', 'scheduled_at']) assert.deepEqual(ra[k], a0[k], k + ' del prerrequisito intacto');
    assert.equal(ra.deferrals.length, 1);
    assert.match(ra.deferrals[0].reason, /^Aplazado \d+ días? porque practicaste «Tema b»/);
    assert.equal(p.reviewReasonText(ra), ra.deferrals[0].reason);
    assert.equal(JSON.stringify(g.reviews.find(r => r.id === 'c')), c0, 'el tema que depende de b (no su prerrequisito) no se toca');
    assert.equal(JSON.stringify(g.coverage.filter(c => c.id !== 'b')), cov0, 'cobertura del prerrequisito y de los demás temas intacta'); assert.equal(JSON.stringify(g.learner.a ?? null), learner0);
    assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, evidence0 + 1, 'solo el intento de b');
    assert.equal(g.events.filter(e => e.type === 'EVIDENCE' && e.node_id === 'a').length, 0, 'sin evidencia a nombre del prerrequisito');
    const def = g.events.filter(e => e.type === 'REVIEW_DEFERRED');
    assert.equal(def.length, 1); assert.equal(def[0].creates_evidence, false); assert.equal(def[0].review_node_id, 'a'); assert.equal(def[0].source_attempt_id, 'b-credit'); assert.equal(def[0].node_id, undefined);
    assert.equal(JSON.stringify(other), otherSnap, 'otra meta intacta');
    // idempotente: reaplicar el mismo intento no duplica
    const again = p.creditPrerequisites(g, 'b', g.events.find(e => e.attempt_id === 'b-credit'));
    assert.equal(again.length, 0); assert.equal(ra.deferrals.length, 1);
    // tope por ciclo: a lo más 2 aplazamientos
    for (const [i, id] of ['x1', 'x2'].entries()) p.creditPrerequisites(g, 'b', { ...g.events.find(e => e.attempt_id === 'b-credit'), attempt_id: id });
    assert.ok(ra.deferrals.length <= 2);
    assert.ok(ra.deferrals.reduce((s, d) => s + d.days, 0) <= 28, 'suma acotada por el intervalo original');
  }

  // 11. Crédito: un fallo en el avanzado no toca al prerrequisito; una relación entre metas no da crédito; fuera de ventana no se mueve.
  {
    const g = reviewGoal([node('a'), node('b', ['a'])], [{ id: 'a', due: T0 + 2 * DAY, step: 4, last: T0 - 28 * DAY }, { id: 'b', due: T0 - DAY, step: 3, last: T0 - 20 * DAY }]);
    const a0 = JSON.stringify(g.reviews.find(r => r.id === 'a'));
    const failed = { ...ev('b', false, { at: T0, attempt: 'bf' }), result: 'MISCONCEPTION' };
    assert.equal(p.creditPrerequisites(g, 'b', failed).length, 0);
    const conf = { ...ev('b', true, { at: T0, attempt: 'bc', conf: 10 }) };
    assert.equal(p.creditPrerequisites(g, 'b', conf).length, 0, 'acierto frágil no da crédito');
    assert.equal(p.creditPrerequisites(g, 'b', ev('b', true, { at: T0, attempt: 'bi', cls: 'PRACTICE_IMMEDIATE' })).length, 0);
    assert.equal(JSON.stringify(g.reviews.find(r => r.id === 'a')), a0);
    g.reviews.find(r => r.id === 'a').due = T0 + 60 * DAY; const far = JSON.stringify(g.reviews.find(r => r.id === 'a'));
    assert.equal(p.creditPrerequisites(g, 'b', ev('b', true, { at: T0, attempt: 'bz' })).length, 0, 'fuera de la ventana no se mueve');
    assert.equal(JSON.stringify(g.reviews.find(r => r.id === 'a')), far);
    // prerrequisito que no es del mapa de la meta (otra meta) no se acredita
    const ghost = reviewGoal([node('a'), node('b', ['otra-meta-n'])], [{ id: 'a', due: T0 + DAY, step: 4, last: T0 - 20 * DAY }, { id: 'b', due: T0, step: 3, last: T0 - 20 * DAY }]);
    assert.equal(p.creditPrerequisites(ghost, 'b', ev('b', true, { at: T0, attempt: 'bg' })).length, 0);
  }

  // 12. Tope diario: nada se pierde; prioriza por retraso relativo y por prerrequisitos de lo que se estudia; reparte lo demás.
  {
    const nodes = Array.from({ length: 12 }, (_, i) => node('n' + i, i === 11 ? ['n3'] : []));
    const g = goal(nodes);
    g.reviews = nodes.map((n, i) => ({ id: n.id, due: T0 - (i + 1) * 3600000, step: 0, history: [], last_exposure_at: T0 - (i + 1) * 3600000 - DAY, scheduled_at: T0 - DAY * 2 }));
    g.reviews[5].due = T0 - 20 * DAY; g.reviews[5].last_exposure_at = T0 - 22 * DAY; // muy vencido
    g.reviews[3].due = T0 - 2 * 3600000;
    const q = p.reviewQueue(g, T0);
    assert.equal(q.cap, 5); assert.equal(q.due_total, 12); assert.equal(q.today.length, 5); assert.equal(q.later.length, 7);
    assert.equal(new Set([...q.today, ...q.later.map(x => x.id)]).size, 12, 'no se pierde ninguno');
    assert.ok(q.today.includes('n5'), 'el más vencido en relación a su intervalo entra');
    assert.match(p.queueText(q), /^12 repasos vencidos; hoy van 5 \(7 quedan pendientes para los días siguientes, según prioridad y sin fecha comprometida\)\.$/);
    assert.ok(q.later.every(x => /^\d{4}-\d\d-\d\d$/.test(x.estimated_for)));
    assert.equal(q.later.filter(x => x.estimated_for === q.later[0].estimated_for).length, 5, 'reparto de a tope por día');
    const f = p.reviewQueue(g, T0, { focus: 'n11' });
    assert.ok(f.today.includes('n3'), 'prerrequisito de lo que se estudia ahora tiene prioridad');
    // sin desborde: orden histórico due,id y nada cambia
    const small = goal(nodes.slice(0, 3)); small.reviews = g.reviews.slice(0, 3).map(r => ({ ...r }));
    assert.deepEqual(p.reviewQueue(small, T0).today, [...small.reviews].sort((a, b) => a.due - b.due || a.id.localeCompare(b.id)).map(r => r.id));
    assert.match(p.queueText(p.reviewQueue(small, T0)), /^3 repasos vencidos; hoy van 3\.$/);
    // el calendario guardado no se reescribe
    assert.deepEqual(g.reviews.map(r => r.due), nodes.map((n, i) => i === 5 ? T0 - 20 * DAY : i === 3 ? T0 - 2 * 3600000 : T0 - (i + 1) * 3600000));
    // lo ya respondido hoy consume el cupo; la meta diaria define el tope; configurable
    const done = goal(nodes); done.reviews = g.reviews.map(r => ({ ...r })); done.events = Array.from({ length: 5 }, (_, i) => ev('n' + i, true, { at: T0 - 1000, attempt: 'd' + i }));
    const qd = p.reviewQueue(done, T0);
    assert.equal(qd.remaining, 0); assert.equal(qd.today.length, 0); assert.equal(qd.later.length, 12);
    assert.match(p.queueText(qd), /ya hiciste 5 hoy/);
    const capped = goal(nodes, { schedule_config: { daily_cap: 2 } }); capped.reviews = g.reviews.map(r => ({ ...r }));
    assert.equal(p.reviewQueue(capped, T0).today.length, 2);
    // consumidores: sesión de hoy y selector respetan el tope
    const plan = p.buildDailyPlan(g, T0).filter(b => b.kind === 'review');
    assert.ok(plan.length <= 3 && plan.every(b => q.today.includes(b.node_id)));
  }

  // 13. Texto visible: próximos repasos con motivo y panel sin escribir nada.
  {
    const g = reviewGoal([node('a'), node('b')], [{ id: 'a', due: T0 + 5 * DAY, step: 1, last: T0 - DAY }, { id: 'b', due: T0 + 9 * DAY, step: 2, last: T0 }]);
    const up = p.upcomingReviews(g, T0);
    assert.deepEqual(up.map(u => u.id), ['a', 'b']); assert.ok(up.every(u => u.reason.length > 5));
    const before = JSON.stringify(g);
    const box = element('section'); p.schedulePanel(box, g);
    assert.equal(JSON.stringify(g), before, 'pintar el calendario no escribe nada');
    const text = JSON.stringify(box.children);
    assert.match(text, /Tema a/); assert.match(text, /Ajuste personal/);
    const sum = p.scheduleSummary(g, T0); assert.equal(sum.personal.factor, 1);
    const rep = p.usageReport(g, T0); assert.equal(rep.schedule.cap, 5);
  }

  // 14. Corrección manual de un repaso: revoca aplazamientos, conserva los datos temporales y limpia la nota.
  {
    clock = T0;
    const mk = () => reviewGoal([node('a'), node('b', ['a'])], [{ id: 'a', due: T0 + 2 * DAY, step: 4, last: T0 - 28 * DAY }, { id: 'b', due: T0 - DAY, step: 2, last: T0 - 8 * DAY }]);
    const g = mk(); open(g, 'b');
    const a1 = act('b9', 'b'), assess = res(a1, 'b-fix');
    const fromDue = g.reviews.find(r => r.id === 'a').due;
    p.applyResult(g, 'b', 'REVIEW', 'respuesta', assess);
    const ra = g.reviews.find(r => r.id === 'a');
    assert.ok(ra.due > fromDue && g.reviews.find(r => r.id === 'b').schedule_note);
    p.applyManualCorrection(g, 'b', 'REVIEW', 'respuesta', assess, 'CORRECT', 'fix-same');
    assert.ok(ra.due > fromDue, 'seguir siendo acierto válido conserva el aplazamiento');
    const g2 = mk(); open(g2, 'b'); const as2 = res(act('b9', 'b'), 'b-fix2');
    p.applyResult(g2, 'b', 'REVIEW', 'respuesta', as2);
    const ra2 = g2.reviews.find(r => r.id === 'a'), evidenceBefore = g2.events.filter(e => e.type === 'EVIDENCE').length;
    p.applyManualCorrection(g2, 'b', 'REVIEW', 'respuesta', as2, 'MISCONCEPTION', 'fix-2');
    assert.equal(ra2.due, fromDue, 'la corrección a fallo devuelve la fecha original');
    assert.deepEqual(ra2.deferrals, []);
    const rev = g2.events.filter(e => e.type === 'REVIEW_DEFERRAL_REVOKED');
    assert.equal(rev.length, 1); assert.equal(rev[0].creates_evidence, false); assert.equal(rev[0].node_id, undefined); assert.equal(rev[0].source_attempt_id, 'b-fix2');
    assert.equal(g2.events.filter(e => e.type === 'EVIDENCE' && e.node_id === 'a').length, 0);
    assert.ok(g2.events.filter(e => e.type === 'EVIDENCE').length > evidenceBefore, 'la corrección sí es evidencia del tema corregido');
    const corrected = g2.events.find(e => e.type === 'EVIDENCE' && e.attempt_id === 'fix-2'), original = g2.events.find(e => e.attempt_id === 'b-fix2');
    for (const k of ['temporal_classification', 'delay_ms_from_last_exposure', 'due_at', 'review_schedule_state']) assert.equal(corrected[k], original[k], k + ' se conserva');
    assert.equal(corrected.temporal_classification, 'DELAYED_RETRIEVAL_OBSERVED');
    const entries = p.scheduleEntries(g2).filter(e => e.node_id === 'b');
    assert.equal(entries.length, 1); assert.equal(entries[0].pass, false, 'el repaso corregido sigue en el modelo, como fallo');
    assert.equal(g2.reviews.find(r => r.id === 'b').schedule_note, undefined, 'nota obsoleta eliminada');
    assert.match(p.reviewReasonText(g2.reviews.find(r => r.id === 'b')), /escalera/);
  }

  // 15. Selector con tope: toma el primer repaso ofrecible aunque los primeros de la cola hayan tenido exposición reciente.
  const bigGoal = (n, extra = {}) => {
    const nodes = Array.from({ length: n }, (_, i) => node('n' + i, []));
    const g = goal(nodes, extra);
    g.reviews = nodes.map((nd, i) => ({ id: nd.id, due: T0 - (i + 1) * DAY, step: 0, history: [], last_exposure_at: T0 - (i + 3) * DAY, scheduled_at: T0 - (i + 3) * DAY }));
    g.events = nodes.map((nd, i) => ({ type: 'TEACHING_EXPOSURE', node_id: nd.id, at: i >= 5 ? T0 - 3600000 : T0 - 6 * DAY }));
    p.setStoreForTests({ goals: [g], active: g.id });
    return g;
  };
  {
    clock = T0;
    const g = bigGoal(8, { schedule_config: { daily_cap: 3 } });
    const q = p.reviewQueue(g, T0, { focus: null });
    assert.equal(q.today.length, 3);
    const d = p.selectTutorAction(g, T0);
    assert.equal(d.action, 'REVIEW');
    assert.ok(!['n5', 'n6', 'n7'].includes(d.node_id), 'no ofrece los de exposición reciente');
    assert.equal(d.node_id, q.offer.find(id => !['n5', 'n6', 'n7'].includes(id)));
    // con el cupo agotado el selector automático no ofrece repaso, pero «siete minutos» sí
    const done = bigGoal(8, { schedule_config: { daily_cap: 3 } });
    done.events.push(...['n0', 'n1', 'n2'].map((id, i) => ev(id, true, { at: T0 - 1000, attempt: 'cap' + i })));
    assert.notEqual(p.selectTutorAction(done, T0).action, 'REVIEW');
    p.startBrief(done); assert.equal(done.session.mode, 'REVIEW'); assert.ok(done.session.node);
    // coherencia: plan diario, selector, «siete minutos» y cola abren el mismo primer repaso
    const g2 = bigGoal(8, { schedule_config: { daily_cap: 3 } });
    g2.events = g2.events.map(e => ({ ...e, at: T0 - 6 * DAY }));
    const q2 = p.reviewQueue(g2, T0);
    assert.equal(p.selectTutorAction(g2, T0).node_id, q2.offer[0]);
    const planFirst = p.buildDailyPlan(g2, T0).find(b => b.kind === 'review').node_id;
    assert.equal(planFirst, q2.offer[0]);
    p.startBrief(g2); assert.equal(g2.session.node, q2.offer[0]);
    assert.equal(p.usageReport(g2, T0).reviews.due, 8);
    g2.reviews.push({ id: 'fantasma', due: T0 - DAY, step: 0, history: [] });
    assert.equal(p.usageReport(g2, T0).reviews.due, 8, 'repasos de nodos inexistentes no cuentan');
  }

  // 16. Importación malformada: deferrals/schedule_note saneados.
  {
    const raw = goal(); raw.reviews = [{ id: 'a', due: T0, step: 0, history: [], deferrals: {}, schedule_note: 'x' }, { id: 'b', due: T0, step: 0, history: [], deferrals: [null, { from_due: 1, to_due: 'x', days: 1, at: 1 }, { from_due: 1, to_due: 2, days: 1, at: 3, reason: 'y'.repeat(900) }], schedule_note: { reason: 7, due: 'mañana' } }];
    const out = p.normalizeImportedStore(JSON.parse(JSON.stringify({ goals: [raw], active: 'g1' }))).goals[0].reviews;
    assert.deepEqual(out[0].deferrals, []); assert.equal(out[0].schedule_note, null);
    assert.equal(out[1].deferrals.length, 1); assert.equal(out[1].deferrals[0].reason.length, 200);
    assert.equal(out[1].schedule_note.reason, ''); assert.equal(out[1].schedule_note.due, undefined);
    assert.doesNotThrow(() => p.reviewReasonText(out[0])); assert.doesNotThrow(() => p.reviewQueue(Object.assign(goal(), { reviews: out }), T0));
  }

  // 17. Motivo desfasado: tras lapseReview, «No recuerdo» o la escalera, no se muestra el motivo anterior.
  {
    clock = T0;
    const g = reviewGoal([node('a'), node('b', ['a'])], [{ id: 'a', due: T0 + 2 * DAY, step: 4, last: T0 - 28 * DAY }, { id: 'b', due: T0 - DAY, step: 2, last: T0 - 8 * DAY }]);
    open(g, 'b'); p.applyResult(g, 'b', 'REVIEW', 'respuesta', res(act('b7', 'b'), 'b-stale'));
    const rb = g.reviews.find(r => r.id === 'b'), ra = g.reviews.find(r => r.id === 'a');
    assert.match(p.reviewReasonText(rb), /^Acertaste/); assert.match(p.reviewReasonText(ra), /^Aplazado/);
    p.lapseReview(g, 'b', T0); assert.doesNotMatch(p.reviewReasonText(rb), /^Acertaste/); assert.match(p.reviewReasonText(rb), /escalera/);
    p.lapseReview(g, 'a', T0); assert.doesNotMatch(p.reviewReasonText(ra), /Aplazado/);
    const ra2 = JSON.parse(JSON.stringify(ra)); ra2.due = T0 + 1 * DAY; ra2.step = 0; // «No recuerdo»
    assert.doesNotMatch(p.reviewReasonText({ ...ra2, deferrals: [{ ...ra.deferrals[0] ?? { to_due: 1, reason: 'Aplazado' } }] }), /^Aplazado/);
    const l = { id: 'b', due: T0 + 9 * DAY, step: 3, history: [{ attempt_id: 'b-stale' }], schedule_note: { attempt_id: 'b-stale', due: T0 + 14 * DAY, reason: 'Acertaste → 14 días.' }, deferrals: [] };
    assert.doesNotMatch(p.reviewReasonText(l), /Acertaste/);
    const g3 = reviewGoal([node('a')], [{ id: 'a', due: T0 + 5 * DAY, step: 3, last: T0 - 10 * DAY }]);
    g3.reviews[0].history.push({ attempt_id: 'x' }); g3.reviews[0].schedule_note = { attempt_id: 'x', due: T0 + 5 * DAY, reason: 'Acertaste → 5 días.' };
    assert.match(p.reviewReasonText(g3.reviews[0]), /^Acertaste/);
    p.ladderReschedule(g3, { phase: 'REVIEW', node_id: 'a' }, {}); // la fase REVIEW no reprograma
    assert.match(p.reviewReasonText(g3.reviews[0]), /^Acertaste/);
    clock = T0; p.ladderReschedule(g3, { phase: 'GUIDED', node_id: 'a' }, {}); // reprograma con lapseReview
    assert.doesNotMatch(p.reviewReasonText(g3.reviews[0]), /^Acertaste/);
  }

  // 18. Cupo diario: las correcciones y la auditoría no cuentan dos veces.
  {
    const nodes = Array.from({ length: 6 }, (_, i) => node('n' + i));
    const g = goal(nodes, { schedule_config: { daily_cap: 3 } });
    g.reviews = nodes.map(n => ({ id: n.id, due: T0 - DAY, step: 0, history: [] }));
    const e1 = { ...ev('n0', true, { at: T0 - 1000, attempt: 'c1' }), evidence_id: 'E-c1' };
    g.events = [e1, { ...ev('n0', false, { at: T0 - 500, attempt: 'c1b' }), correction_of: 'E-c1' }, { ...ev('n1', true, { at: T0 - 400, attempt: 'au' }), audit_only: true }];
    assert.equal(p.reviewQueue(g, T0).done_today, 1);
  }

  // 19. Aging: un repaso largo muy vencido no queda detrás de los cortos indefinidamente.
  {
    const nodes = Array.from({ length: 8 }, (_, i) => node('n' + i));
    const g = goal(nodes, { schedule_config: { daily_cap: 3 } });
    g.reviews = nodes.map((n, i) => ({ id: n.id, due: T0 - 2 * DAY, step: 0, history: [], last_exposure_at: T0 - 3 * DAY, scheduled_at: T0 - 3 * DAY }));
    g.reviews[7] = { id: 'n7', due: T0 - 30 * DAY, step: 6, history: [], last_exposure_at: T0 - 120 * DAY, scheduled_at: T0 - 120 * DAY };
    assert.ok(p.reviewQueue(g, T0, { focus: null }).today.includes('n7'));
  }

  // 20. Un prerrequisito aplazado y respondido en su fecha original no queda como anticipado.
  {
    clock = T0;
    const g = reviewGoal([node('a'), node('b', ['a'])], [{ id: 'a', due: T0 + 2 * DAY, step: 4, last: T0 - 28 * DAY }, { id: 'b', due: T0 - DAY, step: 2, last: T0 - 8 * DAY }]);
    open(g, 'b'); p.applyResult(g, 'b', 'REVIEW', 'respuesta', res(act('b8', 'b'), 'b-orig'));
    const ra = g.reviews.find(r => r.id === 'a'), orig = ra.deferrals[0].from_due;
    assert.ok(ra.due > orig);
    clock = orig + 3600000; open(g, 'a');
    p.applyResult(g, 'a', 'REVIEW', 'respuesta', res(act('a8', 'a'), 'a-orig'));
    const e = g.events.find(x => x.attempt_id === 'a-orig');
    assert.equal(e.review_schedule_state, 'AFTER_DUE', 'se evalúa contra la fecha original');
    assert.equal(e.due_at, orig);
    assert.equal(p.scheduleEntries(g).filter(x => x.node_id === 'a')[0].state, 'AFTER_DUE');
    assert.deepEqual(ra.deferrals, [], 'al responder se reinician los aplazamientos');
    clock = T0;
  }

  // 21. Recuperación: 3 fallos iniciales + 8 aciertos limpios no pesan para siempre; el redondeo es a milésimas.
  {
    const g = goal(); g.events = series('a', [false, false, false, ...Array(8).fill(true)]);
    const m = p.scheduleNodeModel(p.scheduleEntries(g));
    assert.ok(m.stretch >= 1, 'se recupera: ' + m.stretch);
    assert.equal(m.stretch, Math.round(m.stretch * 1000) / 1000);
    const lone = p.scheduleNodeModel(p.scheduleEntries(Object.assign(goal(), { events: series('a', [false, false, false, true, true]) })));
    assert.ok(lone.stretch < 1, 'aún con pocos aciertos sigue por debajo');
    const old = goal(); old.events = series('a', [false, false, false, false, false, false, ...Array(12).fill(true)]);
    assert.ok(p.scheduleNodeModel(p.scheduleEntries(old)).stretch >= 1, 'solo pesan las últimas 12 entradas');
    assert.ok(p.schedulePersonal(Object.assign(goal(), { events: Array.from({ length: 30 }, (_, i) => ev('a', true, { at: T0 - (60 - i) * DAY })) })).factor <= 1.25, 'máximo real del factor personal 1,25');
  }

  console.log('adaptive_schedule.test.js OK');
})().catch(e => { console.error = console.log; console.error(e); process.exit(1); });
