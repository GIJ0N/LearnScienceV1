// graded_hints_v1: the evidence event records the most revealing hint used (0-5)
// and any recorded hint blocks independence. No provider, no browser.
const assert = require('node:assert/strict');

function element(type = 'div') {
  return { type, textContent: '', value: '', disabled: false, children: [],
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    replaceChildren(...items) { this.children = items; } };
}
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: id => (id === 'app' ? roots.app : roots.status), createElement: type => element(type) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;

const policy = require('../app.js');
const DAY = 86400000;

function independentContract(id = 'activity-n1') {
  return policy.normalizeActivityContract({ activity_id: id, node_id: 'n1', stage: 'INDEPENDENT', kind: 'application',
    observable_dimensions: ['direct_application'], supports_independence: true, role: 'independent_practice' });
}
function goal() {
  const q = (prompt, kind) => ({ prompt, reference: 'Criterio', kind });
  return {
    id: 'goal-hints', profile_id: 'profile-hints', goal: 'Meta', learner: {}, events: [], reviews: [], repairEpisodes: [], contextStack: [],
    nodes: [{ id: 'n1', name: 'n1', outcome: 'Resolver', level: 0, prerequisites: [], kind: 'concept', probe: q('Explica', 'explanation') }],
    coverage: [{ id: 'n1', name: 'n1', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'direct_application', name: 'direct_application', required: true, status: 'UNKNOWN', evidence: [] }] }],
    lessons: { n1: { explanation: 'E', example: 'Ej', common_error: 'Error', check: q('Comprende', 'explanation'), guided: q('Guía', 'application'), independent: q('Aplica', 'application'), integration: q('Integra', 'context_case') } },
    session: { mode: 'INDEPENDENT', node: 'n1', stack: [], tries: 0, hints: 0 },
  };
}
function attach(value) { policy.setStoreForTests({ goals: [value], active: value.id }); policy.setProfileForTests({ profile_id: 'profile-hints' }); return value; }

// 1. Normalización conservadora del nivel.
{
  assert.equal(policy.normalizeHintLevel(undefined), null);
  assert.equal(policy.normalizeHintLevel(null), null);
  assert.equal(policy.normalizeHintLevel(0), 0);
  assert.equal(policy.normalizeHintLevel(3), 3);
  assert.equal(policy.normalizeHintLevel('2'), 2);
  assert.equal(policy.normalizeHintLevel(2.2), 3, 'se redondea hacia el peldaño más revelador');
  assert.equal(policy.normalizeHintLevel(-4), 0);
  assert.equal(policy.normalizeHintLevel(99), 5);
  for (const bad of ['alto', NaN, Infinity, {}, true]) assert.equal(policy.normalizeHintLevel(bad), 5, `valor ilegible ${String(bad)} → 5`);
  assert.equal(policy.maxHintLevel(null, null), null);
  assert.equal(policy.maxHintLevel(null, 0), 0);
  assert.equal(policy.maxHintLevel(4, 1), 4);
}

// 2. Sin pista: el evento conserva independencia y registra hint_level_max null.
{
  const event = policy.activityEvidence(independentContract(), { status: 'CORRECT' }, 0, { attempt_id: 'no-hint' });
  assert.equal(event.hint_level_max, null);
  assert.equal(event.hint_ladder_version, policy.HINT_LADDER_VERSION);
  assert.equal(event.help_used, 0);
  assert.equal(event.is_independent, true);
}

// 3. Cualquier pista, incluso P0, impide independencia aunque help_used llegue en 0.
for (const level of [0, 1, 2, 3, 4, 5]) {
  const event = policy.activityEvidence(independentContract(), { status: 'CORRECT' }, 0, { attempt_id: `hint-${level}`, hint_level_max: level });
  assert.equal(event.hint_level_max, level);
  assert.equal(event.help_used >= 1, true, 'una pista graduada también cuenta como ayuda');
  assert.equal(event.is_independent, false);
  assert.equal(event.independent, false);
  assert.equal(event.result, 'CORRECT', 'la corrección sobrevive a la ayuda; la independencia no');
}

// 4. Flujo activo de lección: dos pistas → nivel máximo, sin independencia y sin dominio.
{
  const value = attach(goal());
  value.session.mode = 'GUIDED';
  value.session.hints = 1;
  value.session.hint_level_max = 2;
  const activity = policy.activityContract(value.lessons.n1.guided, 'n1', 'guided_practice');
  policy.applyResult(value, 'n1', 'GUIDED', 'respuesta', { status: 'CORRECT', error_type: 'none', feedback: 'ok', _activity: activity, _attempt_id: 'guided-hint' });
  const event = value.events.find(x => x.type === 'EVIDENCE' && x.attempt_id === 'guided-hint');
  assert.equal(event.hint_level_max, 2);
  assert.equal(event.is_independent, false);
  assert.equal(value.session.hints, 0);
  assert.equal(value.session.hint_level_max, null, 'el nivel se reinicia para la siguiente actividad');
}

// 5. Un evento con hint_level_max pero is_independent=true forzado (dato manipulado o
//    importado) no cuenta para suficiencia.
{
  const make = (id, at, extra = {}) => ({ ...policy.activityEvidence(independentContract(`activity-${id}`), { status: 'CORRECT' }, 0, { attempt_id: id, timestamp: at }), question: { prompt: `Pregunta ${id}`, reference: 'r', kind: 'application', observable_dimensions: ['direct_application'] }, ...extra });
  const dim = evidence => ({ id: 'direct_application', required: true, evidence });
  const clean = dim([make('c1', 1 * DAY), make('c2', 3 * DAY)]);
  assert.equal(policy.independentSuccesses(clean).length, 2, 'control positivo: dos aciertos independientes distintos');
  assert.equal(policy.deriveCoverage({ dimensions: [clean] }).dimensions[0].status, 'MASTERED', 'control positivo alcanza suficiencia');
  const tampered = dim([make('t1', 1 * DAY), make('t2', 3 * DAY, { hint_level_max: 1, help_used: 0, is_independent: true, independent: true })]);
  assert.deepEqual(policy.independentSuccesses(tampered).map(x => x.attempt_id), ['t1'], 'el intento con pista no cuenta');
  assert.notEqual(policy.deriveCoverage({ dimensions: [tampered] }).dimensions[0].status, 'MASTERED', 'una pista registrada nunca aporta independencia');
  assert.equal(policy.hintBlocksIndependence({ hint_level_max: 0, help_used: 0 }), true);
  assert.equal(policy.hintBlocksIndependence({ hint_level_max: null, help_used: 0 }), false);
  assert.equal(policy.hintBlocksIndependence({ help_used: 0 }), false, 'legacy sin campo: se decide solo con help_used');
  assert.equal(policy.hintBlocksIndependence({ help_used: 2 }), true);
}

// 6. Legacy: eventos sin hint_level_max siguen funcionando igual (no se inventa nivel).
{
  const legacy = { type: 'EVIDENCE', attempt_id: 'legacy-1', result: 'CORRECT', help_used: 1, is_independent: false };
  assert.equal(legacy.hint_level_max, undefined);
  assert.equal(policy.hintBlocksIndependence(legacy), true);
  const normalized = policy.normalizeGoal({ ...goal(), events: [legacy] });
  const kept = normalized.events.find(x => x.attempt_id === 'legacy-1');
  assert.equal('hint_level_max' in kept, false, 'la normalización no inventa un nivel para datos legacy');
  assert.equal(normalized.session.hint_level_max, null);
}

// 7. Reparación: registrar pistas guarda el nivel por pista y el máximo del intento;
//    la pista del evaluador (no verificada) se trata como P3.
{
  const episode = { stage: 'GUIDED', current_help_used: 0, current_hint_level_max: null, hint_history: [] };
  assert.equal(policy.registerRepairHint(episode, 'GUIDED', 'requested', 0), true);
  assert.equal(policy.registerRepairHint(episode, 'GUIDED', 'requested', 4), true);
  assert.equal(policy.registerRepairHint(episode, 'GUIDED', 'requested', 1), true);
  assert.equal(episode.current_help_used, 3);
  assert.equal(episode.current_hint_level_max, 4);
  assert.deepEqual(episode.hint_history.map(x => x.level), [0, 4, 1]);
  const unknown = { current_help_used: 0, hint_history: [] };
  policy.registerRepairHint(unknown, 'CHECK');
  assert.equal(unknown.current_hint_level_max, 5, 'sin nivel declarado se asume el más revelador');
  assert.equal(policy.registerRepairHint({ closed_at: 1 }, 'GUIDED', 'requested', 0), false);
  assert.equal(policy.registerRepairHint({}, 'PARENT_RETEST', 'requested', 0), false, 'etapas sin pista no registran');
  assert.equal(policy.repairHintLevel('GUIDED', 0, ['a', 'b']), 3);
  assert.equal(policy.repairHintLevel('GUIDED', 1, ['a', 'b']), 4);
  assert.equal(policy.repairHintLevel('GUIDED', 9, ['a', 'b']), 4);
  assert.equal(policy.repairHintLevel('CHECK', 0, ['a']), 0);
  assert.equal(policy.HINT_LEVELS.MODEL_UNVERIFIED, 3);
}

// 8. Reparación vía checkpoint: el nivel viaja del episodio al checkpoint, sobrevive
//    la normalización (recarga) y llega al evento; el reintento padre no queda independiente.
{
  const checkpoint = policy.normalizeRepairCheckpoint({ attempt_id: 'cp-1', activity_id: 'a', stage: 'GUIDED', help_used: 2, hint_level_max: 4, status: 'EVALUATED', evaluation: { status: 'CORRECT' } });
  assert.equal(checkpoint.hint_level_max, 4);
  assert.equal(policy.normalizeRepairCheckpoint({ attempt_id: 'cp-legacy', status: 'EVALUATING' }).hint_level_max, null);
  const hinted = policy.activityEvidence(independentContract('retest'), { status: 'CORRECT' }, 0, { attempt_id: 'retest-1', hint_level_max: 0 });
  assert.equal(policy.correctIndependent(hinted), false);
  const manipulated = { ...hinted, is_independent: true };
  assert.equal(policy.correctIndependent(manipulated), false, 'is_independent forzado con pista registrada no cierra el episodio');
}

// 9. Criterios: el nivel del borrador se persiste y el evento de evidencia lo conserva.
{
  const value = attach(goal());
  const draftGoal = policy.normalizeGoal({ ...value, criterion_draft: { schema_version: 'criterion_assessment_v1', profile_id: 'profile-hints', goal_id: value.id, node_id: 'n1', activity_id: 'act', activity: { activity_id: 'act', options: [] }, help_used: 1, hint_level_max: 1, status: 'DRAFT' } });
  assert.equal(draftGoal.criterion_draft.hint_level_max, 1);
  const legacyDraft = policy.normalizeGoal({ ...value, criterion_draft: { schema_version: 'criterion_assessment_v1', profile_id: 'profile-hints', goal_id: value.id, node_id: 'n1', activity_id: 'act', activity: { activity_id: 'act', options: [] }, help_used: 0, status: 'DRAFT' } });
  assert.equal(legacyDraft.criterion_draft.hint_level_max, null);
  const assessment = { schema_version: 'criterion_assessment_v1', attempt_id: 'crit-1', activity_id: 'act', overall: 'CORRECT', help_used: 0, hint_level_max: 1, independent: true,
    criteria: [{ criterion_id: 'option_choice', observable_dimension: 'recognition', status: 'SATISFIED' }, { criterion_id: 'explanation', observable_dimension: 'conceptual', status: 'SATISFIED' }] };
  policy.recordCriterionAssessment(value, 'n1', { selected_option_id: 'a', explanation: 'x' }, assessment);
  const event = value.events.find(x => x.attempt_id === 'crit-1');
  assert.equal(event.hint_level_max, 1);
  assert.equal(event.help_used, 1);
  assert.equal(event.is_independent, false, 'aunque el servidor declarara independent=true, una pista lo impide');
}

console.log('OK: pistas graduadas — nivel máximo registrado, cualquier pista impide independencia, legacy compatible.');
