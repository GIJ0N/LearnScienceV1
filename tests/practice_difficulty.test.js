// practice_difficulty_v1: bandas base/standard/challenge de la práctica. La dificultad es dato de selección, nunca crédito.
const assert = require('node:assert/strict');

function element(type = 'div') {
  return { type, textContent: '', value: '', disabled: false, children: [], style: {}, append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); return item; }, replaceChildren(...items) { this.children = items; }, setAttribute() {}, addEventListener() {} };
}
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: id => (id === 'app' ? roots.app : roots.status), createElement: type => element(type) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
global.fetch = async () => { throw new Error('La prueba no permite red no simulada.'); };
console.error = () => {};

const p = require('../app.js');
const T0 = Date.UTC(2026, 10, 10, 15);
p.setClockForTests(() => T0 + 10 ** 9);
p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1);
const settle = () => new Promise(resolve => setImmediate(resolve));
function find(root, predicate) {
  if (root && predicate(root)) return root;
  for (const child of root?.children || []) { const hit = find(child, predicate); if (hit) return hit; }
  return null;
}

let seq = 0;
const baseGoal = () => ({
  id: 'g1', profile_id: 'profile-test', goal: 'Meta', learner: {}, events: [], reviews: [], repairEpisodes: [], contextStack: [], lessons: {},
  nodes: [{ id: 'n1', name: 'Tema uno', level: 0, prerequisites: [], outcome: 'Resolver', probe: { prompt: 'Explica uno', kind: 'explanation' } }],
  coverage: [{ id: 'n1', name: 'n1', status: 'UNKNOWN', confidence: 0, dimensions: ['direct_application', 'conceptual'].map(d => ({ id: d, name: d, required: true, status: 'UNKNOWN', evidence: [] })) }],
  session: { mode: 'DIAGNOSTIC', node: 'n1', stack: [], tries: 0, hints: 0 }
});
const attach = goal => { p.setStoreForTests({ goals: [goal], active: goal.id }); return goal; };
const dim = (goal, id) => goal.coverage[0].dimensions.find(d => d.id === id);

// Una evidencia real (activityContract + activityEvidence). band: 'base' | 'standard' | 'challenge' | null (legado, sin campos de banda).
function evidence(goal, { band = 'standard', result = 'CORRECT', help = 0, hint, attempt, prompt } = {}) {
  seq++;
  const question = { prompt: prompt || 'Pregunta ' + seq, reference: 'Criterio', kind: 'application', observable_dimensions: ['direct_application'], ...(band ? { difficulty_band: band } : {}) };
  const activity = p.activityContract(question, 'n1', 'independent_practice');
  const event = p.activityEvidence(activity, { status: result, evaluator_version: 'local-fixture' }, help, { attempt_id: attempt || 'att-' + seq, timestamp: T0 + seq * 1000, hint_level_max: hint });
  goal.events.push({ type: 'EVIDENCE', ...event });
  dim(goal, 'direct_application').evidence.push(event);
  return event;
}
// Historia en texto: S acierto, F fallo, H acierto con pista, U «No sé»/UNKNOWN. Prefijos: b = banda base, c = desafío, l = legado sin banda.
function history(text, { sufficient = false } = {}) {
  const goal = baseGoal();
  for (const [, prefix, code] of text.matchAll(/([blc]?)([SFHU])/g)) {
    const o = { band: prefix === 'b' ? 'base' : prefix === 'c' ? 'challenge' : prefix === 'l' ? null : 'standard' };
    if (code === 'F') o.result = 'MISCONCEPTION'; if (code === 'U') o.result = 'UNKNOWN'; if (code === 'H') o.hint = 1;
    evidence(goal, o);
  }
  if (sufficient) for (const i of [1, 2]) dim(goal, 'conceptual').evidence.push({ evidence_id: 'k' + i, attempt_id: 'k' + i, type: 'EVIDENCE', result: 'CORRECT', status: 'CORRECT', is_independent: true, observed_dimensions: ['conceptual'], question: { prompt: 'Concepto ' + i }, phase: 'CONFIRMATION', timestamp: T0 + i });
  return attach(goal);
}
const coversAll = goal => p.deriveCoverage(goal.coverage[0]).mastered === true;

(async () => {
  assert.equal(p.PRACTICE_DIFFICULTY_VERSION, 'practice_difficulty_v1');
  assert.deepEqual([...p.PRACTICE_BANDS], ['base', 'standard', 'challenge']);
  assert.deepEqual([p.DIFFICULTY_WINDOW, p.DIFFICULTY_MIN_SAMPLE, p.DIFFICULTY_UP_RATE, p.DIFFICULTY_DOWN_RATE, p.DIFFICULTY_HYSTERESIS], [5, 3, 0.85, 0.5, 2]);

  // 1. Tabla de transiciones: historia -> banda repetida (replayed) y banda efectiva sin / con suficiencia previa.
  const table = [
    ['', 'standard', 'standard', 'standard'],                 // sin historial = estándar (idéntico a hoy)
    ['SS', 'standard', 'standard', 'standard'],               // muestra mínima de 3 no alcanzada
    ['SSS', 'challenge', 'standard', 'challenge'],            // 3/3 sin pistas sube; el desafío exige suficiencia
    ['SSF', 'standard', 'standard', 'standard'],              // 2/3 queda en medio
    ['FFF', 'base', 'base', 'base'],                          // 0/3 baja
    ['FSF', 'base', 'base', 'base'],                          // 1/3 baja
    ['SFSSF', 'standard', 'standard', 'standard'],            // 3/5 queda en medio
    ['SSSSF', 'challenge', 'standard', 'challenge'],          // 4/5 = 80 % no cambia lo ya subido
    ['SSSFFF', 'standard', 'standard', 'standard'],           // desafío -> estándar con 2/5
    ['FFFSSSSS', 'standard', 'standard', 'standard'],         // base -> estándar con 5/5
    ['FFFSSSSSS', 'standard', 'standard', 'standard'],        // histéresis: una evidencia más no vuelve a subir
    ['FFFSSSSSSS', 'challenge', 'standard', 'challenge'],     // con 2 evidencias nuevas sí
    ['bSbSbS', 'challenge', 'standard', 'challenge'],         // los aciertos base cuentan para la banda (rampa), no para suficiencia
    ['SSSSS cF cF cF', 'standard', 'standard', 'standard']   // fallos en desafío bajan la banda (dato de selección)
  ];
  for (const [text, replayed, plain, withSufficiency] of table) {
    const without = history(text);
    assert.equal(p.practiceBandState(without, 'n1').band, replayed, 'repetida: ' + text);
    assert.equal(p.practiceBand(without, 'n1', 'confirmation').band, plain, 'sin suficiencia: ' + text);
    // Con suficiencia previa (dos aciertos conceptuales). La dimensión de aplicación sólo la tienen los S/F del propio texto.
    const enough = history(text, { sufficient: true });
    const expected = coversAll(enough) ? withSufficiency : plain;
    assert.equal(p.practiceBand(enough, 'n1', 'confirmation').band, expected, 'con suficiencia: ' + text);
  }

  // 2. Reglas del valor: ayuda, UNKNOWN, duplicados, correcciones y legado.
  assert.equal(p.practiceBandState(history('SSH'), 'n1').band, 'standard', 'un acierto con pista no cuenta como acierto: no sube');
  assert.equal(p.practiceBandState(history('SSSHHH'), 'n1').hits, 2, 'los aciertos con pista restan a la tasa');
  assert.equal(p.practiceBandState(history('SS' + 'U'.repeat(6)), 'n1').evidences, 2, 'UNKNOWN no entra a la muestra');
  assert.equal(p.practiceBandState(history('FF' + 'U'.repeat(6)), 'n1').band, 'standard', 'UNKNOWN no baja la banda');
  {
    const g = history('SS'); const last = g.events.at(-1); g.events.push({ ...last, evidence_id: 'otro' });
    assert.equal(p.practiceBandState(g, 'n1').evidences, 2, 'mismo attempt_id dos veces cuenta una sola');
    assert.equal(p.practiceBandState(g, 'n1').band, 'standard');
    const withHelp = history('SS'); evidence(withHelp, { help: 1 }); evidence(withHelp, { help: 2 });
    assert.equal(p.practiceBandState(withHelp, 'n1').band, 'base', 'aciertos con ayuda nunca suben; necesitar ayuda la mitad de las veces baja el nivel');
  }
  {
    // Una corrección manual sustituye al original y no cuenta dos veces (ni como acierto ni como fallo).
    const g = history('SS'); const original = evidence(g, { result: 'MISCONCEPTION' });
    const correction = { ...evidence(g, {}), correction_of: original.evidence_id, corrected: true };
    g.events[g.events.length - 1] = { type: 'EVIDENCE', ...correction };
    assert.equal(p.difficultySample(g, 'n1').length, 2, 'original sustituido y corrección excluidos');
    assert.equal(p.practiceBandState(g, 'n1').band, 'standard');
  }
  {
    // Eventos legados sin banda = estándar; una banda sin versión válida o inventada tampoco cuenta; nunca se agregan campos.
    const g = history('lSlSlS'); assert.equal(p.eventBand(g.events[0]), 'standard');
    assert.ok(g.events.every(e => !('difficulty_band' in e) && !('difficulty_policy_version' in e)), 'no se inventan bandas');
    assert.equal(p.eventBand({ difficulty_band: 'challenge' }), 'standard');
    assert.equal(p.eventBand({ difficulty_band: 'raro', difficulty_policy_version: 'practice_difficulty_v1' }), 'standard');
    assert.equal(p.eventBand({ difficulty_band: 'base', difficulty_policy_version: 'practice_difficulty_v1' }), 'base');
    const fresh = attach(baseGoal()); const before = JSON.stringify(fresh);
    assert.equal(p.practiceBand(fresh, 'n1', 'lesson').band, 'standard'); assert.equal(JSON.stringify(fresh), before, 'calcular la banda no modifica la meta');
    const loaded = p.normalizeGoal(JSON.parse(JSON.stringify(g)));
    assert.ok(loaded.events.every(e => !('difficulty_band' in e)));
  }

  // 3. Histéresis: no oscila con una respuesta y no encadena dos cambios seguidos.
  {
    const g = history('FFFSSSSS'); assert.equal(p.practiceBandState(g, 'n1').band, 'standard');
    for (const next of ['F', 'S', 'F', 'S']) { evidence(g, next === 'F' ? { result: 'MISCONCEPTION' } : {}); assert.equal(p.practiceBandState(g, 'n1').band, 'standard', 'sigue en estándar tras ' + next); }
    assert.equal(p.practiceBandState(history('FFFSSSSSS'), 'n1').band, 'standard');
    assert.equal(p.practiceBandState(history('FFFSSSSSSS'), 'n1').band, 'challenge');
    assert.equal(p.practiceBandState(history('SSSFFF'), 'n1').band, 'standard', 'desafío -> estándar, no salta a base');
  }

  // 4. Suficiencia intacta: una práctica base NO suma; estándar sí.
  {
    const base = baseGoal(); evidence(base, { band: 'base' }); evidence(base, { band: 'base' });
    assert.equal(p.independentSuccesses(dim(base, 'direct_application')).length, 0, 'las dos prácticas base no suman');
    assert.equal(p.sufficient(dim(base, 'direct_application')), false);
    evidence(base, { band: 'standard' }); evidence(base, { band: 'standard' });
    assert.equal(p.independentSuccesses(dim(base, 'direct_application')).length, 2);
    assert.equal(p.sufficient(dim(base, 'direct_application')), true, 'dos estándar sí');
    const mixed = baseGoal(); evidence(mixed, { band: 'base' }); evidence(mixed, { band: 'standard' });
    assert.equal(p.sufficient(dim(mixed, 'direct_application')), false, 'una base + una estándar no basta');
    const legacy = baseGoal(); evidence(legacy, { band: null }); evidence(legacy, { band: null });
    assert.equal(p.sufficient(dim(legacy, 'direct_application')), true, 'eventos sin banda cuentan como antes');
  }

  // 5. Desafío: sin suficiencia previa no concede nada y se registra como estándar; con suficiencia, un fallo no es contradicción.
  {
    const noSuff = history('S'); const q = { prompt: 'Desafío sin base', reference: 'c', kind: 'application', observable_dimensions: ['direct_application'], difficulty_band: 'challenge' };
    const prepared = p.prepareRecord(noSuff, 'n1', 'INDEPENDENT', 'x', { status: 'MISCONCEPTION', error_type: 'conceptual' }, 0, p.activityContract(q, 'n1', 'independent_practice'), 'att-guard');
    assert.equal(prepared.event.difficulty_band, 'standard', 'sin suficiencia el desafío se registra como estándar');
    assert.equal(prepared.event.contradicts_sufficiency, true);
    assert.equal(prepared.event.counts_as_learning_failure, true);
    const okPrepared = p.prepareRecord(noSuff, 'n1', 'INDEPENDENT', 'x', { status: 'CORRECT', evaluator_version: 'local-fixture' }, 0, p.activityContract({ ...q, prompt: 'Otro desafío' }, 'n1', 'independent_practice'), 'att-guard-2');
    assert.equal(okPrepared.event.difficulty_band, 'standard');

    const g = history('SS', { sufficient: true }); assert.equal(coversAll(g), true);
    const before = p.independentSuccesses(dim(g, 'direct_application')).map(e => e.attempt_id);
    const failActivity = p.activityContract({ ...q, prompt: 'Desafío con base' }, 'n1', 'independent_practice');
    const event = p.record(g, 'n1', 'INDEPENDENT', 'x', { status: 'MISCONCEPTION', error_type: 'conceptual' }, 0, failActivity, 'att-challenge-fail');
    assert.equal(event.difficulty_band, 'challenge'); assert.equal(event.difficulty_policy_version, 'practice_difficulty_v1');
    assert.equal(event.contradicts_sufficiency, false); assert.equal(event.counts_as_learning_failure, false);
    assert.equal(p.isContradiction(event), false);
    assert.equal(coversAll(g), true, 'sufficient() no cambia tras fallar en desafío');
    assert.deepEqual(p.independentSuccesses(dim(g, 'direct_application')).map(e => e.attempt_id), before, 'los aciertos previos siguen');
    assert.equal(p.learningState(g, 'n1', Date.now()).dimensions.find(d => d.id === 'direct_application').difficulty, false, 'no abre reparación');
    assert.equal(p.practiceBandState(g, 'n1').evidences, 3, 'el fallo sí queda como dato para la banda');

    // Contraste: el mismo fallo en estándar sí rompe la suficiencia.
    const h = history('SS', { sufficient: true });
    p.record(h, 'n1', 'INDEPENDENT', 'x', { status: 'MISCONCEPTION', error_type: 'conceptual' }, 0, p.activityContract({ ...q, difficulty_band: 'standard', prompt: 'Estándar con fallo' }, 'n1', 'independent_practice'), 'att-standard-fail');
    assert.equal(coversAll(h), false);
    // Un fallo en desafío tampoco dispara el aviso de seguridad por confianza alta (calibración) sobre el tema.
    const sure = history('SS', { sufficient: true });
    p.record(sure, 'n1', 'INDEPENDENT', 'x', { status: 'MISCONCEPTION', error_type: 'conceptual', _learner_confidence: 95 }, 0, p.activityContract({ ...q, prompt: 'Desafío seguro' }, 'n1', 'independent_practice'), 'att-sure');
    assert.equal(p.learningState(sure, 'n1', Date.now()).committed_misconception, false);
  }

  // 6. Selector: la banda de cada propósito.
  {
    const g = history('SSS'); // 3/3 pero sin suficiencia
    assert.equal(p.practiceBand(g, 'n1', 'challenge').band, 'standard', 'challenge como propósito sin suficiencia: estándar');
    const s = history('SSS', { sufficient: true });
    assert.equal(p.practiceBand(s, 'n1', 'challenge').band, 'challenge');
    assert.equal(p.practiceBand(s, 'n1', 'production').band, 'challenge');
    assert.equal(p.practiceBand(s, 'n1', 'lesson').band, 'standard', 'una lección nunca es desafío');
    assert.match(p.practiceBand(s, 'n1', 'lesson').reason, /práctica aparte/);
    const low = history('SS cF cF cF', { sufficient: true }); assert.equal(coversAll(low), true);
    assert.equal(p.practiceBandState(low, 'n1').band, 'base');
    assert.equal(p.practiceBand(low, 'n1', 'challenge').band, 'standard', 'desempeño reciente bajo: el desafío espera');
    assert.equal(p.practiceBand(low, 'n1', 'confirmation').band, 'base');
    const request = p.lessonRequest(history('FFF'), history('FFF').nodes[0]);
    assert.equal(request.difficulty_band, 'base');
    assert.equal(p.lessonRequest(attach(baseGoal()), baseGoal().nodes[0]).difficulty_band, 'standard');
    // Precedencia: la lección que no aplicó la banda deja la práctica en estándar y lo explica.
    const decision = p.practiceBand(history('FFF'), 'n1', 'lesson');
    assert.equal(p.lessonDifficultyReason(decision, 'base'), decision.reason);
    assert.match(p.lessonDifficultyReason(decision, 'standard'), /lección ya ajusta el apoyo/);
    const lesson = { difficulty_band: 'standard', difficulty_reason: 'x', independent: { prompt: 'i' }, integration: { prompt: 'n' }, check: { prompt: 'c' } };
    assert.equal(p.bandedQuestion(lesson.independent, lesson, 'INDEPENDENT').difficulty_band, 'standard');
    assert.equal(p.bandedQuestion(lesson.integration, lesson, 'INTEGRATE').difficulty_band, 'standard');
    assert.equal(p.bandedQuestion(lesson.check, lesson, 'COMPREHENSION'), lesson.check, 'la comprobación y la práctica guiada no llevan banda');
    assert.equal(p.bandedQuestion(lesson.independent, { independent: {} }, 'INDEPENDENT'), lesson.independent, 'lección antigua sin banda: sin cambios');
  }

  // 7. Razones visibles en lenguaje llano y sin marcado.
  assert.equal(p.practiceBand(history('FFFSSSSS'), 'n1', 'confirmation').reason, 'Subiste porque acertaste 5 de 5 sin pistas');
  assert.equal(p.practiceBand(history('FFF'), 'n1', 'confirmation').reason, 'Bajaste de nivel porque no acertaste ninguna de las últimas 3 sin pistas');
  assert.equal(p.practiceBand(history('FSF'), 'n1', 'confirmation').reason, 'Bajaste de nivel porque acertaste solo 1 de 3 sin pistas');
  assert.equal(p.practiceBand(history(''), 'n1', 'confirmation').reason, 'Es tu nivel de partida.');
  assert.equal(p.practiceBand(history('SS'), 'n1', 'confirmation').reason, 'Aún hay pocas respuestas recientes para cambiar el nivel.');
  assert.equal(p.practiceBand(history('SFSSF'), 'n1', 'confirmation').reason, 'Se mantiene porque tus respuestas recientes están en un punto medio.');
  assert.match(p.practiceBand(history('SSS'), 'n1', 'confirmation').reason, /se abre cuando tu evidencia inicial esté completa/);
  for (const [band, label] of [['base', 'base'], ['standard', 'estándar'], ['challenge', 'desafío']]) {
    const line = p.difficultyLine(band, '<img src=x onerror=alert(1)>');
    assert.equal(line.textContent, 'Nivel: ' + label + ' · <img src=x onerror=alert(1)>', 'texto plano, sin innerHTML');
  }
  {
    const g = history('FFFSSSSS'); const box = element();
    p.renderQuestion(box, { prompt: 'Calcula algo', reference: 'r', kind: 'application', observable_dimensions: ['direct_application'], difficulty_band: 'standard', difficulty_reason: 'Subiste porque acertaste 5 de 5 sin pistas' }, 'n1', 'INDEPENDENT', 'independent_practice');
    assert.ok(find(box, e => e.textContent === 'Nivel: estándar · Subiste porque acertaste 5 de 5 sin pistas'), 'línea visible con el motivo');
    const guided = element(); p.renderQuestion(guided, { prompt: 'Guiada', reference: 'r', kind: 'application', observable_dimensions: ['direct_application'], difficulty_band: 'base' }, 'n1', 'GUIDED', 'guided_practice');
    assert.equal(find(guided, e => String(e.textContent).startsWith('Nivel:')), null, 'solo la práctica que cuenta muestra el nivel');
    const legacy = element(); p.renderQuestion(legacy, { prompt: 'Antigua', reference: 'r', kind: 'application', observable_dimensions: ['direct_application'] }, 'n1', 'INDEPENDENT', 'independent_practice');
    assert.equal(find(legacy, e => String(e.textContent).startsWith('Nivel:')), null, 'sin banda no se muestra nada');
    void g;
  }

  // 8. La banda base se envía al servidor (confirmación y producción) y se registra en el evento.
  {
    assert.equal(p.confirmationPayload(history('FFF'), history('FFF').nodes[0], 'direct_application', 'base').difficulty, 'base');
    assert.equal(p.confirmationPayload(history('FFF'), history('FFF').nodes[0], 'direct_application', 'raro').difficulty, 'standard');
    const g = history('FFF'); g.session = { mode: 'CONFIRMATION', node: 'n1', stack: [], tries: 0, hints: 0, confirmation: { node_id: 'n1', attempts: 0, question: null, target_dimension: null } };
    const sent = [];
    global.fetch = async (route, options) => {
      const body = JSON.parse(options.body);
      if (route !== '/api/confirmation') return { ok: true, json: async () => ({ ok: true, revision: 1 }) };
      sent.push([route, body]);
      const kind = p.CONFIRMATION_KINDS[body.target_dimension];
      return { ok: true, json: async () => ({ question: { prompt: 'Comprobación nueva', reference: 'Criterio', kind, observable_dimensions: [body.target_dimension] }, difficulty_band: body.difficulty }) };
    };
    await p.confirmationView(element(), g, g.nodes[0]); await settle();
    assert.equal(sent.length, 1); assert.equal(sent[0][1].difficulty, 'base', 'el cliente envía base');
    const question = g.session.confirmation.question;
    assert.equal(question.difficulty_band, 'base'); assert.match(question.difficulty_reason, /^Bajaste de nivel/);
    const event = p.prepareRecord(g, 'n1', 'CONFIRMATION', 'resp', { status: 'CORRECT', evaluator_version: 'local-fixture' }, 0, p.activityContract(question, 'n1', 'evidence_confirmation'), 'att-conf').event;
    assert.equal(event.difficulty_band, 'base'); assert.equal(event.difficulty_policy_version, 'practice_difficulty_v1');

    // Propósito challenge con suficiencia: se envía challenge.
    const c = history('SSS', { sufficient: true }); c.session = { mode: 'CONFIRMATION', node: 'n1', stack: [], tries: 0, hints: 0, confirmation: { node_id: 'n1', attempts: 0, question: null, target_dimension: 'direct_application', purpose: 'challenge' } };
    sent.length = 0; await p.confirmationView(element(), c, c.nodes[0]); await settle();
    assert.equal(sent[0][1].difficulty, 'challenge');

    // Producción: la banda viaja en la solicitud y el evento la conserva.
    const pr = history('FFF'); pr.production = { version: p.PROD_VERSION, id: 'prod-1', node_id: 'n1', kind: null, item: null, status: 'active', result: null, unavailable: false };
    global.fetch = async (route, options) => { const body = JSON.parse(options.body); if (route !== '/api/practice/produce') return { ok: true, json: async () => ({ ok: true, revision: 1 }) }; sent.push([route, body]); return { ok: true, json: async () => ({ item_id: 'prod-item-1', node_id: 'n1', kind: 'numeric', prompt: 'Calcula 2 + 3 en unidades', difficulty_band: body.difficulty_band }) }; };
    sent.length = 0; assert.equal(await p.fetchProduction(pr), true);
    assert.equal(sent[0][0], '/api/practice/produce'); assert.equal(sent[0][1].difficulty_band, 'base');
    assert.equal(pr.production.item.difficulty_band, 'base');
    p.applyProductionResult(pr, { schema_version: p.PROD_VERSION, item_id: 'prod-item-1', node_id: 'n1', status: 'CORRECT', error_type: 'none', solution: 's' }, 'att-prod', '5 u');
    const prodEvent = pr.events.filter(e => e.type === 'EVIDENCE').at(-1);
    assert.equal(prodEvent.difficulty_band, 'base');
    assert.equal(p.independentSuccesses(dim(pr, 'direct_application')).some(e => e.attempt_id === 'att-prod'), false, 'la producción base no suma para suficiencia');
  }

  console.log('practice_difficulty.test.js OK');
})().catch(error => { console.error = console.log; console.error(error); process.exit(1); });
