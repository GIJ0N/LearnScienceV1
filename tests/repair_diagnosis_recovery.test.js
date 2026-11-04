const assert = require('node:assert/strict');

function element(type = 'div') {
  return { type, textContent: '', value: '', disabled: false, children: [], append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); return item; }, replaceChildren(...items) { this.children = items; } };
}
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: id => id === 'app' ? roots.app : roots.status, createElement: type => element(type) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;

const policy = require('../app.js');

const question = (prompt = 'Resuelve 2x + 3 = 7') => ({ prompt, reference: 'x = 2', kind: 'application', observable_dimensions: ['direct_application'], activity_id: 'parent-activity' });
function value(id = 'goal-recovery') {
  const parentQuestion = question();
  const parentEvent = { type: 'EVIDENCE', evidence_id: 'evidence-parent', attempt_id: 'attempt-parent', activity_id: 'parent-activity', node_id: 'n1', phase: 'INDEPENDENT', result: 'PARTIAL', status: 'PARTIAL', error_type: 'prerequisite', help_used: 0, answer: 'Sumé tres', observed_dimensions: [], timestamp: 100 };
  return { id, profile_id: 'profile-test', goal: 'Álgebra', nodes: [{ id: 'n0', name: 'Operaciones inversas', outcome: 'Aislar variables', prerequisites: [], kind: 'procedure' }, { id: 'n1', name: 'Ecuaciones', outcome: 'Resolver ecuaciones', prerequisites: ['n0'], kind: 'procedure' }], coverage: [], learner: {}, reviews: [], lessons: { n1: { independent: parentQuestion } }, events: [parentEvent], repairEpisodes: [], contextStack: [], session: { mode: 'INDEPENDENT', node: 'n1', stack: [], stage: 'teach', tries: 0 } };
}
function plan(observable = ['conceptual']) {
  return { plan_version: policy.REPAIR_TEACHING_VERSION, suspected_gaps: [{ gap_id: 'gap-inverse', node_id: 'n0', concept: 'Operaciones inversas', reason: 'Confundió la operación inversa', motivating_evidence: 'Sumó en vez de restar', confidence: 0.9, status: 'SUSPECTED' }], diagnostic_checks: [{ gap_id: 'gap-inverse', question: { prompt: '¿Qué operación deshace sumar cinco?', reference: 'Restar cinco', kind: 'explanation', observable_dimensions: observable } }] };
}
function prepare(goal) {
  policy.setStoreForTests({ goals: [goal], active: goal.id });
  policy.setProfileForTests({ profile_id: 'profile-test' });
  return policy.createPendingRepairDiagnosis(goal, 'n1', 'INDEPENDENT', 'Sumé tres', { status: 'PARTIAL', error_type: 'prerequisite', feedback: 'Revisa la operación inversa' }, goal.events[0]);
}
const persisted = async () => true;

(async () => {
  // Error de red: conserva padre y operación, sin episodio ni evidencia nueva.
  {
    const goal = value(); prepare(goal);
    await assert.rejects(policy.retryRepairDiagnosis(goal, { persist: persisted, diagnose: async () => { throw new TypeError('red no disponible'); } }), /red no disponible/);
    assert.equal(goal.pending_repair_diagnosis.status, 'ERROR');
    assert.equal(goal.repairEpisodes.length, 0); assert.equal(goal.events.filter(x => x.type === 'EVIDENCE').length, 1);
  }

  // Contrato inválido: observable_dimensions vacío sigue rechazado.
  {
    const goal = value(); prepare(goal);
    await assert.rejects(policy.retryRepairDiagnosis(goal, { persist: persisted, diagnose: async () => plan([]) }), error => error.code === 'INVALID_REPAIR_PLAN');
    assert.equal(goal.repairEpisodes.length, 0); assert.equal(goal.pending_repair_diagnosis.status, 'ERROR');
  }

  // El mismo diagnóstico puede reintentarse y crea exactamente un episodio.
  {
    const goal = value(); prepare(goal); let calls = 0;
    await assert.rejects(policy.retryRepairDiagnosis(goal, { persist: persisted, diagnose: async () => { calls++; throw Error('fallo transitorio'); } }));
    const outcome = await policy.retryRepairDiagnosis(goal, { persist: persisted, diagnose: async () => { calls++; return plan(); } });
    assert.ok(outcome.episode); assert.equal(calls, 2); assert.equal(goal.pending_repair_diagnosis, null);
    assert.equal(goal.repairEpisodes.length, 1); assert.equal(goal.events.filter(x => x.type === 'REPAIR_EPISODE_OPENED').length, 1); assert.equal(goal.events.filter(x => x.type === 'EVIDENCE').length, 1);
  }

  // Doble clic: solo una solicitud puede estar en vuelo.
  {
    const goal = value(); prepare(goal); let release, calls = 0;
    const wait = new Promise(resolve => { release = resolve; });
    const first = policy.retryRepairDiagnosis(goal, { persist: persisted, diagnose: async () => { calls++; await wait; return plan(); } });
    await Promise.resolve();
    const second = await policy.retryRepairDiagnosis(goal, { persist: persisted, diagnose: async () => { calls++; return plan(); } });
    assert.deepEqual(second, { duplicate: true }); release(); await first; assert.equal(calls, 1); assert.equal(goal.repairEpisodes.length, 1);
  }

  // Una respuesta tardía se ignora si cambió la meta activa.
  {
    const goal = value(); prepare(goal); let release;
    const wait = new Promise(resolve => { release = resolve; });
    const running = policy.retryRepairDiagnosis(goal, { persist: persisted, diagnose: async () => { await wait; return plan(); } });
    await Promise.resolve(); policy.setStoreForTests({ goals: [goal, value('other-goal')], active: 'other-goal' }); release();
    assert.deepEqual(await running, { stale: true }); assert.equal(goal.repairEpisodes.length, 0); assert.ok(goal.pending_repair_diagnosis);
  }

  // Una recarga convierte REQUESTING en un error recuperable y no inventa episodios.
  {
    const goal = value(); prepare(goal); goal.pending_repair_diagnosis.status = 'REQUESTING';
    const loaded = policy.normalizeGoal(JSON.parse(JSON.stringify(goal))); policy.setStoreForTests({ goals: [loaded], active: loaded.id }); policy.setProfileForTests({ profile_id: 'profile-test' });
    assert.equal(loaded.pending_repair_diagnosis.status, 'ERROR'); assert.match(loaded.pending_repair_diagnosis.error, /interrumpió/); assert.equal(loaded.repairEpisodes.length, 0);
    await policy.retryRepairDiagnosis(loaded, { persist: persisted, diagnose: async () => plan() }); assert.equal(loaded.repairEpisodes.length, 1);
  }

  // Un fallo antes de solicitar y un conflicto al guardar el episodio no afirman persistencia.
  {
    const goal = value(); prepare(goal); let called = false;
    await assert.rejects(policy.retryRepairDiagnosis(goal, { persist: async () => false, diagnose: async () => { called = true; return plan(); } }), error => error.code === 'REPAIR_DIAGNOSIS_NOT_SAVED');
    assert.equal(called, false); assert.equal(goal.pending_repair_diagnosis.persistence_confirmed, false); assert.equal(goal.repairEpisodes.length, 0);
  }
  {
    const goal = value(); prepare(goal); let writes = 0;
    await assert.rejects(policy.retryRepairDiagnosis(goal, { persist: async () => ++writes === 1, diagnose: async () => plan() }), error => error.code === 'REPAIR_DIAGNOSIS_NOT_SAVED');
    assert.equal(goal.repairEpisodes.length, 0); assert.equal(goal.events.filter(x => x.type === 'REPAIR_EPISODE_OPENED').length, 0); assert.equal(goal.pending_repair_diagnosis.status, 'ERROR');
  }

  // Posponer conserva el padre y no crea evidencia.
  {
    const goal = value(); prepare(goal); assert.equal(await policy.postponeRepairDiagnosis(goal, persisted), true);
    assert.equal(goal.pending_repair_diagnosis.status, 'POSTPONED'); assert.equal(goal.events.length, 1); assert.equal(goal.repairEpisodes.length, 0);
  }

  console.log('repair_diagnosis_recovery.test.js PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
