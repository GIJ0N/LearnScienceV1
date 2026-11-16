// teaching_ladder_v1 (cliente): cada «no lo logró» sube un peldaño y nunca repite; no crea EVIDENCE; la respuesta posterior cuenta con ayuda.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute() {}, prepend() {} }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');

let calls = [], directError = null, rung3Error = null;
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const checkItem = n => ({ schema_version: 'direct_teaching_v1', item_id: 'direct-' + n, node_id: 'a', prompt: '¿Qué controla el espesor de película? (' + n + ')', options: [{ id: 'a', text: 'La cobertura y el curado' }, { id: 'b', text: 'El color final' }, { id: 'c', text: 'La carga de la pistola' }] });
const pkg = rung => ({ schema_version: 'direct_teaching_v1', ...(rung > 1 ? { rung } : {}), needs: ['Qué es el espesor', 'Por qué cambia el curado'],
  steps: [{ body: 'Versión ' + rung + ': el espesor es la altura de la capa curada, en micras.' }, { body: 'Versión ' + rung + ': una capa más gruesa tarda más en curar porque el calor atraviesa más material.' }],
  worked: { prompt: 'Ejemplo ' + rung + ': una lámina recibe 80 micras y otra 160. ¿Cuál cura más lento?', steps: ['Comparar espesores.', 'El calor atraviesa el doble.', 'Cura más lento la de 160.'] }, check: checkItem(rung), content_check: { checked: true } });
const commented = () => ({ schema_version: 'direct_teaching_v1', rung: 3, model_answer: 'RESPUESTA-MODELO: entre 60 y 80 micras.', why: ['Porque cubre sin escurrir.', 'Porque cura parejo en el horno.'], content_check: { checked: true } });
global.fetch = async (route, options) => {
  const body = JSON.parse(options.body);
  calls.push({ route, body });
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  if (route === '/api/evaluate') {
    if (body.answer === 'No sé') return { ok: true, json: async () => ({ status: 'UNKNOWN', feedback: 'Está bien no saberlo aún.', error_type: 'lack_of_exposure', hint: '', evaluator_version: 'local-fixture' }) };
    if (body.answer === 'Incierto') return { ok: true, json: async () => ({ status: 'UNKNOWN', feedback: 'No pude evaluarlo.', error_type: 'attention', hint: '', evaluator_version: 'local-fixture' }) };
    if (body.answer === 'Parcial') return { ok: true, json: async () => ({ status: 'PARTIAL', feedback: 'Confundes espesor con color', error_type: 'conceptual', hint: '', evaluator_version: 'local-fixture' }) };
    return { ok: true, json: async () => ({ status: 'CORRECT', feedback: 'Correcto', error_type: 'none', hint: '', evaluator_version: 'local-fixture' }) };
  }
  if (route === '/api/teach/direct') {
    const rung = body.rung || 1;
    if (rung === 3 && rung3Error) return { ok: false, json: async () => ({ error: rung3Error }) };
    if (directError) return { ok: false, json: async () => ({ error: directError }) };
    return { ok: true, json: async () => rung === 3 ? commented() : pkg(rung) };
  }
  if (route === '/api/teach/direct/answer') return { ok: true, json: async () => ({ schema_version: 'direct_teaching_v1', status: body.selected_option_id === 'a' ? 'CORRECT' : body.selected_option_id ? 'MISCONCEPTION' : 'UNKNOWN', item_id: body.item_id, node_id: 'a', correct_option_id: 'a', explanation: 'Porque el espesor define el curado.', selected_misconception: body.selected_option_id === 'b' ? 'Confunde espesor con color' : '', error_type: 'none' }) };
  return { ok: false, json: async () => ({ error: 'sin ruta en la prueba: ' + route }) };
};

const node = { id: 'a', name: 'Espesor', level: 0, prerequisites: [], outcome: 'Controlar el espesor', probe: { prompt: 'Explica', kind: 'explanation' } };
const Q = { check: { prompt: '¿Por qué medir el espesor?', reference: 'Porque controla el curado', kind: 'explanation' }, guided: { prompt: 'Guiada', reference: 'r', kind: 'application' }, independent: { prompt: '¿Qué espesor da cobertura?', reference: 'Entre 60 y 80 micras', kind: 'application' }, integration: { prompt: 'Integra', reference: 'r', kind: 'context_case' } };
function goal(mode = 'INDEPENDENT', extra = {}) {
  return {
    id: 'g', profile_id: 'profile-test', goal: 'Pintura', nodes: [node], learner: {}, reviews: [], events: [],
    coverage: [{ id: 'a', name: 'a', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] }],
    lessons: { a: { explanation: 'Explicación', example: 'Ejemplo', common_error: 'Error', ...Q, adaptation_mode: 'initial' } },
    session: { mode, node: 'a', stack: [], tries: 0, hints: 0 }, ...extra,
  };
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
const find = (label, root = roots.app) => { if (root && root.textContent === label) return root; for (const c of (root && root.children) || []) { const f = find(label, c); if (f) return f; } return null; };
const has = (needle, root = roots.app) => { if (root && String(root.textContent || '').includes(needle)) return true; return ((root && root.children) || []).some(c => has(needle, c)); };
const evidence = g => g.events.filter(e => e.type === 'EVIDENCE');
const ladderEvents = g => g.events.filter(e => e.type === 'TEACHING_LADDER');
const ROLE = { COMPREHENSION: 'comprehension_check', GUIDED: 'guided_practice', INDEPENDENT: 'independent_practice', INTEGRATE: 'integration', REVIEW: 'spaced_review' };
const KEY = { COMPREHENSION: 'check', GUIDED: 'guided', INDEPENDENT: 'independent', INTEGRATE: 'integration' };
const teachCalls = () => calls.filter(c => c.route === '/api/teach/direct');
const view = async () => { roots.app.children = []; await p.session(); };

async function answer(g, phase, text, question) {
  await settle(20);
  const q = question || g.lessons.a[KEY[phase]], box = element();
  const ui = p.renderQuestion(box, q, 'a', phase, ROLE[phase]);
  assert.equal(ui.ok, true);
  ui.answer.value = text;
  await (text === 'No sé' ? ui.dontKnow : ui.submit).onclick();
  const go = find('Continuar', ui.feedback);
  assert.ok(go, 'hay botón Continuar');
  go.onclick();
  await settle();
  return ui;
}
// «No sé» y mostrar la pantalla (llama a la ruta); la persona vuelve a la pregunta con directReturn cuando se pide.
async function dontKnow(g, phase = 'INDEPENDENT', question) { await answer(g, phase, 'No sé', question); await view(); }
// La misma pregunta reaparece (navegación, respaldo restaurado, el modelo repite el enunciado): la lección guardada vuelve tal cual.
const snapshot = g => JSON.parse(JSON.stringify(g.lessons.a));
function comeBack(g, saved, mode = 'INDEPENDENT') { g.lessons.a = JSON.parse(JSON.stringify(saved)); g.session.mode = mode; g.session.node = 'a'; g.session.direct = null; }
const optionB = () => (function walk(n) { if (n && String(n.textContent).startsWith('b) ')) return n; for (const c of (n && n.children) || []) { const f = walk(c); if (f) return f; } return null; })(roots.app);

(async () => {
  // 1. «No sé» x3 -> peldaños 1, 2, 3 sin repetir; el cuarto solo ofrece «Seguir con otro tema».
  {
    const g = attach(goal()); calls = []; directError = null; rung3Error = null; const saved = snapshot(g);
    await dontKnow(g);
    assert.equal(g.session.direct.rung, 1); assert.equal(g.session.direct.status, 'ready');
    assert.equal(teachCalls()[0].body.rung, undefined, 'el peldaño 1 no añade campos nuevos');
    assert.equal(teachCalls()[0].body.avoid, undefined);
    assert.ok(g.session.hints >= 1); assert.equal(g.session.ladder['a|' + Q.independent.prompt].rung, 1);
    const bodies1 = pkg(1).steps.map(x => x.body);
    p.directReturn(g); await dontKnow(g);
    assert.equal(g.session.direct.rung, 2); assert.equal(g.session.direct.status, 'ready');
    const b2 = teachCalls()[1].body;
    assert.equal(b2.rung, 2); assert.deepEqual(b2.avoid, bodies1, 'avoid = pasos ya mostrados');
    assert.equal(b2.question.prompt, Q.independent.prompt);
    assert.ok(has('Te lo explico de otra forma')); assert.equal(has('Versión 1'), false, 'no repite el peldaño 1');
    assert.ok(g.session.hints >= 2, 'ayuda >=2 tras el peldaño 2');
    p.directReturn(g); await dontKnow(g);
    assert.equal(g.session.direct.rung, 3); assert.equal(g.session.direct.status, 'ready');
    assert.equal(teachCalls()[2].body.rung, 3); assert.equal(teachCalls()[2].body.question.reference, Q.independent.reference);
    assert.ok(has('Respuesta comentada')); assert.ok(has('RESPUESTA-MODELO')); assert.ok(find('Seguir con otro tema')); assert.ok(find('Ver la lección de nuevo'));
    assert.ok(g.session.hints >= 3); assert.equal(g.session.hint_level_max, 5, 'nivel máximo de ayuda tras ver la respuesta');
    assert.deepEqual(ladderEvents(g).map(e => e.rung), [1, 2, 3]); assert.deepEqual(ladderEvents(g).map(e => e.trigger), ['no_se', 'no_se', 'no_se']);
    assert.ok(ladderEvents(g).every(e => e.node_id === 'a' && typeof e.at === 'number'));
    assert.equal(g.events.filter(e => e.type === 'TEACHING_EXPOSURE').length >= 1, true);
    // La lección no se borra a media vista; sí al salir.
    assert.equal(g.lessons.a, undefined, 'H1: la pregunta se invalida al mostrar la respuesta'); assert.ok(has('RESPUESTA-MODELO'), 'la vista sigue con la pregunta guardada en s.direct');
    // Cuarto: solo «Seguir con otro tema».
    find('Seguir con otro tema').onclick(); await settle(); comeBack(g, saved); // salida real de la interfaz y la misma pregunta reaparece
    const before = teachCalls().length;
    await dontKnow(g, 'INDEPENDENT', Q.independent);
    assert.equal(g.session.direct.status, 'exhausted'); assert.equal(teachCalls().length, before, 'sin otra llamada');
    assert.ok(find('Seguir con otro tema')); assert.equal(find('Reintentar'), null); assert.equal(find('Ver la lección completa'), null); assert.equal(find('Ver la lección de nuevo'), null);
    assert.equal(ladderEvents(g).length, 3, 'agotada: sin evento nuevo');
    assert.equal(evidence(g).length, 4, 'solo los 4 UNKNOWN registrados, ningún EVIDENCE nuevo');
    assert.ok(evidence(g).every(e => e.result === 'UNKNOWN'));
    assert.equal(p.verified(g, 'a'), false);
  }

  // 2. Otra pregunta del mismo tema empieza en el peldaño 1; la escalera se reinicia en una visita nueva.
  {
    const g = attach(goal('GUIDED')); calls = [];
    await dontKnow(g, 'GUIDED'); p.directReturn(g); await dontKnow(g, 'GUIDED');
    assert.equal(g.session.direct.rung, 2);
    p.directReturn(g); g.session.mode = 'INDEPENDENT';
    await dontKnow(g, 'INDEPENDENT');
    assert.equal(g.session.direct.rung, 1, 'pregunta distinta, peldaño 1');
    assert.equal(Object.keys(g.session.ladder).length, 2);
    p.chooseNext(g, { newVisit: true, reselect: true });
    assert.deepEqual(g.session.ladder, {}, 'se reinicia donde se vaciaba direct_prompts'); assert.deepEqual(g.session.direct_prompts, []);
  }

  // 3. UNKNOWN de evaluación incierta: no sube ni abre nada.
  {
    const g = attach(goal()); calls = [];
    await dontKnow(g); p.directReturn(g);
    const rungBefore = g.session.ladder['a|' + Q.independent.prompt].rung;
    await answer(g, 'INDEPENDENT', 'Incierto');
    assert.ok(!g.session.direct); assert.equal(g.session.ladder['a|' + Q.independent.prompt].rung, rungBefore);
    assert.equal(ladderEvents(g).length, 1); assert.equal(teachCalls().length, 1);
  }

  // 4. directFull sube de peldaño en vez de repetir la lección; con la escalera en 0 conserva el comportamiento anterior.
  {
    const g = attach(goal()); calls = [];
    await dontKnow(g);
    p.directFull(g, node); await settle(); await view();
    assert.equal(g.session.direct.rung, 2); assert.equal(g.session.mode, 'INDEPENDENT', 'no vuelve a la lección guardada');
    assert.equal(ladderEvents(g).at(-1).trigger, 'direct_full');
    const f = attach(goal()); calls = []; directError = 'El servidor falló';
    await dontKnow(f); assert.equal(f.session.direct.status, 'failed');
    directError = null; p.directFull(f, node);
    assert.equal(f.session.direct, null); assert.equal(f.session.mode, 'TEACH', 'escalera en 0: lección completa como antes');
  }

  // 5. Check fallado: aparece «Explícamelo de otra forma» (con la idea errónea) y sube al peldaño 2.
  {
    const g = attach(goal()); calls = [];
    await dontKnow(g);
    g.session.direct.stage = 4; await view();
    optionB().onclick(); await find('Responder').onclick();
    assert.equal(g.events.find(e => e.type === 'DIRECT_CHECK').status, 'MISCONCEPTION');
    assert.ok(find('Volver a la pregunta')); const other = find('Explícamelo de otra forma'); assert.ok(other, 'ofrece otra forma');
    other.onclick(); await settle(); await view();
    assert.equal(g.session.direct.rung, 2);
    assert.equal(teachCalls().at(-1).body.misconception, 'Confunde espesor con color');
    assert.equal(ladderEvents(g).at(-1).trigger, 'check_failed');
    // Con la comprobación correcta no se ofrece.
    const h = attach(goal()); calls = [];
    await dontKnow(h); h.session.direct.stage = 4; await view();
    (function walk(n) { if (n && String(n.textContent).startsWith('a) ')) n.onclick(); for (const c of (n && n.children) || []) walk(c); })(roots.app);
    await find('Responder').onclick();
    assert.equal(find('Explícamelo de otra forma'), null); assert.ok(find('Volver a la pregunta'));
  }

  // 6. Tope de intentos tras un fallo: ofrece el peldaño 3 con la línea explicativa; tras un acierto no.
  {
    const g = attach(goal()); calls = []; g.session.adaptive = { attempts: 5, reviews: 0, node_id: 'a' };
    await answer(g, 'INDEPENDENT', 'Parcial'); await view();
    assert.equal(g.session.direct.rung, 3); assert.equal(g.session.direct.trigger, 'attempt_cap');
    assert.ok(has('Llevas varios intentos en esta pregunta')); assert.ok(has('Respuesta comentada'));
    assert.equal(teachCalls().at(-1).body.misconception, 'Confundes espesor con color');
    assert.equal(ladderEvents(g).at(-1).trigger, 'attempt_cap');
    const h = attach(goal()); calls = []; h.session.adaptive = { attempts: 5, reviews: 0, node_id: 'a' };
    await answer(h, 'INDEPENDENT', 'Entre 60 y 80 micras');
    assert.ok(!h.session.direct, 'un acierto en el tope no abre la escalera'); assert.equal(ladderEvents(h).length, 0);
  }

  // 7. Reparación cerrada a medias: oferta con una opción más (desde REPAIRING y PARENT_RETEST).
  {
    const parent = { prompt: 'Resuelve 2x + 3 = 7', reference: 'x = 2', kind: 'application', observable_dimensions: ['direct_application'] };
    const mk = () => {
      const value = goal('INDEPENDENT'); value.nodes = [{ id: 'n0', name: 'Inversas', outcome: 'o', level: 0, prerequisites: [], kind: 'procedure', probe: { prompt: 'q', reference: 'r', kind: 'explanation', observable_dimensions: ['conceptual'] } }, { id: 'n1', name: 'Ecuaciones', outcome: 'o', level: 0, prerequisites: ['n0'], kind: 'procedure', probe: { prompt: 'q2', reference: 'r', kind: 'explanation', observable_dimensions: ['conceptual'] } }];
      value.coverage = [{ id: 'n1', name: 'Ecuaciones', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'direct_application', required: true, status: 'UNKNOWN', evidence: [] }] }];
      value.lessons = { n1: { explanation: 'E', example: 'X', common_error: 'C', independent: { ...parent, activity_id: 'parent-activity' } } };
      value.repairEpisodes = []; value.contextStack = []; value.session = { mode: 'INDEPENDENT', node: 'n1', stack: [], stage: 'teach', tries: 0, hints: 0 };
      p.setStoreForTests({ goals: [value], active: value.id }); p.setProfileForTests({ profile_id: 'profile-test' });
      const activity = p.activityContract(parent, 'n1', 'independent_practice');
      const event = p.record(value, 'n1', 'INDEPENDENT', 'Sumé', { status: 'PARTIAL', error_type: 'prerequisite', feedback: 'f', evaluator_version: 'local-fixture' }, 0, activity, 'parent-l');
      const diagnosis = { plan_version: p.REPAIR_TEACHING_VERSION, suspected_gaps: [{ gap_id: 'gap', node_id: 'n0', concept: 'Inversas', reason: 'r', motivating_evidence: 'm', confidence: 0.9, status: 'SUSPECTED' }], diagnostic_checks: [{ gap_id: 'gap', question: { prompt: '¿Qué deshace sumar?', reference: 'Restar', kind: 'explanation', observable_dimensions: ['conceptual'] } }] };
      const episode = p.createRepairEpisode(value, { activity_id: event.activity_id, attempt_id: event.attempt_id, node_id: 'n1', question: parent, response: 'Sumé', evaluation: { status: 'PARTIAL', error_type: 'prerequisite', feedback: 'f' }, help_used: 0, context_snapshot: { mode: 'INDEPENDENT', node: 'n1', stack: [], stage: 'teach', tries: 0 } }, diagnosis);
      p.pushContext(value, { context_id: 'ctx-l', episode_id: episode.episode_id, status: 'ACTIVE', history: [] });
      return { value, episode };
    };
    for (const stage of ['REPAIRING', 'PARENT_RETEST']) {
      const { value, episode } = mk(); calls = [];
      const before = evidence(value).length;
      if (stage === 'REPAIRING') { episode.status = 'REPAIRING'; episode.stage = 'GUIDED'; episode.activity_count = 5; }
      else { episode.status = 'PARENT_RETEST'; episode.stage = 'PARENT_RETEST'; episode.parent_retest = { ...(episode.parent_retest || {}), attempts: [{ result: 'PARTIAL' }] }; }
      p.transitionRepairEpisode(value, episode, { result: 'PARTIAL', is_independent: false, repair_stage: stage });
      assert.equal(episode.status, 'PARTIAL', stage); assert.ok(value.session.stuck, 'queda la oferta desde ' + stage);
      assert.equal(value.session.stuck.kind, 'repair'); assert.equal(evidence(value).length, before, 'sin EVIDENCE nuevo');
      await view();
      assert.ok(has('La reparación no terminó de resolver esto')); assert.ok(find('Enséñamelo')); assert.ok(find('Ahora no'));
      const other = find('Explícamelo de otra forma'); assert.ok(other, 'opción extra');
      other.onclick(); await settle(); await view();
      assert.equal(value.session.direct.rung, 2); assert.equal(value.session.direct.question_prompt, 'Resuelve 2x + 3 = 7');
      assert.equal(ladderEvents(value).at(-1).trigger, 'repair_partial'); assert.equal(value.session.stuck, null);
    }
    // El cierre por diagnóstico sin causa conserva su texto y también ofrece la opción extra.
    const { value, episode } = mk(); p.stuckClose(value, episode, 'x'); await view();
    assert.ok(has('El diagnóstico no encontró la causa. ¿Te lo enseño paso a paso?')); assert.ok(find('Explícamelo de otra forma'));
    // «Enséñamelo» sigue abriendo el peldaño 1 si la pregunta no se había visto.
    find('Enséñamelo').onclick(); await settle(); assert.equal(value.session.direct.rung, 1);
  }

  // 8. Pasos no resueltos de la lección por pasos: botón por cada uno (máx. 2) que abre el peldaño 2.
  {
    const steps = [1, 2, 3].map(i => ({ step_id: 'step-' + i, predict: { prompt: 'p' + i }, resolution: 'r', body: 'Cuerpo del paso ' + i + ' con detalle suficiente.', check: { schema_version: 'step_lessons_v1', item_id: 'step-item-' + i, node_id: 'a', prompt: '¿Idea ' + i + '?', options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }] } }));
    const g = attach(goal('TEACH', { id: 'g-steps' })); g.lessons.a.steps = steps; g.lessons.a.faded = null; calls = [];
    const st = p.stepState(g, 'a'); st.index = 3; st.stage = 'done'; st.unresolved = ['step-1', 'step-2', 'step-3'];
    await view();
    assert.ok(has('Hay 3 idea(s) que aún no quedaron firmes')); assert.ok(has('las volveremos a comprobar al practicar'), 'el texto se conserva');
    const buttons = []; (function walk(n) { if (n && n.textContent === 'Explícame esto de otra forma') buttons.push(n); for (const c of (n && n.children) || []) walk(c); })(roots.app);
    assert.equal(buttons.length, 2, 'máximo 2');
    buttons[0].onclick(); await settle(); await view();
    assert.equal(g.session.direct.rung, 2); assert.equal(g.session.direct.phase, 'STEP');
    const body = teachCalls().at(-1).body; assert.equal(body.rung, 2); assert.equal(body.question.prompt, '¿Idea 1?'); assert.deepEqual(body.avoid, ['Cuerpo del paso 1 con detalle suficiente.']);
    assert.equal(ladderEvents(g).at(-1).trigger, 'step_unresolved'); assert.equal(evidence(g).length, 0);
    assert.equal(g.session.hints, 0, 'no marca ayuda de otra pregunta');
    p.directReturn(g); await view();
    const again = []; (function walk(n) { if (n && n.textContent === 'Explícame esto de otra forma') again.push(n); for (const c of (n && n.children) || []) walk(c); })(roots.app);
    assert.equal(again.length, 1, 'el paso ya explicado no se vuelve a ofrecer');
    // Sin pasos no resueltos no hay botón.
    const h = attach(goal('TEACH', { id: 'g-steps' })); h.lessons.a.steps = steps; h.lessons.a.faded = null; const sh = p.stepState(h, 'a'); sh.index = 3; sh.stage = 'done'; sh.unresolved = [];
    await view(); assert.equal(find('Explícame esto de otra forma'), null);
  }

  // 9. Fallo de la ruta en el peldaño N: no avanza, no guarda, ofrece Reintentar y Seguir con otro tema; sin cuota no se revela la referencia.
  {
    const g = attach(goal()); calls = []; directError = null; rung3Error = null;
    await dontKnow(g); p.directReturn(g); await dontKnow(g); p.directReturn(g);
    rung3Error = 'cuota agotada';
    await answer(g, 'INDEPENDENT', 'No sé'); await view();
    assert.equal(g.session.direct.rung, 3); assert.equal(g.session.direct.status, 'failed');
    assert.equal(g.session.ladder['a|' + Q.independent.prompt].rung, 2, 'no avanza de peldaño');
    assert.equal(ladderEvents(g).length, 2, 'sin evento del peldaño fallido');
    assert.equal(g.reviews.length, 0, 'no se reprograma nada'); assert.ok(g.lessons.a, 'no se invalida la pregunta si no se vio la respuesta');
    await view();
    assert.ok(has('No pude preparar este apoyo ahora.')); assert.ok(find('Reintentar')); assert.ok(find('Seguir con otro tema')); assert.equal(find('Ver la lección completa'), null);
    assert.equal(has(Q.independent.reference), false, 'no revela la referencia sin cuota'); assert.equal(has('RESPUESTA-MODELO'), false);
    assert.ok(g.session.hints < 3, 'sin respuesta vista no se marca el nivel máximo'); assert.notEqual(g.session.hint_level_max, 5);
    rung3Error = null; find('Reintentar').onclick(); await view();
    assert.equal(g.session.direct.status, 'ready'); assert.equal(g.session.ladder['a|' + Q.independent.prompt].rung, 3);
    // Fallo en el peldaño 2: la escalera queda en 1.
    const h = attach(goal()); calls = [];
    await dontKnow(h); p.directReturn(h); directError = 'El servidor falló'; await dontKnow(h);
    assert.equal(h.session.direct.status, 'failed'); assert.equal(h.session.ladder['a|' + Q.independent.prompt].rung, 1);
    await view(); assert.ok(find('Reintentar')); assert.ok(find('Seguir con otro tema'));
    directError = null;
  }

  // 10. Ayuda tras cada peldaño: la respuesta posterior nunca es independiente.
  for (const rungs of [1, 2, 3]) {
    const g = attach(goal()); calls = []; const saved = snapshot(g);
    for (let i = 1; i <= rungs; i++) { await dontKnow(g); if (i < rungs) p.directReturn(g); }
    assert.equal(g.session.direct.rung, rungs);
    if (rungs < 3) p.directReturn(g); else { find('Seguir con otro tema').onclick(); await settle(); comeBack(g, saved); }
    await answer(g, 'INDEPENDENT', 'Entre 60 y 80 micras');
    const last = evidence(g).at(-1);
    assert.equal(last.result, 'CORRECT'); assert.equal(last.is_independent, false, 'peldaño ' + rungs); assert.ok(last.help_used >= rungs, 'help_used>=' + rungs);
    if (rungs === 3) assert.equal(last.hint_level_max, 5);
    assert.equal(last.supports_transfer === true || last.is_novel_variant === true, false);
    assert.equal(p.verified(g, 'a'), false);
  }

  // 11. Peldaño 3b: reprograma la pregunta y regenera la lección solo al salir.
  {
    const g = attach(goal('GUIDED')); calls = [];
    await dontKnow(g, 'GUIDED'); p.directReturn(g); await dontKnow(g, 'GUIDED'); p.directReturn(g); await dontKnow(g, 'GUIDED');
    assert.equal(g.session.direct.rung, 3);
    const review = g.reviews.find(r => r.id === 'a'); assert.ok(review, 'queda un repaso corto programado'); assert.ok(review.due <= Date.now() + 86400000 + 1000);
    assert.equal(g.lessons.a, undefined, 'H1: se invalida al mostrar la respuesta, no al salir'); assert.ok(has('RESPUESTA-MODELO'));
    find('Ver la lección de nuevo').onclick(); await settle();
    assert.equal(g.lessons.a, undefined, 'sigue sin lección: se regenera'); assert.equal(g.session.direct, null); assert.equal(g.session.mode, 'TEACH');
    const h = attach(goal('GUIDED')); calls = [];
    await dontKnow(h, 'GUIDED'); p.directReturn(h); await dontKnow(h, 'GUIDED'); p.directReturn(h); await dontKnow(h, 'GUIDED');
    find('Seguir con otro tema').onclick(); await settle();
    assert.equal(h.lessons.a, undefined); assert.equal(h.session.direct, null);
  }

  // 12. Peldaño 3a: con un prerrequisito sin evidencia ofrece «Primero conviene», sin llamar a la ruta.
  {
    const pre = { id: 'pre', name: 'Medir micras', level: 0, prerequisites: [], outcome: 'Medir', probe: { prompt: 'Explica', kind: 'explanation' } };
    const g = attach(goal()); g.nodes = [pre, { ...node, prerequisites: ['pre'] }]; calls = [];
    await dontKnow(g); p.directReturn(g); await dontKnow(g); p.directReturn(g);
    const before = teachCalls().length;
    await dontKnow(g); await view();
    assert.equal(g.session.direct.status, 'prereq'); assert.equal(teachCalls().length, before, 'sin llamada: no hay respuesta que pedir');
    assert.ok(has('Primero conviene: Medir micras')); const go = find('Ir a ese tema'); assert.ok(go);
    assert.equal(ladderEvents(g).at(-1).rung, 3); assert.equal(g.session.hints, 2, 'ayuda exacta tras el 3a'); assert.notEqual(g.session.hint_level_max, 5, 'no se vio la respuesta');
    assert.equal(has('RESPUESTA-MODELO'), false);
    go.onclick(); await settle();
    assert.equal(g.session.hints, 0, 'H6: la primera respuesta del prerrequisito no cuenta con ayuda'); assert.equal(g.session.hint_level_max, null);
    assert.equal(g.session.node, 'pre'); assert.ok(g.session.stack.includes('a'), 'apila el tema padre'); assert.equal(g.session.direct, null);
  }

  // 13. REVIEW: ni la escalera ni el peldaño 3 mueven el calendario; la pregunta vista no vuelve como evidencia.
  {
    const review = { id: 'a', due: 1000, step: 2, origin_attempt_id: 'orig', target_dimension: 'conceptual', question: { prompt: '¿Qué mide el espesor?', reference: 'Altura de la capa', kind: 'explanation' }, history: [] };
    const g = attach(goal('REVIEW', { reviews: [review] })); calls = [];
    const snap = () => JSON.stringify({ due: review.due, step: review.step, history: review.history, n: g.reviews.length });
    const base = snap();
    await dontKnow(g, 'REVIEW', review.question); assert.equal(g.session.direct.rung, 1); assert.equal(snap(), base);
    p.directReturn(g); await dontKnow(g, 'REVIEW', review.question); assert.equal(g.session.direct.rung, 2); assert.equal(snap(), base);
    p.directReturn(g); await dontKnow(g, 'REVIEW', review.question); assert.equal(g.session.direct.rung, 3); assert.equal(snap(), base, 'el peldaño 3 no mueve el calendario');
    assert.ok(g.session.hints >= 3 && g.session.hint_level_max === 5);
    p.directOther(g); await settle();
    assert.equal(snap(), base, 'tampoco al salir'); assert.equal(review.question, null, 'la pregunta vista ya no sirve para independencia');
    assert.equal(evidence(g).length, 3); assert.ok(evidence(g).every(e => e.result === 'UNKNOWN'));
  }

  // 14. Estados antiguos sin s.ladder (ni direct_prompts) se cargan y funcionan; el estado nuevo es aditivo.
  {
    const g = attach(goal()); delete g.session.ladder; delete g.session.direct_prompts; calls = [];
    assert.equal(p.ladderRung(g, 'a', Q.independent), 0);
    await dontKnow(g); assert.equal(g.session.direct.rung, 1);
    const legacy = goal(); legacy.session.direct = { version: 'direct_teaching_v1', node_id: 'a', phase: 'INDEPENDENT', question_prompt: Q.independent.prompt, status: 'repeat', stage: 0 };
    attach(legacy); assert.doesNotThrow(() => p.normalizeGoal ? p.normalizeGoal(legacy) : true);
    assert.equal(p.ladderAnswerValid(commented()), true); assert.equal(p.ladderAnswerValid({ ...commented(), why: ['uno'] }), false); assert.equal(p.ladderAnswerValid({ ...commented(), rung: 2 }), false);
  }

  // 15. Sin sesión de reparación activa: con una reparación en curso no se abre la escalera.
  {
    const g = attach(goal()); g.contextStack = [{ context_id: 'c', episode_id: 'e', status: 'ACTIVE', history: [] }];
    assert.equal(p.openDirect(g, 'a', 'INDEPENDENT', Q.independent, 'x'), false); assert.ok(!g.session.direct);
    assert.equal(g.session.ladder === undefined || Object.keys(g.session.ladder).length === 0, true);
  }
  // 16. Tras el check del peldaño 2, el ejemplo con huecos existente se ofrece aunque el modo de la lección no lo permita; en el peldaño 1 no.
  {
    const faded = { schema_version: 'faded_examples_v1', worked: { prompt: 'Ejemplo resuelto de huecos', steps: ['a', 'b', 'c'] }, faded: { prompt: 'Ahora tú', steps: [{ text: 's1' }, { blank: true, check: { item_id: 'fade-1', node_id: 'a', prompt: '¿Hueco?', options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }] } }, { text: 's3' }] } };
    const g = attach(goal(), {}); g.lessons.a.adaptation_mode = 'consolidate'; g.lessons.a.faded = faded; calls = [];
    assert.equal(p.fadedAllowed(g.lessons.a), false, 'el modo no lo permite');
    await dontKnow(g); g.session.direct.stage = 4; g.events.push({ type: 'DIRECT_CHECK', node_id: 'a', item_id: g.session.direct.package.check.item_id, status: 'CORRECT' }); await view();
    assert.equal(has('Probar un ejemplo con huecos'), false, 'peldaño 1: sin oferta'); assert.ok(find('Volver a la pregunta'));
    p.directReturn(g); await dontKnow(g); g.session.direct.stage = 4; g.events.push({ type: 'DIRECT_CHECK', node_id: 'a', item_id: g.session.direct.package.check.item_id, status: 'CORRECT' }); await view();
    const offer = find('Probar un ejemplo con huecos'); assert.ok(offer, 'peldaño 2: oferta opcional'); assert.ok(find('Volver a la pregunta'));
    offer.onclick(); await settle(); await view();
    assert.ok(has('Ejemplo resuelto de huecos')); assert.ok(has('Saltar ejemplo'));
    find('Saltar ejemplo').onclick(); await settle(); await view();
    assert.equal(has('Probar un ejemplo con huecos'), false, 'ya saltado: no se vuelve a ofrecer'); assert.ok(find('Volver a la pregunta'));
    const h = attach(goal()); calls = []; // sin ejemplo existente: no se genera ni se ofrece
    await dontKnow(h); p.directReturn(h); await dontKnow(h); h.session.direct.stage = 4; h.events.push({ type: 'DIRECT_CHECK', node_id: 'a', item_id: h.session.direct.package.check.item_id, status: 'CORRECT' }); await view();
    assert.equal(has('Probar un ejemplo con huecos'), false); assert.equal(calls.filter(c => c.route === '/api/lesson/faded').length, 0);
    assert.equal(evidence(g).filter(e => e.result !== 'UNKNOWN').length, 0);
  }
  // 17. H1: ayuda del 3b no se «lava» saliendo por navegación; defensa persistente en goal.ladder_shown.
  {
    const g = attach(goal('GUIDED')); calls = []; const saved = snapshot(g);
    await dontKnow(g, 'GUIDED'); p.directReturn(g); await dontKnow(g, 'GUIDED'); p.directReturn(g); await dontKnow(g, 'GUIDED');
    assert.equal(g.session.direct.status, 'ready'); assert.equal(g.lessons.a, undefined, 'la pregunta ya no es la misma');
    assert.ok(Object.keys(g.ladder_shown).length >= 1);
    p.chooseNext(g, { newVisit: true, reselect: true }); await settle(); // «Retomar habilidad» / navegación
    assert.deepEqual(g.session.ladder, {}); assert.equal(g.session.hints, 0); assert.equal(g.lessons.a, undefined, 'sigue invalidada');
    assert.ok(Object.keys(g.ladder_shown).length >= 1, 'newVisit no borra ladder_shown');
    // Por cualquier vía reaparece el mismo enunciado: pegar la respuesta modelo no es independiente.
    comeBack(g, saved, 'GUIDED'); g.session.hints = 0; g.session.hint_level_max = null;
    await answer(g, 'GUIDED', 'RESPUESTA-MODELO: entre 60 y 80 micras.');
    const last = evidence(g).at(-1);
    assert.equal(last.result, 'CORRECT'); assert.equal(last.is_independent, false); assert.ok(last.help_used >= 3); assert.equal(last.hint_level_max, 5);
    // Sobrevive a guardar y cargar, y una meta antigua sin el mapa se comporta como antes.
    const round = JSON.parse(JSON.stringify(g)); assert.equal(p.ladderShownLevel(round, 'a', Q.guided.prompt), 3);
    assert.equal(p.ladderShownLevel({}, 'a', Q.independent.prompt), 0); assert.equal(p.ladderShownLevel({ ladder_shown: [] }, 'a', Q.independent.prompt), 0);
    const old = attach(goal()); delete old.ladder_shown; calls = [];
    await answer(old, 'INDEPENDENT', 'Entre 60 y 80 micras'); assert.equal(evidence(old).at(-1).is_independent, true, 'sin peldaño visto, independiente como siempre');
    // Tope razonable de entradas.
    const cap = {}; for (let i = 0; i < 400; i++) p.ladderMarkShown(cap, 'a', 'pregunta ' + i, 1);
    assert.ok(Object.keys(cap.ladder_shown).length <= 300); assert.equal(p.ladderShownLevel(cap, 'a', 'pregunta 399'), 1); assert.equal(p.ladderShownLevel(cap, 'a', 'pregunta 0'), 0);
  }
  // H1 (cualquier peldaño): un reintento tras un UNKNOWN en la misma pregunta sigue marcado con ayuda >= nivel del peldaño.
  for (const rungs of [1, 2]) {
    const g = attach(goal()); calls = [];
    for (let i = 1; i <= rungs; i++) { await dontKnow(g); p.directReturn(g); }
    await answer(g, 'INDEPENDENT', 'Incierto'); assert.equal(g.session.hints, 0, 'la sesión ya reinició la ayuda');
    await answer(g, 'INDEPENDENT', 'Entre 60 y 80 micras');
    const last = evidence(g).at(-1); assert.equal(last.is_independent, false, 'peldaño ' + rungs); assert.ok(last.help_used >= rungs);
  }
  // H1 en REVIEW: la pregunta vista en el 3b no es apta para retención independiente.
  {
    const review = { id: 'a', due: 1000, step: 2, origin_attempt_id: 'orig', target_dimension: 'conceptual', question: { prompt: '¿Qué mide el espesor?', reference: 'Altura de la capa', kind: 'explanation' }, history: [] };
    const g = attach(goal('REVIEW', { reviews: [review] })); calls = []; const q = { ...review.question };
    for (let i = 1; i <= 3; i++) { await dontKnow(g, 'REVIEW', q); if (i < 3) p.directReturn(g); }
    assert.equal(g.session.direct.rung, 3); assert.equal(review.question, null, 'invalidada al mostrar la respuesta');
    p.chooseNext(g, { newVisit: true, reselect: true }); await settle();
    review.question = { ...q }; g.session.mode = 'REVIEW'; g.session.node = 'a'; g.session.direct = null; g.session.hints = 0; g.session.hint_level_max = null;
    await answer(g, 'REVIEW', 'Altura de la capa', review.question);
    const last = evidence(g).at(-1); assert.equal(last.result, 'CORRECT'); assert.equal(last.is_independent, false); assert.ok(last.help_used >= 3); assert.equal(last.hint_level_max, 5);
  }

  // 18. H2: los callejones de «misma lección» abren la escalera.
  {
    const g = attach(goal('COMPREHENSION')); calls = []; directError = null;
    await view(); await settle(); await view();
    const btn = find('No lo entendí; vuelve al ejemplo'); assert.ok(btn, 'se conserva el texto del botón');
    btn.onclick(); await settle();
    assert.equal(g.session.direct.rung, 1); assert.equal(g.session.direct.trigger, 'not_understood'); assert.equal(g.session.direct.question_prompt, Q.check.prompt);
    assert.equal(g.session.mode, 'COMPREHENSION', 'no repite el ejemplo');
    await view(); assert.equal(ladderEvents(g).at(-1).trigger, 'not_understood'); assert.equal(evidence(g).length, 0);
    // Sin pregunta de comprobación: comportamiento anterior.
    const h = attach(goal('COMPREHENSION')); delete h.lessons.a.check; h.lessons.a.check = { prompt: ' ', reference: '', kind: 'explanation' };
    assert.equal(p.openDirect(h, 'a', 'COMPREHENSION', p.directQuestion(h, 'a', 'COMPREHENSION'), null, { trigger: 'not_understood' }), false);
  }
  {
    const mkReview = () => ({ id: 'a', due: 1000, step: 2, origin_attempt_id: 'orig', target_dimension: 'conceptual', question: { prompt: '¿Qué mide el espesor?', reference: 'Altura de la capa', kind: 'explanation' }, history: [], presented_at: 1 });
    // «No recuerdo»: escalera con la pregunta del repaso; el calendario sigue la regla vigente.
    let review = mkReview(); let g = attach(goal('REVIEW', { reviews: [review] })); calls = [];
    await view(); await settle(); await view();
    const forget = find('No recuerdo; volvamos a aprenderlo'); assert.ok(forget);
    forget.onclick(); await settle();
    assert.equal(g.session.direct.trigger, 'not_remember'); assert.equal(g.session.direct.phase, 'REVIEW'); assert.equal(g.session.direct.question_prompt, '¿Qué mide el espesor?');
    assert.equal(review.step, 0); assert.ok(review.due > 1000); assert.equal(g.session.mode, 'REVIEW');
    // Fallo en REVIEW: escalera, no «aprender de nuevo» la misma lección.
    review = mkReview(); g = attach(goal('REVIEW', { reviews: [review] })); calls = [];
    await answer(g, 'REVIEW', 'Parcial', review.question || mkReview().question);
    assert.ok(g.session.direct, 'abre la escalera'); assert.equal(g.session.direct.trigger, 'review_failed'); assert.equal(g.session.direct.phase, 'REVIEW');
    assert.equal(g.session.mode, 'REVIEW'); assert.equal(g.session.node, 'a'); assert.equal(review.step, 1, 'calendario por la regla vigente de fallo'); assert.equal(review.history.length, 1);
    await view(); assert.equal(g.session.direct.misconception, 'Confundes espesor con color', 'se guarda para el peldaño 2'); assert.ok(has('Vamos a construirlo'));
  }

  // 19. H5: tras un 3a, si el prerrequisito ya no falta se permite el 3b; si falta, queda agotada.
  {
    const pre = { id: 'pre', name: 'Medir micras', level: 0, prerequisites: [], outcome: 'Medir', probe: { prompt: 'Explica', kind: 'explanation' } };
    const mk = () => { const g = attach(goal()); g.nodes = [pre, { ...node, prerequisites: ['pre'] }]; calls = []; return g; };
    const g = mk(); const saved = snapshot(g);
    await dontKnow(g); p.directReturn(g); await dontKnow(g); p.directReturn(g); await dontKnow(g);
    assert.equal(g.session.direct.status, 'prereq');
    comeBack(g, saved); await dontKnow(g); assert.equal(g.session.direct.status, 'exhausted', 'el prerrequisito sigue faltando'); assert.equal(teachCalls().filter(c => c.body.rung === 3).length, 0);
    g.events.push({ type: 'CURRICULUM_CONTINUED', node_id: 'pre', at: Date.now() });
    comeBack(g, saved); await dontKnow(g);
    assert.equal(g.session.direct.rung, 3); assert.equal(g.session.direct.status, 'ready', 'ahora sí la respuesta comentada'); assert.equal(teachCalls().filter(c => c.body.rung === 3).length, 1);
    assert.ok(has('RESPUESTA-MODELO')); assert.equal(g.lessons.a, undefined);
    assert.equal(g.session.hint_level_max, 5);
    comeBack(g, saved); await dontKnow(g); assert.equal(g.session.direct.status, 'exhausted', 'el 3b se ofrece una sola vez');
    assert.deepEqual(ladderEvents(g).map(e => e.rung), [1, 2, 3, 3]);
  }

  // 20. H7: estado antiguo con direct «repeat» o sin pregunta se trata como nulo al pintar.
  for (const legacy of [{ version: 'direct_teaching_v1', node_id: 'a', phase: 'INDEPENDENT', question_prompt: Q.independent.prompt, status: 'repeat', stage: 0 },
                        { version: 'direct_teaching_v1', node_id: 'a', phase: 'INDEPENDENT', question_prompt: Q.independent.prompt, status: 'failed', stage: 0 }]) {
    const g = attach(goal()); g.session.direct = legacy; calls = [];
    await view();
    assert.equal(g.session.direct, null); assert.equal(find('Reintentar'), null, 'sin «Reintentar» roto'); assert.equal(has('Ya vimos una explicación corta'), false);
    assert.ok(has(Q.independent.prompt), 'se pinta la pregunta normal');
  }

  console.log('teaching_ladder.test.js OK');
})().catch(e => { console.error(e); process.exit(1); });
