const assert = require('node:assert/strict');

function element(type = 'div') {
  return {
    type, children: [], style: {}, textContent: '', className: '', value: '', checked: false,
    append(...items) { this.children.push(...items); return this; },
    appendChild(item) { this.children.push(item); return item; },
    replaceChildren(...items) { this.children = items; },
    setAttribute() {}, click() {},
  };
}

const app = element('app');
const status = element('status');
global.document = { getElementById: id => id === 'app' ? app : status, createElement: type => element(type) };
let localWrites = 0;
global.localStorage = { getItem: () => null, setItem: () => { localWrites += 1; } };
global.confirm = () => true;
global.crypto = global.crypto || require('node:crypto').webcrypto;

let requests = [];
let failSave = true;
global.fetch = async (route, options) => {
  const body = JSON.parse(options.body);
  requests.push({ route, body });
  if (route === '/api/profile/save' && failSave) {
    return { ok: false, json: async () => ({ error: 'disco no disponible' }) };
  }
  return { ok: true, json: async () => ({ saved: true, revision: 3 }) };
};

const policy = require('../app.js');
const goal = {
  id: 'goal-1', profile_id: 'profile-test', goal: 'Unidades',
  nodes: [{ id: 'n1', name: 'Unidades', prerequisites: [], level: 0, outcome: 'Convertir', kind: 'concept', probe: { prompt: 'p', reference: 'r', kind: 'units', observable_dimensions: ['units'] } }],
  coverage: [{ id: 'n1', dimensions: [{ id: 'units', name: 'Unidades', required: true, status: 'UNKNOWN', evidence: [] }] }],
  learner: {}, lessons: {}, reviews: [], events: [],
  session: { profile_id: 'profile-test', mode: 'TEACH', node: 'n1', stack: [], stage: 'teach', tries: 0 },
};
const store = { goals: [goal], active: goal.id };
policy.setStoreForTests(store);
policy.setProfileForTests({ profile_id: 'profile-test', name: 'Prueba', preferences: {} }, 1);

(async () => {
  assert.equal(await policy.save(), false);
  await policy.flushSave();
  assert.match(status.textContent, /No se guardó la memoria durable/);
  assert.equal(localWrites, 0, 'el progreso completo no vuelve a localStorage');
  assert.equal(requests[0].body.expected_revision, 1);

  failSave = false;
  assert.equal(await policy.save(), true, 'un reintento explícito puede recuperar el guardado');
  assert.equal(requests.at(-1).body.profile_id, 'profile-test');
  assert.equal(requests.at(-1).body.store.goals[0].id, 'goal-1');

  const request = policy.lessonRequest(goal, goal.nodes[0]);
  assert.equal(request.profile_id, 'profile-test');
  assert.equal(request.goal_id, 'goal-1');
  assert.equal(request.node_id, 'n1');
  assert.equal(request.target_dimension, 'units');

  goal.reviews = [{ id: 'n1', due: 0, step: 0, question: { prompt: 'repaso', reference: 'r', kind: 'units', observable_dimensions: ['units'] }, history: [] }];
  policy.startBrief(goal);
  assert.equal(goal.session.brief_mode, true);
  assert.equal(goal.session.mode, 'REVIEW');
  assert.match(goal.session.brief_reason, /repaso vencido/);
  policy.pauseBrief(goal);
  assert.equal(goal.session.brief_mode, false);
  assert.ok(goal.session.brief_paused_at);
  await policy.flushSave();
  console.log('OK: durable frontend save failure, recovery, profile association and brief resume state');
})().catch(error => { console.error(error); process.exitCode = 1; });
