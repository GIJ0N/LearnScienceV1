const assert = require('node:assert/strict');

function element(type = 'div') {
  return {
    type, textContent: '', value: '', disabled: false, children: [],
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    replaceChildren(...items) { this.children = items; },
  };
}

const roots = { app: element('main'), status: element('div') };
global.document = {
  getElementById: id => (id === 'app' ? roots.app : roots.status),
  createElement: type => element(type),
};
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;

const policy = require('../app.js');

function node(id = 'n1', prerequisites = []) {
  return { id, name: id, outcome: 'Resolver', level: 0, prerequisites, kind: 'procedure', probe: { prompt: `Probe ${id}`, reference: 'Criterio', kind: 'explanation' } };
}

function lesson() {
  return {
    explanation: 'Explicación', example: 'Ejemplo', common_error: 'Error',
    check: { prompt: 'Explica la relación original', reference: 'Criterio', kind: 'explanation', activity_id: 'parent-check' },
    guided: { prompt: 'Resuelve el caso padre con apoyo', reference: 'Criterio', kind: 'application', activity_id: 'parent-guided' },
    independent: { prompt: 'Resuelve 2x + 3 = 7', reference: 'x=2', kind: 'application', activity_id: 'parent-independent' },
    integration: { prompt: 'Integra el método', reference: 'Criterio', kind: 'context_case', activity_id: 'parent-integration' },
  };
}

function goal() {
  return {
    id: 'goal-1', goal: 'Álgebra', nodes: [node('n0'), node('n1', ['n0'])], learner: {},
    coverage: [{ id: 'n1', name: 'n1', status: 'UNKNOWN', confidence: 0, dimensions: [
      { id: 'direct_application', name: 'Aplicación', required: true, status: 'UNKNOWN', evidence: [] },
      { id: 'transfer', name: 'Transferencia', required: false, status: 'UNKNOWN', evidence: [] },
    ] }],
    events: [], reviews: [], lessons: { n1: lesson() }, repairEpisodes: [], contextStack: [],
    session: { mode: 'INDEPENDENT', node: 'n1', stack: [], stage: 'teach', tries: 0, hints: 0 },
  };
}

function plan(overrides = {}) {
  return {
    suspected_gaps: [
      { gap_id: 'gap-equation', node_id: 'n0', concept: 'Aislar la variable', reason: 'Bloquea el problema padre', motivating_evidence: 'No aisló x', confidence: 0.8, status: 'SUSPECTED' },
      { gap_id: 'gap-arithmetic', node_id: 'n0', concept: 'Operaciones inversas', reason: 'Posible confusión', motivating_evidence: 'Paso omitido', confidence: 0.4, status: 'SUSPECTED' },
    ],
    diagnostic_checks: [
      { gap_id: 'gap-equation', question: { prompt: '¿Qué operación deshace sumar tres?', reference: 'Restar tres', kind: 'explanation' } },
      { gap_id: 'gap-arithmetic', question: { prompt: 'Calcula siete menos tres', reference: 'Cuatro', kind: 'calculation' } },
    ],
    repair_activities: {
      CHECK: { prompt: 'Identifica la operación inversa en y + 5 = 9', reference: 'Restar cinco', kind: 'explanation' },
      GUIDED: { prompt: 'Con apoyo, despeja y en y + 5 = 9', reference: 'y=4', kind: 'application' },
      INDEPENDENT: { prompt: 'Sin ayuda, despeja z en 3z - 2 = 10', reference: 'z=4', kind: 'application' },
    },
    parent_retest: { prompt: 'Vuelve al caso relacionado: despeja x en 2x + 5 = 9', reference: 'x=2', kind: 'application' },
    transfer_check: { prompt: 'Una tarifa cobra 4 de base y 3 por hora; ¿cuántas horas producen 16?', reference: '4 horas', kind: 'transfer' },
    transfer_novelty_status: 'CONFIRMED',
    transfer_novelty_basis: 'Cambia de ecuación simbólica a modelado verbal y exige seleccionar la representación.',
    ...overrides,
  };
}

function attach(value) {
  policy.setStoreForTests({ goals: [value], active: value.id });
  return value;
}

function openEpisode(value, customPlan = plan(), parentHelp = 0) {
  attach(value);
  const parentActivity = policy.activityContract(value.lessons.n1.independent, 'n1', 'independent_practice');
  const parentEvent = policy.record(value, 'n1', 'INDEPENDENT', 'Sumé tres', { status: 'PARTIAL', error_type: 'prerequisite', feedback: 'Revisa operaciones inversas' }, parentHelp, parentActivity, 'parent-attempt-1');
  const episode = policy.createRepairEpisode(value, {
    activity_id: parentEvent.activity_id,
    attempt_id: parentEvent.attempt_id,
    node_id: 'n1',
    question: value.lessons.n1.independent,
    response: 'Sumé tres',
    evaluation: { status: parentEvent.result, error_type: parentEvent.error_type, feedback: 'Revisa operaciones inversas' },
    help_used: parentEvent.help_used,
    context_snapshot: { mode: 'INDEPENDENT', node: 'n1', stack: [], stage: 'teach', tries: 0 },
  }, customPlan);
  policy.pushContext(value, { context_id: 'context-root', episode_id: episode.episode_id, status: 'ACTIVE', history: [] });
  return episode;
}

let sequence = 0;
function applyStage(value, episode, status = 'CORRECT', help = 0, attemptId = null) {
  const current = policy.episodeActivity(episode);
  assert.ok(current, `No current activity for ${episode.status}/${episode.stage}`);
  const id = attemptId || `episode-attempt-${++sequence}`;
  const result = {
    status, error_type: status === 'CORRECT' ? 'none' : 'procedure', feedback: 'feedback', hint: '',
    _activity: current.activity, _attempt_id: id, _episode_id: episode.episode_id,
    _repair_stage: current.phase, _help_used: help,
  };
  return { applied: policy.applyResult(value, 'n1', current.activity.stage, 'respuesta', result), result, event: value.events.filter(x => x.type === 'EVIDENCE').at(-1) };
}

function expectCode(fn, code) {
  assert.throws(fn, error => error && error.code === code);
}

function parentFixture(value, attemptId = `parent-fixture-${++sequence}`) {
  attach(value);
  const activity = policy.activityContract(value.lessons.n1.independent, 'n1', 'independent_practice');
  const event = policy.record(value, 'n1', 'INDEPENDENT', 'respuesta original', { status: 'PARTIAL', error_type: 'prerequisite', feedback: 'Reparar' }, 0, activity, attemptId);
  return {
    activity_id: event.activity_id, attempt_id: event.attempt_id, node_id: 'n1',
    question: value.lessons.n1.independent, response: 'respuesta original',
    evaluation: { status: event.result, error_type: event.error_type, feedback: 'Reparar' },
    help_used: 0, context_snapshot: { mode: 'INDEPENDENT', node: 'n1', stack: [], stage: 'teach', tries: 0 },
  };
}

function applyThenRepeat(value, episode, status = 'CORRECT', help = 0) {
  const current = policy.episodeActivity(episode);
  const attemptId = `double-transition-${++sequence}`;
  const result = {
    status, error_type: status === 'CORRECT' ? 'none' : 'procedure', feedback: 'feedback', hint: '',
    _activity: current.activity, _attempt_id: attemptId, _episode_id: episode.episode_id,
    _repair_stage: current.phase, _help_used: help,
  };
  assert.equal(policy.applyResult(value, 'n1', current.activity.stage, 'respuesta', result), true);
  const afterFirst = JSON.stringify(value);
  expectCode(() => policy.applyResult(value, 'n1', current.activity.stage, 'respuesta', result), 'DUPLICATE_ATTEMPT');
  assert.equal(JSON.stringify(value), afterFirst);
  assert.equal(value.events.filter(x => x.type === 'EVIDENCE' && x.attempt_id === attemptId).length, 1);
  return value.events.find(x => x.type === 'EVIDENCE' && x.attempt_id === attemptId);
}

function requestHintThroughContext(value, episode) {
  const box = element('section');
  policy.contextScreen(box, value);
  const hint = box.children.find(item => item && item.type === 'button' && item.textContent === 'Dame una pista');
  assert.ok(hint, `La etapa ${episode.stage} no expuso la pista esperada`);
  hint.onclick();
  assert.ok(episode.current_help_used > 0);
}

function finishDiagnosis(value, episode) {
  while (episode.status === 'DIAGNOSING') applyStage(value, episode, episode.diagnostic_index === 0 ? 'PARTIAL' : episode.diagnostic_index === 1 ? 'CORRECT' : 'UNKNOWN');
}

function finishRepair(value, episode, independentHelp = 0) {
  while (episode.status === 'REPAIRING') {
    const help = episode.stage === 'INDEPENDENT' ? independentHelp : episode.stage === 'GUIDED' ? 1 : 0;
    applyStage(value, episode, 'CORRECT', help);
    if (episode.stage === 'INDEPENDENT' && independentHelp > 0) break;
  }
}

// A. El fallo padre abre un episodio sin sobrescribir evidencia, respuesta ni evaluación.
{
  const value = goal();
  const episode = openEpisode(value);
  assert.equal(episode.status, 'DIAGNOSING');
  assert.equal(episode.parent_activity_id, 'parent-independent');
  assert.equal(episode.parent_attempt_id, 'parent-attempt-1');
  assert.equal(episode.parent_response, 'Sumé tres');
  assert.equal(episode.parent_evaluation.status, 'PARTIAL');
  assert.equal(value.events.filter(x => x.attempt_id === 'parent-attempt-1').length, 1);
}

// B. Hipótesis y diagnósticos están acotados; solo una laguna queda seleccionada.
{
  const value = goal();
  const atLimit = plan({
    suspected_gaps: Array.from({ length: 3 }, (_, i) => ({ gap_id: `g${i}`, concept: `c${i}`, confidence: i / 10, status: 'SUSPECTED' })),
    diagnostic_checks: Array.from({ length: 3 }, (_, i) => ({ gap_id: `g${i}`, question: { prompt: `Diagnóstico ${i}`, reference: 'Criterio', kind: 'explanation' } })),
  });
  const episode = openEpisode(value, atLimit);
  assert.equal(episode.suspected_gaps.length, 3);
  assert.equal(episode.diagnostic_checks.length, 3);
  finishDiagnosis(value, episode);
  assert.equal(episode.status, 'REPAIRING');
  assert.ok(episode.selected_gap);
  assert.equal(episode.suspected_gaps.filter(x => x.status === 'CONFIRMED').length, 1);
  assert.equal(episode.suspected_gaps.filter(x => x.status === 'SUSPECTED').length, 1);
}

// C. Las actividades son distintas; ayuda y práctica guiada no acreditan independencia.
{
  const prepared = policy.prepareRepairPlan(plan(), lesson().independent, 'episode-x');
  const prompts = Object.values(prepared.repair_activities).map(x => x.prompt);
  assert.equal(new Set(prompts).size, 3);
  assert.throws(() => policy.prepareRepairPlan(plan({ repair_activities: { CHECK: plan().repair_activities.CHECK, GUIDED: plan().repair_activities.CHECK, INDEPENDENT: plan().repair_activities.INDEPENDENT } }), lesson().independent, 'episode-x'), error => error.code === 'DUPLICATE_REPAIR_ACTIVITY');

  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  applyStage(value, episode, 'CORRECT');
  const guided = applyStage(value, episode, 'CORRECT', 1).event;
  assert.equal(guided.is_independent, false);
  const helpedIndependent = applyStage(value, episode, 'CORRECT', 1).event;
  assert.equal(helpedIndependent.is_independent, false);
  assert.equal(episode.status, 'REPAIRING');
  assert.equal(episode.stage, 'INDEPENDENT');
  const independent = applyStage(value, episode, 'CORRECT', 0).event;
  assert.equal(independent.is_independent, true);
  assert.equal(episode.status, 'PARENT_RETEST');
  assert.equal(value.coverage[0].dimensions[0].evidence.length, 1, 'La evidencia hija no debe actualizar cobertura del padre');
}

// C1. La equivalencia es textual y conservadora; los identificadores y el contexto no fabrican novedad.
{
  const original = { ...lesson().independent, activity_id: 'activity-a', episode_id: 'episode-a', parent_activity_id: 'parent-a' };
  assert.equal(policy.repairActivityRelation(original, { ...original }), 'EQUIVALENT');
  assert.equal(policy.repairActivityRelation(original, { ...original, activity_id: 'activity-b' }), 'EQUIVALENT');
  assert.equal(policy.repairActivityRelation(original, { ...original, kind: 'transfer', activity_id: 'activity-c' }), 'EQUIVALENT');
  assert.equal(policy.repairActivityRelation(original, { ...original, episode_id: 'episode-b', activity_id: 'activity-d' }), 'EQUIVALENT');
  assert.equal(policy.repairActivityRelation(original, { ...original, parent_activity_id: 'parent-b', activity_id: 'activity-parent' }), 'EQUIVALENT');
  assert.equal(policy.repairActivityRelation(original, { ...original, prompt: '  RESUELVE 2X + 3 = 7!!! ', activity_id: 'activity-e' }), 'EQUIVALENT');
  assert.equal(policy.repairActivityRelation(original, { ...original, prompt: 'Modela una tarifa de cuatro por hora', activity_id: 'activity-f', kind: 'application' }), 'DISTINCT');
  assert.equal(policy.repairActivityRelation({ prompt: 'Pregunta A' }, { prompt: 'Pregunta B' }), 'INDETERMINATE');
  assert.equal(policy.repairActivityRelation(original, { ...original, prompt: '', activity_id: 'activity-empty' }), 'INDETERMINATE');
  assert.equal(policy.repairActivityRelation(original, null), 'INDETERMINATE');
  assert.equal(policy.repairActivityRelation({}, {}), 'INDETERMINATE');
  assert.equal(policy.equivalentRepairActivity(original, { ...original, activity_id: 'activity-b' }), true);
  assert.equal(policy.equivalentRepairActivity(original, { ...original, prompt: 'Modela una tarifa de cuatro por hora', activity_id: 'activity-f' }), false);

  const withoutNovelty = policy.prepareRepairPlan(plan({
    transfer_check: { prompt: 'Modela una tarifa de cuatro por hora', reference: '4 horas', kind: 'transfer', activity_id: 'transfer-new' },
    transfer_novelty_status: 'INDETERMINATE', transfer_novelty_basis: '',
  }), original, 'episode-equivalence');
  assert.equal(withoutNovelty.transfer_check.novelty_status, 'INDETERMINATE');

  const withNovelty = policy.prepareRepairPlan(plan(), original, 'episode-equivalence');
  assert.equal(withNovelty.transfer_check.novelty_status, 'CONFIRMED');
  assert.equal(withNovelty.transfer_check.attempts.length, 0);
}

// D. El hijo no domina al padre; el reintento conserva el original y usa ids nuevos.
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  finishRepair(value, episode);
  assert.equal(policy.verified(value, 'n1'), false);
  const current = policy.episodeActivity(episode);
  assert.notEqual(current.activity.activity_id, episode.parent_activity_id);
  const retest = applyStage(value, episode, 'CORRECT').event;
  assert.notEqual(retest.attempt_id, episode.parent_attempt_id);
  assert.equal(episode.parent_response, 'Sumé tres');
  assert.equal(episode.parent_retest.attempts.length, 1);
  assert.equal(episode.status, 'TRANSFER_CHECK');
}

// E. Transferencia requiere novedad confirmada; copia/indeterminación no acredita.
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  finishRepair(value, episode);
  applyStage(value, episode, 'CORRECT');
  const transfer = applyStage(value, episode, 'CORRECT').event;
  assert.equal(transfer.is_novel_variant, true);
  assert.equal(episode.status, 'COMPLETED');
  assert.ok(episode.closed_at);
}
{
  const value = goal();
  const indeterminate = plan({ transfer_novelty_status: 'INDETERMINATE', transfer_novelty_basis: '' });
  const episode = openEpisode(value, indeterminate);
  finishDiagnosis(value, episode);
  finishRepair(value, episode);
  applyStage(value, episode, 'CORRECT');
  assert.equal(episode.status, 'PARTIAL');
  assert.equal(episode.transfer_check.novelty_status, 'INDETERMINATE');
  assert.equal(episode.transfer_check.attempts.length, 0);
}

// F. Límites: profundidad, actividades, gaps repetidos y cierre parcial.
{
  const value = goal();
  const episode = openEpisode(value);
  policy.pushContext(value, { context_id: 'c2', episode_id: episode.episode_id, gap_id: 'depth-g2' });
  policy.pushContext(value, { context_id: 'c3', episode_id: episode.episode_id, gap_id: 'depth-g3' });
  policy.pushContext(value, { context_id: 'c4', episode_id: episode.episode_id, gap_id: 'depth-g4' });
  assert.equal(policy.canPushContext(value, { context_id: 'c5', episode_id: episode.episode_id }).reason, 'MAX_DEPTH');
  assert.throws(() => policy.pushContext(value, { context_id: 'c5', episode_id: episode.episode_id }), error => error.code === 'MAX_DEPTH');
  assert.equal(episode.status, 'PARTIAL');
  assert.match(episode.close_reason, /profundidad máxima/);
  assert.equal(value.contextStack.length, 0);
}
{
  const value = goal();
  const episode = openEpisode(value);
  policy.pushContext(value, { context_id: 'gap-child', episode_id: episode.episode_id, gap_id: 'repeat-gap' });
  assert.equal(policy.canPushContext(value, { context_id: 'repeat', episode_id: episode.episode_id, gap_id: 'repeat-gap' }).reason, 'DUPLICATE_GAP');
  assert.throws(() => policy.pushContext(value, { context_id: 'repeat', episode_id: episode.episode_id, gap_id: 'repeat-gap' }), error => error.code === 'DUPLICATE_GAP');
  assert.equal(episode.status, 'PARTIAL');
  assert.match(episode.close_reason, /misma laguna/);
}
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  for (let i = 0; i < policy.REPAIR_LIMITS.max_activities; i++) applyStage(value, episode, 'PARTIAL');
  assert.equal(episode.status, 'PARTIAL');
  assert.match(episode.close_reason, /máximo de actividades/);
}

// G. El cierre y la importación conservan el episodio; legacy no inventa episodios.
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  finishRepair(value, episode);
  applyStage(value, episode, 'CORRECT');
  applyStage(value, episode, 'CORRECT');
  assert.equal(value.contextStack.length, 0);
  assert.equal(value.repairEpisodes.length, 1);
  assert.equal(episode.context_history.length, 1);
  const backup = { goals: [value], active: value.id };
  const before = JSON.stringify(backup);
  const restored = policy.normalizeImportedStore(backup);
  assert.equal(JSON.stringify(backup), before);
  assert.equal(restored.goals[0].repairEpisodes[0].status, 'COMPLETED');
  assert.equal(restored.goals[0].repairEpisodes[0].parent_response, 'Sumé tres');

  const legacy = policy.normalizeImportedStore({ goals: [{ id: 'legacy', nodes: [node()], learner: {}, session: {} }], active: 'legacy' });
  assert.deepEqual(legacy.goals[0].repairEpisodes, []);
}

// G1. Las importaciones no inventan created_at; solo un episodio nuevo recibe fecha de creación.
{
  const legacyGoal = {
    id: 'legacy-dates', nodes: [], learner: {}, coverage: [], events: [], lessons: {},
    session: {}, repairEpisodes: [{ episode_id: 'legacy-no-date', status: 'PARTIAL' }],
  };
  const originalNow = Date.now;
  Date.now = () => 9999999999999;
  try {
    const imported = policy.normalizeImportedStore({ goals: [legacyGoal], active: legacyGoal.id });
    const legacyEpisode = imported.goals[0].repairEpisodes[0];
    assert.equal(legacyEpisode.created_at, null);
    assert.equal(Object.prototype.hasOwnProperty.call(legacyEpisode, 'legacy_imported_at'), false);
    assert.deepEqual(legacyEpisode.repair_evidence, []);
    const repeated = policy.normalizeImportedStore(imported);
    assert.equal(repeated.goals[0].repairEpisodes[0].created_at, null);
  } finally {
    Date.now = originalNow;
  }

  const valid = policy.normalizeRepairEpisode({ episode_id: 'legacy-valid-date', status: 'PARTIAL', created_at: 1234567890 });
  assert.equal(valid.created_at, 1234567890);
  assert.equal(policy.normalizeRepairEpisode({ episode_id: 'legacy-null-date', status: 'PARTIAL', created_at: null }).created_at, null);
  assert.equal(policy.normalizeRepairEpisode({ episode_id: 'legacy-string-date', status: 'PARTIAL', created_at: '1234567890' }).created_at, null);
  assert.equal(policy.normalizeRepairEpisode({ episode_id: 'legacy-invalid-date', status: 'PARTIAL', created_at: Number.NaN }).created_at, null);
  assert.equal(policy.normalizeRepairEpisode({ episode_id: 'legacy-failed', status: 'FAILED' }).status, 'FAILED');
  const fresh = openEpisode(goal());
  assert.equal(typeof fresh.created_at, 'number');
  const roundTrip = policy.normalizeImportedStore({ goals: [{ ...goal(), repairEpisodes: [fresh] }], active: 'goal-1' });
  assert.equal(roundTrip.goals[0].repairEpisodes[0].created_at, fresh.created_at);
}

// H. Recorridos: reparación fallida, padre fallido, variante fallida, doble clic y reanudación.
{
  const value = goal();
  const episode = openEpisode(value, plan(), 1);
  assert.equal(episode.parent_help_used, 1);
  finishDiagnosis(value, episode);
  finishRepair(value, episode);
  assert.equal(episode.status, 'PARENT_RETEST');
}
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  for (let i = 0; i < policy.REPAIR_LIMITS.max_activities; i++) applyStage(value, episode, 'MISCONCEPTION');
  assert.equal(episode.status, 'PARTIAL');
}
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  finishRepair(value, episode);
  applyStage(value, episode, 'PARTIAL');
  applyStage(value, episode, 'PARTIAL');
  assert.equal(episode.status, 'PARTIAL');
  assert.equal(episode.parent_retest.attempts.length, 2);
}
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  finishRepair(value, episode);
  applyStage(value, episode, 'CORRECT');
  applyStage(value, episode, 'PARTIAL');
  assert.equal(episode.status, 'PARTIAL');
}
{
  const value = goal();
  const episode = openEpisode(value);
  const current = policy.episodeActivity(episode);
  const duplicateId = 'double-click-attempt';
  applyStage(value, episode, 'PARTIAL', 0, duplicateId);
  const count = value.events.filter(x => x.attempt_id === duplicateId).length;
  assert.throws(() => policy.applyResult(value, 'n1', current.activity.stage, 'respuesta', { status: 'PARTIAL', error_type: 'procedure', _activity: current.activity, _attempt_id: duplicateId, _episode_id: episode.episode_id, _repair_stage: current.phase, _help_used: 0 }), error => error.code === 'DUPLICATE_ATTEMPT');
  assert.equal(value.events.filter(x => x.attempt_id === duplicateId).length, count);

  const resumed = policy.normalizeGoal(value);
  const resumedEpisode = resumed.repairEpisodes[0];
  assert.equal(resumedEpisode.status, episode.status);
  assert.equal(policy.episodeActivity(resumedEpisode).question.prompt, policy.episodeActivity(episode).question.prompt);
  attach(resumed);
  expectCode(() => policy.applyResult(resumed, 'n1', current.activity.stage, 'respuesta antigua', {
    status: 'PARTIAL', error_type: 'procedure', _activity: current.activity,
    _attempt_id: duplicateId, _episode_id: episode.episode_id,
    _repair_stage: current.phase, _help_used: 0,
  }), 'DUPLICATE_ATTEMPT');
}

// Auditoría A-B. La ruta hija no domina al padre y las pistas quedan registradas.
{
  const value = goal();
  const episode = openEpisode(value);
  const parentCoverageCount = value.coverage[0].dimensions[0].evidence.length;
  finishDiagnosis(value, episode);
  assert.equal(policy.repairCanRequestHint('CHECK'), true);
  requestHintThroughContext(value, episode);
  const check = applyStage(value, episode, 'CORRECT', episode.current_help_used).event;
  assert.equal(check.help_used, 1);
  assert.equal(check.is_independent, false);

  requestHintThroughContext(value, episode);
  const guided = applyStage(value, episode, 'CORRECT', episode.current_help_used).event;
  assert.equal(guided.help_used, 1);
  assert.equal(guided.is_independent, false);

  requestHintThroughContext(value, episode);
  const helpedIndependent = applyStage(value, episode, 'CORRECT', episode.current_help_used).event;
  assert.equal(helpedIndependent.help_used, 1);
  assert.equal(helpedIndependent.is_independent, false);
  assert.equal(episode.status, 'REPAIRING');
  assert.equal(episode.stage, 'INDEPENDENT');
  assert.deepEqual(episode.hint_history.map(x => x.stage), ['CHECK', 'GUIDED', 'INDEPENDENT']);

  const independent = applyStage(value, episode, 'CORRECT', 0).event;
  assert.equal(independent.is_independent, true);
  assert.equal(episode.status, 'PARENT_RETEST');
  assert.equal(value.coverage[0].dimensions[0].evidence.length, parentCoverageCount);
  assert.equal(value.learner.n1.level, 0);
  assert.equal(policy.verified(value, 'n1'), false);
  const reloaded = policy.normalizeGoal(JSON.parse(JSON.stringify(value))).repairEpisodes[0];
  assert.deepEqual(reloaded.hint_history.map(x => x.stage), ['CHECK', 'GUIDED', 'INDEPENDENT']);
}

// Auditoría C. Padre e hijo conservan identidad, respuesta y eventos separados.
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  finishRepair(value, episode);
  const beforeCollision = JSON.stringify(value);
  expectCode(() => applyStage(value, episode, 'CORRECT', 0, episode.parent_attempt_id), 'ATTEMPT_COLLISION');
  assert.equal(JSON.stringify(value), beforeCollision);
  const retest = applyStage(value, episode, 'CORRECT').event;
  const parent = value.events.find(x => x.type === 'EVIDENCE' && x.attempt_id === episode.parent_attempt_id);
  assert.notEqual(retest.activity_id, parent.activity_id);
  assert.notEqual(retest.attempt_id, parent.attempt_id);
  assert.notEqual(retest.evidence_id, parent.evidence_id);
  assert.equal(episode.parent_response, 'Sumé tres');
  assert.equal(parent.answer, 'Sumé tres');
}
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  finishRepair(value, episode);
  const helpedRetest = applyStage(value, episode, 'CORRECT', 1).event;
  assert.equal(helpedRetest.is_independent, false);
  assert.equal(episode.status, 'PARENT_RETEST');
  const independentRetest = applyStage(value, episode, 'CORRECT', 0).event;
  assert.equal(independentRetest.is_independent, true);
  assert.equal(episode.status, 'TRANSFER_CHECK');
}

// Auditoría D. La transferencia exige una pregunta nueva, novedad demostrada e independencia.
{
  const original = lesson().independent;
  assert.equal(policy.prepareRepairPlan(plan(), original, 'novel').transfer_check.novelty_status, 'CONFIRMED');
  const exact = policy.prepareRepairPlan(plan({ transfer_check: { ...original }, transfer_novelty_status: 'CONFIRMED', transfer_novelty_basis: 'Declaración sin cambio real.' }), original, 'exact');
  assert.equal(exact.transfer_check.novelty_status, 'INDETERMINATE');
  const otherId = policy.prepareRepairPlan(plan({ transfer_check: { ...original, activity_id: 'different-id' }, transfer_novelty_status: 'CONFIRMED', transfer_novelty_basis: 'Solo cambió el identificador.' }), original, 'other-id');
  assert.equal(otherId.transfer_check.novelty_status, 'INDETERMINATE');
  const formatted = policy.prepareRepairPlan(plan({ transfer_check: { prompt: '  RESUELVE 2X + 3 = 7!!! ', reference: 'x=2', kind: 'transfer', activity_id: 'formatted-id' }, transfer_novelty_status: 'CONFIRMED', transfer_novelty_basis: 'Solo cambió el formato.' }), original, 'formatted');
  assert.equal(formatted.transfer_check.novelty_status, 'INDETERMINATE');
  const absent = policy.prepareRepairPlan(plan({ transfer_novelty_status: undefined, transfer_novelty_basis: '' }), original, 'absent');
  assert.equal(absent.transfer_check.novelty_status, 'INDETERMINATE');
}
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  finishRepair(value, episode);
  applyStage(value, episode, 'CORRECT');
  const transfer = policy.episodeActivity(episode);
  applyStage(value, episode, 'CORRECT', 1);
  assert.equal(episode.status, 'PARTIAL');
  assert.match(episode.close_reason, /independiente/);
  const afterFirst = JSON.stringify(value);
  expectCode(() => policy.applyResult(value, 'n1', transfer.activity.stage, 'otra', { status: 'CORRECT', error_type: 'none', _activity: transfer.activity, _attempt_id: 'second-transfer', _episode_id: episode.episode_id, _repair_stage: transfer.phase, _help_used: 0 }), 'INVALID_REPAIR_STAGE');
  assert.equal(JSON.stringify(value), afterFirst);
  assert.equal(episode.transfer_check.attempts.length, 1);
}

// Auditoría E. Persistencia conservadora y reparación de estados legacy imposibles.
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  policy.popContext(value, 'ABANDONED', 'abandono adversarial');
  assert.equal(episode.status, 'ABANDONED');
  assert.ok(episode.closed_at);
  assert.equal(episode.context_history.length, 1);
  assert.equal(value.events.filter(x => x.type === 'REPAIR_EPISODE_CLOSED' && x.episode_id === episode.episode_id).length, 1);
  const exported = JSON.parse(JSON.stringify({ goals: [value], active: value.id }));
  const reloaded = policy.normalizeImportedStore(exported);
  assert.equal(reloaded.goals[0].repairEpisodes[0].status, 'ABANDONED');
  assert.equal(reloaded.goals[0].repairEpisodes[0].context_history.length, 1);
}
{
  const raw = goal();
  raw.coverage[0].dimensions[0].evidence = [];
  raw.repairEpisodes = [{
    episode_id: 'legacy-incomplete', parent_node_id: 'n1', status: 'COMPLETED', stage: 'TRANSFER_CHECK',
    suspected_gaps: [], diagnostic_checks: [], repair_activities: {}, repair_evidence: [],
    parent_retest: { question: { prompt: 'Reintento legacy', kind: 'application' }, attempts: [] },
    transfer_check: { question: { prompt: 'Transferencia legacy', kind: 'transfer' }, attempts: [], novelty_status: 'CONFIRMED', novelty_basis: 'declarada' },
    limits: { max_activities: 999 },
  }];
  const before = JSON.stringify(raw);
  const imported = policy.normalizeGoal(raw);
  assert.equal(JSON.stringify(raw), before);
  const episode = imported.repairEpisodes[0];
  assert.equal(episode.status, 'PARTIAL');
  assert.match(episode.close_reason, /no contiene toda la evidencia/);
  assert.equal(episode.parent_retest.question.activity_id, null);
  assert.equal(episode.transfer_check.question.activity_id, null);
  assert.equal(episode.limits.max_activities, policy.REPAIR_LIMITS.max_activities);
  assert.equal(policy.verified(imported, 'n1'), false);
}
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  finishRepair(value, episode);
  assert.equal(episode.status, 'PARENT_RETEST');
  const raw = JSON.parse(JSON.stringify(value));
  raw.events = [];
  const imported = policy.normalizeGoal(raw).repairEpisodes[0];
  assert.equal(imported.status, 'PARTIAL');
  assert.match(imported.close_reason, /fallo original del problema padre/);
}
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  applyStage(value, episode, 'CORRECT');
  applyStage(value, episode, 'CORRECT');
  const exported = JSON.parse(JSON.stringify(value));
  exported.repairEpisodes[0].status = 'TRANSFER_CHECK';
  exported.repairEpisodes[0].stage = 'TRANSFER_CHECK';
  exported.repairEpisodes[0].parent_retest.attempts = [];
  const imported = policy.normalizeGoal(exported).repairEpisodes[0];
  assert.equal(imported.status, 'REPAIRING');
  assert.equal(imported.stage, 'INDEPENDENT');
}

// Auditoría F. Todos los rechazos ocurren antes de mutar la meta.
{
  const value = goal();
  const episode = openEpisode(value);
  const current = policy.episodeActivity(episode);
  const before = JSON.stringify(value);
  expectCode(() => policy.applyResult(value, 'n1', current.activity.stage, 'x', { status: 'CORRECT', error_type: 'none', _activity: current.activity, _attempt_id: 'wrong-stage', _episode_id: episode.episode_id, _repair_stage: 'GUIDED', _help_used: 0 }), 'INVALID_REPAIR_STAGE');
  assert.equal(JSON.stringify(value), before);
}
{
  const value = goal();
  const episode = openEpisode(value);
  const current = policy.episodeActivity(episode);
  const foreignContract = { ...current.activity, episode_id: 'otro-episodio' };
  const before = JSON.stringify(value);
  expectCode(() => policy.applyResult(value, 'n1', current.activity.stage, 'x', { status: 'CORRECT', error_type: 'none', _activity: foreignContract, _attempt_id: 'foreign-contract', _episode_id: episode.episode_id, _repair_stage: current.phase, _help_used: 0 }), 'INVALID_REPAIR_STAGE');
  assert.equal(JSON.stringify(value), before);
}
{
  const value = goal();
  attach(value);
  value.session.mode = 'CONTEXT';
  value.contextStack = [];
  policy.contextScreen(element('section'), value);
  assert.equal(value.session.mode, 'DIAGNOSTIC');
  assert.equal(value.events.at(-1).type, 'CONTEXT_RECOVERY');
  assert.equal(value.events.at(-1).status, 'ABANDONED');
}
for (const [name, brokenPlan, code] of [
  ['actividad hija', plan({ repair_activities: { CHECK: plan().repair_activities.CHECK, GUIDED: plan().repair_activities.CHECK, INDEPENDENT: plan().repair_activities.INDEPENDENT } }), 'DUPLICATE_REPAIR_ACTIVITY'],
  ['parent_retest', plan({ parent_retest: {} }), 'INVALID_PARENT_RETEST'],
  ['transfer_check', plan({ transfer_check: {}, transfer_novelty_status: 'CONFIRMED', transfer_novelty_basis: '' }), 'INVALID_TRANSFER_CHECK'],
  ['cuarto diagnóstico', plan({ suspected_gaps: Array.from({ length: 4 }, (_, i) => ({ gap_id: `limit-gap-${i}`, concept: `g${i}` })), diagnostic_checks: Array.from({ length: 4 }, (_, i) => ({ gap_id: `limit-gap-${i}`, question: { prompt: `Límite ${i}`, reference: 'r', kind: 'explanation' } })) }), 'DIAGNOSTIC_LIMIT'],
]) {
  const value = goal();
  const parent = parentFixture(value, `atomic-parent-${name}`);
  const before = JSON.stringify(value);
  expectCode(() => policy.createRepairEpisode(value, parent, brokenPlan), code);
  assert.equal(JSON.stringify(value), before, `${name} dejó una mutación parcial`);
  assert.equal(value.repairEpisodes.length, 0);
}
{
  const value = goal();
  attach(value);
  const activity = policy.activityContract(value.lessons.n1.independent, 'n1', 'independent_practice');
  const event = policy.record(value, 'n1', 'INDEPENDENT', 'correcta', { status: 'CORRECT', error_type: 'none' }, 0, activity, 'correct-parent');
  const parent = { activity_id: event.activity_id, attempt_id: event.attempt_id, node_id: 'n1', question: value.lessons.n1.independent, response: 'correcta', evaluation: { status: 'CORRECT' }, context_snapshot: {} };
  const before = JSON.stringify(value);
  expectCode(() => policy.createRepairEpisode(value, parent, plan()), 'INVALID_PARENT_EVIDENCE');
  assert.equal(JSON.stringify(value), before);
}

// Auditoría G. Los topes cierran o rechazan explícitamente sin completar dominio.
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  let stale;
  for (let i = 0; i < policy.REPAIR_LIMITS.max_activities; i++) {
    stale = policy.episodeActivity(episode);
    applyStage(value, episode, 'PARTIAL');
  }
  assert.equal(episode.status, 'PARTIAL');
  const before = JSON.stringify(value);
  expectCode(() => policy.applyResult(value, 'n1', stale.activity.stage, 'séptima', { status: 'PARTIAL', error_type: 'procedure', _activity: stale.activity, _attempt_id: 'seventh-repair', _episode_id: episode.episode_id, _repair_stage: stale.phase, _help_used: 0 }), 'INVALID_REPAIR_STAGE');
  assert.equal(JSON.stringify(value), before);
  assert.notEqual(episode.status, 'COMPLETED');
}
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  finishRepair(value, episode);
  let stale = policy.episodeActivity(episode);
  applyStage(value, episode, 'PARTIAL');
  stale = policy.episodeActivity(episode);
  applyStage(value, episode, 'PARTIAL');
  assert.equal(episode.status, 'PARTIAL');
  const before = JSON.stringify(value);
  expectCode(() => policy.applyResult(value, 'n1', stale.activity.stage, 'tercero', { status: 'CORRECT', error_type: 'none', _activity: stale.activity, _attempt_id: 'third-parent-retest', _episode_id: episode.episode_id, _repair_stage: stale.phase, _help_used: 0 }), 'INVALID_REPAIR_STAGE');
  assert.equal(JSON.stringify(value), before);
}
{
  const raw = goal();
  raw.repairEpisodes = [{
    episode_id: 'too-many-diagnostics', parent_node_id: 'n1', status: 'DIAGNOSING', stage: 'DIAGNOSTIC',
    suspected_gaps: Array.from({ length: 4 }, (_, i) => ({ gap_id: `g${i}` })),
    diagnostic_checks: Array.from({ length: 4 }, (_, i) => ({ gap_id: `g${i}`, question: { prompt: `D${i}`, kind: 'explanation' } })),
    repair_activities: {}, repair_evidence: [],
  }];
  const imported = policy.normalizeGoal(raw).repairEpisodes[0];
  assert.equal(imported.status, 'PARTIAL');
  assert.match(imported.close_reason, /máximo de diagnósticos/);
}

// Auditoría H. Doble envío en cada transición produce exactamente una evidencia.
{
  const value = goal();
  const episode = openEpisode(value);
  applyThenRepeat(value, episode, 'PARTIAL');
  applyThenRepeat(value, episode, 'CORRECT');
  assert.equal(episode.status, 'REPAIRING');
  applyThenRepeat(value, episode, 'CORRECT');
  applyThenRepeat(value, episode, 'CORRECT', 1);
  applyThenRepeat(value, episode, 'CORRECT');
  assert.equal(episode.status, 'PARENT_RETEST');
  applyThenRepeat(value, episode, 'CORRECT');
  assert.equal(episode.status, 'TRANSFER_CHECK');
  applyThenRepeat(value, episode, 'CORRECT');
  assert.equal(episode.status, 'COMPLETED');
}

// Auditoría I. La importación no puede elevar contratos, novedad ni cierres terminales.
{
  const duplicate = plan();
  duplicate.parent_retest = { ...duplicate.repair_activities.CHECK };
  expectCode(() => policy.prepareRepairPlan(duplicate, lesson().independent, 'duplicate-parent-retest'), 'DUPLICATE_PARENT_RETEST');
}
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  episode.repair_activities.CHECK.activity_contract = { evidence_scope: 'node', supports_independence: true };
  assert.equal(policy.episodeActivity(episode).activity.evidence_scope, 'repair_episode');
}
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  finishRepair(value, episode);
  applyStage(value, episode, 'CORRECT');
  episode.transfer_check.novelty_status = 'INDETERMINATE';
  episode.transfer_check.question.activity_contract = { evidence_scope: 'node', supports_transfer: true, is_novel_variant: true };
  const activity = policy.episodeActivity(episode).activity;
  assert.equal(activity.evidence_scope, 'node');
  assert.equal(activity.supports_transfer, false);
  assert.equal(activity.is_novel_variant, false);
}
{
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  finishRepair(value, episode);
  applyStage(value, episode, 'CORRECT');
  episode.transfer_check.question.prompt = episode.parent_question.prompt;
  episode.transfer_check.novelty_status = 'CONFIRMED';
  episode.transfer_check.novelty_basis = 'Declaración heredada sin diferencia textual.';
  const imported = policy.normalizeRepairEpisode(JSON.parse(JSON.stringify(episode)));
  assert.equal(imported.transfer_check.novelty_status, 'INDETERMINATE');
  assert.equal(imported.status, 'PARTIAL');
}
{
  const value = goal();
  const episode = openEpisode(value);
  policy.closeRepairEpisode(value, episode, 'COMPLETED', 'cierre forzado sin evidencia');
  assert.equal(episode.status, 'PARTIAL');
  assert.notEqual(episode.close_reason, 'cierre forzado sin evidencia');
}
{
  const value = goal();
  const episode = openEpisode(value);
  policy.closeRepairEpisode(value, episode, 'ABANDONED', 'abandono');
  value.contextStack.push({ context_id: 'stale-closed-context', episode_id: episode.episode_id, status: 'ACTIVE', history: [] });
  value.session.mode = 'CONTEXT';
  assert.doesNotThrow(() => policy.contextScreen(element('section'), value));
  assert.equal(value.contextStack.length, 0);
  assert.ok(value.events.some(x => x.type === 'REPAIR_CONTEXT_CLOSED' && x.context_id === 'stale-closed-context'));
}
{
  const value = goal();
  const episode = openEpisode(value);
  value.contextStack = [];
  value.session.mode = 'CONTEXT';
  policy.contextScreen(element('section'), value);
  assert.equal(episode.status, 'ABANDONED');
  assert.ok(value.events.some(x => x.type === 'REPAIR_EPISODE_CLOSED' && x.episode_id === episode.episode_id));
  assert.ok(value.events.some(x => x.type === 'CONTEXT_RECOVERY' && Array.isArray(x.episode_ids) && x.episode_ids.includes(episode.episode_id)));
}
{
  const value = goal();
  const episode = openEpisode(value);
  const current = policy.episodeActivity(episode);
  Object.freeze(episode.diagnostic_checks[0].evidence);
  assert.throws(() => policy.applyResult(value, 'n1', current.activity.stage, 'x', {
    status: 'PARTIAL', error_type: 'procedure', _activity: current.activity,
    _attempt_id: 'commit-failure', _episode_id: episode.episode_id,
    _repair_stage: current.phase, _help_used: 0,
  }), TypeError);
  const restored = policy.repairEpisode(value, episode.episode_id);
  assert.equal(value.events.some(x => x.attempt_id === 'commit-failure'), false);
  assert.equal(restored.diagnostic_index, 0);
  assert.equal(restored.diagnostic_checks[0].evidence.length, 0);
  const retry = policy.episodeActivity(restored);
  assert.equal(policy.applyResult(value, 'n1', retry.activity.stage, 'x', {
    status: 'PARTIAL', error_type: 'procedure', _activity: retry.activity,
    _attempt_id: 'commit-failure', _episode_id: restored.episode_id,
    _repair_stage: retry.phase, _help_used: 0,
  }), true);
  assert.equal(value.events.filter(x => x.attempt_id === 'commit-failure').length, 1);
}
{
  const value = attach(goal());
  const activity = policy.activityContract(value.lessons.n1.independent, 'n1', 'independent_practice');
  const result = { status: 'CORRECT', error_type: 'none', _activity: activity, _attempt_id: 'coverage-commit-failure' };
  Object.freeze(value.events);
  assert.throws(() => policy.applyResult(value, 'n1', 'INDEPENDENT', 'x', result), TypeError);
  assert.equal(value.events.length, 0);
  assert.equal(value.learner.n1, undefined);
  assert.equal(value.coverage[0].dimensions[0].evidence.length, 0);
  assert.equal(policy.applyResult(value, 'n1', 'INDEPENDENT', 'x', result), true);
  assert.equal(value.events.filter(x => x.attempt_id === 'coverage-commit-failure').length, 1);
  assert.equal(value.coverage[0].dimensions[0].evidence.length, 1);
}
{
  const fs = require('node:fs');
  const vm = require('node:vm');
  const raw = { goals: [{ id: 'reload-goal', nodes: [], learner: {}, session: { mode: 'DIAGNOSTIC' }, repairEpisodes: [{ episode_id: 'persisted-episode', status: 'PARTIAL' }] }], active: 'reload-goal' };
  const sandbox = {
    console, JSON, Date, Math, Set, Object, Array, String, Number, Boolean, Error,
    module: { exports: {} }, exports: {}, crypto: global.crypto,
    setTimeout, clearTimeout,
    localStorage: { getItem: () => JSON.stringify(raw), setItem: () => {} },
    document: { getElementById: () => element(), createElement: type => element(type) },
  };
  sandbox.globalThis = sandbox;
  const source = fs.readFileSync(require.resolve('../app.js'), 'utf8') + '\n;globalThis.__auditStore=store;';
  vm.runInNewContext(source, sandbox, { filename: 'app.js' });
  assert.equal(sandbox.__auditStore.goals.length, 1);
  assert.equal(sandbox.__auditStore.goals[0].repairEpisodes[0].episode_id, 'persisted-episode');
}

(async () => {
  // Una pista devuelta tras un fallo se conserva para el siguiente intento de la misma etapa.
  const value = goal();
  const episode = openEpisode(value);
  finishDiagnosis(value, episode);
  global.fetch = async () => ({ ok: true, json: async () => ({ status: 'PARTIAL', error_type: 'procedure', feedback: 'Reintenta', hint: 'Empieza por la operación inversa.' }) });
  const box = element('section');
  policy.contextScreen(box, value);
  const answer = box.children.find(item => item && item.type === 'textarea');
  const evaluate = box.children.find(item => item && item.type === 'button' && item.textContent === 'Evaluar esta etapa');
  answer.value = 'respuesta parcial';
  await evaluate.onclick();
  const feedback = box.children.find(item => item && item.type === 'div');
  const continueButton = feedback.children.find(item => item && item.type === 'button' && item.textContent === 'Continuar');
  assert.equal(continueButton.onclick(), true);
  assert.equal(episode.stage, 'CHECK');
  assert.equal(episode.current_help_used, 1);
  assert.equal(episode.hint_history.at(-1).source, 'evaluator_feedback');
  const next = applyStage(value, episode, 'CORRECT', episode.current_help_used).event;
  assert.equal(next.help_used, 1);
  assert.equal(next.is_independent, false);
  console.log('OK: repair episode policy and integrated flows');
})().catch(error => { console.error(error); process.exitCode = 1; });
