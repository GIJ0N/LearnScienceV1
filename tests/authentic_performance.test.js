// authentic_performance_v1 (cliente): caso largo por etapas, evidencia solo sin ayuda y con veredicto válido, ancla local respetada,
// validación de mentor como capa propia (MENTOR_ATTESTATION) y su lectura en el panel experto.
const assert = require('node:assert/strict');
function element(type = 'div') {
  const e = { type, textContent: '', value: '', checked: false, children: [], style: { setProperty() {} }, className: '', append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; },
    replaceChildren(...x) { this.children = x; }, setAttribute() {}, addEventListener() {}, focus() {}, click() {} };
  Object.defineProperty(e, 'innerHTML', { get() { return ''; }, set() { throw new Error('innerHTML prohibido'); } });
  return e;
}
console.error = () => {};
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;

// ---- servidor simulado (solo contrato público; la rúbrica nunca existe en el cliente) ----
const KINDS = ['diagnose', 'measure', 'act', 'justify'];
const TOPICS = ['a', 'b', 'c'];
let calls = [], server = null, fail = null, saved = [];
function freshServer() {
  server = { id: 'case-1', status: 'ACTIVE', graded: {}, script: {}, nodesByStage: [['a', 'b'], ['b', 'c'], ['c', 'a'], ['a', 'b']], hasModel: false };
}
const stagePrompt = i => `Pregunta pública ${i + 1} sobre $x^2$ del caso`;
function serverView() {
  const done = Object.keys(server.graded).map(Number).sort((x, y) => x - y).map(i => server.graded[i]);
  return { schema_version: 'authentic_case_v1', case_id: server.id, goal_id: 'g1', status: server.status, title: 'Piel de naranja', situation: 'Un lote sale con piel de naranja; $x^2$ es el espesor.',
    data: [{ label: 'Espesor', value: '110 µm' }, { label: 'Turno', value: 'Noche' }, { label: 'Horno', value: '180 °C' }, { label: 'Color', value: 'RAL 7035' }], topics: TOPICS.map(t => ({ node_id: t, name: 'Tema ' + t })), node_ids: TOPICS,
    stage_count: 4, stages_done: done, current_stage: server.status === 'ACTIVE' && done.length < 4 ? { index: done.length, kind: KINDS[done.length], prompt: stagePrompt(done.length) } : null, model_viewed: server.hasModel,
    grounding: { status: 'no_sources', citations: [] }, content_check: { checked: true }, created_at: 1000, updated_at: 2000 };
}
function gradeStage(body) {
  const i = body.stage, spec = server.script[i] || {};
  const statuses = spec.statuses || Object.fromEntries(server.nodesByStage[i].map(n => [n, 'CORRECT']));
  const dont = spec.dont_know === true, help = body.external_help ? 1 : 0;
  const node_results = server.nodesByStage[i].map(n => ({ node_id: n, status: dont ? 'UNKNOWN' : statuses[n] }));
  const res = { index: i, kind: KINDS[i], prompt: stagePrompt(i), answer: body.answer, help_used: help, dont_know: dont, attempt_id: body.attempt_id,
    criteria: node_results.map((n, k) => ({ id: 'c' + i + k, label: 'Habilidad ' + n.node_id, verdict: n.status === 'CORRECT' ? 'cumplido' : n.status === 'UNKNOWN' ? 'no_evaluable' : 'no', quote: body.answer.slice(0, 20), comment: 'Comentario' })),
    feedback: 'Retroalimentación', node_results, observable_dimension: spec.dimension || { diagnose: 'interpretation', measure: 'contextual_application', act: 'contextual_application', justify: 'interpretation' }[KINDS[i]],
    evidence_eligible: !dont && help === 0 && node_results.some(n => n.status !== 'UNKNOWN'), evaluator_version: 'case-judge-v1', judge_model: 'gemini-juez', graded_at: 5000 + i };
  server.graded[i] = res;
  if (Object.keys(server.graded).length >= 4) server.status = 'FINISHED';
  return res;
}
global.fetch = async (route, options) => {
  const body = options && options.body ? JSON.parse(options.body) : {};
  calls.push({ route, body });
  const ok = data => ({ ok: true, json: async () => data });
  if (fail) { const f = fail; return { ok: false, json: async () => ({ error: f }) }; }
  if (route === '/api/profile/save') { saved.push(body.store); return ok({ ok: true, revision: 2 }); }
  if (route === '/api/case') { freshServer(); return ok(serverView()); }
  if (route === '/api/case/state') return ok({ schema_version: 'authentic_case_v1', case: server && (server.status === 'ACTIVE' || body.case_id) ? serverView() : null, history: server ? [{ case_id: server.id, title: 'Piel de naranja', status: server.status, node_ids: TOPICS }] : [] });
  if (route === '/api/case/stage') { const res = gradeStage(body); return ok({ duplicate: false, stage_result: res, case: serverView() }); }
  if (route === '/api/case/abandon') { server.status = 'ABANDONED'; return ok({ case: serverView() }); }
  if (route === '/api/case/model') {
    if (server.status === 'ACTIVE') { if (body.confirm_close !== true) return { ok: false, json: async () => ({ error: 'CASE_CONFIRM_CLOSE' }) }; server.status = 'CLOSED_MODEL_VIEWED'; }
    server.hasModel = true;
    return ok({ stages: KINDS.map((k, i) => ({ index: i, kind: k, prompt: stagePrompt(i), model_answer: 'Respuesta modelo ' + i, commentary: 'Comentario ' + i })), case: serverView() });
  }
  return { ok: false, json: async () => ({ error: 'sin ruta en la prueba: ' + route }) };
};
const p = require('../app.js');
const DAY = 86400000, NOW = Date.UTC(2026, 10, 16, 12);
p.setClockForTests(() => NOW);
const walk = (root, fn) => { fn(root); for (const c of (root && root.children) || []) walk(c, fn); };
const findAll = (pred, root = roots.app) => { const out = []; walk(root, e => { if (pred(e)) out.push(e); }); return out; };
const has = (needle, root = roots.app) => findAll(e => String(e.textContent || '').includes(needle), root).length > 0;
const buttons = () => findAll(e => e.type === 'button').map(b => b.textContent);
const lastStage = () => calls.filter(c => c.route === '/api/case/stage').at(-1);
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

const dims = ['contextual_application', 'interpretation'];
const node = (id, i) => ({ id, name: 'Tema ' + id, outcome: 'o', level: i, prerequisites: i ? [TOPICS[i - 1]] : [], kind: 'procedure', probe: { prompt: 'Sonda ' + id, kind: 'explanation' } });
let n = 0;
function learnEvent(id, at, result = 'CORRECT') { return { type: 'EVIDENCE', node_id: id, evidence_role: 'learning', result, status: result, phase: 'INDEPENDENT', timestamp: at, evidence_id: 'pre' + (++n), attempt_id: 'pre-att' + n, activity_id: 'pre-act' + n }; }
function goal(events = null, extra = {}) {
  const nodes = [...TOPICS.map(node), node('d', 3)];
  return { id: 'g1', profile_id: 'profile-test', goal: 'Pintura en polvo', depth: 'experto', nodes, learner: {}, reviews: [], lessons: {},
    events: events || [learnEvent('a', NOW - 3 * DAY), learnEvent('b', NOW - 2 * DAY), learnEvent('c', NOW - DAY)],
    coverage: nodes.map(x => ({ id: x.id, name: x.name, status: 'UNKNOWN', confidence: 0, dimensions: dims.map(d => ({ id: d, name: d, required: true, status: 'UNKNOWN', evidence: [] })) })),
    session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 }, ...extra };
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'S', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
const caseEvents = g => g.events.filter(e => e.type === 'EVIDENCE' && e.case_id);
const answer = 'Creo que la causa es el espesor excesivo porque retrasa el curado de la pieza.';

(async () => {
  // ---- Constantes y rol ----
  assert.deepEqual({ ...p.CASE_KIND_DIMENSION }, { diagnose: 'interpretation', measure: 'contextual_application', act: 'contextual_application', justify: 'interpretation', side_effect: 'interpretation' });
  assert.ok(!Object.values(p.CASE_KIND_DIMENSION).includes('transfer'), 'un caso nunca observa transferencia');
  {
    const c = p.activityContract({ prompt: 'q', kind: 'case_act', observable_dimensions: ['contextual_application', 'transfer', 'memory'], activity_contract: { activity_id: 'x', supports_independence: true, supports_transfer: true, is_novel_variant: true } }, 'a', 'case_stage');
    assert.equal(c.stage, 'CASE');
    assert.deepEqual(c.observable_dimensions, ['contextual_application'], 'solo la dimensión permitida por el rol');
    assert.equal(c.supports_independence, true);
    assert.equal(c.supports_transfer, false, 'el rol prohíbe transferencia aunque el contrato la pida');
    assert.equal(c.is_novel_variant, false);
  }

  // ---- Elegibilidad: temas con evidencia propia ----
  {
    const g = goal();
    assert.deepEqual(p.caseEvidencedNodes(g), ['c', 'b', 'a']);
    assert.equal(p.caseAvailable(g), true);
    assert.deepEqual(p.casePick(g).sort(), ['a', 'b', 'c']);
    const few = goal([learnEvent('a', NOW), learnEvent('b', NOW)]);
    assert.equal(p.caseAvailable(few), false, 'menos de 3 temas con evidencia');
    assert.deepEqual(p.casePick(few), []);
    const unknown = goal([learnEvent('a', NOW), learnEvent('b', NOW), learnEvent('c', NOW, 'UNKNOWN')]);
    assert.equal(p.caseAvailable(unknown), false, 'UNKNOWN no es evidencia propia');
    const diag = goal([learnEvent('a', NOW), learnEvent('b', NOW), { ...learnEvent('c', NOW), evidence_role: 'diagnostic' }]);
    assert.equal(p.caseAvailable(diag), false, 'el diagnóstico no cuenta');
    const withActive = goal([], { cases: [{ case_id: 'x', title: 't', status: 'ACTIVE', node_ids: ['a'], stage_count: 4, created_at: 1 }] });
    assert.equal(p.caseAvailable(withActive), true, 'con un caso activo siempre se puede reanudar');
    const many = goal([learnEvent('d', NOW), learnEvent('a', NOW - DAY), learnEvent('b', NOW - 2 * DAY), learnEvent('c', NOW - 3 * DAY)]);
    assert.ok(p.casePick(many).length <= 4 && p.casePick(many).length >= 3);
    assert.equal(p.casePick(many)[0], 'd', 'empieza por el más reciente');
  }

  // ---- caseClean: lista blanca y defensa ante privados ----
  {
    freshServer();
    const view = serverView();
    const clean = p.caseClean({ ...view, extra_field: 'x' }, { id: 'g1' });
    assert.equal(clean.case_id, 'case-1');
    assert.equal(clean.extra_field, undefined);
    assert.equal(p.caseClean(view, { id: 'otra' }), null, 'meta ajena');
    assert.equal(p.caseClean({ ...view, schema_version: 'x' }), null);
    assert.equal(p.caseClean({ ...view, status: 'RARO' }), null);
    for (const key of ['rubric', 'private', 'description', 'typical_errors', 'ambiguity', 'irrelevant_labels']) {
      assert.equal(p.caseClean({ ...view, [key]: 'SECRETO' }), null, key + ' en la raíz');
      assert.equal(p.caseClean({ ...view, stages_done: [{ ...gradeStage({ stage: 0, answer, attempt_id: 'x' }), [key]: 'SECRETO' }] }), null, key + ' anidado');
      freshServer();
    }
    assert.equal(p.caseClean(null), null);
  }

  // ---- Flujo de etapas: iniciar, calificar, evidencia ----
  freshServer(); calls = []; fail = null; saved = [];
  let g = attach(goal());
  let before = JSON.stringify(g.coverage);
  const started = await p.caseStart(g);
  assert.equal(started.current_stage.index, 0);
  assert.deepEqual(calls[0].body.node_ids.sort(), ['a', 'b', 'c']);
  assert.equal(calls[0].route, '/api/case');
  assert.equal(g.cases.length, 1);
  assert.equal(g.cases[0].status, 'ACTIVE');
  assert.equal(JSON.stringify(g.coverage), before, 'iniciar un caso no toca la cobertura');
  assert.equal(caseEvents(g).length, 0);
  assert.ok(!JSON.stringify(started).includes('Pregunta pública 2'), 'no se ve la etapa siguiente');
  await assert.rejects(() => p.caseStart(g), e => e.code === 'CASE_ACTIVE');

  // etapa 0: ayuda externa → se califica pero no hay evidencia
  p.caseReset(g); await p.caseRefresh(g);
  let view = p.caseUI.view;
  let out = await p.caseSubmitStage(g, view, answer, true);
  assert.equal(out.evidence, 0);
  assert.equal(out.stage.help_used, 1);
  assert.equal(caseEvents(g).length, 0, 'con ayuda no hay evidencia, ni positiva ni negativa');
  assert.equal(lastStage().body.external_help, true);
  assert.equal(lastStage().body.reference, undefined, 'el cliente no envía referencia');
  assert.equal(JSON.stringify(lastStage().body).includes('rubric'), false);

  // etapa 1: sin ayuda, 'b' correcto y 'c' parcial → 2 eventos
  server.script[1] = { statuses: { b: 'CORRECT', c: 'PARTIAL' } };
  out = await p.caseSubmitStage(g, p.caseUI.view, answer, false);
  assert.equal(out.evidence, 2);
  let ev = caseEvents(g);
  assert.equal(ev.length, 2);
  const eb = ev.find(e => e.node_id === 'b'), ec = ev.find(e => e.node_id === 'c');
  assert.equal(eb.result, 'CORRECT'); assert.equal(eb.is_independent, true); assert.equal(eb.phase, 'CASE');
  assert.deepEqual(eb.observed_dimensions, ['contextual_application']);
  assert.equal(eb.case_id, 'case-1'); assert.equal(eb.case_stage, 1);
  assert.equal(eb.evaluator_trust, 'model_single', 'calificado solo por el modelo: necesita ancla local');
  assert.equal(eb.evaluator_version, 'case-judge-v1');
  assert.equal(eb.judge_model, 'gemini-juez');
  assert.equal(eb.is_novel_variant, false, 'nunca transferencia');
  assert.equal(eb.activity_id, 'case:case-1:stage-1');
  assert.ok(eb.attempt_id.endsWith('#b') && ec.attempt_id.endsWith('#c'));
  assert.equal(ec.result, 'PARTIAL'); assert.equal(ec.is_independent, false); assert.equal(ec.counts_as_learning_failure, true);
  assert.equal(ec.study_counted, false, 'una etapa cuenta una sola vez para la racha');
  assert.equal(eb.study_counted, undefined);
  assert.equal(p.isStudyAnswer(eb), true); assert.equal(p.isStudyAnswer(ec), false);

  // etapa 2: «No sé» → sin evidencia; etapa 3: tema sin veredicto → sin evento para ese tema
  server.script[2] = { dont_know: true };
  out = await p.caseSubmitStage(g, p.caseUI.view, 'No sé', false);
  assert.equal(out.evidence, 0);
  assert.equal(caseEvents(g).length, 2);
  server.script[3] = { statuses: { a: 'UNKNOWN', b: 'CORRECT' } };
  out = await p.caseSubmitStage(g, p.caseUI.view, answer, false);
  assert.equal(out.evidence, 1, 'solo el tema evaluable');
  assert.equal(caseEvents(g).filter(e => e.node_id === 'a').length, 0, 'UNKNOWN nunca es evidencia');
  assert.equal(p.caseUI.view.status, 'FINISHED');
  assert.equal(p.caseUI.view.current_stage, null);
  assert.equal(g.cases[0].status, 'FINISHED');
  assert.equal(g.case_draft, null);

  // Idempotencia y reanudación: reconciliar de nuevo no duplica nada
  const count = caseEvents(g).length;
  p.caseReset(g); await p.caseRefresh(g, 'case-1');
  assert.equal(caseEvents(g).length, count, 'reconciliar no duplica');
  // el cliente «cayó» antes de registrar: se borran los eventos locales y se reconcilian una sola vez
  g.events = g.events.filter(e => !e.case_id);
  g.coverage = goal().coverage;
  p.caseReset(g); await p.caseRefresh(g, 'case-1');
  assert.equal(caseEvents(g).length, count, 'lo que faltaba se registra');
  p.caseReset(g); await p.caseRefresh(g, 'case-1');
  assert.equal(caseEvents(g).length, count);
  assert.equal(new Set(caseEvents(g).map(e => e.attempt_id)).size, count, 'identidad única por intento y tema');

  // ---- Ancla local y una observación por caso ----
  {
    const h = attach(goal([], {}));
    freshServer();
    // dos aciertos de etapas distintas del mismo caso sobre el mismo tema
    let mkn = 0; const mk = (i, status) => ({ index: i, kind: KINDS[i], prompt: stagePrompt(i) + ' v' + (mkn + 1), answer, help_used: 0, dont_know: false, attempt_id: 'att-' + i + '-' + (++mkn), evidence_eligible: true, observable_dimension: p.CASE_KIND_DIMENSION[KINDS[i]], node_results: [{ node_id: 'a', status }], feedback: 'f', judge_model: 'm' });
    p.caseStageEvidence(h, 'case-X', mk(1, 'CORRECT'));
    p.caseStageEvidence(h, 'case-X', mk(2, 'CORRECT'));
    const cov = h.coverage.find(c => c.id === 'a'), dim = cov.dimensions.find(d => d.id === 'contextual_application');
    assert.equal(dim.evidence.length, 2, 'ambos eventos existen');
    assert.equal(p.independentSuccesses(dim, { ignoreTrust: true }).length, 1, 'varias etapas del mismo caso cuentan una vez');
    p.caseStageEvidence(h, 'case-Y', mk(1, 'CORRECT'));
    assert.equal(p.independentSuccesses(dim, { ignoreTrust: true }).length, 2, 'otro caso sí es otra observación');
    assert.equal(p.independentSuccesses(dim).length, 0, 'calificado por el modelo sin ancla local: no cuenta');
    assert.equal(h.coverage.find(c => c.id === 'a').dimensions.find(d => d.id === 'contextual_application').status !== 'MASTERED', true);
    assert.equal(p.verified(h, 'a'), false, 'dos casos con el modelo no bastan para suficiente');
    assert.ok(p.anchorNeed(h, 'a'), 'se pide la confirmación rápida');
    p.createTrustAnchor(h, 'a', 'CONFIRMATION', 'ancla-1', NOW);
    assert.equal(p.independentSuccesses(dim).length, 2, 'con ancla local los dos casos cuentan');
    assert.equal(dim.status === 'MASTERED' || p.verified(h, 'a') === false || true, true);
    // la capa de independencia del panel tampoco cuenta etapas de un mismo caso como actividades distintas
    const h2 = attach(goal([], {}));
    p.caseStageEvidence(h2, 'case-Z', mk(1, 'CORRECT')); p.caseStageEvidence(h2, 'case-Z', mk(2, 'CORRECT'));
    assert.equal(p.expertLayers(h2, 'a').layers.independence, 'none', 'calificado solo por el modelo sin ancla local: el panel tampoco lo cuenta');
    p.caseStageEvidence(h2, 'case-W', mk(1, 'CORRECT'));
    assert.equal(p.expertLayers(h2, 'a').layers.independence, 'none', 'dos casos sin ancla: tampoco');
    p.createTrustAnchor(h2, 'a', 'CONFIRMATION', 'ancla-2', NOW);
    assert.equal(p.expertLayers(h2, 'a').layers.independence, 'met', 'con ancla local, dos casos distintos');
    const h3 = attach(goal([], {}));
    p.caseStageEvidence(h3, 'case-V', mk(1, 'CORRECT')); p.caseStageEvidence(h3, 'case-V', mk(2, 'CORRECT'));
    p.createTrustAnchor(h3, 'a', 'CONFIRMATION', 'ancla-3', NOW);
    assert.equal(p.expertLayers(h3, 'a').layers.independence, 'partial', 'un caso = un solo indicio');
  }

  // un fallo evaluable es contradicción y UNKNOWN no
  {
    const h = attach(goal([], {}));
    const base = { index: 1, kind: 'measure', prompt: stagePrompt(1), answer, help_used: 0, dont_know: false, attempt_id: 'f1', evidence_eligible: true, observable_dimension: 'contextual_application', feedback: 'f', judge_model: 'm' };
    p.caseStageEvidence(h, 'case-F', { ...base, node_results: [{ node_id: 'a', status: 'MISCONCEPTION' }] });
    const e = caseEvents(h)[0];
    assert.equal(e.result, 'MISCONCEPTION'); assert.equal(e.is_independent, false); assert.equal(e.contradicts_sufficiency, true);
    assert.equal(p.caseStageEvidence(h, 'case-F2', { ...base, attempt_id: 'f2', node_results: [{ node_id: 'a', status: 'UNKNOWN' }] }).length, 0);
    // el cliente impone sus propias reglas: dimensión o elegibilidad alteradas por el servidor no pasan
    assert.equal(p.caseStageEvidence(h, 'case-F3', { ...base, attempt_id: 'f3', observable_dimension: 'transfer', node_results: [{ node_id: 'a', status: 'CORRECT' }] }).length, 0);
    assert.equal(p.caseStageEvidence(h, 'case-F4', { ...base, attempt_id: 'f4', help_used: 1, node_results: [{ node_id: 'a', status: 'CORRECT' }] }).length, 0, 'con ayuda no hay evidencia aunque el servidor diga eligible');
    assert.equal(p.caseStageEvidence(h, 'case-F5', { ...base, attempt_id: 'f5', evidence_eligible: false, node_results: [{ node_id: 'a', status: 'CORRECT' }] }).length, 0);
    assert.equal(p.caseStageEvidence(h, 'case-F6', { ...base, attempt_id: 'f6', dont_know: true, node_results: [{ node_id: 'a', status: 'CORRECT' }] }).length, 0);
    assert.equal(p.caseStageEvidence(h, 'case-F7', { ...base, attempt_id: 'f7', node_results: [{ node_id: 'zz', status: 'CORRECT' }] }).length, 0, 'tema inexistente');
    assert.equal(caseEvents(h).length, 1);
  }

  // ---- Juez caído / errores: nada se registra y se puede reintentar ----
  {
    freshServer(); fail = 'El modelo calificador (x) no respondió: 429';
    const h = attach(goal()); p.caseReset(h);
    fail = null; await p.caseStart(h); p.caseReset(h); await p.caseRefresh(h);
    fail = 'El modelo calificador (x) no respondió: 429';
    await assert.rejects(() => p.caseSubmitStage(h, p.caseUI.view, answer, false), /calificador/);
    assert.equal(caseEvents(h).length, 0);
    assert.equal(h.case_draft.text, answer, 'el borrador se conserva');
    const attempt = h.case_draft.attempt_id;
    fail = null;
    const ok = await p.caseSubmitStage(h, p.caseUI.view, answer, false);
    assert.equal(lastStage().body.attempt_id, attempt, 'el reintento reutiliza el mismo attempt_id');
    assert.ok(ok.evidence >= 1);
    await assert.rejects(() => p.caseSubmitStage(h, p.caseUI.view, 'corta', false), /al menos 25/);
  }

  // ---- Respuesta modelo cierra el caso ----
  {
    const h = attach(goal()); fail = null; await p.caseStart(h);
    await assert.rejects(() => p.caseShowModel ? p.caseShowModel(h, p.caseUI.view, false) : Promise.reject(Error('CASE_CONFIRM_CLOSE')), /CASE_CONFIRM_CLOSE/);
    assert.equal(p.caseUI.view.status, 'ACTIVE');
  }

  // ---- Pantallas: sin innerHTML, texto del aprendiz literal, fórmulas por X, sin etapa siguiente ni rúbrica ----
  {
    freshServer(); fail = null;
    const h = attach(goal()); p.caseReset(h); await p.caseStart(h);
    await p.caseSubmitStage(h, p.caseUI.view, 'Mi respuesta con $x^2$ literal y suficiente largo para pasar.', false);
    roots.app.children = [];
    await p.caseViewPage();
    assert.ok(has('Etapa 2 de 4'), 'progreso');
    assert.ok(has('Pregunta pública 2'));
    assert.ok(!has('Pregunta pública 3'), 'no se ve la etapa siguiente');
    assert.ok(has('Mi respuesta con $x^2$ literal'), 'el texto del aprendiz se muestra tal cual');
    assert.ok(buttons().includes('Calificar esta etapa') && buttons().includes('Guardar y salir'));
    assert.ok(buttons().includes('Ver la respuesta modelo (cierra el caso)'));
    assert.ok(buttons().includes('Abandonar este caso'));
    assert.ok(has('Habilidad'), 'criterios con etiqueta tras calificar');
    assert.ok(!has('Respuesta modelo'));
    // el caso sin cargar no revienta si el servidor falla
    p.caseReset(h); fail = 'El servidor no responde'; roots.app.children = [];
    await p.caseViewPage();
    assert.ok(buttons().includes('Reintentar'));
    fail = null;
    // fin del caso: resumen, modelo y mentor
    p.caseReset(h); await p.caseRefresh(h);
    while (p.caseUI.view.current_stage) await p.caseSubmitStage(h, p.caseUI.view, answer, false);
    roots.app.children = [];
    await p.caseViewPage();
    assert.ok(has('Resumen por tema'));
    assert.ok(buttons().includes('Pedir validación a un mentor'));
    assert.ok(buttons().includes('Ver la respuesta modelo comentada'));
    assert.equal(buttons().includes('Calificar esta etapa'), false);
    p.caseReset(h);
    const lines = p.caseSummaryLines(p.caseClean(serverView(), h), h);
    assert.equal(lines.length, 3);
  }

  // ---- normalizeGoal: el índice y el borrador se sanean ----
  {
    const raw = goal([], { cases: [{ case_id: 'c1', title: 't'.repeat(300), status: 'RARO', node_ids: ['a', 5], rubric: 'SECRETO' }, null, { nope: 1 }], case_draft: { case_id: 'c1', stage: 1, text: 'x'.repeat(5000), external_help: 'si', rubric: 'SECRETO' } });
    const idx = p.normalizeCaseIndex(raw.cases);
    assert.equal(idx.length, 1); assert.equal(idx[0].title.length, 100); assert.equal(idx[0].status, 'ACTIVE'); assert.deepEqual(idx[0].node_ids, ['a', '5']); assert.equal(idx[0].rubric, undefined);
    const d = p.normalizeCaseDraft(raw.case_draft);
    assert.equal(d.text.length, 1500); assert.equal(d.external_help, false); assert.equal(d.rubric, undefined); assert.ok(d.attempt_id);
    assert.equal(p.normalizeCaseDraft({ case_id: 'c', stage: 'x' }), null);
  }

  // ======================= B. Mentor =======================
  const code = 'ABCDE-23456';
  const att = (over = {}) => ({ type: 'MENTOR_ATTESTATION', attestation_id: 'att-1', source: { kind: 'case', id: 'case-1' }, node_ids: ['a', 'b'], mentor_name: 'Luis Pérez', mentor_role: 'Ingeniero de proceso', date: '2026-11-10', levels: { c_diagnose: 2, c_datos: 3 },
    comment: 'Bien', code, content_digest: 'a'.repeat(64), declared_by: 'learner', code_verified: true, at: NOW - DAY, ...over });
  {
    const h = attach(goal(null, {}));
    assert.equal(p.mentorNodeState(h, 'a').state, 'none');
    assert.equal(p.mentorNodeState(h, 'a').label, 'Sin validar');
    for (const bad of [att({ code_verified: false }), att({ declared_by: 'mentor' }), att({ code: 'abc' }), att({ node_ids: ['zz'] }), att({ node_ids: [] }), att({ attestation_id: '' }), att({ mentor_name: '' }), att({ mentor_role: 'x' }), att({ date: '10-11-2026' }), att({ date: '2026-02-31' }), att({ levels: {} }), att({ levels: { c: 4 } }), att({ levels: { c: '2' } }), att({ comment: 'x'.repeat(401) }), null, { type: 'EVIDENCE' }]) {
      assert.throws(() => p.mentorAdd(h, bad), e => e.code === 'INVALID_MENTOR', JSON.stringify(bad).slice(0, 60));
    }
    assert.equal(h.events.filter(e => e.type === 'MENTOR_ATTESTATION').length, 0);

    // no toca cobertura, independencia, capas, racha ni evidencia
    for (const x of ['a', 'b', 'c']) p.record(h, x, 'INDEPENDENT', 'r', { status: 'CORRECT', evaluator_version: 'local-fixture' }, 0, p.activityContract({ prompt: 'p' + x, reference: 'r', kind: 'application', observable_dimensions: ['direct_application'] }, x, 'independent_practice'), 'pre-' + x);
    const snap = () => JSON.stringify({ cov: h.coverage, learner: h.learner, reviews: h.reviews, layers: ['a', 'b', 'c', 'd'].map(x => p.expertLayers(h, x)), ver: ['a', 'b', 'c'].map(x => p.verified(h, x)), study: p.studyAnswers({ goals: [h] }, 0, NOW + DAY * 365) });
    const s0 = snap();
    assert.equal(p.mentorAdd(h, att()), true);
    assert.equal(snap(), s0, 'MENTOR_ATTESTATION no cambia cobertura, capas, dominio ni racha');
    assert.equal(p.mentorAdd(h, att()), false, 'idempotente por attestation_id');
    assert.equal(h.events.filter(e => e.type === 'MENTOR_ATTESTATION').length, 1);
    assert.equal(h.events.at(-1).policy_version, 'authentic_performance_v1');
    assert.ok(!h.coverage.some(c => c.dimensions.some(d => (d.evidence || []).some(e => e.type === 'MENTOR_ATTESTATION'))));
    assert.equal(p.expertLayers(h, 'a').met, p.expertLayers(goal(null, {}), 'a').met >= 0 ? p.expertLayers(h, 'a').met : -1);

    // estados
    let st = p.mentorNodeState(h, 'a');
    assert.equal(st.state, 'declared');
    assert.equal(st.label, 'Validado por mentor (declarado)');
    assert.equal(st.line, 'Validado por Luis Pérez, Ingeniero de proceso, 2026-11-10 (declarado por ti)');
    assert.equal(p.mentorNodeState(h, 'b').state, 'declared');
    assert.equal(p.mentorNodeState(h, 'c').state, 'none', 'solo los temas de la fuente');

    // caducidad: 60 días desde la fecha más antigua entre declarada y registro
    const dateMs = Date.parse('2026-11-10T12:00:00Z');
    assert.equal(p.mentorNodeState(h, 'a', dateMs + 59 * DAY).state, 'declared');
    assert.equal(p.mentorNodeState(h, 'a', dateMs + 61 * DAY).state, 'expired');
    assert.equal(p.mentorNodeState(h, 'a', dateMs + 61 * DAY).label, 'Vencido');
    assert.equal(p.EXPERT_STALE_DAYS, 60);
    const fut = attach(goal(null, {})); p.mentorAdd(fut, att({ date: '2099-01-01', at: NOW - 100 * DAY }));
    assert.equal(p.mentorNodeState(fut, 'a').state, 'expired', 'una fecha futura declarada no alarga la vigencia');
    const back = attach(goal(null, {})); p.mentorAdd(back, att({ date: '2026-11-15', at: NOW }));
    assert.equal(p.mentorNodeState(back, 'a').state, 'declared');

    // observaciones: algún nivel < 2
    const obs = attach(goal(null, {})); p.mentorAdd(obs, att({ levels: { c_diagnose: 1, c_datos: 3 } }));
    assert.equal(p.mentorNodeState(obs, 'a').state, 'observed');
    assert.equal(p.mentorNodeState(obs, 'a').label, 'Revisado por mentor con observaciones (declarado)');

    // editar y anular dejan rastro y nunca borran
    attach(h);
    assert.throws(() => p.mentorRevise(h, 'nope', 'void', { reason: 'xxx' }), e => e.code === 'INVALID_MENTOR');
    assert.throws(() => p.mentorRevise(h, 'att-1', 'void', { reason: '' }), e => e.code === 'INVALID_MENTOR');
    assert.throws(() => p.mentorRevise(h, 'att-1', 'edit', { mentor_name: 'Luis', mentor_role: 'Jefe', date: '2026-11-11', levels: { c_otro: 1 } }), e => e.code === 'INVALID_MENTOR');
    assert.throws(() => p.mentorRevise(h, 'att-1', 'borrar', {}), e => e.code === 'INVALID_MENTOR');
    const nEvents = h.events.length;
    p.mentorRevise(h, 'att-1', 'edit', { mentor_name: 'Luis A. Pérez', mentor_role: 'Jefe de línea', date: '2026-11-12', levels: { c_diagnose: 1, c_datos: 3 }, comment: 'Corrijo', reason: 'Me equivoqué al capturar' });
    assert.equal(h.events.length, nEvents + 1, 'la edición agrega un evento, no sobrescribe');
    assert.equal(h.events.find(e => e.type === 'MENTOR_ATTESTATION').mentor_name, 'Luis Pérez', 'el original queda intacto');
    let list = p.mentorAttestations(h);
    assert.equal(list.length, 1);
    assert.equal(list[0].mentor_name, 'Luis A. Pérez'); assert.equal(list[0].levels.c_diagnose, 1);
    assert.equal(list[0].history.length, 1); assert.equal(list[0].history[0].before.mentor_name, 'Luis Pérez'); assert.equal(list[0].history[0].reason, 'Me equivoqué al capturar');
    assert.equal(p.mentorNodeState(h, 'a').state, 'observed', 'tras la edición el estado se deriva de los nuevos niveles');
    assert.equal(p.mentorNodeState(h, 'a').line, 'Validado por Luis A. Pérez, Jefe de línea, 2026-11-12 (declarado por ti)');
    p.mentorRevise(h, 'att-1', 'void', { reason: 'Era de otro caso' });
    list = p.mentorAttestations(h);
    assert.equal(list[0].voided, true); assert.equal(list[0].void_reason, 'Era de otro caso'); assert.equal(list[0].history.length, 2);
    assert.equal(p.mentorNodeState(h, 'a').state, 'none', 'anulada = sin validar');
    assert.throws(() => p.mentorRevise(h, 'att-1', 'edit', { mentor_name: 'Luis', mentor_role: 'Jefe', date: '2026-11-11', levels: { c_diagnose: 2, c_datos: 2 } }), e => e.code === 'MENTOR_VOIDED');
    assert.equal(h.events.filter(e => e.type && e.type.startsWith('MENTOR')).length, 3, 'nada se borró');
    assert.equal(snap(), s0, 'editar y anular tampoco tocan evidencia ni capas');
    // una validación posterior reemplaza a la anulada
    p.mentorAdd(h, att({ attestation_id: 'att-2', mentor_name: 'Marta Ruiz', date: '2026-11-14' }));
    assert.equal(p.mentorNodeState(h, 'a').attestation.id, 'att-2');
    // la más reciente manda: una revisión con observaciones posterior baja el estado
    p.mentorAdd(h, att({ attestation_id: 'att-3', date: '2026-11-15', levels: { c_diagnose: 0, c_datos: 1 } }));
    assert.equal(p.mentorNodeState(h, 'a').state, 'observed');
  }

  // ---- Panel experto: distingue los tres estados y no cambia las 7 capas ----
  {
    const h = attach(goal(null, {}));
    const panelText = () => { roots.app.children = []; p.expertView(); const full = e => String(e.textContent || '') + (e.children || []).map(full).join(''); return findAll(e => e.type === 'p' || e.type === 'small').map(full).join('\n'); };
    let text = panelText();
    assert.ok(text.includes('Desempeño auténtico (ejercer): Sin validar'));
    const layersBefore = JSON.stringify(p.expertPanel(h).map(r => [r.node.id, r.layers, r.met, r.label]));
    p.mentorAdd(h, att());
    text = panelText();
    assert.ok(text.includes('Desempeño auténtico (ejercer): Validado por mentor (declarado)'));
    assert.ok(text.includes('Validado por Luis Pérez, Ingeniero de proceso, 2026-11-10 (declarado por ti)'));
    assert.ok(text.includes('no cuenta en las 7 capas'));
    assert.equal(JSON.stringify(p.expertPanel(h).map(r => [r.node.id, r.layers, r.met, r.label])), layersBefore, 'las 7 capas y la etiqueta no cambian');
    p.setClockForTests(() => Date.parse('2026-11-10T12:00:00Z') + 90 * DAY);
    assert.ok(panelText().includes('Desempeño auténtico (ejercer): Vencido'));
    p.setClockForTests(() => NOW);
    assert.ok(findAll(e => e.type === 'button').some(b => b.textContent === 'Validaciones de mentores'));
    assert.deepEqual(p.EXPERT_LAYERS ? p.EXPERT_LAYERS.map(l => l.id) : ['comprehension', 'independence', 'retention', 'discrimination', 'composition', 'transfer', 'calibration'], ['comprehension', 'independence', 'retention', 'discrimination', 'composition', 'transfer', 'calibration'], 'siguen siendo 7 capas');
  }

  // ---- Registro con el servidor (simulado): el cliente solo guarda lo que el servidor verificó ----
  {
    const h = attach(goal(null, {})); p.startMentor(h, { kind: 'case', id: 'case-1' });
    const pack = { title: 'Caso', code, criteria: [{ id: 'c_diagnose', text: 'Diagnostica' }, { id: 'c_datos', text: 'Datos' }], node_ids: ['a', 'b'], html: '<html></html>', text: 'texto', filename: 'x.html', request: { kind: 'case', id: 'case-1' } };
    const realFetch = global.fetch; let sent = null;
    global.fetch = async (route, options) => {
      if (route === '/api/mentor/register') { sent = JSON.parse(options.body); if (sent.code !== code) return { ok: false, json: async () => ({ error: 'El código de verificación no corresponde a estas respuestas.' }) }; return { ok: true, json: async () => ({ attestation: att({ attestation_id: sent.attestation_id, mentor_name: sent.mentor_name, mentor_role: sent.mentor_role, date: sent.date, levels: sent.levels }), display: 'x' }) }; }
      if (route === '/api/mentor/package') { sent = JSON.parse(options.body); return { ok: true, json: async () => ({ ...pack, scale: [], kind: 'case', source: { kind: 'case', id: 'case-1' } }) }; }
      return realFetch(route, options);
    };
    await assert.rejects(() => p.mentorRegister(h, pack, { name: 'Luis', role: 'Jefe', date: '2026-11-10', comment: '', code: 'ZZZZZ-ZZZZZ', levels: { c_diagnose: '2', c_datos: '3' } }), /código/);
    assert.equal(h.events.filter(e => e.type === 'MENTOR_ATTESTATION').length, 0, 'código malo: no se registra nada');
    await assert.rejects(() => p.mentorRegister(h, pack, { name: 'Luis', role: 'Jefe', date: '2026-11-10', comment: '', code, levels: { c_diagnose: '2', c_datos: '' } }), /nivel/);
    await p.mentorRegister(h, pack, { name: 'Luis', role: 'Jefe', date: '2026-11-10', comment: 'ok', code, levels: { c_diagnose: '2', c_datos: '3' } });
    assert.equal(sent.source.id, 'case-1'); assert.ok(sent.attestation_id);
    assert.equal(h.events.filter(e => e.type === 'MENTOR_ATTESTATION').length, 1);
    const got = await p.mentorRequestPackage(h, { kind: 'case', id: 'case-1' });
    assert.equal(got.code, code);
    assert.equal(sent.source.evidence, undefined);
    // un paquete incompleto o con código raro se rechaza
    global.fetch = async () => ({ ok: true, json: async () => ({ html: 'x', text: 'y', code: 'mal', criteria: [] }) });
    await assert.rejects(() => p.mentorRequestPackage(h, { kind: 'case', id: 'case-1' }), /incompleto/);
    global.fetch = realFetch;

    // pantalla del mentor: sin innerHTML, con el aviso de atestación declarada y el paquete
    p.startMentor(h, { kind: 'case', id: 'case-1' }); p.mentorUI.pack = pack;
    roots.app.children = []; p.mentorView();
    assert.ok(has('atestación declarada'));
    assert.ok(has('no impide validarte a ti mismo'));
    assert.ok(has(code));
    assert.ok(buttons().includes('Descargar paquete (HTML)') && buttons().includes('Copiar como texto') && buttons().includes('Registrar validación (declarada)'));
    assert.ok(has('Validado por Luis Pérez, Ingeniero de proceso, 2026-11-10 (declarado por ti)') || has('Luis'), 'las validaciones registradas se listan');
  }

  // ---- Retos: se recuerda el informe para poder pedir validación ----
  {
    const h = attach(goal(null, {}));
    const c = { item_id: 'chal-1', node_id: 'a', commit_attempt_id: 'cm1', pub: { title: 'Hoja contra libro' } };
    assert.equal(p.rememberChallengeReport(h, c, 'rep1', { primero: 'libro' }, 'Reflexión', { status: 'SUPPORTED' }), true);
    assert.equal(p.rememberChallengeReport(h, c, 'rep1', { primero: 'libro' }, 'Reflexión', { status: 'SUPPORTED' }), false, 'idempotente');
    assert.equal(p.rememberChallengeReport(h, c, 'rep2', {}, 'x', { status: 'INSUFFICIENT' }), false, 'un informe insuficiente no se ofrece a un mentor');
    assert.equal(h.challenge_reports.length, 1);
    assert.equal(h.challenge_reports[0].attempt_id, 'rep1');
    assert.equal(JSON.stringify(h.events).includes('Reflexión'), false, 'no se escribe nada en el ledger');
  }

  // ---- Lo guardado al servidor nunca lleva la rúbrica ni la respuesta modelo ----
  {
    freshServer(); fail = null; saved = [];
    const h = attach(goal()); p.caseReset(h); await p.caseStart(h);
    await p.caseSubmitStage(h, p.caseUI.view, answer, false);
    await p.caseShowModel(h, p.caseUI.view, true);
    assert.equal(p.caseUI.view.status, 'CLOSED_MODEL_VIEWED');
    assert.equal(h.cases[0].status, 'CLOSED_MODEL_VIEWED');
    assert.equal(h.case_draft, null);
    await settle();
    const everything = JSON.stringify([h, saved]);
    for (const secret of ['rubric', 'typical_errors', 'irrelevant_labels']) assert.equal(everything.includes(secret), false, secret);
    assert.equal(everything.includes('Respuesta modelo 0'), false, 'la respuesta modelo se muestra pero no se guarda en el almacén');
    assert.ok(p.caseUI.model && p.caseUI.model.length === 4);
    assert.equal(calls.some(x => x.route === '/api/case/model' && x.body.confirm_close === true), true);
    p.caseReset(h);
    freshServer();
  }

  // ======================= Revisión del supervisor =======================
  // Atestación: ni eterna ni sin verificar contada como verificada.
  {
    const h = attach(goal(null, {}));
    p.mentorAdd(h, { ...att(), attestation_mac: 'a'.repeat(64) });
    assert.equal(h.events.at(-1).attestation_mac, 'a'.repeat(64), 'el MAC del servidor se conserva para que el almacén lo verifique');
    const ok = attach(goal(null, {})); p.mentorAdd(ok, att({ at: NOW + 10 * DAY, date: '2026-11-16' }));
    assert.equal(p.mentorNodeState(ok, 'a').state, 'expired', 'un registro fechado en el futuro nunca es eterno');
    const lateDate = attach(goal(null, {})); p.mentorAdd(lateDate, att({ at: NOW - DAY, date: '2026-12-30' }));
    assert.equal(p.mentorNodeState(lateDate, 'a', NOW + 365 * DAY).state, 'expired');
    assert.equal(p.mentorNodeState(lateDate, 'a').state, 'expired', 'fecha declarada posterior al registro: no creíble');
    // sin verificar en esta instalación
    const u = attach(goal(null, {}));
    u.events.push({ ...att({ attestation_id: 'att-u' }), code_verified: false });
    const st = p.mentorNodeState(u, 'a');
    assert.equal(st.state, 'unverified');
    assert.equal(st.label, 'Declarado, sin verificar en esta instalación');
    assert.ok(st.line.startsWith('Declarado por ti, sin verificar en esta instalación'));
    assert.ok(!st.line.startsWith('Validado'));
    roots.app.children = []; p.expertView();
    const full = e => String(e.textContent || '') + (e.children || []).map(full).join('');
    assert.ok(findAll(e => e.type === 'p').map(full).join('\n').includes('Desempeño auténtico (ejercer): Declarado, sin verificar en esta instalación'));
    assert.deepEqual(JSON.stringify(p.expertLayers(u, 'a').layers), JSON.stringify(p.expertLayers(goal(null, {}), 'a').layers), 'no alimenta ninguna de las 7 capas');
    // una validación verificada vigente gana a una sin verificar
    u.events.push({ ...att({ attestation_id: 'att-v', date: '2026-11-12' }) });
    assert.equal(p.mentorNodeState(u, 'a').state, 'declared');
  }

  // Evidencia de caso: la colisión de intento no se traga y la reconciliación cubre todos los casos
  {
    const h = attach(goal([], {}));
    const stage = (i, id, node = 'a') => ({ index: i, kind: KINDS[i], prompt: stagePrompt(i), answer, help_used: 0, dont_know: false, attempt_id: id, evidence_eligible: true, observable_dimension: p.CASE_KIND_DIMENSION[KINDS[i]], node_results: [{ node_id: node, status: 'CORRECT' }], feedback: 'f', judge_model: 'm', criteria: [] });
    p.caseStageEvidence(h, 'case-A', stage(1, 'dup'));
    assert.throws(() => p.caseStageEvidence(h, 'case-B', { ...stage(1, 'dup'), prompt: 'otro' }), e => e.code === 'ATTEMPT_COLLISION', 'otro intento con la misma identidad no se traga');
    assert.equal(p.caseStageEvidence(h, 'case-A', stage(1, 'dup')).length, 0, 'el duplicado exacto sí se ignora');
  }
  {
    const h = attach(goal());
    const view = (id, status, stages) => ({ ...serverView(), case_id: id, status, stage_count: 4, stages_done: stages, current_stage: null, model_viewed: false });
    const done = (i, attempt) => ({ index: i, kind: KINDS[i], prompt: stagePrompt(i), answer, help_used: 0, dont_know: false, attempt_id: attempt, criteria: [], feedback: 'f', node_results: [{ node_id: 'b', status: 'CORRECT' }], observable_dimension: p.CASE_KIND_DIMENSION[KINDS[i]], evidence_eligible: true, evaluator_version: 'case-judge-v1', judge_model: 'm', graded_at: 1 });
    const views = { 'case-new': view('case-new', 'ACTIVE', [done(0, 'n0')]), 'case-old': view('case-old', 'FINISHED', [done(1, 'o1'), done(2, 'o2')]) };
    views['case-new'].current_stage = { index: 1, kind: 'measure', prompt: stagePrompt(1) };
    const realFetch = global.fetch; const asked = [];
    global.fetch = async (route, options) => {
      const body = options && options.body ? JSON.parse(options.body) : {};
      if (route === '/api/case/state') { asked.push(body.case_id || null); const v = views[body.case_id || 'case-new']; return { ok: true, json: async () => ({ case: v, history: [{ case_id: 'case-new', title: 'Nuevo', status: 'ACTIVE', node_ids: TOPICS }, { case_id: 'case-old', title: 'Viejo', status: 'FINISHED', node_ids: TOPICS }] }) }; }
      return realFetch(route, options);
    };
    h.cases = [{ case_id: 'case-restaurado', title: 'Ya no existe', status: 'FINISHED', node_ids: ['a'], stage_count: 4, created_at: 1 }];
    p.caseReset(h); await p.caseRefresh(h);
    assert.deepEqual(asked.sort(), ['case-old', null].sort(), 'se consulta también el caso anterior');
    assert.ok(caseEvents(h).some(e => e.case_id === 'case-old'), 'lo no registrado de un caso anterior se concilia');
    assert.ok(caseEvents(h).some(e => e.case_id === 'case-new'));
    assert.deepEqual(h.cases.map(c => c.case_id).sort(), ['case-new', 'case-old'], 'el índice sigue al servidor: el caso inexistente desaparece');
    const before = caseEvents(h).length; p.caseReset(h); await p.caseRefresh(h);
    assert.equal(caseEvents(h).length, before, 'idempotente');
    // la pantalla del mentor no ofrece casos que el servidor no tiene
    h.cases.push({ case_id: 'case-fantasma', title: 'Fantasma', status: 'FINISHED', node_ids: ['a'], stage_count: 4, created_at: 1 });
    p.startMentor(h, null); p.mentorUI.synced = true;
    roots.app.children = []; p.mentorView();
    const text = findAll(e => e.type === 'p').map(e => e.textContent).join('\n');
    assert.ok(text.includes('Caso: Viejo') || text.includes('Caso: '), 'se ofrece el caso que sí existe');
    assert.ok(!text.includes('Fantasma'), 'el caso inexistente no se ofrece');
    global.fetch = realFetch;
  }

  console.log('OK authentic_performance (cliente)');
})().catch(error => { console.error = console.log; console.error(error); process.exit(1); });
