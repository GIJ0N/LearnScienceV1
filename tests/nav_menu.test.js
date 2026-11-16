// nav_menu_v1: la navegación se pliega en móvil con CSS + una clase. Aquí se comprueba la estructura con DOM simulado;
// el aspecto real (alto de la barra, visibilidad) lo comprueba tests/browser_smoke.test.js.
const assert = require('node:assert/strict');
function element(type = 'div') { const e = { type, textContent: '', value: '', children: [], attrs: {}, style: { setProperty(k, v) { this[k] = v; } }, className: '', append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute(k, v) { this.attrs[k] = String(v); }, prepend() {} }; return e; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const fetchCalls = [];
let failSave = false;
global.fetch = async (route) => {
  fetchCalls.push(route);
  if (route === '/api/profile/save' && failSave) return { ok: false, json: async () => ({ error: 'fallo simulado' }) };
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  return { ok: false, json: async () => ({ error: 'sin ruta en la prueba: ' + route }) };
};
console.error = () => {};
const p = require('../app.js');
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const walk = (root, fn) => { fn(root); for (const c of (root && root.children) || []) walk(c, fn); };
const findAll = (pred, root = roots.app) => { const out = []; walk(root, e => { if (pred(e)) out.push(e); }); return out; };
const cls = (c, root = roots.app) => findAll(e => String(e.className || '').split(/\s+/).includes(c), root);
const button = text => { const b = findAll(e => e.type === 'button' && e.textContent === text); assert.equal(b.length, 1, 'un botón «' + text + '»: ' + b.length); return b[0]; };
const navButtons = () => cls('nav-button').map(b => b.textContent);

const node = id => ({ id, name: 'Tema ' + id, outcome: 'Resultado ' + id, level: 0, prerequisites: [], kind: 'procedure', probe: { prompt: 'Sonda', reference: 'r', kind: 'explanation' } });
const goal = { id: 'g1', profile_id: 'profile-test', goal: 'Pintura en polvo', nodes: [node('a')], learner: {}, reviews: [], events: [],
  coverage: [{ id: 'a', name: 'Tema a', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'units', name: 'u', required: true, status: 'UNKNOWN', evidence: [] }] }],
  areas: [], session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 } };
p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1);
p.setStoreForTests({ goals: [goal], active: goal.id });

(async () => {
  p.home();
  // 1. Todos los botones de navegación de antes siguen, con su texto, dentro de .nav-links.
  const expected = ['Perfiles', 'Metas', 'Aprendizaje', 'Preferencias', 'Plan', 'Ruta y mapa', 'Nivel experto', 'Fuentes', 'Informe'];
  const names = navButtons();
  for (const t of expected) assert.ok(names.includes(t), 'falta «' + t + '»');
  assert.ok(names.some(t => t.startsWith('Tema: ')), 'falta el botón de tema');
  const links = cls('nav-links');
  assert.equal(links.length, 1);
  for (const t of [...expected]) assert.equal(findAll(e => e.type === 'button' && e.textContent === t, links[0]).length, 1, '«' + t + '» dentro de .nav-links');
  assert.ok(findAll(e => e.type === 'button' && e.textContent.startsWith('Tema: '), links[0]).length === 1);

  // 2. «Menú»: cerrado al inicio, con aria-controls hacia el contenedor.
  let menu = button('Menú');
  assert.equal(menu.attrs['aria-expanded'], 'false');
  assert.equal(menu.attrs['aria-controls'], links[0].id);
  assert.ok(String(menu.className).split(/\s+/).includes('nav-toggle'));
  assert.ok(!String(links[0].className).split(/\s+/).includes('is-open'));

  // 3. Abrir: aria-expanded=true y .is-open; no toca la meta ni escribe eventos.
  menu.onclick(); await settle();
  menu = button('Menú');
  assert.equal(menu.attrs['aria-expanded'], 'true');
  assert.ok(String(cls('nav-links')[0].className).split(/\s+/).includes('is-open'));
  for (const t of expected) assert.ok(navButtons().includes(t), 'sigue «' + t + '» abierto');
  // 4. Alternar de nuevo cierra.
  menu.onclick(); await settle();
  assert.equal(button('Menú').attrs['aria-expanded'], 'false');
  assert.ok(!String(cls('nav-links')[0].className).split(/\s+/).includes('is-open'));
  // 5. Abrir y navegar: se cierra.
  button('Menú').onclick(); await settle();
  assert.equal(button('Menú').attrs['aria-expanded'], 'true');
  button('Metas').onclick(); await settle();
  assert.equal(button('Menú').attrs['aria-expanded'], 'false', 'al navegar el menú se cierra');
  assert.ok(!String(cls('nav-links')[0].className).split(/\s+/).includes('is-open'));
  // 6. Cada botón de navegación lleva a su página (la página activa se marca con aria-current) y cierra el menú,
  // también al pulsar el de la página actual (así se prueba el cierre del propio botón, no solo el cambio de página).
  const pages = [['Metas', 'Metas'], ['Metas', 'Metas'], ['Aprendizaje', 'Aprendizaje'], ['Preferencias', 'Preferencias'], ['Plan', 'Plan'], ['Ruta y mapa', 'Ruta y mapa'], ['Nivel experto', 'Nivel experto'], ['Fuentes', 'Fuentes'], ['Informe', 'Informe']];
  for (const [label, current] of pages) {
    button('Menú').onclick(); await settle();
    assert.equal(button('Menú').attrs['aria-expanded'], 'true', 'abierto antes de «' + label + '»');
    button(label).onclick(); await settle();
    assert.equal(button('Menú').attrs['aria-expanded'], 'false', 'tras «' + label + '» el menú se cierra');
    assert.ok(!String(cls('nav-links')[0].className).split(/\s+/).includes('is-open'), 'sin is-open tras «' + label + '»');
    assert.equal(button(current).attrs['aria-current'], 'page', '«' + label + '» lleva a su página');
    assert.equal(findAll(e => e.attrs && e.attrs['aria-current'] === 'page').length, 1, 'una sola página marcada tras «' + label + '»');
  }
  // «Perfiles» vuelve a la lista de perfiles, que no pinta la barra.
  button('Menú').onclick(); await settle(); button('Perfiles').onclick(); await settle();
  assert.equal(cls('nav-links').length, 0, '«Perfiles» lleva a la pantalla de perfiles');
  p.home();
  button('Metas').onclick(); await settle();
  assert.equal(button('Metas').attrs['aria-current'], 'page');
  // 7. Nada escrito: «Metas» puede registrar su propia decisión del tutor (comportamiento previo),
  // pero alternar el menú no modifica la meta, no añade eventos y no guarda.
  assert.equal(goal.events.filter(e => e.type === 'EVIDENCE').length, 0);
  const before = JSON.stringify(goal), eventsBefore = goal.events.length, saves = fetchCalls.length;
  for (let i = 0; i < 4; i++) { button('Menú').onclick(); await settle(); }
  assert.equal(button('Menú').attrs['aria-expanded'], 'false');
  button('Menú').onclick(); await settle();
  assert.equal(button('Menú').attrs['aria-expanded'], 'true');
  assert.equal(JSON.stringify(goal), before, 'la meta no cambia al alternar el menú');
  assert.equal(goal.events.length, eventsBefore);
  assert.equal(fetchCalls.length, saves, 'alternar el menú no guarda nada');
  // 8. «Reintentar guardado» queda en la barra junto a «Menú», nunca dentro de .nav-links (oculto en móvil).
  assert.equal(findAll(e => e.type === 'button' && e.textContent === 'Reintentar guardado').length, 0, 'sin cambios pendientes no aparece');
  failSave = true;
  await p.save().catch(() => {}); await settle();
  p.home(); await settle();
  const retry = button('Reintentar guardado');
  const bar = findAll(e => e.type === 'nav')[0] || roots.app.children.find(c => String(c.className).includes('app-nav'));
  assert.ok(bar, 'existe la barra');
  assert.ok(bar.children.includes(retry), '«Reintentar guardado» es hijo directo de la barra');
  assert.equal(findAll(e => e === retry, cls('nav-links')[0]).length, 0, '«Reintentar guardado» no está dentro de .nav-links');
  assert.ok(String(retry.className).split(/\s+/).includes('nav-retry'));
  console.log('nav_menu.test.js OK');
})().catch(e => { console.error = console.log; console.error(e); process.exit(1); });
