const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Contexto no seguro (HTTP en IP, p. ej. Tailscale): crypto existe pero sin randomUUID.
const nodeCrypto = require('node:crypto').webcrypto;
function setCrypto(value) {
  Object.defineProperty(globalThis, 'crypto', { value, configurable: true, writable: true });
}
const insecure = { getRandomValues: array => nodeCrypto.getRandomValues(array) };
setCrypto(insecure);

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
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let requests = [];
global.fetch = async (route, options) => {
  const body = JSON.parse(options.body);
  requests.push({ route, body });
  if (route === '/api/map') {
    return { ok: true, json: async () => ({
      depth: 'solido', map_version: 1,
      nodes: [{ id: 'n1', name: 'Unidades', prerequisites: [], level: 0, outcome: 'Convertir', kind: 'concept', probe: { prompt: 'p', reference: 'r', kind: 'units', observable_dimensions: ['units'] } }],
      coverage: [{ id: 'n1', dimensions: [{ id: 'units', name: 'Unidades', required: true, status: 'UNKNOWN', evidence: [] }] }],
    }) };
  }
  return { ok: true, json: async () => ({ saved: true, revision: 2 }) };
};

const policy = require('../app.js');

function findButton(node, label) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'button' && node.textContent === label) return node;
  for (const child of node.children || []) {
    const found = findButton(child, label);
    if (found) return found;
  }
  return null;
}
function findByType(node, type) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === type) return node;
  for (const child of node.children || []) {
    const found = findByType(child, type);
    if (found) return found;
  }
  return null;
}

(async () => {
  // 1. Sin randomUUID, con getRandomValues: UUID v4 valido y unico.
  const seen = new Set();
  for (let i = 0; i < 1000; i += 1) {
    const value = policy.uuid();
    assert.match(value, UUID_V4);
    seen.add(value);
  }
  assert.equal(seen.size, 1000, '1000 UUID deben ser unicos');
  assert.match(policy.newId('attempt'), /^attempt-[0-9a-f]{8}-[0-9a-f]{4}-4/);

  // 2. Con randomUUID nativo se usa tal cual.
  setCrypto({ ...insecure, randomUUID: () => 'nativo-1' });
  assert.equal(policy.uuid(), 'nativo-1');
  setCrypto(insecure);

  // 3. Sin crypto en absoluto: no lanza y devuelve cadena no vacia.
  setCrypto(undefined);
  const fallback = policy.uuid();
  assert.equal(typeof fallback, 'string');
  assert.ok(fallback.length > 0);
  assert.match(policy.newId('x'), /^x-.+/);
  setCrypto(insecure);

  // 4. Flujo real: «Empezar ruta» en contexto no seguro crea la meta.
  const store = { goals: [], active: null };
  policy.setStoreForTests(store);
  policy.setProfileForTests({ profile_id: 'profile-test', name: 'Prueba', preferences: {} }, 1);
  policy.home();
  const start = findButton(app, 'Empezar ruta');
  assert.ok(start, 'debe existir el boton Empezar ruta');
  const nameInput = findByType(app, 'input');
  nameInput.value = 'Pintura electrostatica en polvo';
  await start.onclick();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(!/randomUUID/.test(status.textContent), 'no debe aparecer el error randomUUID: ' + status.textContent);
  assert.equal(requests.some(r => r.route === '/api/map'), true);
  assert.equal(store.goals.length, 1, 'la meta se crea');
  assert.match(store.goals[0].id, UUID_V4);
  assert.equal(store.active, store.goals[0].id);

  // 5. Guardia estatica: ninguna llamada directa a crypto.randomUUID( fuera de uuid().
  const root = path.join(__dirname, '..');
  for (const file of ['app.js', 'app_legacy.py']) {
    let text = fs.readFileSync(path.join(root, file), 'utf8');
    const start = text.indexOf('function uuid(){');
    assert.ok(start >= 0, file + ' debe definir uuid()');
    const end = text.indexOf('function newId(', start);
    assert.ok(end > start, file + ' debe definir newId() tras uuid()');
    const outside = text.slice(0, start) + text.slice(end);
    assert.ok(!/crypto\s*\.\s*randomUUID\s*\(/.test(outside), file + ' llama crypto.randomUUID( fuera de uuid()');
  }
  console.log('OK: IDs en contexto no seguro (uuid v4 con getRandomValues, respaldo sin crypto, creacion de meta y guardia estatica)');
})().catch(error => { console.error(error); process.exitCode = 1; });
