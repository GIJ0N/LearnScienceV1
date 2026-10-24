const assert = require('node:assert/strict');

function element(type = 'div') {
  return { type, textContent: '', value: '', disabled: false, children: [], append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); return item; }, replaceChildren(...items) { this.children = items; } };
}
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: id => id === 'app' ? roots.app : roots.status, createElement: type => element(type) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;

const policy = require('../app.js');

function question(prompt, reference, kind, observable_dimensions) { return { prompt, reference, kind, observable_dimensions }; }
function goal() {
  const parent = question('Resuelve 2x + 3 = 7', 'x = 2', 'application', ['direct_application']);
  return {
    id: 'goal-v2', profile_id: 'profile-test', goal: 'Álgebra',
    nodes: [
      { id: 'n0', name: 'Operaciones inversas', outcome: 'Aislar variables', level: 0, prerequisites: [], kind: 'procedure', probe: question('¿Qué deshace sumar?', 'Restar', 'explanation', ['conceptual']) },
      { id: 'n1', name: 'Ecuaciones', outcome: 'Resolver ecuaciones', level: 0, prerequisites: ['n0'], kind: 'procedure', probe: question('¿Qué es despejar?', 'Aislar', 'explanation', ['conceptual']) },
    ], learner: {}, coverage: [{ id: 'n1', name: 'Ecuaciones', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'direct_application', required: true, status: 'UNKNOWN', evidence: [] }] }],
    events: [], reviews: [
      { id: 'n0', last_exposure_at: 10, question: { prompt: 'Repaso n0' }, answered_at: null },
      { id: 'n1', last_exposure_at: 20, question: { prompt: 'Repaso n1' }, answered_at: null },
    ], lessons: { n1: { independent: { ...parent, activity_id: 'parent-activity' } } }, repairEpisodes: [], contextStack: [],
    session: { mode: 'INDEPENDENT', node: 'n1', stack: [], stage: 'teach', tries: 0, hints: 0 },
  };
}
function diagnosis() {
  return { plan_version: policy.REPAIR_TEACHING_VERSION, suspected_gaps: [{ gap_id: 'gap-inverse', node_id: 'n0', concept: 'Operaciones inversas', reason: 'No aisló la variable', motivating_evidence: 'Sumó en vez de restar', confidence: 0.9, status: 'SUSPECTED' }], diagnostic_checks: [{ gap_id: 'gap-inverse', question: question('¿Qué operación deshace sumar cinco?', 'Restar cinco', 'explanation', ['conceptual']) }] };
}
function teaching(overrides = {}) {
  return {
    plan_version: policy.REPAIR_TEACHING_VERSION, gap_id: 'gap-inverse', explanation: 'Aplicar la operación inversa a ambos lados conserva la igualdad.',
    worked_example: { prompt: 'Resuelve y + 4 = 10', steps: ['Resta cuatro en ambos lados.', 'Simplifica y conserva la igualdad.'], conclusion: 'y = 6' },
    expansion: 'Una balanza permanece equilibrada si haces la misma operación en ambos lados.', guided_hints: ['Identifica qué operación acompaña a la variable.', 'Aplica su inversa a ambos lados.'],
    repair_activities: {
      CHECK: question('¿Qué operación usarías primero en z + 8 = 11?', 'Restar ocho', 'explanation', ['conceptual']),
      GUIDED: question('Con apoyo, resuelve a + 6 = 15', 'a = 9', 'application', ['direct_application']),
      INDEPENDENT: question('Sin ayuda, resuelve 3b - 1 = 11', 'b = 4', 'application', ['direct_application']),
    },
    independent_retries: [question('Sin ayuda, resuelve 4c + 2 = 18', 'c = 4', 'calculation', ['direct_application'])],
    parent_retest: question('Resuelve 2m + 5 = 13', 'm = 4', 'application', ['direct_application']),
    transfer_check: question('Una tarifa cobra 5 de base y 2 por hora; ¿cuántas horas producen 13?', '4 horas', 'transfer', ['transfer']),
    transfer_novelty_status: 'CONFIRMED', transfer_novelty_basis: 'Cambia una ecuación simbólica por una situación verbal que exige modelarla.', ...overrides,
  };
}
let sequence = 0;
function openV2(value) {
  policy.setStoreForTests({ goals: [value], active: value.id }); policy.setProfileForTests({ profile_id: 'profile-test' });
  const activity = policy.activityContract(value.lessons.n1.independent, 'n1', 'independent_practice');
  const event = policy.record(value, 'n1', 'INDEPENDENT', 'Sumé tres', { status: 'PARTIAL', error_type: 'prerequisite', feedback: 'Revisa la operación inversa' }, 0, activity, 'parent-v2');
  const episode = policy.createRepairEpisode(value, { activity_id: event.activity_id, attempt_id: event.attempt_id, node_id: 'n1', question: value.lessons.n1.independent, response: 'Sumé tres', evaluation: { status: 'PARTIAL', error_type: 'prerequisite', feedback: 'Revisa la operación inversa' }, help_used: 0, context_snapshot: { mode: 'INDEPENDENT', node: 'n1', stack: [], stage: 'teach', tries: 0 } }, diagnosis());
  policy.pushContext(value, { context_id: 'ctx-v2', episode_id: episode.episode_id, status: 'ACTIVE', history: [] });
  return episode;
}
function applyCurrent(value, episode, status = 'CORRECT', help = 0) {
  const current = policy.episodeActivity(episode); assert.ok(current);
  return policy.applyResult(value, 'n1', current.activity.stage, 'respuesta', { status, error_type: status === 'CORRECT' ? 'none' : 'procedure', feedback: 'feedback', hint: '', _activity: current.activity, _attempt_id: `v2-${++sequence}`, _episode_id: episode.episode_id, _repair_stage: current.phase, _help_used: help });
}

// Diagnóstico primero; solo una laguna confirmada habilita enseñanza posterior.
{
  const value = goal(), episode = openV2(value); applyCurrent(value, episode, 'PARTIAL');
  assert.equal(episode.selected_gap.status, 'CONFIRMED'); assert.equal(episode.stage, 'TEACH'); assert.equal(episode.teaching_package, null);
  policy.attachRepairTeachingPackage(episode, teaching());
  assert.equal(episode.plan_gap_id, 'gap-inverse'); assert.equal(episode.stage, 'TEACH');
}
{
  const value = goal(), episode = openV2(value); applyCurrent(value, episode, 'UNKNOWN');
  assert.equal(episode.status, 'PARTIAL'); assert.match(episode.close_reason, /incierto/); assert.equal(episode.teaching_package, null);
}

// Mostrar enseñanza registra exposición una sola vez y nunca evidencia positiva.
{
  let tick = 1000; policy.setClockForTests(() => ++tick);
  const value = goal(), episode = openV2(value); applyCurrent(value, episode, 'PARTIAL'); policy.attachRepairTeachingPackage(episode, teaching());
  const parentExposure = value.reviews.find(x => x.id === 'n1').last_exposure_at;
  policy.openRepairTeaching(value, episode); policy.openRepairTeaching(value, episode);
  const exposures = value.events.filter(x => x.type === 'CONTENT_EXPOSURE');
  assert.equal(exposures.length, 2); assert.deepEqual(exposures.map(x => x.exposure_kind), ['explanation', 'worked_example']);
  assert.ok(value.reviews.find(x => x.id === 'n0').last_exposure_at > 10); assert.equal(value.reviews.find(x => x.id === 'n1').last_exposure_at, parentExposure);
  assert.equal(value.coverage[0].dimensions[0].evidence.length, 1, 'leer no añade evidencia hija ni positiva');
  const reloaded = policy.normalizeGoal(JSON.parse(JSON.stringify(value))), loadedEpisode = reloaded.repairEpisodes[0];
  policy.setStoreForTests({ goals: [reloaded], active: reloaded.id }); policy.contextScreen(element('section'), reloaded);
  assert.equal(loadedEpisode.stage, 'TEACH'); assert.equal(loadedEpisode.teaching_progress.content_opened, true);
  assert.equal(reloaded.events.filter(x => x.type === 'CONTENT_EXPOSURE').length, 2, 'recargar o renderizar no duplica exposición');
  policy.setClockForTests();
}

// CHECK permite omitir lectura; GUIDED conserva ayuda; INDEPENDENT asistido rota de actividad.
{
  const value = goal(), episode = openV2(value); applyCurrent(value, episode, 'PARTIAL'); policy.attachRepairTeachingPackage(episode, teaching());
  policy.beginRepairCheck(value, episode, true); applyCurrent(value, episode, 'PARTIAL');
  assert.equal(episode.stage, 'TEACH'); assert.equal(episode.teaching_progress.content_opened, false); assert.equal(episode.teaching_progress.skipped_explanation, false);
}
{
  const value = goal(), episode = openV2(value); applyCurrent(value, episode, 'PARTIAL'); policy.attachRepairTeachingPackage(episode, teaching());
  policy.beginRepairCheck(value, episode, true); assert.equal(episode.teaching_progress.skipped_explanation, true); assert.equal(value.events.filter(x => x.type === 'CONTENT_EXPOSURE').length, 0);
  applyCurrent(value, episode); assert.equal(episode.stage, 'GUIDED');
  const box = element('section'); policy.contextScreen(box, value); const hint = box.children.find(x => x?.type === 'button' && x.textContent === 'Dame una pista'); assert.ok(hint); hint.onclick();
  assert.equal(episode.current_help_used, 1); assert.equal(value.events.filter(x => x.exposure_kind === 'requested_hint').length, 1);
  applyCurrent(value, episode, 'CORRECT', 1); assert.equal(episode.stage, 'INDEPENDENT');
  const first = policy.episodeActivity(episode).activity.activity_id; applyCurrent(value, episode, 'CORRECT', 1);
  const second = policy.episodeActivity(episode).activity.activity_id; assert.notEqual(second, first); assert.equal(episode.status, 'REPAIRING');
  applyCurrent(value, episode, 'CORRECT', 0); assert.equal(episode.status, 'PARENT_RETEST'); assert.equal(episode.parent_response, 'Sumé tres');
}

// Pausa, recarga y checkpoint evaluado sobreviven; aplicar dos veces no duplica.
{
  const value = goal(), episode = openV2(value); applyCurrent(value, episode, 'PARTIAL'); policy.attachRepairTeachingPackage(episode, teaching()); policy.beginRepairCheck(value, episode, true);
  assert.equal(policy.pauseRepairEpisode(value, episode), true); assert.equal(value.contextStack[0].status, 'PAUSED'); assert.equal(policy.resumeRepairEpisode(value, episode), true);
  const current = policy.episodeActivity(episode), checkpoint = policy.beginRepairCheckpoint(episode, current, 'Restaría ocho');
  policy.storeRepairCheckpointEvaluation(episode, checkpoint.attempt_id, { status: 'CORRECT', error_type: 'none', feedback: 'Correcto', hint: '' });
  const reloaded = policy.normalizeGoal(JSON.parse(JSON.stringify(value))); policy.setStoreForTests({ goals: [reloaded], active: reloaded.id });
  const loadedEpisode = reloaded.repairEpisodes[0]; assert.equal(loadedEpisode.attempt_checkpoint.response_text, 'Restaría ocho'); assert.equal(loadedEpisode.attempt_checkpoint.status, 'EVALUATED');
  assert.equal(policy.applyRepairCheckpoint(reloaded, loadedEpisode), true); assert.equal(policy.applyRepairCheckpoint(reloaded, loadedEpisode), true);
  assert.equal(reloaded.events.filter(x => x.type === 'EVIDENCE' && x.attempt_id === checkpoint.attempt_id).length, 1); assert.equal(loadedEpisode.stage, 'GUIDED');
}

// Contratos incompatibles, copias y versiones desconocidas se manejan de forma conservadora.
{
  const value = goal(), episode = openV2(value); applyCurrent(value, episode, 'PARTIAL');
  assert.throws(() => policy.attachRepairTeachingPackage(episode, teaching({ gap_id: 'otro-gap' })), error => error.code === 'REPAIR_GAP_MISMATCH');
  const copied = teaching(); copied.worked_example.prompt = value.lessons.n1.independent.prompt;
  assert.throws(() => policy.attachRepairTeachingPackage(episode, copied), error => ['DUPLICATE_REPAIR_ACTIVITY', 'REPAIR_EXAMPLE_LEAK'].includes(error.code));
  const missing = teaching(); missing.guided_hints = [];
  assert.throws(() => policy.attachRepairTeachingPackage(episode, missing), error => error.code === 'INCOMPLETE_REPAIR_TEACHING');
  const unknown = policy.normalizeRepairEpisode({ episode_id: 'future', plan_version: 'repair_teaching_v99', status: 'REPAIRING', stage: 'TEACH' });
  assert.equal(unknown.plan_version, 'repair_teaching_v99'); assert.equal(unknown.unsupported_plan_version, true); assert.equal(policy.episodeActivity(unknown), null);
  const legacy = policy.normalizeRepairEpisode({ episode_id: 'legacy', status: 'PARTIAL' });
  assert.equal(legacy.plan_version, policy.REPAIR_POLICY_VERSION); assert.equal(legacy.teaching_package, null); assert.equal(legacy.teaching_progress.explanation_shown_at, null);
}

console.log('repair_teaching_v2.test.js PASS');
