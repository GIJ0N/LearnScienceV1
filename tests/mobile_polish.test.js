// mobile_polish_v1: borrador local de respuesta abierta y reglas de CSS móvil (safe-area, 44 px, 16 px).
// DOM simulado; sin navegador, sin servidor real y sin proveedor. LS_APP_JS permite probar mutaciones sobre una copia.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function element(type = 'div') {
  return { type, textContent: '', value: '', disabled: false, children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute() {} };
}
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.confirm = () => true;
const mem = new Map();
let storageBroken = false;
global.localStorage = {
  getItem: k => { if (storageBroken) throw new Error('SecurityError'); return mem.has(k) ? mem.get(k) : null; },
  setItem: (k, v) => { if (storageBroken) throw new Error('QuotaExceededError'); mem.set(k, String(v)); },
  removeItem: k => { if (storageBroken) throw new Error('SecurityError'); mem.delete(k); },
};
const calls = [];
let failEvaluate = false;
global.fetch = async (route, options) => {
  calls.push({ route, body: String(options.body) });
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  if (route === '/api/evaluate') {
    if (failEvaluate) return { ok: false, json: async () => ({ error: 'No se pudo evaluar.' }) };
    return { ok: true, json: async () => ({ status: 'CORRECT', feedback: 'Correcto', error_type: 'none', hint: '', evaluator_version: 'local-fixture' }) };
  }
  throw new Error('Ruta inesperada ' + route);
};
const APP = process.env.LS_APP_JS || path.join(__dirname, '..', 'app.js');
const p = require(APP);

const node = { id: 'a', name: 'Espesor', level: 0, prerequisites: [], outcome: 'Controlar', probe: { prompt: 'Explica', kind: 'explanation' } };
const Q = { activity_id: 'act-1', prompt: '¿Por qué medir el espesor?', reference: 'Porque controla el curado', kind: 'explanation' };
function goal() {
  return {
    id: 'g', profile_id: 'profile-A', goal: 'Pintura', nodes: [node], learner: {}, reviews: [], events: [],
    coverage: [{ id: 'a', name: 'a', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] }],
    lessons: { a: { explanation: 'x', example: 'y', common_error: 'z', check: Q, guided: Q, independent: Q, integration: Q, adaptation_mode: 'initial' } },
    session: { mode: 'COMPREHENSION', node: 'a', stack: [], tries: 0, hints: 0 },
  };
}
function attach(profileId) { const g = goal(); g.profile_id = profileId; p.setProfileForTests({ profile_id: profileId, name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
const render = () => { const box = element(); const ui = p.renderQuestion(box, Q, 'a', 'COMPREHENSION', 'comprehension_check'); assert.equal(ui.ok, true); return ui; };
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const KEYA = 'ls-draft:profile-A:act-1', KEYB = 'ls-draft:profile-B:act-1';

(async () => {
  // 1. Se guarda por perfil y actividad, sin tocar servidor ni eventos.
  const g = attach('profile-A');
  let ui = render();
  assert.equal(ui.answer.value, '', 'sin borrador previo el campo está vacío');
  const before = calls.length;
  ui.answer.value = 'El espesor controla el curado'; ui.answer.oninput();
  assert.equal(mem.get(KEYA), 'El espesor controla el curado');
  assert.deepEqual([...mem.keys()], [KEYA], 'solo existe la clave por perfil y actividad');
  assert.equal(calls.length, before, 'escribir un borrador no llama al servidor');
  assert.equal(g.events.length, 0, 'el borrador no genera eventos');
  assert.equal(JSON.stringify(g).includes('El espesor controla'), false, 'el borrador no entra en la meta');

  // 2. Se restaura al volver a la actividad.
  attach('profile-A');
  ui = render();
  assert.equal(ui.answer.value, 'El espesor controla el curado', 'el texto se restaura');

  // 3. Un borrador de otro perfil no aparece, y no se mezcla.
  attach('profile-B');
  ui = render();
  assert.equal(ui.answer.value, '', 'el perfil B no ve el borrador del perfil A');
  ui.answer.value = 'Texto de B'; ui.answer.oninput();
  assert.equal(mem.get(KEYA), 'El espesor controla el curado', 'el borrador de A no cambia');
  assert.equal(mem.get(KEYB), 'Texto de B');
  mem.delete(KEYB);

  // 4. Si el envío falla, el borrador se conserva.
  attach('profile-A');
  ui = render();
  failEvaluate = true;
  const realError = console.error; console.error = () => {};
  await ui.submit.onclick(); await settle();
  console.error = realError;
  assert.equal(mem.get(KEYA), 'El espesor controla el curado', 'un envío fallido conserva el borrador');
  failEvaluate = false;

  // 5. Al enviar con éxito se borra; el borrador no viaja en la petición ni crea eventos por sí mismo.
  attach('profile-A');
  ui = render();
  const n0 = calls.length;
  await ui.submit.onclick(); await settle();
  assert.equal(mem.has(KEYA), false, 'el envío exitoso borra el borrador');
  const sent = calls.slice(n0);
  assert.equal(sent.some(c => c.route === '/api/evaluate'), true);
  assert.equal(sent.some(c => c.body.includes('ls-draft')), false, 'ninguna petición lleva la clave del borrador');
  attach('profile-A');
  assert.equal(render().answer.value, '', 'tras enviar, al volver no reaparece');

  // 6. localStorage no disponible: nada se rompe.
  storageBroken = true;
  attach('profile-A');
  ui = render();
  ui.answer.value = 'sin almacenamiento'; ui.answer.oninput();
  assert.equal(p.draftSave('profile-A', 'act-1', 'x'), false);
  assert.equal(p.draftLoad('profile-A', 'act-1'), '');
  await ui.submit.onclick(); await settle();
  storageBroken = false;
  assert.equal(mem.has(KEYA), false);

  // 7. Sin perfil o sin actividad no hay clave (nunca un borrador global).
  assert.equal(p.draftKey(null, 'act-1'), null);
  assert.equal(p.draftKey('profile-A', null), null);

  // 8. CSS móvil: safe-area, objetivos de 44 px y campos de 16 px.
  const css = p.VISUAL_CSS;
  for (const side of ['top', 'right', 'bottom', 'left']) assert.ok(css.includes('env(safe-area-inset-' + side), 'safe-area ' + side);
  const m = css.match(/@media\(max-width:600px\)\{(.*)\}\n/);
  assert.ok(m, 'existe el bloque móvil de 600 px');
  assert.ok(/min-height:44px;min-width:44px/.test(m[1]), 'objetivos táctiles de 44 px de alto y ancho');
  assert.ok(/input,textarea,select[^{]*\{font-size:16px\}/.test(m[1]), 'campos a 16 px');
  const py = fs.readFileSync(path.join(__dirname, '..', 'app_legacy.py'), 'utf8');
  assert.ok(py.includes('viewport-fit=cover'), 'viewport-fit=cover en el documento principal');

  console.log('mobile_polish OK');
})().catch(e => { console.error(e); process.exit(1); });
