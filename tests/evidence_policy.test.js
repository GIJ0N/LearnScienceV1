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
  getElementById: (id) => (id === 'app' ? roots.app : roots.status),
  createElement: (type) => element(type),
};
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;

const policy = require('../app.js');

function assessment(status = 'CORRECT', overrides = {}) {
  return { status, error_type: 'none', feedback: 'feedback', hint: '', ...overrides };
}

function contract(nodeId = 'n1', overrides = {}) {
  return policy.normalizeActivityContract({
    activity_id: `activity-${nodeId}`, node_id: nodeId, stage: 'INDEPENDENT', kind: 'application',
    observable_dimensions: ['direct_application'], supports_independence: true,
    supports_transfer: false, role: 'independent_practice', ...overrides,
  });
}

function node(id = 'n1') {
  return { id, name: id, outcome: 'Resolver', level: 0, prerequisites: [], kind: 'concept', probe: { prompt: 'Explica', kind: 'explanation' } };
}

function lesson() {
  return {
    explanation: 'Explicación', example: 'Ejemplo', common_error: 'Error',
    check: { prompt: 'Comprende', kind: 'explanation' },
    guided: { prompt: 'Guía', kind: 'application' },
    independent: { prompt: 'Aplica', kind: 'application' },
    integration: { prompt: 'Integra', kind: 'context_case' },
  };
}

function goalWithDimensions(dimensions = ['conceptual'], id = 'n1') {
  return {
    id: `goal-${id}`, goal: 'Meta', nodes: [node(id)], learner: {},
    coverage: [{ id, name: id, status: 'UNKNOWN', confidence: 0, dimensions: dimensions.map(d => ({ id: d, name: d, required: true, status: 'UNKNOWN', evidence: [] })) }],
    events: [], reviews: [], lessons: { [id]: lesson() },
    session: { mode: 'COMPREHENSION', node: id, stack: [], tries: 0, hints: 0 },
  };
}

function attach(goal) {
  policy.setStoreForTests({ goals: [goal], active: goal.id });
  return goal;
}

function expectCode(fn, code) {
  assert.throws(fn, error => error && error.code === code);
}

function eventFor(role, kind, status = 'CORRECT', help = 0, extra = {}) {
  const activity = policy.activityContract(extra.question || { kind }, 'n1', role);
  return policy.activityEvidence(activity, assessment(status), help, { attempt_id: extra.attempt_id || `${role}-${kind}-${status}` });
}

async function submitThroughUI(goal, question, phase, role, response) {
  attach(goal);
  global.fetch = async () => ({ ok: true, json: async () => response });
  const box = element('section');
  const ui = policy.renderQuestion(box, question, 'n1', phase, role);
  assert.equal(ui.ok, true);
  ui.answer.value = 'Mi respuesta';
  await ui.submit.onclick();
  const buttons = ui.feedback.children.filter(x => x && x.type === 'button');
  return { ui, buttons };
}

(async () => {
  // 1. El rol fija los permisos máximos; el contrato solo puede restringirlos.
  {
    const guided = policy.activityContract({ kind: 'application', activity_contract: { supports_independence: true } }, 'n1', 'guided_practice');
    assert.equal(guided.supports_independence, false);
    const restricted = policy.activityContract({ kind: 'application', activity_contract: { supports_independence: false } }, 'n1', 'independent_practice');
    assert.equal(restricted.supports_independence, false);
    const guidedTransfer = policy.activityContract({ kind: 'transfer', activity_contract: { supports_transfer: true, is_novel_variant: true, observable_dimensions: ['transfer'] } }, 'n1', 'guided_practice');
    assert.equal(guidedTransfer.supports_transfer, false);
    assert.equal(guidedTransfer.is_novel_variant, false);
    const allowedTransfer = policy.activityContract({ kind: 'transfer', activity_contract: { supports_transfer: true, is_novel_variant: true, observable_dimensions: ['transfer'] } }, 'n1', 'integration');
    assert.equal(allowedTransfer.supports_transfer, true);
  }

  // 2. Las dimensiones son la intersección role + kind + declaración explícita.
  {
    assert.deepEqual(policy.activityContract({ kind: 'recognition' }, 'n1', 'diagnostic_probe').observable_dimensions, ['recognition']);
    assert.deepEqual(policy.activityContract({ kind: 'recognition' }, 'n1', 'integration').observable_dimensions, []);
    assert.deepEqual(policy.activityContract({ kind: 'recognition', activity_contract: { observable_dimensions: ['conceptual', 'recognition'] } }, 'n1', 'diagnostic_probe').observable_dimensions, ['recognition']);
    assert.deepEqual(policy.activityContract({ kind: 'application', activity_contract: { observable_dimensions: ['procedure', 'direct_application'] } }, 'n1', 'guided_practice').observable_dimensions, ['direct_application']);
    assert.deepEqual(policy.activityContract({ kind: 'context_case' }, 'n1', 'integration').observable_dimensions, ['contextual_application', 'interpretation']);
    assert.deepEqual(policy.activityContract({ kind: 'recognition', activity_contract: { kind: 'application', observable_dimensions: ['direct_application'] } }, 'n1', 'independent_practice').observable_dimensions, []);
  }

  // 3. Ausencia, UNKNOWN y valores desconocidos son indeterminados, nunca fallos.
  for (const status of [undefined, null, 'UNKNOWN', 'ALIEN_STATUS']) {
    const practice = policy.activityEvidence(contract(), { status, error_type: 'none' }, 0, { attempt_id: `unknown-${String(status)}` });
    assert.equal(practice.result, 'UNKNOWN');
    assert.equal(practice.counts_as_learning_failure, false);
  }
  {
    assert.equal(eventFor('diagnostic_probe', 'explanation', 'MISCONCEPTION').counts_as_learning_failure, false);
    assert.equal(eventFor('independent_practice', 'application', 'MISCONCEPTION').counts_as_learning_failure, true);
    const priorCorrect = eventFor('diagnostic_probe', 'explanation', 'CORRECT', 0, { attempt_id: 'diag-correct' });
    const laterDiagnosticFailure = eventFor('diagnostic_probe', 'explanation', 'MISCONCEPTION', 0, { attempt_id: 'diag-failure' });
    assert.equal(policy.sufficient({ id: 'conceptual', evidence: [priorCorrect, laterDiagnosticFailure] }), false);
    const goal = goalWithDimensions(['direct_application']);
    policy.record(goal, 'n1', 'INDEPENDENT', 'x', { status: 'NOT_A_STATUS' }, 0, contract(), 'unknown-record');
    assert.equal(goal.learner.n1.errors.length, 0);
    assert.equal(goal.coverage[0].status, 'UNKNOWN');
  }

  // 4. REVIEW inválido se rechaza antes de cualquier mutación.
  {
    const goal = goalWithDimensions(['memory']);
    goal.session.mode = 'REVIEW';
    const activity = policy.activityContract({ kind: 'recall' }, 'n1', 'spaced_review');
    const before = JSON.stringify(goal);
    expectCode(() => policy.applyResult(goal, 'n1', 'REVIEW', 'x', { ...assessment(), _activity: activity, _attempt_id: 'invalid-review' }), 'INVALID_REVIEW');
    assert.equal(JSON.stringify(goal), before);
    expectCode(() => policy.applyResult(goal, 'n1', 'REVIEW', 'x', { ...assessment(), _attempt_id: 'incomplete-review' }), 'INVALID_RESULT');
    assert.equal(JSON.stringify(goal), before);
    expectCode(() => policy.applyResult(goal, 'n1', 'UNRECOGNIZED', 'x', { ...assessment(), _activity: activity, _attempt_id: 'invalid-phase' }), 'INVALID_PHASE');
    assert.equal(JSON.stringify(goal), before);
  }
  {
    const goal = attach(goalWithDimensions(['memory']));
    goal.session.mode = 'REVIEW';
    goal.reviews = [{ id: 'n1', due: 0, step: 0, question: { prompt: 'Recuerda X', kind: 'recall' }, history: [] }];
    const activity = policy.activityContract(goal.reviews[0].question, 'n1', 'spaced_review');
    const result = { ...assessment(), _activity: activity, _attempt_id: 'valid-review' };
    assert.equal(policy.applyResult(goal, 'n1', 'REVIEW', 'X', result), true);
    assert.equal(goal.reviews[0].step, 1);
    assert.equal(goal.reviews[0].history.length, 1);
    expectCode(() => policy.applyResult(goal, 'n1', 'REVIEW', 'X', result), 'DUPLICATE_ATTEMPT');
    assert.equal(goal.reviews[0].step, 1);
    assert.equal(goal.reviews[0].history.length, 1);
  }

  // 5. La evidencia derivada tiene prioridad sobre level y expone discrepancias.
  {
    const empty = goalWithDimensions(['conceptual', 'direct_application']);
    empty.learner.n1 = { level: 5, confidence: 'verified', evidence: [], errors: [], last: null };
    assert.equal(policy.derivedStartMode(empty, 'n1'), 'TEACH');
    assert.equal(policy.progressDiscrepancy(empty, 'n1').inconsistent, true);
    attach(empty);
    policy.startTeach(empty, 'n1');
    assert.equal(empty.session.mode, 'TEACH');
    assert.equal(empty.events.at(-1).type, 'PROGRESS_DISCREPANCY');

    const partial = goalWithDimensions(['conceptual', 'direct_application']);
    partial.learner.n1 = { level: 5, confidence: 'verified', evidence: [], errors: [], last: null };
    const conceptual = policy.activityContract({ kind: 'explanation' }, 'n1', 'comprehension_check');
    policy.record(partial, 'n1', 'COMPREHENSION', 'x', assessment(), 0, conceptual, 'conceptual-progress');
    assert.equal(policy.derivedStartMode(partial, 'n1'), 'GUIDED');

    const complete = goalWithDimensions(['conceptual']);
    complete.learner.n1 = { level: 0, confidence: 'unverified', evidence: [], errors: [], last: null };
    policy.record(complete, 'n1', 'COMPREHENSION', 'x', assessment(), 0, conceptual, 'complete-low-level');
    assert.equal(policy.derivedStartMode(complete, 'n1'), 'DIAGNOSTIC');
    assert.equal(policy.verified(complete, 'n1'), true);
    assert.equal(policy.progressDiscrepancy(complete, 'n1').inconsistent, true);
    assert.equal(policy.nextNode(complete), null);
    assert.equal(policy.masteredCount(complete), 1);
  }

  // 6 y 7. Duplicados, colisiones y correcciones relacionadas.
  {
    const goal = goalWithDimensions(['direct_application']);
    const first = policy.record(goal, 'n1', 'INDEPENDENT', 'x', assessment(), 0, contract(), 'attempt-1');
    assert.ok(first);
    expectCode(() => policy.record(goal, 'n1', 'INDEPENDENT', 'x', assessment(), 0, contract(), 'attempt-1'), 'DUPLICATE_ATTEMPT');
    goal.events.push({ type: 'EVIDENCE', attempt_id: 'legacy-attempt' });
    assert.equal(policy.attemptDisposition(goal, 'legacy-attempt', contract(), 'n1'), 'duplicate');

    goal.nodes.push(node('n2'));
    goal.coverage.push({ id: 'n2', dimensions: [{ id: 'direct_application', required: true, evidence: [] }] });
    expectCode(() => policy.record(goal, 'n2', 'INDEPENDENT', 'x', assessment(), 0, contract('n2'), 'attempt-1'), 'ATTEMPT_COLLISION');
    expectCode(() => policy.record(goal, 'n1', 'INDEPENDENT', 'x', assessment(), 0, contract('n1', { activity_id: 'other-activity' }), 'attempt-1'), 'ATTEMPT_COLLISION');
    assert.ok(policy.record(goal, 'n1', 'INDEPENDENT', 'x', assessment(), 0, contract('n1', { activity_id: 'other-activity' }), 'attempt-2'));
  }
  {
    const goal = attach(goalWithDimensions(['conceptual']));
    const activity = policy.activityContract({ kind: 'explanation' }, 'n1', 'comprehension_check');
    const original = { ...assessment('CORRECT'), _activity: activity, _attempt_id: 'continue-first', _decision: 'accepted' };
    assert.equal(policy.applyResult(goal, 'n1', 'COMPREHENSION', 'x', original), true);
    assert.equal(policy.applyManualCorrection(goal, 'n1', 'COMPREHENSION', 'x', original, 'PARTIAL', 'correction-after'), true);
    assert.equal(goal.events.filter(x => x.type === 'EVIDENCE').length, 2);
    assert.equal(goal.events.at(-1).correction_of, goal.events[0].evidence_id);
    assert.equal(goal.events.at(-1).actor, 'user');
    assert.equal(goal.events.at(-1).source, 'manual_correction');
    assert.equal(goal.events.at(-1).original_result, 'CORRECT');
    assert.equal(goal.events.at(-1).corrected_result, 'PARTIAL');
    assert.equal(goal.session.mode, 'GUIDED');
    expectCode(() => policy.applyManualCorrection(goal, 'n1', 'COMPREHENSION', 'x', original, 'PARTIAL', 'correction-after'), 'DUPLICATE_ATTEMPT');
    expectCode(() => policy.applyResult(goal, 'n1', 'COMPREHENSION', 'x', original), 'DUPLICATE_ATTEMPT');
  }
  {
    const goal = attach(goalWithDimensions(['conceptual']));
    const activity = policy.activityContract({ kind: 'explanation' }, 'n1', 'comprehension_check');
    const original = { ...assessment('PARTIAL'), _activity: activity, _attempt_id: 'correct-first' };
    assert.equal(policy.applyManualCorrection(goal, 'n1', 'COMPREHENSION', 'x', original, 'CORRECT', 'correction-first'), true);
    const evidence = goal.events.filter(x => x.type === 'EVIDENCE');
    assert.equal(evidence.length, 2);
    assert.equal(evidence[0].decision, 'superseded');
    assert.deepEqual(evidence[0].observed_dimensions, []);
    assert.equal(evidence[1].decision, 'corrected');
    assert.equal(evidence[1].correction_of, evidence[0].evidence_id);
    assert.equal(goal.session.mode, 'GUIDED');
    expectCode(() => policy.applyResult(goal, 'n1', 'COMPREHENSION', 'x', original), 'DUPLICATE_ATTEMPT');
  }

  // 8. Importación defensiva y contratos sin mutación de la entrada.
  {
    const raw = { goals: [{ id: 'legacy', nodes: [node()], learner: {}, session: {} }], active: 'legacy' };
    const before = JSON.stringify(raw);
    const imported = policy.normalizeImportedStore(raw);
    assert.equal(JSON.stringify(raw), before);
    const goal = imported.goals[0];
    assert.deepEqual(goal.reviews, []);
    assert.deepEqual(goal.coverage, []);
    assert.deepEqual(goal.events, []);
    assert.deepEqual(goal.session.stack, []);
    assert.equal(policy.verified(goal, 'n1'), false);

    const question = { prompt: 'Legacy', kind: 'application' };
    const questionBefore = JSON.stringify(question);
    const built = policy.activityContract(question, 'n1', 'independent_practice');
    assert.equal(JSON.stringify(question), questionBefore);
    assert.ok(built.activity_id);
    const nullContract = policy.activityContract(null, 'n1', 'guided_practice');
    assert.deepEqual(nullContract.observable_dimensions, []);
    assert.equal(nullContract.supports_independence, false);
    const invalid = policy.renderQuestion(element('section'), null, 'n1', 'GUIDED', 'guided_practice');
    assert.equal(invalid.ok, false);
  }

  // Recorridos reales: renderQuestion -> evaluate -> applyResult -> record -> coverage.
  {
    const goal = goalWithDimensions(['conceptual']);
    const { buttons } = await submitThroughUI(goal, goal.lessons.n1.check, 'COMPREHENSION', 'comprehension_check', assessment('CORRECT'));
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].onclick(), true);
    assert.equal(goal.coverage[0].dimensions[0].status, 'MASTERED');
    assert.equal(goal.events.filter(x => x.type === 'EVIDENCE').length, 1);
    assert.equal(goal.session.mode, 'GUIDED');
    assert.equal(buttons[0].onclick(), false);
    assert.equal(buttons[1].onclick(), false);
    assert.equal(goal.events.filter(x => x.type === 'EVIDENCE').length, 1);
  }
  {
    const goal = goalWithDimensions(['conceptual']);
    const { buttons } = await submitThroughUI(goal, goal.lessons.n1.check, 'COMPREHENSION', 'comprehension_check', assessment('PARTIAL'));
    assert.equal(buttons[1].onclick(), true);
    assert.equal(buttons[0].onclick(), false);
    assert.equal(buttons[1].onclick(), false);
    assert.equal(goal.events.filter(x => x.type === 'EVIDENCE').length, 2);
    assert.equal(goal.events.filter(x => x.type === 'EVIDENCE' && x.decision === 'corrected').length, 1);
    assert.equal(goal.session.mode, 'GUIDED');
  }
  {
    const helpedGoal = goalWithDimensions(['direct_application']);
    helpedGoal.session.mode = 'INDEPENDENT';
    helpedGoal.session.hints = 1;
    const helped = await submitThroughUI(helpedGoal, helpedGoal.lessons.n1.independent, 'INDEPENDENT', 'independent_practice', assessment('CORRECT'));
    helped.buttons[0].onclick();
    assert.equal(helpedGoal.coverage[0].dimensions[0].evidence[0].is_independent, false);

    const independentGoal = goalWithDimensions(['direct_application']);
    independentGoal.session.mode = 'INDEPENDENT';
    const independent = await submitThroughUI(independentGoal, independentGoal.lessons.n1.independent, 'INDEPENDENT', 'independent_practice', assessment('CORRECT'));
    independent.buttons[0].onclick();
    assert.equal(independentGoal.coverage[0].dimensions[0].evidence[0].is_independent, true);
  }
  {
    const goal = goalWithDimensions(['conceptual']);
    const unknown = await submitThroughUI(goal, goal.lessons.n1.check, 'COMPREHENSION', 'comprehension_check', assessment('UNRECOGNIZED'));
    unknown.buttons[0].onclick();
    assert.equal(goal.learner.n1.errors.length, 0);
    assert.equal(goal.coverage[0].status, 'UNKNOWN');
  }
  {
    const goal = goalWithDimensions(['conceptual']);
    goal.session.mode = 'DIAGNOSTIC';
    const diagnostic = await submitThroughUI(goal, goal.nodes[0].probe, 'DIAGNOSTIC', 'diagnostic_probe', assessment('MISCONCEPTION'));
    diagnostic.buttons[0].onclick();
    assert.equal(goal.learner.n1.errors.length, 0);
    assert.equal(goal.session.mode, 'TEACH');
  }

  // El retorno de microtutoría se conserva sin cambiar su lógica interna.
  {
    const goal = goalWithDimensions(['conceptual']);
    goal.session.mode = 'CONTEXT';
    goal.contextStack = [{ context_id: 'child', resume_mode: 'GUIDED', status: 'ACTIVE' }];
    policy.popContext(goal, 1);
    assert.equal(goal.session.mode, 'GUIDED');
    assert.equal(goal.contextStack.length, 0);
  }

  // Contradicciones posteriores siguen invalidando suficiencia; vacío es conservador.
  {
    const dimension = { id: 'direct_application', evidence: [] };
    dimension.evidence.push(policy.activityEvidence(contract(), assessment(), 0, { attempt_id: 'time-1' }));
    dimension.evidence.push(policy.activityEvidence(contract(), assessment('MISCONCEPTION'), 0, { attempt_id: 'time-2' }));
    assert.equal(policy.sufficient(dimension), false);
    assert.equal(policy.deriveCoverage({ dimensions: [] }).mastered, false);
    assert.equal(policy.sufficient({ id: 'direct_application', evidence: [{ status: 'CORRECT', independent: true }] }), false);
  }

  console.log('OK: evidence policy invariants and integrated flows');
})().catch(error => { console.error(error); process.exitCode = 1; });
