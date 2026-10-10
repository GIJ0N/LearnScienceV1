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
global.fetch = async () => { throw new Error('La prueba no permite red.'); };

const policy = require('../app.js');

function goalFor(dimension, question) {
  return {
    id: `goal-${dimension}`, goal: 'Prueba local',
    nodes: [{ id: 'n1', name: 'Nodo', outcome: 'Resolver', level: 0, prerequisites: [], kind: 'procedure', probe: { prompt: 'Probe', reference: 'Criterio', kind: 'explanation' } }],
    coverage: [{ id: 'n1', name: 'Nodo', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: dimension, name: dimension, required: true, status: 'UNKNOWN', evidence: [] }] }],
    learner: {}, events: [], reviews: [], repairEpisodes: [], contextStack: [],
    lessons: { n1: { explanation: 'Explicación', example: 'Ejemplo', common_error: 'Error', check: { prompt: 'Comprende', reference: 'Criterio', kind: 'explanation' }, guided: question, independent: question, integration: { prompt: 'Integra', reference: 'Criterio', kind: 'context_case' } } },
    session: { mode: 'INDEPENDENT', node: 'n1', stack: [], tries: 0, hints: 0 },
  };
}

function positivePath(dimension, question) {
  const goal = goalFor(dimension, question);
  policy.setStoreForTests({ goals: [goal], active: goal.id });
  assert.equal(policy.pendingActivityDimension(goal, 'n1'), dimension);
  assert.equal(policy.lessonRequest(goal, goal.nodes[0]).target_dimension, dimension);
  const activity = policy.activityContract(question, 'n1', 'independent_practice');
  assert.deepEqual(activity.observable_dimensions, [dimension]);
  const result = { status: 'CORRECT', error_type: 'none', feedback: 'Correcto', hint: '', _activity: activity, _attempt_id: `attempt-${dimension}` };
  assert.equal(policy.applyResult(goal, 'n1', 'INDEPENDENT', 'respuesta', result), true);
  const event = goal.events.find(x => x.type === 'EVIDENCE' && x.attempt_id === result._attempt_id);
  assert.deepEqual(event.observed_dimensions, [dimension]);
  assert.equal(goal.coverage[0].dimensions[0].evidence.length, 1);
  assert.equal(goal.coverage[0].dimensions[0].status, 'MASTERED');
  assert.throws(() => policy.applyResult(goal, 'n1', 'INDEPENDENT', 'respuesta', result), error => error.code === 'DUPLICATE_ATTEMPT');
  assert.equal(goal.coverage[0].dimensions[0].evidence.length, 1);
  return { kind: question.kind, observed: event.observed_dimensions, evidence: 1, status: 'MASTERED' };
}

function negativePaths(families) {
  for (const family of families) {
    const unknown = policy.activityContract({ kind: 'unknown_family', observable_dimensions: [family.dimension] }, 'n1', 'independent_practice');
    assert.deepEqual(unknown.observable_dimensions, []);

    const otherDimension = families.find(candidate => candidate.dimension !== family.dimension).dimension;
    const incompatibleFamily = policy.activityContract({ kind: family.kind, observable_dimensions: [otherDimension] }, 'n1', 'independent_practice');
    assert.deepEqual(incompatibleFamily.observable_dimensions, []);

    const wrongRole = policy.activityContract({ kind: family.kind, observable_dimensions: [family.dimension] }, 'n1', 'comprehension_check');
    assert.deepEqual(wrongRole.observable_dimensions, []);

    const generic = policy.activityContract({ kind: 'explanation', observable_dimensions: [family.dimension] }, 'n1', 'diagnostic_probe');
    assert.deepEqual(generic.observable_dimensions, []);
  }

  const first = families[0];
  const helped = policy.activityEvidence(
    policy.activityContract({ kind: first.kind, observable_dimensions: [first.dimension] }, 'n1', 'independent_practice'),
    { status: 'CORRECT', error_type: 'none' }, 1, { attempt_id: 'helped' },
  );
  assert.equal(helped.is_independent, false);

  const unknownGoal = goalFor(first.dimension, { kind: first.kind, observable_dimensions: [first.dimension] });
  const unknownActivity = policy.activityContract({ kind: first.kind, observable_dimensions: [first.dimension] }, 'n1', 'independent_practice');
  policy.record(unknownGoal, 'n1', 'INDEPENDENT', 'no sé', { status: 'UNKNOWN', error_type: 'none' }, 0, unknownActivity, 'unknown-attempt');
  assert.equal(unknownGoal.coverage[0].dimensions[0].status, 'UNKNOWN');
  assert.equal(policy.verified(unknownGoal, 'n1'), false);

  const repairGoal = goalFor(first.dimension, { kind: first.kind, observable_dimensions: [first.dimension] });
  const child = policy.activityContract({ kind: first.kind, observable_dimensions: [first.dimension], evidence_scope: 'repair_episode', episode_id: 'episode-1', repair_stage: 'DIAGNOSTIC' }, 'n1', 'repair_diagnostic');
  policy.record(repairGoal, 'n1', 'MICRO_TUTOR', 'respuesta', { status: 'CORRECT', error_type: 'none' }, 0, child, 'repair-child');
  assert.equal(repairGoal.coverage[0].dimensions[0].evidence.length, 0);

  const legacy = policy.normalizeImportedStore({ goals: [{ id: 'legacy', nodes: repairGoal.nodes, learner: {}, coverage: repairGoal.coverage, lessons: { n1: { independent: { prompt: 'Legacy', reference: 'Criterio', kind: 'unknown' } } }, session: {} }], active: 'legacy' });
  assert.equal(legacy.goals[0].coverage[0].dimensions[0].evidence.length, 0);
  assert.deepEqual(policy.activityContract(legacy.goals[0].lessons.n1.independent, 'n1', 'independent_practice').observable_dimensions, []);
}

function findByText(root, value) {
  if (root?.textContent === value) return root;
  for (const child of root?.children || []) {
    const found = findByText(child, value);
    if (found) return found;
  }
  return null;
}

async function lessonRecovery(question) {
  const goal = goalFor('units', question);
  goal.lessons = {};
  goal.session.mode = 'TEACH';
  goal.session.target_dimension = 'units';
  policy.setStoreForTests({ goals: [goal], active: goal.id });
  const originalError = console.error;
  console.error = () => {};
  global.fetch = async () => ({ ok: false, json: async () => ({ error: 'Contrato dirigido incompatible.' }) });
  try {
    await policy.session();
  } finally {
    console.error = originalError;
  }
  assert.equal(roots.status.textContent, 'Contrato dirigido incompatible.');
  assert.ok(findByText(roots.app, 'No se pudo preparar una actividad válida.'));
  const retry = findByText(roots.app, 'Reintentar microlección');
  assert.equal(typeof retry?.onclick, 'function');
  assert.equal(goal.session.target_dimension, 'units');
  assert.equal(goal.lessons.n1, undefined);
  assert.equal(goal.events.length, 0);
  assert.equal(goal.coverage[0].dimensions[0].evidence.length, 0);

  const validLesson = {
    target_dimension: 'units', explanation: 'Explicación', example: 'Ejemplo', common_error: 'Error',
    check: { prompt: 'Comprueba', reference: 'Criterio', kind: 'explanation' },
    guided: question, independent: question,
    integration: { prompt: 'Integra', reference: 'Criterio', kind: 'context_case' },
  };
  let requests = 0;
  global.fetch = async (_route, options) => {
    requests += 1;
    assert.equal(JSON.parse(options.body).target_dimension, 'units');
    return { ok: true, json: async () => validLesson };
  };
  await policy.session();
  assert.equal(requests, 1);
  assert.equal(goal.lessons.n1.target_dimension, 'units');
  assert.equal(goal.events.length, 0);
  assert.equal(goal.coverage[0].dimensions[0].evidence.length, 0);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
  const payload = JSON.parse(input);
  const results = {};
  for (const family of payload.families) results[family.dimension] = positivePath(family.dimension, payload.lessons[family.dimension].independent);
  negativePaths(payload.families);
  await lessonRecovery(payload.lessons.units.independent);
  console.log(JSON.stringify(results));
});
