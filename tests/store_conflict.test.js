// store_conflict_v1: conflicto de revisión entre pestañas del mismo perfil.
// Node + DOM simulado + servidor falso con semántica de revisión (sin navegador, sin proveedor real).
const assert = require('node:assert/strict');
const path = require('node:path');

const APP = path.join(__dirname, '..', 'app.js');
const PROFILE_ID = 'profile-test';
const DRAFT_KEY = 'ls-draft:profile-test:act-1';

function element(type = 'div') {
  return {
    type, children: [], style: {}, textContent: '', className: '', value: '', checked: false, disabled: false, onclick: null,
    append(...items) { this.children.push(...items); return this; },
    appendChild(item) { this.children.push(item); return item; },
    replaceChildren(...items) { this.children = items; },
    setAttribute() {}, click() {}, focus() {},
  };
}

function buttons(el, out = []) {
  if (!el) return out;
  if (el.type === 'button') out.push(el);
  for (const child of el.children || []) buttons(child, out);
  return out;
}

function buttonNamed(el, label) {
  const found = buttons(el).find(b => b.textContent === label);
  assert.ok(found, `falta el botón «${label}»`);
  return found;
}

function evidence(attemptId, answer) {
  return {
    type: 'EVIDENCE', attempt_id: attemptId, evidence_id: 'ev-' + attemptId, activity_id: 'act-1', node_id: 'n1',
    phase: 'INDEPENDENT', result: 'CORRECT', status: 'CORRECT', answer, help_used: 0, is_independent: true,
    observed_dimensions: ['units'], at: 1, timestamp: 1,
  };
}

function goal(events) {
  return {
    id: 'goal-1', profile_id: PROFILE_ID, goal: 'Unidades',
    nodes: [{ id: 'n1', name: 'Unidades', prerequisites: [], level: 0, outcome: 'Convertir', kind: 'concept', probe: { prompt: 'p', reference: 'r', kind: 'units', observable_dimensions: ['units'] } }],
    coverage: [{ id: 'n1', dimensions: [{ id: 'units', name: 'Unidades', required: true, status: 'UNKNOWN', evidence: [] }] }],
    learner: {}, lessons: {}, reviews: [], events,
    session: { profile_id: PROFILE_ID, mode: 'TEACH', node: 'n1', stack: [], stage: 'teach', tries: 0 },
  };
}

const localStore = () => ({ goals: [goal([evidence('attempt-local', 'respuesta de esta pestaña')])], active: 'goal-1' });
const profile = () => ({ profile_id: PROFILE_ID, name: 'Prueba', preferences: {} });

// Sesión limpia por escenario: globales nuevos y un módulo app.js recargado.
function setup() {
  const status = element('status');
  const indicator = element('span');
  indicator.id = 'ruta-persistence-state';
  const app = element('app');
  const storage = new Map();
  const dom = { status, indicator, app, storage, confirmAnswers: [], confirmAsked: [], blobs: [], listeners: new Map() };
  global.document = { getElementById: id => id === 'app' ? app : id === 'ruta-persistence-state' ? indicator : status, createElement: type => element(type) };
  global.localStorage = { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => { storage.set(k, String(v)); }, removeItem: k => { storage.delete(k); } };
  global.confirm = msg => { dom.confirmAsked.push(msg); return dom.confirmAnswers.length ? dom.confirmAnswers.shift() : true; };
  global.addEventListener = (type, fn) => { dom.listeners.set(type, fn); };
  global.removeEventListener = (type, fn) => { if (dom.listeners.get(type) === fn) dom.listeners.delete(type); };
  global.Blob = class { constructor(parts) { dom.blobs.push(String(parts[0])); } };
  global.URL.createObjectURL = () => 'blob:test';
  global.URL.revokeObjectURL = () => {};
  global.crypto = global.crypto || require('node:crypto').webcrypto;
  return dom;
}

// Servidor falso: revisión real, conflicto con la misma semántica que memory_store.save.
function fakeServer(initialRevision = 2) {
  const server = {
    revision: initialRevision, networkDown: false, requests: [],
    store: { goals: [goal([evidence('attempt-otra', 'guardado por la otra pestaña')])], active: 'goal-1' },
  };
  global.fetch = async (route, options) => {
    const body = JSON.parse(options.body);
    server.requests.push({ route, body });
    const reply = (ok, status, data) => ({ ok, status, json: async () => data });
    if (route === '/api/profile/save') {
      if (server.networkDown) throw new TypeError('fetch failed');
      if (Number(body.expected_revision) !== server.revision) {
        return reply(false, 400, { error: 'La memoria cambió en otra sesión; recarga antes de guardar.', code: 'STORE_CONFLICT' });
      }
      server.revision += 1;
      server.store = JSON.parse(JSON.stringify(body.store));
      return reply(true, 200, { saved: true, revision: server.revision });
    }
    if (route === '/api/profile/load') {
      return reply(true, 200, { profile_id: PROFILE_ID, name: 'Prueba', preferences: {}, revision: server.revision, store: JSON.parse(JSON.stringify(server.store)) });
    }
    return reply(true, 200, { profiles: [] });
  };
  return server;
}

function load() {
  delete require.cache[require.resolve(APP)];
  return require(APP);
}

const savesSent = server => server.requests.filter(r => r.route === '/api/profile/save');
const loadsSent = server => server.requests.filter(r => r.route === '/api/profile/load');

async function scenarioConflictDoesNotResendStaleRevision() {
  setup();
  const server = fakeServer(2);
  const policy = load();
  policy.setStoreForTests(localStore());
  policy.setProfileForTests(profile(), 1); // esta pestaña cree que la revisión es 1; el servidor ya va por 2
  assert.equal(await policy.save(), false);
  assert.match(document.getElementById('status').textContent, /Otra pestaña guardó cambios de este perfil\. Tienes 1 intento sin guardar\./);
  // Lo que haría «Reintentar guardado» o cualquier guardado posterior tras el conflicto
  assert.equal(await policy.save(), false);
  await policy.flushSave();
  assert.equal(savesSent(server).length, 1, 'tras el conflicto no se reenvía la revisión obsoleta');
  assert.deepEqual(buttons(policy.persistenceControl()).map(b => b.textContent), ['Descargar cambios no guardados', 'Recargar desde el disco']);
}

async function scenarioNonConflictFailureKeepsRetry() {
  setup();
  const server = fakeServer(2);
  const policy = load();
  policy.setStoreForTests(localStore());
  policy.setProfileForTests(profile(), 2);
  server.networkDown = true;
  assert.equal(await policy.save(), false);
  const retry = policy.persistenceControl();
  assert.equal(retry.textContent, 'Reintentar guardado', 'un error de red sí ofrece reintentar');
  server.networkDown = false;
  await retry.onclick();
  await policy.flushSave();
  assert.equal(server.revision, 3, 'el reintento usa la revisión vigente y guarda');
  assert.equal(policy.persistenceControl(), null);
}

async function scenarioDownloadAndReloadWithConfirmation() {
  const dom = setup();
  const server = fakeServer(2);
  const policy = load();
  policy.setStoreForTests(localStore());
  policy.setPageForTests('profiles');
  policy.setProfileForTests(profile(), 1);
  await policy.save();
  const before = server.requests.length;

  buttonNamed(policy.persistenceControl(), 'Descargar cambios no guardados').onclick();
  assert.equal(server.requests.length, before, 'descargar no envía nada al servidor');
  const exported = dom.blobs.at(-1);
  assert.ok(exported && exported.includes('respuesta de esta pestaña'), 'se exporta el snapshot local');
  assert.ok(!exported.includes('guardado por la otra pestaña'), 'la exportación no fusiona cambios del servidor');
  assert.equal(policy.getStoreForTests().goals[0].events[0].attempt_id, 'attempt-local', 'descargar no altera el estado local');

  dom.confirmAnswers.push(false);
  await buttonNamed(policy.persistenceControl(), 'Recargar desde el disco').onclick();
  assert.equal(loadsSent(server).length, 0, 'recargar sin confirmación no recarga');
  assert.equal(policy.getStoreForTests().goals[0].events[0].attempt_id, 'attempt-local');

  dom.confirmAnswers.push(true);
  await buttonNamed(policy.persistenceControl(), 'Recargar desde el disco').onclick();
  assert.match(dom.confirmAsked.at(-1), /Se descartará el intento sin guardar en esta pestaña\. ¿Continuar\?/);
  assert.equal(loadsSent(server).length, 1, 'con confirmación se recarga desde el servidor');
  assert.equal(policy.getStoreForTests().goals[0].events[0].attempt_id, 'attempt-otra');
  assert.equal(policy.persistenceControl(), null, 'tras recargar ya no hay conflicto pendiente');
}

async function scenarioUnloadGuardFollowsDirtyState() {
  const dom = setup();
  const server = fakeServer(2);
  const policy = load();
  policy.setStoreForTests(localStore());
  policy.setPageForTests('profiles');
  policy.setProfileForTests(profile(), 2);
  assert.equal(await policy.save(), true);
  assert.equal(dom.listeners.has('beforeunload'), false, 'sin cambios pendientes no hay aviso al cerrar');

  policy.setProfileForTests(profile(), 1);
  await policy.save();
  assert.ok(dom.listeners.has('beforeunload'), 'con cambios sin guardar hay aviso al cerrar');
  const event = { defaultPrevented: false, returnValue: undefined, preventDefault() { this.defaultPrevented = true; } };
  dom.listeners.get('beforeunload')(event);
  assert.equal(event.defaultPrevented, true);
  assert.ok(event.returnValue, 'el aviso fija returnValue');

  dom.confirmAnswers.push(true);
  await buttonNamed(policy.persistenceControl(), 'Recargar desde el disco').onclick();
  assert.equal(dom.listeners.has('beforeunload'), false, 'al quedar sin cambios pendientes se quita el aviso');
  assert.ok(server.revision >= 2);
}

async function scenarioDraftKeptUntilDurableSave() {
  const dom = setup();
  const server = fakeServer(2);
  const policy = load();
  dom.storage.set(DRAFT_KEY, 'Mi respuesta sin enviar');
  policy.setStoreForTests(localStore());
  policy.setProfileForTests(profile(), 2);
  policy.markDraftForAttempt('attempt-local', PROFILE_ID, 'act-1'); // la evaluación fue bien; aún no hay guardado durable
  assert.equal(dom.storage.get(DRAFT_KEY), 'Mi respuesta sin enviar', 'la evaluación sola no borra el borrador');

  server.networkDown = true;
  assert.equal(await policy.save(), false);
  assert.equal(dom.storage.get(DRAFT_KEY), 'Mi respuesta sin enviar', 'si el guardado falla, el borrador se conserva');

  server.networkDown = false;
  assert.equal(await policy.save(), true);
  assert.equal(dom.storage.has(DRAFT_KEY), false, 'tras guardado exitoso el borrador se borra');
  assert.equal(JSON.stringify(server.requests).includes('Mi respuesta sin enviar'), false, 'el borrador nunca va al servidor');
}

const scenarios = [
  ['conflicto sin reenvío de la revisión obsoleta', scenarioConflictDoesNotResendStaleRevision],
  ['error de red conserva Reintentar guardado', scenarioNonConflictFailureKeepsRetry],
  ['descargar, recargar con confirmación', scenarioDownloadAndReloadWithConfirmation],
  ['aviso al cerrar solo con cambios pendientes', scenarioUnloadGuardFollowsDirtyState],
  ['borrador hasta guardado durable', scenarioDraftKeptUntilDurableSave],
];

(async () => {
  for (const [name, run] of scenarios) {
    await run();
    console.log('OK: ' + name);
  }
  console.log('OK: store_conflict_v1 (' + scenarios.length + ' escenarios)');
})().catch(error => { console.error(error); process.exitCode = 1; });
