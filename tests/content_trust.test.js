const assert = require('node:assert/strict');
const fs = require('node:fs');

function element(type = 'div') {
  return { type, children: [], style: {}, textContent: '', className: '', value: '', checked: false,
    append(...i) { this.children.push(...i); return this; }, appendChild(i) { this.children.push(i); return i; },
    replaceChildren(...i) { this.children = i; }, setAttribute() {}, click() {} };
}
const indicator = element('span'); indicator.id = 'ruta-persistence-state';
global.document = { getElementById: id => id === 'ruta-persistence-state' ? indicator : element(), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
global.crypto = global.crypto || require('node:crypto').webcrypto;

let requests = [];
let release = null;
global.fetch = async (route, options) => {
  requests.push({ route, body: JSON.parse(options.body) });
  if (route === '/api/profile/save' && release) await new Promise(r => { release.push(r); });
  return { ok: true, json: async () => ({ saved: true, revision: requests.length + 1 }) };
};

const policy = require('../app.js');
const store = { goals: [{ id: 'g1', profile_id: 'p', goal: 'Meta', nodes: [], coverage: [], learner: {}, lessons: {}, reviews: [], events: [], session: { mode: 'TEACH', stack: [] }, mark: 0 }], active: 'g1' };
policy.setStoreForTests(store);
policy.setProfileForTests({ profile_id: 'p', name: 'Prueba', preferences: {} }, 1);

(async () => {
  // Guardados seguidos se agrupan y el último estado es el que llega al disco.
  const jobs = [];
  for (let i = 1; i <= 6; i += 1) { store.goals[0].mark = i; jobs.push(policy.save()); }
  assert.ok(jobs.every(j => j === jobs[0]), 'las llamadas del mismo tick comparten un solo guardado');
  await jobs[0];
  assert.equal(requests.filter(r => r.route === '/api/profile/save').length, 1);
  assert.equal(requests[0].body.store.goals[0].mark, 6);

  // Con un guardado en vuelo, los cambios siguientes se agrupan en UN guardado posterior con el último estado.
  requests = []; release = [];
  const first = policy.save();
  await new Promise(r => setImmediate(r));
  assert.equal(requests.length, 1);
  store.goals[0].mark = 7; const a = policy.save();
  store.goals[0].mark = 8; const b = policy.save();
  assert.equal(a, b);
  release.shift()();
  await first;
  await new Promise(r => setImmediate(r));
  release.shift()();
  await b;
  const saves = requests.filter(r => r.route === '/api/profile/save');
  assert.equal(saves.length, 2, 'dos llamadas pendientes = un solo guardado adicional');
  assert.equal(saves[1].body.store.goals[0].mark, 8);
  assert.equal(saves[1].body.expected_revision, 2, 'cada guardado usa la revisión del anterior');
  release = null;

  // Etiquetas: nada interno llega a pantalla.
  for (const k of ['UNKNOWN', 'PARTIALLY_UNDERSTOOD', 'EXPLAIN', 'CHECK', 'GUIDED_PRACTICE', 'INDEPENDENT_PRACTICE', 'MASTERED']) {
    assert.doesNotMatch(policy.humanLabel(k), /^[A-Z_]+$/, k + ' debe traducirse');
  }
  assert.equal(policy.coverageLabel('UNKNOWN'), 'sin datos');
  assert.equal(policy.humanLabel('algo_nuevo'), 'algo_nuevo', 'lo desconocido no se pierde');

  // Profundidad: cuatro niveles; el valor por defecto de la UI no es un valor inventado.
  assert.deepEqual(policy.DEPTH_OPTIONS.map(o => o[0]), ['curiosidad', 'solido', 'profesional', 'experto']);
  assert.ok(policy.RESTORABLE_PAGES.has('session') && !policy.RESTORABLE_PAGES.has('profiles'));

  // Cableado del cliente (las vistas no se pueden montar sin navegador).
  const src = fs.readFileSync(__dirname + '/../app.js', 'utf8');
  assert.ok(src.includes("api('/api/hint'"), 'la pista guiada viene del servidor');
  assert.ok(!src.includes('Piensa qué dato falta para decidir'), 'la pista ya no copia el «error habitual»');
  assert.ok(src.includes("api('/api/content/report'") && src.includes('reportButton(b,goal,n.id,'), '«Esto está mal» está en la lección y en la pregunta');
  assert.ok(src.includes("depth:depthValue") && src.includes("depth:goal.depth||'experto'"), 'la profundidad viaja al crear y al abrir áreas');
  const boot = src.slice(src.indexOf('async function bootstrap'));
  assert.ok(boot.indexOf("getItem('ruta.page.'+selected)") < boot.indexOf('await selectProfile(selected)'), 'la pantalla guardada se lee ANTES de que selectProfile la sobrescriba con su render');
  console.log('OK: contenido confiable en el cliente (guardados agrupados, etiquetas, profundidad, cableado).');
})();
