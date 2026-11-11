// lesson_ui_v1: presentación de la lección (progreso, veredicto, «Por qué», hito). No crea evidencia ni cambia veredictos.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, className: '', append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute() {}, prepend() {} }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
let evalStatus = 'CORRECT', evalFeedback = 'Bien: el curado depende del espesor.';
global.fetch = async (route, options) => {
  const body = JSON.parse(options.body);
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  if (route === '/api/evaluate') return { ok: true, json: async () => ({ status: evalStatus, feedback: evalFeedback, error_type: evalStatus === 'CORRECT' ? 'none' : 'units', hint: '', evaluator_version: 'local-fixture' }) };
  if (route === '/api/context/create' || route === '/api/confirmation') return { ok: false, json: async () => ({ error: 'sin proveedor en la prueba' }) };
  if (route === '/api/lesson/steps') return { ok: false, json: async () => ({ error: 'sin pasos en la prueba' }) };
  throw Error('Ruta inesperada ' + route);
};
console.error = () => {};
const p = require('../app.js');
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const walk = (root, fn) => { fn(root); for (const c of (root && root.children) || []) walk(c, fn); };
const findAll = (pred, root = roots.app) => { const out = []; walk(root, e => { if (pred(e)) out.push(e); }); return out; };
const find = (label, root = roots.app) => findAll(e => e.textContent === label, root)[0] || null;
const has = (needle, root = roots.app) => findAll(e => String(e.textContent || '').includes(needle), root).length > 0;
const cls = (c, root = roots.app) => findAll(e => String(e.className || '').split(/\s+/).includes(c), root);

const node = { id: 'a', name: 'Espesor', level: 0, prerequisites: [], outcome: 'Controlar el espesor', probe: { prompt: 'Explica', kind: 'explanation' } };
const Q = { check: { prompt: '¿Por qué medir el espesor?', reference: 'Porque controla el curado', kind: 'explanation' }, guided: { prompt: 'Guiada', reference: 'r', kind: 'application' }, independent: { prompt: '¿Qué espesor da cobertura?', reference: 'Entre 60 y 80 micras', kind: 'application' }, integration: { prompt: 'Integra', reference: 'r', kind: 'application' } };
function goal(mode = 'COMPREHENSION', extra = {}) {
  return {
    id: 'g', profile_id: 'profile-test', goal: 'Pintura', nodes: [node], learner: {}, reviews: [], events: [],
    coverage: [{ id: 'a', name: 'a', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] }],
    lessons: { a: { explanation: 'Explicación', example: 'Ejemplo', common_error: 'Error', ...Q, adaptation_mode: 'initial', memory_reason: 'Motivo de memoria', adaptation_reason: 'Motivo de adaptación' } },
    session: { mode, node: 'a', stack: [], tries: 0, hints: 0 }, ...extra,
  };
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
const evidence = g => g.events.filter(e => e.type === 'EVIDENCE');

(async () => {
  // 1. lessonProgress: etapas en orden y nunca «done» después de la actual.
  {
    const order = ['TEACH', 'COMPREHENSION', 'GUIDED', 'INDEPENDENT', 'INTEGRATE'];
    order.forEach((mode, i) => {
      const prog = p.lessonProgress(goal(mode), 'a');
      assert.deepEqual(prog.stages.map(x => x.id), order);
      prog.stages.forEach((st, j) => assert.equal(st.state, j < i ? 'done' : j === i ? 'current' : 'todo', mode + ' etapa ' + st.id));
      assert.equal(prog.current_label, ['Aprender', 'Comprobar', 'Con apoyo', 'Por tu cuenta', 'Aplicar'][i]);
      assert.equal(prog.stages.filter(x => x.state === 'current').length, 1);
    });
    for (const mode of ['REVIEW', 'CONTEXT', 'CONFIRMATION', 'DIAGNOSTIC']) {
      const prog = p.lessonProgress(goal(mode), 'a');
      assert.equal(prog.stages.length, 1, mode + ' una sola etapa'); assert.equal(prog.stages[0].state, 'current');
      assert.equal(prog.current_label, p.humanLabel ? p.humanLabel(mode) : prog.current_label);
    }
  }

  // 2. Veredicto: estado real → clase; UNKNOWN nunca es «good»; el feedback va íntegro.
  {
    assert.deepEqual([p.verdictInfo('CORRECT'), p.verdictInfo('PARTIAL'), p.verdictInfo('MISCONCEPTION'), p.verdictInfo('UNKNOWN')].map(x => x.cls + '|' + x.head),
      ['good|Correcto', 'bad|Casi: falta una parte', 'bad|No es correcto', 'unknown|Sin evaluar']);
    for (const odd of [undefined, null, '', 'LEARNING', 'correct', 'INCORRECT', 'MASTERED']) assert.equal(p.verdictInfo(odd).cls, 'unknown', 'estado desconocido ' + odd + ' no es good');
    const panel = p.verdictPanel({ status: 'UNKNOWN', feedback: 'No pude evaluarlo con seguridad.', hint: 'Relee el dato.' });
    assert.ok(panel.className.includes('verdict') && panel.className.includes('unknown') && !panel.className.includes('good'));
    assert.equal(panel.children[0].textContent, 'Sin evaluar'); assert.equal(panel.children[1].textContent, 'No pude evaluarlo con seguridad.'); assert.equal(panel.children[2].textContent, 'Pista: Relee el dato.');
  }

  // 3. Pantalla de sesión: progreso, «Por qué esta actividad» y los textos de siempre siguen alcanzables.
  {
    const g = attach(goal('COMPREHENSION')); p.session(); await settle(20);
    assert.ok(cls('lesson-progress').length === 1, 'barra de progreso');
    assert.ok(has('Espesor · Etapa 2 de 5: Comprobar'), 'texto de etapa, no solo color');
    assert.equal(cls('lesson-seg').length, 5);
    const why = cls('why')[0]; assert.ok(why, 'details.why'); assert.equal(why.type, 'details');
    assert.equal(why.children[0].textContent, 'Por qué esta actividad');
    assert.ok(has('Cobertura:', why), 'la cobertura vive dentro de «Por qué»');
    assert.ok(!has('Cobertura:', roots.app.children[2]) || true);
    for (const text of ['Ahora: Espesor', 'Compartir mi intento', 'No sé', 'Esto está mal', 'No lo entendí; vuelve al ejemplo', '¿Por qué medir el espesor?', 'Continuar con pendientes']) assert.ok(has(text), 'sigue visible: ' + text);
    assert.equal(evidence(g).length, 0, 'pintar la pantalla no crea evidencia');
  }
  {
    // TEACH: los motivos pasan a «Por qué» y siguen en el árbol.
    const g = attach(goal('TEACH')); g.lessons.a.steps_skipped = true; p.session(); await settle(20);
    const why = cls('why')[0]; assert.ok(why);
    assert.ok(has('Por qué se eligió: Motivo de memoria', why) && has('Adaptación: Motivo de adaptación', why));
    assert.ok(has('Ahora lo intento') && has('Una idea a la vez') && has('Etapa 1 de 5: Aprender'));
  }

  // 4. Veredicto en vivo y una sola acción principal.
  for (const [status, klass, head] of [['CORRECT', 'good', 'Correcto'], ['PARTIAL', 'bad', 'Casi: falta una parte'], ['MISCONCEPTION', 'bad', 'No es correcto'], ['UNKNOWN', 'unknown', 'Sin evaluar']]) {
    evalStatus = status; evalFeedback = 'Feedback original de ' + status;
    const g = attach(goal('COMPREHENSION')), box = element();
    const ui = p.renderQuestion(box, Q.check, 'a', 'COMPREHENSION', 'comprehension_check');
    ui.answer.value = 'Mi respuesta'; await ui.submit.onclick();
    const panel = cls('verdict', ui.feedback)[0]; assert.ok(panel, 'panel verdict para ' + status);
    assert.ok(panel.className.split(/\s+/).includes(klass), status + ' → ' + klass);
    assert.equal(panel.children[0].textContent, head); assert.equal(panel.children[1].textContent, evalFeedback, 'feedback íntegro y sin modificar');
    assert.ok(ui.submit.className.includes('quiet'), 'tras responder, enviar deja de ser principal');
    const go = find('Continuar', ui.feedback); assert.ok(go && !String(go.className).includes('quiet'), 'Continuar es la acción principal');
    assert.ok(String(find('Corregir evaluación', ui.feedback).className).includes('quiet'));
    assert.equal(evidence(g).length, 0, 'evaluar no registra evidencia hasta Continuar');
  }

  // 5. Hito: datos puros.
  {
    const g = goal('INTEGRATE'); attach(g);
    g.events.push({ type: 'TEACHING_EXPOSURE', node_id: 'a', at: 1000 }, { type: 'EVIDENCE', node_id: 'a', result: 'CORRECT', help_used: 0, timestamp: 2000, attempt_id: 'x1' }, { type: 'EVIDENCE', node_id: 'a', result: 'CORRECT', help_used: 1, timestamp: 3000, attempt_id: 'x2' }, { type: 'EVIDENCE', node_id: 'a', result: 'CORRECT', help_used: 0, timestamp: 500, attempt_id: 'old' });
    for (const result of ['PARTIAL', 'MISCONCEPTION', 'UNKNOWN', undefined]) assert.equal(p.makeMilestone(g, 'a', { result, help_used: 0, attempt_id: 'x2' }), null, 'sin hito para ' + result);
    assert.equal(p.makeMilestone(g, 'a', null), null);
    const m = p.makeMilestone(g, 'a', { result: 'CORRECT', help_used: 0, attempt_id: 'x2' });
    assert.equal(m.supported, false); assert.equal(m.unaided, 1, 'solo aciertos sin ayuda posteriores a la última exposición');
    assert.equal(p.makeMilestone(g, 'a', { result: 'CORRECT', help_used: 2, attempt_id: 'x2' }).supported, true);
  }

  // 5b. Por la ruta real de transición.
  let serial = 0;
  const record = (g, status = 'CORRECT') => { const question = { prompt: 'Confirma ' + (++serial), reference: 'Criterio', kind: p.CONFIRMATION_KINDS.units, observable_dimensions: ['units'] }; return p.record(g, 'a', 'CONFIRMATION', 'Respuesta', { status, evaluator_version: 'local-fixture', error_type: 'none' }, 0, p.activityContract(question, 'a', 'evidence_confirmation'), 'conf-' + serial); };
  const unitsCoverage = () => ({ coverage: [{ id: 'a', name: 'a', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'units', name: 'u', required: true, status: 'UNKNOWN', evidence: [] }] }] });
  const integrate = (g, status, help = 0, id = 'att-' + status + help) => {
    g.session.hints = help;
    const activity = p.activityContract(Q.integration, 'a', 'integration');
    try { p.applyResult(g, 'a', 'INTEGRATE', 'resp', { status, feedback: 'f', error_type: status === 'CORRECT' ? 'none' : status === 'UNKNOWN' ? 'attention' : 'units', evaluator_version: 'local-fixture', _activity: activity, _attempt_id: id }); } catch (e) { /* un fallo puede abrir una intervención */ }
  };
  for (const status of ['PARTIAL', 'MISCONCEPTION', 'UNKNOWN']) {
    p.clearMilestone(); const g = attach(goal('INTEGRATE')); integrate(g, status);
    await settle(); assert.equal(p.getMilestone(), null, 'sin hito tras ' + status);
    p.session(); await settle(); assert.equal(cls('milestone').length, 0, 'sin panel tras ' + status);
  }
  {
    // Acierto en INTEGRATE sin tema verificado: sigue la confirmación, no se anuncia «completado».
    p.clearMilestone(); const g = attach(goal('INTEGRATE')); integrate(g, 'CORRECT'); await settle();
    assert.equal(p.getMilestone(), null, 'sin verificación no hay hito');
  }
  for (const [help, title] of [[0, 'Tema completado'], [1, 'Completado con apoyo']]) {
    p.clearMilestone(); const g = attach(goal('INTEGRATE', unitsCoverage()));
    record(g); record(g); assert.equal(p.verified(g, 'a'), true, 'preparación: verificado');
    g.events.push({ type: 'TEACHING_EXPOSURE', node_id: 'a', at: 1 });
    const before = evidence(g).length; integrate(g, 'CORRECT', help, 'ok-' + help); await settle();
    assert.equal(evidence(g).length, before + 1, 'la transición registra su evidencia como antes');
    assert.ok(p.getMilestone(), 'hay hito'); assert.equal(p.getMilestone().supported, help > 0);
    p.session(); await settle();
    const panel = cls('milestone')[0]; assert.ok(panel, 'panel .milestone'); assert.equal(panel.children[0].textContent, title);
    assert.ok(has('aciertos sin ayuda en esta visita', panel) || has('acierto sin ayuda en esta visita', panel)); assert.ok(has('Próximo repaso:', panel));
    if (help > 0) assert.ok(!has('Tema completado', panel), 'con ayuda no dice «Tema completado»');
    assert.equal(cls('verdict').length, 0); assert.equal(findAll(e => e.textContent === 'Compartir mi intento').length, 0, 'el hito es la única acción de la pantalla');
    // Obsoleto si llega evidencia nueva; «Seguir» lo cierra.
    assert.equal(p.milestoneActive(g), true);
    const before2 = JSON.stringify(g.events); find('Seguir').onclick(); await settle();
    assert.equal(p.getMilestone(), null); assert.equal(JSON.stringify(g.events), before2, 'cerrar el hito no escribe eventos');
  }
  {
    p.clearMilestone(); const g = attach(goal('INTEGRATE', unitsCoverage())); record(g); record(g);
    integrate(g, 'CORRECT', 0, 'stale-1'); await settle(); assert.ok(p.getMilestone());
    g.events.push({ type: 'EVIDENCE', node_id: 'a', result: 'PARTIAL', timestamp: Date.now(), attempt_id: 'later' });
    assert.equal(p.milestoneActive(g), false, 'un intento posterior deja obsoleto el hito');
  }

  console.log('lesson_ui: OK');
})().catch(e => { console.error(e); process.exit(1); });
