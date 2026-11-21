// worked_examples_v1 (L4a, cliente): inversión por pericia. teachingSupport es pura; la decisión se congela por lección;
// «lean» salta los pasos y los ejemplos con huecos; ningún paso de este flujo crea EVIDENCE ni exposición de dominio.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute() {}, prepend() {} }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');

const T0 = Date.UTC(2026, 10, 21, 9);
let clock = T0 + 1000;
p.setClockForTests(() => clock);
let calls = [], stepsResponse = null, lessonResponse = null;
global.fetch = async (route, options) => {
  const body = JSON.parse(options.body);
  calls.push({ route, body });
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  if (route === '/api/lesson/steps' && calls.filter(c => c.route === route).length > 6) throw Error('bucle de pasos: se pidieron pasos más de 6 veces');
  if (route === '/api/lesson/steps') return { ok: true, json: async () => stepsResponse };
  if (route === '/api/lesson/faded') return { ok: true, json: async () => ({ schema_version: 'faded_examples_v1' }) };
  if (route === '/api/lesson') return { ok: true, json: async () => lessonResponse };
  throw Error('Ruta inesperada ' + route);
};
const routeCalls = route => calls.filter(c => c.route === route);
const settle = () => new Promise(resolve => setImmediate(resolve));

const stepItem = n => ({ schema_version: 'step_lessons_v1', item_id: 'step-' + n, node_id: 'a', prompt: '¿Cuál?', options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }] });
const stepsOk = () => ({ steps: [1, 2].map(n => ({ step_id: 'step-' + n, predict: { prompt: 'Predice ' + n }, resolution: 'Resolución ' + n, body: 'Cuerpo ' + n, check: stepItem(n) })) });

const node = { id: 'a', name: 'Masa por área', level: 0, prerequisites: [], outcome: 'Resolver', probe: { prompt: 'Explica', kind: 'explanation' } };
const node0 = { id: 'n0', name: 'Densidad', level: 0, prerequisites: [], outcome: 'Usar', probe: { prompt: 'Explica n0', kind: 'explanation' } };
function lessonOf(extra = {}) {
  return { explanation: 'Explicación', example: 'Ejemplo', common_error: 'Error', difficulty_band: 'standard', target_dimension: 'variables', created_at: T0,
    check: { prompt: 'c', reference: 'r', kind: 'explanation' }, guided: { prompt: 'g', reference: 'r', kind: 'application' }, independent: { prompt: 'i', reference: 'r', kind: 'application' }, integration: { prompt: 'n', reference: 'r', kind: 'context_case' },
    adaptation_mode: 'consolidate', ...extra };
}
function goal(lessonExtra = {}, extra = {}) {
  return {
    id: 'g', profile_id: 'profile-test', goal: 'Pintura', nodes: [node, node0], learner: {}, reviews: [], events: [],
    lessons: { a: lessonOf(lessonExtra) },
    coverage: [{ id: 'a', name: 'a', status: 'UNKNOWN', confidence: 0, dimensions: ['variables', 'conceptual', 'direct_application'].map(d => ({ id: d, name: d, required: true, status: 'UNKNOWN', evidence: [] })) }],
    session: { mode: 'TEACH', node: 'a', stack: [], tries: 0, hints: 0, target_dimension: 'variables' },
    ...extra,
  };
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
const dim = (g, id) => g.coverage[0].dimensions.find(d => d.id === id);
// Evidencia independiente real de la dimensión: cuenta como acierto independiente (independentSuccesses).
function independent(g, d, n, extra = {}) {
  const ev = { type: 'EVIDENCE', evidence_id: 'ev-' + n, attempt_id: 'att-' + n, activity_id: 'act-' + n, node_id: 'a', evidence_role: 'learning', phase: 'INDEPENDENT', result: 'CORRECT', status: 'CORRECT', is_independent: true, help_used: 0, observed_dimensions: [d], question: { prompt: 'Pregunta independiente ' + n }, at: T0 + n, ...extra };
  g.events.push(ev); dim(g, d).evidence.push(ev); return ev;
}
// Práctica real con banda standard (activityContract + activityEvidence): tres aciertos seguidos sube a challenge.
let seq = 0;
function practice(g, result = 'CORRECT') {
  seq++;
  const question = { prompt: 'Práctica ' + seq, reference: 'Criterio', kind: 'application', observable_dimensions: ['direct_application'], difficulty_band: 'standard' };
  const activity = p.activityContract(question, 'a', 'independent_practice');
  const ev = p.activityEvidence(activity, { status: result, evaluator_version: 'local-fixture' }, 0, { attempt_id: 'pr-' + seq, timestamp: T0 + 500 + seq, sufficient_before: true });
  g.events.push({ type: 'EVIDENCE', ...ev }); dim(g, 'direct_application').evidence.push(ev);
  return ev;
}
const failure = (g, status, at, extra = {}) => { const ev = { type: 'EVIDENCE', evidence_id: 'f-' + at, attempt_id: 'f-' + at, activity_id: 'fa-' + at, node_id: 'a', evidence_role: 'learning', phase: 'INDEPENDENT', result: status, status, error_type: 'conceptual', is_independent: false, help_used: 0, observed_dimensions: ['variables'], question: { prompt: 'Fallo ' + at }, at, ...extra }; g.events.push(ev); return ev; };
const find = (label, root = roots.app) => { if (root && root.textContent === label) return root; for (const c of (root && root.children) || []) { const f = find(label, c); if (f) return f; } return null; };
const findExample = (root = roots.app) => { if (root && root.className === 'worked-example') return root; for (const c of (root && root.children) || []) { const f = findExample(c); if (f) return f; } return null; };
const has = (needle, root = roots.app) => { if (root && String(root.textContent || '').includes(needle)) return true; return ((root && root.children) || []).some(c => has(needle, c)); };
async function renderTeach(g) { roots.app.children = []; await p.session(); }
const teachingEvents = g => g.events.filter(e => e.type === 'TEACHING_SUPPORT');

(async () => {
  // 1. Señales de lean: cada una sola da lean, sin vetos.
  {
    const g = attach(goal({ adaptation_mode: 'consolidate' })); assert.equal(p.teachingSupport(g, 'a', g.lessons.a).support, 'lean'); assert.ok(p.teachingSupport(g, 'a', g.lessons.a).reasons.includes('consolidate'));
  }
  {
    const g = attach(goal({ adaptation_mode: 'initial' }));
    g.placement = { status: 'complete', items: {}, answers: [{ node_id: 'a', status: 'CORRECT', learner_confidence: 90, attempt_id: 'pl-1' }] };
    const d = p.teachingSupport(g, 'a', g.lessons.a);
    assert.equal(p.placementStatuses(g).a, 'held', 'fixture: el tema queda held por colocación');
    assert.equal(d.support, 'lean'); assert.ok(d.reasons.some(r => /placement|held/.test(r)));
  }
  {
    const g = attach(goal({ adaptation_mode: 'initial' }));
    for (let i = 0; i < 3; i++) practice(g);
    assert.equal(p.practiceBandState(g, 'a').band, 'challenge', 'fixture: tres aciertos seguidos llegan a challenge');
    const d = p.teachingSupport(g, 'a', g.lessons.a);
    assert.equal(d.support, 'lean'); assert.ok(d.reasons.includes('challenge_band'));
  }
  {
    const g = attach(goal({ adaptation_mode: 'initial' }));
    independent(g, 'variables', 1);
    const d = p.teachingSupport(g, 'a', g.lessons.a);
    assert.equal(d.support, 'lean'); assert.ok(d.reasons.includes('independent_target'));
  }

  // 2. Negativos: sin señal, o acierto independiente en OTRA dimensión, no dan lean.
  {
    const g = attach(goal({ adaptation_mode: 'initial' }));
    assert.equal(p.teachingSupport(g, 'a', g.lessons.a).support, 'full');
  }
  {
    const g = attach(goal({ adaptation_mode: 'initial' }));
    independent(g, 'conceptual', 1);
    assert.equal(p.teachingSupport(g, 'a', g.lessons.a).support, 'full', 'un acierto en conceptual no sirve para variables');
  }

  // 3. Vetos: cada uno anula lean aunque la señal consolidate esté presente.
  const vetoes = [
    ['repair', g => { g.lessons.a.adaptation_mode = 'repair'; }, 'repair'],
    ['scaffold', g => { g.lessons.a.adaptation_mode = 'scaffold'; }, 'scaffold'],
    ['último intento UNKNOWN («No sé»)', g => { failure(g, 'UNKNOWN', T0 + 5, { error_type: 'lack_of_exposure', phase: 'DIAGNOSTIC' }); }, 'ultimo_desconocido'],
    ['último intento con lack_of_exposure', g => { failure(g, 'UNKNOWN', T0 + 5, { error_type: 'lack_of_exposure' }); }, 'ultimo_desconocido'],
    ['fallo de aprendizaje posterior a la creación', g => { failure(g, 'MISCONCEPTION', T0 + 10); }, 'fallo_posterior'],
    ['revisión de prerrequisito activa', g => { g.nodes = [node, node0]; node.prerequisites = ['n0']; g.events.push({ type: 'PREREQUISITE_REVIEW', proposal_id: 'pr1', source_node_id: 'a', prerequisite_node_id: 'n0', source_attempt_ids: ['x', 'y'], action: 'check', at: T0 + 1 }); }, 'prerequisite_review'],
    ['unskip de prerrequisito', g => { node.prerequisites = ['n0']; g.events.push({ type: 'PREREQUISITE_REVIEW', proposal_id: 'pr2', source_node_id: 'a', prerequisite_node_id: 'n0', source_attempt_ids: ['x', 'y'], action: 'unskip', at: T0 + 1 }); }, 'prerequisite_review'],
    ['el aprendiz pidió pasos', g => { g.lessons.a.support_optin = true; }, 'support_optin'],
    ['pasos ya iniciados', g => { g.session.step = { node_id: 'a', index: 1, stage: 'check', misses: 0 }; }, 'pasos_iniciados'],
    ['lección guardada sin support (legado)', g => { delete g.lessons.a.created_at; }, 'legacy_sin_support'],
  ];
  for (const [label, mutate, reason] of vetoes) {
    node.prerequisites = []; const g = attach(goal({ adaptation_mode: 'consolidate' })); mutate(g);
    const d = p.teachingSupport(g, 'a', g.lessons.a);
    assert.equal(d.support, 'full', 'veto: ' + label);
    assert.ok(d.reasons.includes(reason), 'motivo ' + reason + ' para ' + label + ': ' + d.reasons.join(','));
  }
  node.prerequisites = [];

  // 4. Congelación: la primera visita decide, repintar no cambia nada y escribe un solo TEACHING_SUPPORT.
  {
    clock = T0 + 1000;
    const g = attach(goal({ adaptation_mode: 'consolidate' }));
    const before = p.lastExposure(g, 'a');
    await renderTeach(g);
    assert.equal(g.lessons.a.support, 'lean');
    assert.ok(Array.isArray(g.lessons.a.support_reasons) && g.lessons.a.support_reasons.includes('consolidate'));
    assert.equal(g.lessons.a.support_at, clock);
    assert.equal(teachingEvents(g).length, 1);
    assert.equal(teachingEvents(g)[0].support, 'lean');
    assert.equal(teachingEvents(g)[0].creates_evidence, false);
    assert.equal(teachingEvents(g)[0].version, 'worked_examples_v1');
    assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0, 'ningún EVIDENCE por decidir el apoyo');
    assert.equal(p.lastExposure(g, 'a') >= before, true);
    await renderTeach(g); await renderTeach(g);
    assert.equal(teachingEvents(g).length, 1, 'repintar no escribe más eventos');
    assert.equal(g.lessons.a.support, 'lean');
    assert.equal(p.isStudyAnswer(teachingEvents(g)[0]), false, 'no cuenta como estudio');
    assert.equal(p.EXPOSURE_TYPES.includes('TEACHING_SUPPORT'), false, 'no es exposición');
    // Congelada: si desaparece la señal que la produjo, repintar no la recalcula.
    g.lessons.a.adaptation_mode = 'initial';
    await renderTeach(g);
    assert.equal(g.lessons.a.support, 'lean', 'sin recalcular en cada render');
    assert.equal(teachingEvents(g).length, 1);
  }

  // 5. Vista lean: sin pasos ni ejemplos con huecos; ejemplo cerrado en <details>; «Ahora lo intento» pasa a comprobación.
  {
    calls = []; stepsResponse = stepsOk();
    const g = attach(goal({ adaptation_mode: 'consolidate' }));
    await renderTeach(g);
    assert.equal(routeCalls('/api/lesson/steps').length, 0, 'lean no pide pasos');
    assert.equal(routeCalls('/api/lesson/faded').length, 0, 'lean no pide ejemplos con huecos');
    assert.equal(p.fadedAllowed(g.lessons.a), false, 'fadedAllowed es falso en lean');
    const det = findExample();
    assert.ok(det, 'el ejemplo va en un details');
    assert.equal(det.open, undefined, 'cerrado por defecto');
    assert.ok(find('Ver un ejemplo resuelto'), 'resumen del ejemplo');
    assert.ok(find('Prefiero ir paso a paso'), 'botón para pedir pasos');
    find('Ahora lo intento').onclick();
    assert.equal(g.session.mode, 'COMPREHENSION', '«Ahora lo intento» lleva a la comprobación');
    assert.equal(routeCalls('/api/lesson/faded').length, 0);
  }

  // 6. «Prefiero ir paso a paso» deja full, marca opt-in y pide pasos con learner_requested.
  {
    calls = []; stepsResponse = stepsOk();
    const g = attach(goal({ adaptation_mode: 'consolidate' }));
    await renderTeach(g);
    find('Prefiero ir paso a paso').onclick();
    assert.equal(g.lessons.a.support, 'full'); assert.equal(g.lessons.a.support_optin, true);
    await renderTeach(g);
    const steps = routeCalls('/api/lesson/steps');
    assert.equal(steps.length, 1, 'pide pasos una vez');
    assert.equal(steps[0].body.learner_requested, true);
    assert.equal(steps[0].body.target_dimension, 'variables');
    assert.equal(g.lessons.a.support, 'full', 'la decisión no vuelve a cambiar');
  }

  // 7. Retorno a full: un fallo tras lean deja full y pide pasos sin atascarse.
  {
    calls = []; stepsResponse = stepsOk();
    clock = T0 + 1000;
    const g = attach(goal({ adaptation_mode: 'consolidate' }));
    await renderTeach(g);
    assert.equal(g.lessons.a.support, 'lean');
    clock = T0 + 200000; failure(g, 'MISCONCEPTION', clock - 1);
    await renderTeach(g);
    assert.equal(g.lessons.a.support, 'full', 'el fallo devuelve a full');
    assert.equal(g.lessons.a.support_returned, true);
    assert.equal(routeCalls('/api/lesson/steps').length, 1);
    assert.equal(routeCalls('/api/lesson/steps')[0].body.learner_requested, true);
    assert.equal(teachingEvents(g).length, 1, 'el retorno no añade otro TEACHING_SUPPORT');
  }
  {
    calls = []; stepsResponse = stepsOk(); clock = T0 + 1000;
    const g = attach(goal({ adaptation_mode: 'consolidate' }));
    await renderTeach(g);
    clock = T0 + 300000; failure(g, 'UNKNOWN', clock - 1, { error_type: 'lack_of_exposure' });
    await renderTeach(g);
    assert.equal(g.lessons.a.support, 'full', 'un «No sé» tras lean devuelve a full');
  }
  {
    const g = attach(goal({ adaptation_mode: 'consolidate' }));
    g.lessons.a.support = 'lean'; g.lessons.a.support_at = T0; g.lessons.a.support_reasons = ['consolidate'];
    p.returnToFullSupport(g, 'a');
    assert.equal(g.lessons.a.support, 'full', 'returnToFullSupport lleva a full');
    assert.equal(g.lessons.a.support_returned, true);
  }

  // 8. Servidor dice STEPS_NOT_NEEDED: pasa a lean en silencio, sin aviso de error ni fallo permanente.
  {
    calls = []; stepsResponse = { code: 'STEPS_NOT_NEEDED', steps: [] }; roots.status.textContent = ''; clock = T0 + 1000;
    const g = attach(goal({ adaptation_mode: 'initial' }));
    await renderTeach(g); await settle();
    assert.equal(routeCalls('/api/lesson/steps').length, 1, 'el cliente pidió pasos una vez (decisión full)');
    assert.equal(g.lessons.a.support, 'lean', 'el servidor manda lean');
    assert.equal(teachingEvents(g).length, 1, 'el registro se actualiza, no se duplica');
    assert.equal(teachingEvents(g)[0].support, 'lean');
    assert.ok(teachingEvents(g)[0].reasons.includes('servidor_consolidate'), 'el motivo queda registrado');
    assert.ok(!has('No pude preparar', roots.status), 'sin aviso de error');
    assert.ok(find('Ver un ejemplo resuelto'), 'la vista es lean');
    assert.equal(routeCalls('/api/lesson/steps').length, 1, 'no vuelve a pedir pasos');
  }

  // 9. Sanidad: full sin señal conserva los pasos y el ejemplo como antes.
  {
    calls = []; stepsResponse = stepsOk(); clock = T0 + 1000;
    const g = attach(goal({ adaptation_mode: 'initial' }));
    await renderTeach(g);
    assert.equal(g.lessons.a.support, 'full');
    assert.equal(routeCalls('/api/lesson/steps').length, 1);
    assert.equal(routeCalls('/api/lesson/steps')[0].body.learner_requested, false);
    assert.equal(findExample(), null, 'sin ejemplo en details en full');
  }

  // 10. Servidor STEPS_NOT_NEEDED con un veto activo: la decisión full se mantiene, sin aviso y sin pedir pasos otra vez.
  {
    calls = []; stepsResponse = { code: 'STEPS_NOT_NEEDED', steps: [] }; roots.status.textContent = ''; clock = T0 + 1000;
    const g = attach(goal({ adaptation_mode: 'consolidate' }));
    failure(g, 'MISCONCEPTION', T0 + 10);
    await renderTeach(g); await settle();
    assert.equal(g.lessons.a.support, 'full', 'el veto de fallo mantiene full');
    assert.ok(g.lessons.a.support_reasons.includes('fallo_posterior'));
    assert.equal(routeCalls('/api/lesson/steps').length, 1, 'no vuelve a pedir pasos');
    assert.ok(!has('No pude preparar', roots.status), 'sin aviso de error');
    assert.equal(teachingEvents(g).length, 1);
    assert.equal(teachingEvents(g)[0].support, 'full');
    assert.ok(!teachingEvents(g)[0].reasons.includes('servidor_consolidate'));
  }

  // 11. B1: «No lo entendí» desde COMPREHENSION con la lección sin congelar: full, con pasos pedidos con learner_requested.
  {
    calls = []; stepsResponse = stepsOk(); clock = T0 + 1000;
    // Sin pregunta de comprobación no se abre la explicación directa: «No lo entendí» vuelve a la lección (TEACH).
    const g = attach(goal({ adaptation_mode: 'consolidate', check: { prompt: '', reference: 'r', kind: 'explanation' } }));
    g.session.mode = 'COMPREHENSION';
    roots.app.children = []; await p.session(); await settle();
    assert.equal(g.lessons.a.support, undefined, 'fixture: la lección no está congelada');
    find('No lo entendí; vuelve al ejemplo').onclick();
    await settle();
    assert.equal(g.lessons.a.support, 'full', 'no queda lean');
    assert.equal(g.lessons.a.support_returned, true);
    assert.equal(g.lessons.a.support_optin, true);
    assert.equal(teachingEvents(g).length, 1, 'se registra la decisión full');
    assert.equal(teachingEvents(g)[0].support, 'full');
    await renderTeach(g); await settle();
    const steps = routeCalls('/api/lesson/steps');
    assert.ok(steps.length >= 1, 'pide pasos');
    assert.ok(steps.every(c => c.body.learner_requested === true), 'con learner_requested');
    assert.equal(g.lessons.a.support, 'full');
  }

  // 12. B1: directFull desde GUIDED sin congelar: full y pasos con learner_requested.
  {
    calls = []; stepsResponse = stepsOk(); clock = T0 + 1000;
    const g = attach(goal({ adaptation_mode: 'consolidate' }));
    g.session.mode = 'GUIDED';
    p.directFull(g, node); await settle();
    assert.equal(g.lessons.a.support, 'full', 'directFull no deja lean');
    assert.equal(g.lessons.a.support_returned, true);
    assert.equal(teachingEvents(g).length, 1);
    assert.equal(teachingEvents(g)[0].support, 'full');
    await renderTeach(g); await settle();
    const steps = routeCalls('/api/lesson/steps');
    assert.ok(steps.length >= 1, 'pide pasos');
    assert.ok(steps.every(c => c.body.learner_requested === true), 'con learner_requested');
  }

  // 13. Menor: regenerar una lección conserva la primera creación del tema y el veto de fallo anterior.
  {
    calls = []; stepsResponse = stepsOk(); clock = T0 + 5000; roots.status.textContent = '';
    const g = attach(goal({ adaptation_mode: 'consolidate', target_dimension: 'units', support: 'lean', support_at: T0, support_reasons: ['consolidate'] }));
    g.events.push({ type: 'TEACHING_SUPPORT', version: 'worked_examples_v1', node_id: 'a', lesson_created_at: T0, support: 'lean', reasons: ['consolidate'], creates_evidence: false, at: T0 });
    failure(g, 'MISCONCEPTION', T0 + 10);
    const check = { prompt: 'c', reference: 'r', kind: 'explanation' };
    lessonResponse = { explanation: 'Explicación nueva', example: 'Ejemplo nuevo', common_error: 'Error', target_dimension: 'variables', difficulty_band: 'standard', adaptation_mode: 'consolidate', check, guided: check, independent: check, integration: check };
    await renderTeach(g); await settle(); await renderTeach(g); await settle();
    assert.equal(g.lessons.a.created_at, clock, 'la lección regenerada tiene created_at nuevo');
    assert.equal(g.lessons.a.first_created_at, T0, 'conserva la primera creación del tema');
    assert.equal(g.lessons.a.support, 'full', 'el fallo anterior sigue vetando lean');
    assert.ok(g.lessons.a.support_reasons.includes('fallo_posterior'));
  }

  console.log('teaching_support.test.js OK');
})().catch(error => { console.error(error); process.exit(1); });
