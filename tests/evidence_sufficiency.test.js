const assert = require('node:assert/strict');
function element(type = 'div') {
  return { type, textContent: '', value: '', children: [],
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    replaceChildren(...items) { this.children = items; } };
}
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null };
global.confirm = () => true;
const policy = require('../app.js');
const DAY = 86400000;
let sequence = 0;
function observation(dimension, prompt, extra = {}) {
  const id = ++sequence;
  const kind = dimension === 'transfer' ? 'transfer' : policy.CONFIRMATION_KINDS[dimension];
  const activity = policy.activityContract({ prompt, reference: 'Criterio', kind,
    observable_dimensions: [dimension], supports_transfer: dimension === 'transfer',
    is_novel_variant: dimension === 'transfer' }, 'n1', dimension === 'transfer' ? 'transfer_check' : 'evidence_confirmation');
  return { ...policy.activityEvidence(activity, { status: 'CORRECT' }, 0,
    { attempt_id: `attempt-${id}`, timestamp: id * DAY }), ...extra };
}
function dimension(id, evidence) { return { id, required: true, evidence }; }
function goal(id = 'units') {
  return { id: 'goal-1', goal: 'Resolver', learner: {}, events: [], reviews: [], repairEpisodes: [], contextStack: [],
    nodes: ['n1', 'n2'].map((node, i) => ({ id: node, name: node, outcome: 'Resolver', level: i,
      prerequisites: i ? ['n1'] : [], probe: { prompt: `Diagnóstico ${node}`, reference: 'Criterio', kind: 'explanation' } })),
    coverage: [{ id: 'n1', dimensions: [dimension(id, [])] }],
    lessons: { n1: { target_dimension: 'units', explanation: 'Explicación', example: 'Ejemplo', common_error: 'Error',
      check: { prompt: 'Explica la idea', reference: 'Criterio', kind: 'explanation' },
      guided: { prompt: 'Convierte con apoyo dos metros', reference: '200 cm', kind: 'units', observable_dimensions: ['units'] },
      independent: { prompt: 'Sin ayuda convierte cinco kilómetros', reference: '5000 m', kind: 'units', observable_dimensions: ['units'] },
      integration: { prompt: 'Interpreta el resultado', reference: 'Criterio', kind: 'context_case' } } },
    session: { mode: 'COMPREHENSION', node: 'n1', stack: [], tries: 0, hints: 0 } };
}
function attach(value) { policy.setStoreForTests({ goals: [value], active: value.id }); return value; }
function find(root, label) {
  if (root?.textContent === label) return root;
  for (const child of root?.children || []) { const result = find(child, label); if (result) return result; }
  return null;
}
const settle = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  // Every dimension needs at least two independent, observed, distinct questions.
  for (const id of [...Object.keys(policy.CONFIRMATION_KINDS), 'transfer']) {
    const a = observation(id, 'Primera situación'), b = observation(id, 'Segunda situación', { phase: id === 'memory' ? 'REVIEW' : 'CONFIRMATION' });
    assert.equal(policy.sufficient(dimension(id, [a])), false, id);
    assert.equal(policy.sufficient(dimension(id, [a, b])), true, id);
    assert.equal(policy.sufficient(dimension(id, [a, { ...b, is_independent: false }])), false);
    assert.equal(policy.sufficient(dimension(id, [a, { ...b, help_used: 1 }])), false);
    assert.equal(policy.sufficient(dimension(id, [a, { ...b, corrected: true }])), false);
    assert.equal(policy.sufficient(dimension(id, [a, { ...b, evidence_scope: 'repair_episode' }])), false);
    assert.equal(policy.sufficient(dimension(id, [a, { ...b, observed_dimensions: [] }])), false);
    assert.equal(policy.sufficient(dimension(id, [a, { ...b, attempt_id: a.attempt_id }])), false);
    assert.equal(policy.sufficient(dimension(id, [a, { ...b, activity_id: a.activity_id }])), false);
    assert.equal(policy.sufficient(dimension(id, [a, { ...b, question: { prompt: '  PRIMERA SITUACIÓN!!! ' } }])), false);
  }
  const a = observation('units', 'Primera conversión'), b = observation('units', 'Segunda conversión');
  const failure = { ...observation('units', 'Tercera conversión'), result: 'MISCONCEPTION', status: 'MISCONCEPTION', contradicts_sufficiency: true };
  assert.equal(policy.sufficient(dimension('units', [a, b, failure])), false);
  assert.equal(policy.sufficient(dimension('units', [a, b, failure, observation('units', 'Cuarta conversión')])), false);
  assert.equal(policy.sufficient(dimension('units', [a, b, failure, observation('units', 'Cuarta conversión'), observation('units', 'Quinta conversión')])), true);
  const corrected = { ...failure, correction_of: a.evidence_id, corrected: true };
  assert.equal(policy.sufficient(dimension('units', [a, b, corrected])), false);
  const falseFailure = { ...failure, evidence_id: 'false-failure' };
  const correction = { ...observation('units', 'Revisión del juicio'), correction_of: falseFailure.evidence_id, corrected: true };
  assert.equal(policy.sufficient(dimension('units', [a, falseFailure, correction, b])), true, 'superseded failure does not erase valid independent evidence');
  const m1 = observation('memory', 'Recuerda el principio', { timestamp: 1000, phase: 'REVIEW' });
  assert.equal(policy.sufficient(dimension('memory', [m1, observation('memory', 'Recuerda otro caso', { timestamp: 2000, phase: 'REVIEW' })])), false);
  assert.equal(policy.sufficient(dimension('memory', [m1, observation('memory', 'Recuerda otro caso', { timestamp: null, phase: 'REVIEW' })])), false);
  assert.equal(policy.sufficient(dimension('memory', [m1, observation('memory', 'Recuerda otro caso', { timestamp: 1000 + DAY, phase: 'REVIEW' })])), true);

  // Legacy evidence is preserved without upgrading missing metadata.
  const legacy = goal(); legacy.coverage[0].dimensions[0].evidence = [{ result: 'CORRECT', independent: true }];
  const serialized = JSON.stringify(legacy), loaded = policy.normalizeGoal(legacy);
  assert.equal(JSON.stringify(legacy), serialized);
  assert.deepEqual(loaded.coverage[0].dimensions[0].evidence, legacy.coverage[0].dimensions[0].evidence);
  assert.equal(policy.verified(loaded, 'n1'), false);

  // Existing lesson -> one independent success -> integration -> fresh confirmation, not another full lesson.
  const value = attach(goal()); let generationCalls = 0, evaluationCalls = 0;
  global.fetch = async (route, options) => {
    const body = JSON.parse(options.body);
    if (route === '/api/confirmation') {
      generationCalls++;
      assert.equal(body.target_dimension, 'units');
      assert.ok(body.previous.includes(value.lessons.n1.independent.prompt));
      return { ok: true, json: async () => ({ question: { prompt: 'Detecta y corrige una conversión inválida', reference: 'Criterio', kind: 'units', observable_dimensions: ['units'] } }) };
    }
    assert.equal(route, '/api/evaluate'); evaluationCalls++;
    return { ok: true, json: async () => ({ status: 'CORRECT', feedback: 'Correcto', hint: '' }) };
  };
  for (const [phase, key, role] of [['COMPREHENSION','check','comprehension_check'], ['GUIDED','guided','guided_practice'], ['INDEPENDENT','independent','independent_practice'], ['INTEGRATE','integration','integration']]) {
    value.session.mode = phase;
    policy.applyResult(value, 'n1', phase, 'Respuesta', { status: 'CORRECT', _activity: policy.activityContract(value.lessons.n1[key], 'n1', role), _attempt_id: `flow-${phase}` });
  }
  await settle();
  assert.equal(value.session.mode, 'CONFIRMATION');
  assert.equal(generationCalls, 1);
  assert.equal(policy.verified(value, 'n1'), false);
  assert.equal(value.session.confirmation.question.kind, 'units');
  const question = value.session.confirmation.question;
  const box = element(); const ui = policy.renderQuestion(box, question, 'n1', 'CONFIRMATION', 'evidence_confirmation');
  ui.answer.value = 'Segunda respuesta independiente'; await ui.submit.onclick();
  const continueButton = find(ui.feedback, 'Continuar');
  assert.equal(continueButton.onclick(), true); await settle();
  assert.equal(policy.verified(value, 'n1'), true);
  assert.equal(generationCalls, 1); assert.equal(evaluationCalls, 1);
  assert.equal(continueButton.onclick(), false);
  assert.equal(value.events.filter(e => e.phase === 'CONFIRMATION' && e.type === 'EVIDENCE').length, 1);
  assert.equal(policy.nextNode(value).id, 'n2');
  policy.finishPractice(value, 'n1');
  assert.equal(value.reviews.length, 1);

  // Same question with new IDs cannot qualify; generated transfer permission is stripped.
  const repeated = goal();
  assert.throws(() => policy.acceptConfirmation(repeated, 'n1', { ...repeated.lessons.n1.independent }, 'units'), e => e.code === 'REPEATED_CONFIRMATION');
  assert.throws(() => policy.acceptConfirmation(repeated, 'n1', { prompt: 'Nueva', reference: 'r', kind: 'units', observable_dimensions: ['units','transfer'] }, 'units'), e => e.code === 'INVALID_CONFIRMATION');
  const safe = policy.acceptConfirmation(repeated, 'n1', { prompt: 'Otra conversión', reference: 'r', kind: 'units', observable_dimensions: ['units'], supports_transfer: true, is_novel_variant: true }, 'units');
  assert.equal(policy.activityContract(safe, 'n1', 'evidence_confirmation').supports_transfer, false);

  // Bounded visits, explicit provisional continuation, retained pending dimensions.
  const limited = attach(goal()); limited.session.mode = 'CONFIRMATION';
  limited.session.confirmation = { node_id: 'n1', attempts: 2, target_dimension: 'units', question: safe };
  const staleActivity = policy.activityContract(safe, 'n1', 'evidence_confirmation');
  policy.applyResult(limited, 'n1', 'CONFIRMATION', 'No sé', { status: 'UNKNOWN', _activity: staleActivity, _attempt_id: 'bounded-unknown' });
  await settle();
  assert.equal(limited.session.confirmation.attempts, 3);
  assert.ok(find(roots.app, 'Terminamos las tres comprobaciones de esta visita. Puedes continuar y volver desde la cobertura, sin marcar dominio.'));
  const eventCount = limited.events.length;
  assert.throws(() => policy.applyResult(limited, 'n1', 'CONFIRMATION', 'Reuso', { status: 'CORRECT', _activity: staleActivity, _attempt_id: 'stale-attempt' }), e => e.code === 'STALE_CONFIRMATION');
  assert.equal(limited.events.length, eventCount);
  find(roots.app, 'Continuar la ruta con pendientes visibles').onclick();
  assert.equal(policy.verified(limited, 'n1'), false);
  assert.equal(policy.readyToAdvance(limited, 'n1'), true);
  assert.equal(policy.nextNode(limited).id, 'n2');
  assert.deepEqual(limited.events.find(e => e.type === 'CURRICULUM_CONTINUED').pending_dimensions, ['units']);
  assert.equal(policy.masteredCount(limited), 0);
  assert.equal(policy.readyToAdvance(policy.normalizeGoal(limited), 'n1'), true);
  const pending = attach(goal('transfer')); pending.session.mode = 'CONFIRMATION';
  assert.equal(policy.confirmationTarget(pending, 'n1'), null);
  await policy.session();
  assert.ok(find(roots.app, 'Continuar la ruta con pendientes visibles'));
  const memory = goal('memory'); memory.coverage[0].dimensions[0].evidence = [m1];
  assert.equal(policy.confirmationTarget(memory, 'n1'), null, 'do not drill same-day memory indefinitely');
  pending.contextStack.push({ context_id: 'active-repair' });
  const before = JSON.stringify(pending);
  assert.equal(policy.startConfirmation(pending, 'n1'), false);
  assert.equal(JSON.stringify(pending), before);

  // Rejected generation has an explicit retry and never writes evidence.
  const rejected = attach(goal()); rejected.session.mode = 'CONFIRMATION';
  const originalError = console.error; console.error = () => {};
  global.fetch = async () => ({ ok: false, json: async () => ({ error: 'Pregunta repetida' }) });
  try { await policy.session(); } finally { console.error = originalError; }
  assert.equal(rejected.events.length, 0);
  assert.ok(find(roots.app, 'Reintentar comprobación'));
  assert.ok(find(roots.app, 'Continuar la ruta con pendientes visibles'));
  // Explicit "relearn" must fetch a fresh lesson informed by durable attempts,
  // rather than displaying the cached initial explanation again.
  const relearn = attach(goal());
  relearn.session.node = 'n1';
  relearn.session.mode = 'CONFIRMATION';
  relearn.session.confirmation = { node_id: 'n1', attempts: 3, question: null, target_dimension: 'units' };
  let adaptedCalls = 0;
  global.fetch = async (route) => {
    assert.equal(route, '/api/lesson');
    adaptedCalls++;
    return { ok: true, json: async () => ({
      ...goal().lessons.n1, target_dimension: 'units',
      explanation: 'Explicación ajustada al historial',
      adaptation_mode: 'repair',
      adaptation_reason: 'La última respuesta requiere refuerzo.'
    }) };
  };
  await policy.session();
  const relearnButton = find(roots.app, 'Volver a aprender esta habilidad');
  assert.ok(relearnButton);
  relearnButton.onclick();
  assert.equal(relearn.session.mode, 'TEACH');
  assert.equal(relearn.lessons.n1, undefined, 'the old lesson must be invalidated');
  await settle(); await settle();
  assert.equal(adaptedCalls, 1);
  assert.equal(relearn.lessons.n1.explanation, 'Explicación ajustada al historial');
  assert.equal(relearn.lessons.n1.adaptation_mode, 'repair');
  console.log('OK: sufficiency v2, independent confirmation, bounded continuation and legacy compatibility');
})().catch(error => { console.error(error); process.exitCode = 1; });
