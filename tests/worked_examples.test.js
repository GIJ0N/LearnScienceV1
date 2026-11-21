// worked_examples_v1 (L4b, cliente): ejemplo resuelto con gemelos, «¿Por qué este paso?» y escalera de huecos.
// Ningún paso de este bloque crea EVIDENCE, TRUST, cobertura ni ancla; el porqué no sale hacia el modelo.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute() {}, prepend() {} }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');

const WEX = 'worked_examples_v1';
let calls = [], setResponse = null, setError = null, openResponse = null;
const SET_ID = 'wexs-1';
const whyItem = n => ({ item_id: 'wex-why-' + n, schema_version: WEX, node_id: 'a', prompt: '¿Por qué se hace el paso ' + n + '?', wex_role: 'why', set_id: SET_ID, step_index: n - 1,
  options: [{ id: 'a', text: 'Conserva la masa' }, { id: 'b', text: 'Divide por el tiempo' }, { id: 'c', text: 'Resta la densidad' }] });
const blankItem = (idn, n) => ({ item_id: 'wex-b' + idn, schema_version: WEX, node_id: 'a', prompt: '¿Qué paso falta ' + n + '?', wex_role: 'blank', blank_kind: 'choice', set_id: SET_ID, twin_index: 0, step_index: n, rung: 1,
  options: [{ id: 'a', text: 'Calcular la masa total' }, { id: 'b', text: 'Dividir el área entre el tiempo' }, { id: 'c', text: 'Restar la densidad' }] });
const workedSet = () => ({ schema_version: WEX, set_id: SET_ID, node_id: 'a', kind: 'procedure', wex_role: 'set', item_id: SET_ID,
  worked: { prompt: 'Problema resuelto 120 g sobre 2 m²', steps: [{ text: 'Identificar la masa', why: whyItem(1) }, { text: 'Identificar el área' }, { text: 'Dividir masa entre área', why: whyItem(3) }] },
  twins: [{ index: 0, prompt: 'Gemelo 300 g sobre 5 m²' }, { index: 1, prompt: 'Gemelo 90 g sobre 3 m²' }, { index: 2, prompt: 'Gemelo 60 g sobre 4 m²' }] });
const openView = (index = 0, rung = 1) => ({ schema_version: WEX, set_id: SET_ID, index, rung, prompt: 'Gemelo ' + index, steps: [{ text: 'Identificar la masa' }, { blank: true, step_index: 1 }, { text: 'Dividir masa entre área' }], blanks: [blankItem(index + '-' + rung, 2)] });

global.fetch = async (route, options) => {
  const body = JSON.parse(options.body);
  calls.push({ route, body });
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  if (route === '/api/lesson/worked') { if (setError) return { ok: false, json: async () => ({ error: setError }) }; return { ok: true, json: async () => setResponse }; }
  if (route === '/api/lesson/worked/open') return { ok: true, json: async () => openResponse || openView(body.index, body.rung) };
  if (route === '/api/lesson/worked/answer') return { ok: true, json: async () => ({ schema_version: WEX, item_id: body.item_id, node_id: 'a', status: body.selected_option_id === 'a' ? 'CORRECT' : body.selected_option_id ? 'MISCONCEPTION' : 'UNKNOWN', evaluator_version: 'worked-local-v1', explanation: 'Porque conserva la masa.', correct_option_id: 'a' }) };
  if (route === '/api/lesson/worked/why') return { ok: true, json: async () => ({ schema_version: WEX, item_id: body.item_id, node_id: 'a', status: body.selected_option_id === 'a' ? 'CORRECT' : 'MISCONCEPTION', evaluator_version: 'worked-local-v1', explanation: 'Conserva la masa.' }) };
  if (route === '/api/lesson/worked/why/open') return { ok: true, json: async () => ({ schema_version: WEX, item_id: body.item_id, node_id: 'a', status: 'OPEN', explanation: 'Conserva la masa.', evaluator_version: 'worked-local-v1' }) };
  if (route === '/api/lesson/steps') return { ok: false, json: async () => ({ error: 'no esperado en este flujo' }) };
  if (route === '/api/lesson/faded') return { ok: false, json: async () => ({ error: 'faded no esperado' }) };
  throw Error('Ruta inesperada ' + route);
};

const node = { id: 'a', name: 'Masa por área', level: 0, prerequisites: [], outcome: 'Resolver', probe: { prompt: 'Explica', kind: 'explanation' } };
function goal(extra = {}) {
  return {
    id: 'g', profile_id: 'profile-test', goal: 'Pintura', nodes: [node], learner: {}, reviews: [], events: [],
    coverage: [{ id: 'a', name: 'a', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] }],
    lessons: { a: { explanation: 'Explicación', example: 'Ejemplo', common_error: 'Error', created_at: 1, adaptation_mode: 'initial', check: { prompt: 'c', reference: 'r', kind: 'explanation' }, guided: { prompt: 'g', reference: 'r', kind: 'application' }, independent: { prompt: 'i', reference: 'r', kind: 'application' }, integration: { prompt: 'x', reference: 'r', kind: 'application' }, ...(extra.lesson || {}) } },
    session: { mode: 'TEACH', node: 'a', stack: [], tries: 0, hints: 0 }, ...(extra.top || {}),
  };
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
const find = (label, root = roots.app) => { if (root && root.textContent === label) return root; for (const c of (root && root.children) || []) { const f = find(label, c); if (f) return f; } return null; };
const has = (needle, root = roots.app) => { if (root && String(root.textContent || '').includes(needle)) return true; return ((root && root.children) || []).some(c => has(needle, c)); };
const routeCalls = r => calls.filter(c => c.route === r);
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setImmediate(r)); };
const exposureEvents = g => g.events.filter(e => e.type === 'EVIDENCE');

(async () => {
  // 1. Lección nueva en initial: «Ahora lo intento» pide /api/lesson/worked y nunca /api/lesson/faded.
  {
    const g = attach(goal()); calls = []; setResponse = workedSet(); setError = null; roots.app.children = [];
    assert.equal(p.workedAllowed(g.lessons.a), true, 'lección nueva en initial: puede pedir el ejemplo');
    assert.equal(p.fadedAllowed(g.lessons.a), true, 'sin worked ni faded el flujo antiguo solo sería alcanzable si workedAllowed fallara');
    g.lessons.a.worked = null; assert.equal(p.fadedAllowed(g.lessons.a), false, 'worked no disponible: nunca cae al ejemplo antiguo');
    g.lessons.a.worked = undefined;
    await p.session(); assert.ok(find('Ahora lo intento'), 'ofrece el botón de paso');
    find('Ahora lo intento').onclick(); await settle(); await p.session(); await settle(); await p.session();
    assert.equal(routeCalls('/api/lesson/faded').length, 0, 'nunca pide el ejemplo antiguo');
    assert.equal(routeCalls('/api/lesson/worked').length, 1, 'pide el conjunto una sola vez');
    assert.ok(has('Un ejemplo resuelto'), 'muestra el ejemplo resuelto');
    assert.ok(has('Saltar ejemplos'), 'Saltar ejemplos siempre visible');
    assert.ok(has('Es práctica con apoyo: no cuenta como dominio'), 'aviso fijo');
    assert.equal(exposureEvents(g).length, 0, 'mostrar el ejemplo no crea evidencia');
  }

  // 2. Fallo de la ruta: worked queda en null, una sola llamada, la lección continúa sin aviso en bucle.
  {
    const g = attach(goal()); calls = []; setResponse = null; setError = 'El conjunto no cumplió el contrato'; roots.app.children = [];
    await p.session(); find('Ahora lo intento').onclick(); await settle(); await p.session(); await settle(); await p.session();
    assert.equal(g.lessons.a.worked, null, 'degrada a null');
    assert.equal(routeCalls('/api/lesson/worked').length, 1, 'un solo intento, sin reintento automático');
    assert.equal(routeCalls('/api/lesson/faded').length, 0, 'no cae al ejemplo antiguo');
    assert.equal(g.session.mode, 'COMPREHENSION', 'la lección continúa a la comprobación, sin bloquearse');
    assert.equal(has('Un ejemplo resuelto'), false, 'no muestra un ejemplo inexistente');
  }

  // 3. Lección guardada con faded (objeto o null): sigue en el flujo antiguo, sin worked.
  for (const faded of [null, { schema_version: 'faded_examples_v1' }]) {
    const g = attach(goal({ lesson: { faded } })); calls = []; roots.app.children = [];
    assert.equal(p.workedAllowed(g.lessons.a), false, 'faded definido: sin worked');
    assert.equal(p.fadedAllowed(g.lessons.a), faded !== null, 'el flujo antiguo se mantiene');
    await p.session(); assert.equal(routeCalls('/api/lesson/worked').length, 0);
  }

  // 4. Lean (adaptation consolidate): sin pasos, sin ejemplo abierto, sin ejemplo con huecos; el ejemplo queda en <details>.
  {
    const g = attach(goal({ lesson: { adaptation_mode: 'consolidate', support: 'lean' } })); calls = []; roots.app.children = [];
    assert.equal(p.workedAllowed(g.lessons.a), false, 'lean: no hay ejemplo con huecos');
    await p.session(); await settle(); await p.session();
    assert.equal(routeCalls('/api/lesson/steps').length + routeCalls('/api/lesson/worked').length, 0, 'lean no pide pasos ni ejemplos');
    assert.ok(find('Ver un ejemplo resuelto'), 'ejemplo en <details> cerrado');
  }

  // 5. whyMode: abierto tras dos aciertos de menú seguidos; vuelve a menú tras «Dije otra cosa».
  {
    const g = goal();
    assert.equal(p.whyMode(g, 'a'), 'menu', 'sin historial: menú');
    g.events.push({ type: 'WORKED_WHY', node_id: 'a', item_id: 'w1', mode: 'menu', status: 'CORRECT', creates_evidence: false, set_id: SET_ID, step_index: 0 });
    assert.equal(p.whyMode(g, 'a'), 'menu', 'un acierto no basta');
    g.events.push({ type: 'WORKED_WHY', node_id: 'a', item_id: 'w2', mode: 'menu', status: 'CORRECT', creates_evidence: false, set_id: SET_ID, step_index: 2 });
    assert.equal(p.whyMode(g, 'a'), 'open', 'dos aciertos seguidos: abierto');
    g.events.push({ type: 'WORKED_WHY', node_id: 'a', item_id: 'w3', mode: 'open', status: null, self_match: 'no', text: 'algo', creates_evidence: false, set_id: SET_ID, step_index: 1 });
    assert.equal(p.whyMode(g, 'a'), 'menu', 'Dije otra cosa: vuelve al menú');
    g.events.push({ type: 'WORKED_WHY', node_id: 'a', item_id: 'w2', mode: 'menu', status: 'CORRECT', creates_evidence: false, set_id: SET_ID, step_index: 2 });
    assert.equal(p.whyMode(g, 'a'), 'menu', 'un duplicado de ítem no cuenta');
  }

  // 6. WORKED_WHY no cambia exposición, racha, evidencia ni la referencia diferida; nunca llama a /api/evaluate.
  {
    const g = attach(goal()); const before = JSON.stringify([p.lastExposure(g, 'a'), g.reviews]);
    const ev = { type: 'WORKED_WHY', node_id: 'a', item_id: 'wex-why-1', mode: 'menu', status: 'CORRECT', creates_evidence: false, set_id: SET_ID, step_index: 0, at: Date.now() };
    g.events.push(ev);
    assert.equal(p.isStudyAnswer(ev), false, 'no cuenta para racha');
    assert.equal(p.EXPOSURE_TYPES.includes('WORKED_WHY'), false, 'no es exposición');
    assert.equal(JSON.stringify([p.lastExposure(g, 'a'), g.reviews]), before, 'no cambia la última exposición ni la revisión');
    assert.equal(routeCalls('/api/evaluate').length, 0);
  }

  // 7. Huecos del ejemplo worked: FADED_STEP con worked_version no cuenta para racha ni como evidencia.
  {
    const worked = { type: 'FADED_STEP', node_id: 'a', item_id: 'wex-b1', attempt_id: 'x1', status: 'CORRECT', worked_version: WEX, set_id: SET_ID, twin_index: 0, rung: 1, at: Date.now() };
    const legacy = { type: 'FADED_STEP', node_id: 'a', item_id: 'fade-1', attempt_id: 'x2', status: 'CORRECT', at: Date.now() };
    assert.equal(p.isStudyAnswer(worked), false, 'hueco worked: no racha');
    assert.equal(p.isStudyAnswer(legacy), true, 'hueco antiguo: sin cambios');
  }

  // 8. Escalera pura: sube con gemelos acertados, baja con fallos o UNKNOWN, mín 1, máx 3, finales explícitos.
  {
    // Una apertura completa: en peldaño 2 hay dos huecos; en peldaños 1 y 3, uno.
    const ev = (twin, rung, status, n = rung === 2 ? 2 : 1) => Array.from({ length: n }, (_, i) => ({ type: 'FADED_STEP', node_id: 'a', set_id: SET_ID, worked_version: WEX, twin_index: twin, rung, status, item_id: 'b' + twin + rung + i, attempt_id: 'at' + twin + rung + i, at: twin * 10 + rung + i }));
    const set = workedSet();
    const g = (...events) => ({ events: events.flat() });
    assert.deepEqual(p.workedLadder(g(), set), { rung: 1, state: 'continue' }, 'empieza en peldaño 1');
    assert.equal(p.workedLadder(g(ev(0, 1, 'CORRECT')), set).rung, 2, 'acierto completo sube');
    assert.equal(p.workedLadder(g(ev(0, 1, 'CORRECT'), ev(1, 2, 'CORRECT')), set).rung, 3, 'sube hasta 3');
    assert.equal(p.workedLadder(g(ev(0, 1, 'CORRECT'), ev(1, 2, 'CORRECT'), ev(2, 3, 'CORRECT')), set).state, 'solo_correct', 'problema solo acertado');
    assert.equal(p.workedLadder(g(ev(0, 1, 'CORRECT'), ev(1, 2, 'MISCONCEPTION')), set).rung, 1, 'fallo baja');
    assert.equal(p.workedLadder(g(ev(0, 1, 'CORRECT'), ev(1, 2, 'UNKNOWN')), set).rung, 1, 'UNKNOWN cuenta como fallo');
    // Acierto parcial en peldaño 2 (un hueco bien, otro mal): la apertura no está completa, no sube.
    const mixed = [ev(1, 2, 'CORRECT', 1)[0], { ...ev(1, 2, 'MISCONCEPTION', 1)[0], item_id: 'mixto2', attempt_id: 'mixto2' }];
    assert.equal(p.workedLadder(g(ev(0, 1, 'CORRECT'), mixed), set).rung, 1, 'acierto parcial no sube');
    assert.equal(p.workedLadder(g(ev(0, 1, 'MISCONCEPTION'), ev(1, 1, 'MISCONCEPTION')), set).state, 'needs_teaching', 'dos fallos seguidos en peldaño 1');
    assert.equal(p.workedLadder(g(ev(0, 1, 'MISCONCEPTION'), ev(1, 1, 'CORRECT'), ev(2, 1, 'MISCONCEPTION')), set).state, 'continue', 'un acierto rompe la racha');
    assert.equal(p.workedLadder(g(ev(0, 1, 'CORRECT'), ev(1, 2, 'MISCONCEPTION'), ev(2, 1, 'MISCONCEPTION')), set).state, 'continue', 'un fallo en peldaño 2 no cuenta como racha de peldaño 1');
    assert.equal(p.workedLadder(g(ev(0, 1, 'MISCONCEPTION'), ev(1, 1, 'MISCONCEPTION')), { ...set, twins: set.twins }).rung, 1, 'mínimo 1');
    assert.equal(p.workedLadder(g(ev(0, 1, 'CORRECT'), ev(1, 2, 'CORRECT'), ev(2, 3, 'CORRECT')), { ...set, twins: [] }).state, 'solo_correct', 'final explícito aunque no queden gemelos');
    assert.equal(p.workedLadder(g(ev(0, 1, 'CORRECT'), ev(1, 2, 'MISCONCEPTION'), ev(2, 1, 'CORRECT')), set).state, 'continue');
    assert.equal(p.workedLadder(g(ev(0, 1, 'CORRECT'), ev(1, 2, 'CORRECT'), ev(2, 3, 'MISCONCEPTION')), set).rung, 2, 'máximo 3; fallo en 3 baja a 2');
    assert.equal(p.workedLadder(g(ev(0, 1, 'CORRECT'), ev(1, 2, 'CORRECT'), ev(2, 3, 'MISCONCEPTION')), set).state, 'continue');
    assert.equal(p.workedLadder({ events: [{ type: 'WORKED_LADDER_END', node_id: 'a', set_id: SET_ID, reason: 'self_skip', final_rung: 3, creates_evidence: false }] }, set).state, 'self_skip', 'un cierre registrado manda');
  }

  // 9. Ahorro: aplicar un hueco worked no crea EVIDENCE, no toca exposición de revisión ni llama a evaluate.
  {
    const g = attach(goal()); const item = blankItem('1-1', 2);
    const before = JSON.stringify(g.reviews);
    p.applyWorkedBlank(g, SET_ID, { twin_index: 0, rung: 1, blank_kind: 'choice', step_index: 1 }, item, { status: 'CORRECT', item_id: item.item_id, node_id: 'a' }, 'att-1', 'a', 80);
    assert.equal(exposureEvents(g).length, 0, 'sin EVIDENCE');
    assert.equal(JSON.stringify(g.reviews), before, 'sin cambios en revisiones');
    assert.equal(g.events.filter(e => e.type === 'FADED_STEP' && e.worked_version === WEX).length, 1);
    assert.equal(p.applyWorkedBlank(g, SET_ID, { twin_index: 0, rung: 1, blank_kind: 'choice', step_index: 1 }, item, { status: 'CORRECT', item_id: item.item_id, node_id: 'a' }, 'att-2', 'a', 80), false, 'solo cuenta la primera respuesta por ítem');
  }

  // 10. Exposición formativa: una por gemelo revelado; repetir el mismo día no vuelve a contar.
  {
    const g = attach(goal());
    assert.equal(p.recordFormativeExposure(g, 'a', 'worked_examples', SET_ID + ':0'), true);
    assert.equal(p.recordFormativeExposure(g, 'a', 'worked_examples', SET_ID + ':0'), null, 'dedupe por gemelo');
    assert.equal(g.events.filter(e => e.type === 'FORMATIVE_EXPOSURE').length, 1);
    assert.equal(p.isStudyAnswer({ type: 'FORMATIVE_EXPOSURE' }), false);
  }

  // 11. Código nuevo sin innerHTML y con texto hostil tratado como texto (E/X).
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const block = src.slice(src.indexOf('// worked_examples_v1 (L4b)'), src.indexOf('// worked_examples_v1 (L4b) fin'));
    assert.ok(block.length > 2000, 'bloque L4b presente');
    assert.equal(/innerHTML/.test(block), false, 'sin innerHTML');
    assert.equal(/\.innerHTML\s*=/.test(src), false, 'ningún innerHTML asignado en app.js');
  }

  // 12. Tras dos fallos seguidos en peldaño 1 la lección pasa a paso a paso (requiere pasos con learner_requested).
  {
    const g = attach(goal()); const l = g.lessons.a; l.worked = workedSet(); calls = []; roots.app.children = [];
    p.workedNeedsTeaching(g, 'a', l);
    assert.equal(l.support, 'full', 'vuelve a la lección por pasos');
    assert.equal(l.support_returned, true);
    assert.equal(l.worked_done, true, 'el conjunto queda cerrado');
    const last = g.events.filter(e => e.type === 'WORKED_LADDER_END').at(-1);
    assert.equal(last.reason, 'needs_teaching');
  }

  // 13. «Ya puedo solo» registra WORKED_LADDER_END con self_skip y abre el problema solo.
  {
    const g = attach(goal()); const l = g.lessons.a; l.worked = workedSet(); calls = []; roots.app.children = [];
    await p.workedSelfSkip(g, 'a', l);
    const end = g.events.filter(e => e.type === 'WORKED_LADDER_END').at(-1);
    assert.equal(end.reason, 'self_skip');
    assert.equal(end.creates_evidence, false);
    assert.equal(routeCalls('/api/lesson/worked/open').length, 1);
    assert.equal(routeCalls('/api/lesson/worked/open')[0].body.rung, 3, 'salta al problema solo');
  }

  console.log('worked_examples: OK');
})().catch(err => { console.error(err); process.exit(1); });
