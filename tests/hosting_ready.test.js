// hosting_ready_v1: pantalla de inicio de sesión, «Cerrar sesión» solo con auth, panel «Recordatorios» y aviso al abrir.
// DOM simulado y fetch controlado: no hay servidor, red ni navegador. El servidor se prueba en tests/hosting_ready.test.py.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

function element(tag = 'div') {
  const e = { tag, type: tag, textContent: '', value: '', checked: false, children: [], attrs: {}, listeners: {}, style: { setProperty() {} }, className: '', disabled: false,
    append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, prepend() {}, click() { this.clicked = true; }, select() { this.selected = true; },
    addEventListener(name, fn) { this.listeners[name] = fn; } };
  return e;
}

// ---------------------------------------------------------------- 1. pantalla de inicio de sesión (script real del servidor)
const loginHtml = execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', 'import sys;sys.path.insert(0,sys.argv[1]);import hosting;sys.stdout.buffer.write(hosting.LOGIN_HTML.encode())', ROOT]).toString('utf8');
const loginScript = loginHtml.match(/<script>([\s\S]*)<\/script>/)[1];

async function runLogin(responder) {
  const ids = { 'login-form': element('form'), 'login-password': element('input'), 'login-message': element('p'), 'login-go': element('button') };
  const calls = []; let reloaded = 0;
  const sandbox = { document: { getElementById: id => ids[id], documentElement: { dataset: {} } }, localStorage: { getItem: () => 'dark' },
    fetch: async (route, opts) => { calls.push({ route, opts }); return responder(route, opts); }, location: { reload() { reloaded++; } } };
  new Function('document', 'localStorage', 'fetch', 'location', loginScript)(sandbox.document, sandbox.localStorage, sandbox.fetch, sandbox.location);
  ids['login-password'].value = 'mi-contraseña-larga';
  let prevented = false;
  await ids['login-form'].listeners.submit({ preventDefault() { prevented = true; } });
  return { ids, calls, reloaded, prevented, theme: sandbox.document.documentElement.dataset.theme };
}

const rest = { ok: (body = {}) => ({ ok: true, status: 200, json: async () => body }), no: (status, body) => ({ ok: false, status, json: async () => body }) };

(async () => {
  // estructura móvil/tema
  assert.match(loginHtml, /name="viewport" content="width=device-width,initial-scale=1"/);
  assert.match(loginHtml, /<input id="login-password"[^>]*type="password"[^>]*autocomplete="current-password"/);
  assert.match(loginHtml, /prefers-color-scheme:dark/);
  assert.match(loginHtml, /\[data-theme="dark"\]/, 'respeta el tema guardado por la app');
  assert.match(loginHtml, /max-width:420px/, 'cabe en 390 px');
  assert.match(loginHtml, /min-height:48px/, 'botón táctil');
  assert.doesNotMatch(loginHtml, /innerHTML/);

  let r = await runLogin(() => rest.ok({ ok: true }));
  assert.equal(r.prevented, true);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].route, '/api/login');
  assert.equal(r.calls[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(r.calls[0].opts.body), { password: 'mi-contraseña-larga' });
  assert.equal(r.reloaded, 1, 'con éxito recarga para entrar a la app');
  assert.equal(r.ids['login-password'].value, '', 'no deja la contraseña en el campo');
  assert.equal(r.theme, 'dark');
  assert.equal(r.ids['login-go'].disabled, false);

  r = await runLogin(() => rest.no(401, { error: 'No se pudo iniciar sesión.' }));
  assert.equal(r.reloaded, 0);
  assert.equal(r.ids['login-message'].textContent, 'No se pudo iniciar sesión.');
  assert.equal(r.ids['login-go'].disabled, false, 'se puede reintentar');
  r = await runLogin(() => rest.no(429, { error: 'Demasiados intentos; espera un momento.' }));
  assert.equal(r.ids['login-message'].textContent, 'Demasiados intentos; espera un momento.');
  r = await runLogin(() => { throw new TypeError('fallo de red'); });
  assert.equal(r.ids['login-message'].textContent, 'No se pudo contactar al servidor.');
  assert.equal(r.reloaded, 0);

  // ---------------------------------------------------------------- 2. app
  const roots = { app: element(), status: element() };
  global.document = { getElementById: id => roots[id], createElement: element };
  global.localStorage = { getItem: () => null, setItem: () => {} };
  global.confirm = () => true;
  global.location = { origin: 'http://100.101.102.103:8765', reloads: 0, reload() { this.reloads++; } };
  const fetchLog = []; let authBody = { auth: 'off', logged_in: true }, authOk = true;
  let reminderGet = { configured: false, has_link: false, settings: null };
  const TOKEN = 'T0KENDEPRUEBAxxxxxxxxxxxxxxxxxxxxxxxx';
  global.fetch = async (route, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    fetchLog.push({ route, body });
    if (route === '/api/auth/status') return authOk ? rest.ok(authBody) : rest.no(500, {});
    if (route === '/api/profile/save') return rest.ok({ ok: true, revision: 2 });
    if (route === '/api/logout') return rest.ok({ ok: true });
    if (route === '/api/reminders/get') return rest.ok(reminderGet);
    if (route === '/api/reminders/save') return rest.ok({ has_link: true, link_path: '/calendar/' + TOKEN + '.ics', settings: { enabled: true, hour: 20, minute: 0, days: body.days, hide_goal_name: body.hide_goal_name, timezone: body.timezone } });
    if (route === '/api/reminders/regenerate') return rest.ok({ has_link: true, link_path: '/calendar/NUEVO' + TOKEN + '.ics', settings: { enabled: true, hour: 20, minute: 0, days: [0, 1, 2, 3, 4, 5, 6], hide_goal_name: false, timezone: '' } });
    if (route === '/api/reminders/disable') return rest.ok({ has_link: false, settings: { enabled: false, hour: 20, minute: 0, days: [0, 1, 2, 3, 4, 5, 6], hide_goal_name: false } });
    if (route === '/api/needs-login') return rest.no(401, { error: 'Inicia sesión para continuar.', login_required: true });
    return rest.no(500, { error: 'sin ruta en la prueba: ' + route });
  };
  console.error = () => {};
  const p = require('../app.js');
  const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
  const walk = (root, fn) => { fn(root); for (const c of (root && root.children) || []) walk(c, fn); };
  const findAll = (pred, root = roots.app) => { const out = []; walk(root, e => { if (pred(e)) out.push(e); }); return out; };
  const buttons = () => findAll(e => e.tag === 'button').map(b => b.textContent);
  const button = text => { const b = findAll(e => e.tag === 'button' && e.textContent === text); assert.equal(b.length, 1, 'un botón «' + text + '»: ' + b.length); return b[0]; };
  const texts = () => findAll(() => true).map(e => e.textContent).filter(Boolean).join(' | ');
  const cls = c => findAll(e => String(e.className || '').split(/\s+/).includes(c));

  const NOW = new Date(2026, 10, 16, 15, 0, 0).getTime(), DAY = 86400000;
  p.setClockForTests(() => NOW);
  const node = id => ({ id, name: 'Tema ' + id, outcome: 'Resultado ' + id, level: 0, prerequisites: [], kind: 'procedure', probe: { prompt: 'Sonda', reference: 'r', kind: 'explanation' } });
  const mkGoal = reviews => ({ id: 'g1', profile_id: 'profile-test', goal: 'Pintura en polvo', nodes: [node('a'), node('b')], learner: {}, reviews, events: [],
    coverage: [], areas: [], session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 } });
  const setup = (goal, extra = {}) => { p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [goal], active: goal.id, ...extra }); };
  const study = (n, at = NOW) => Array.from({ length: n }, (_, i) => ({ type: 'EVIDENCE', evidence_role: 'learning', result: 'CORRECT', attempt_id: 'att' + i + at, activity_id: 'x', node_id: 'a', timestamp: at - i }));

  // loadAuthInfo
  authOk = false; assert.equal(await p.loadAuthInfo(), null); assert.equal(p.authActive(), false, 'si no responde se comporta como off');
  authOk = true; authBody = { auth: 'off', logged_in: true }; await p.loadAuthInfo(); assert.equal(p.authActive(), false);
  authBody = { auth: 'required', logged_in: true }; await p.loadAuthInfo(); assert.equal(p.authActive(), true);

  // «Cerrar sesión» solo con auth activo
  setup(mkGoal([]));
  p.setAuthForTests({ auth: 'off', logged_in: true });
  p.setPageForTests('home'); p.home();
  assert.ok(!buttons().includes('Cerrar sesión'), 'sin auth no hay botón nuevo (la barra queda como antes)');
  p.setAuthForTests(null); p.home();
  assert.ok(!buttons().includes('Cerrar sesión'));
  p.setAuthForTests({ auth: 'required', logged_in: true }); p.home();
  assert.equal(buttons().filter(t => t === 'Cerrar sesión').length, 1);
  global.location.reloads = 0; fetchLog.length = 0;
  button('Cerrar sesión').onclick(); await settle();
  assert.ok(fetchLog.some(c => c.route === '/api/logout'), 'llama a /api/logout');
  assert.equal(global.location.reloads, 1, 'recarga para volver a la pantalla de inicio de sesión');

  // «Cerrar todas las sesiones»: solo con auth, pide confirmación y llama a /api/logout/all
  assert.equal(buttons().filter(t => t === 'Cerrar todas las sesiones').length, 1);
  p.setAuthForTests({ auth: 'off', logged_in: true }); p.home(); assert.ok(!buttons().includes('Cerrar todas las sesiones'));
  p.setAuthForTests({ auth: 'required', logged_in: true }); p.home();
  global.fetch = (orig => async (route, opts) => route === '/api/logout/all' ? (fetchLog.push({ route, body: null }), rest.ok({ ok: true })) : orig(route, opts))(global.fetch);
  global.confirm = () => false; fetchLog.length = 0; global.location.reloads = 0;
  button('Cerrar todas las sesiones').onclick(); await settle();
  assert.ok(!fetchLog.some(c => c.route === '/api/logout/all'), 'si cancelas no se cierra nada');
  global.confirm = () => true;
  button('Cerrar todas las sesiones').onclick(); await settle();
  assert.ok(fetchLog.some(c => c.route === '/api/logout/all'));
  assert.equal(global.location.reloads, 1);

  // la pantalla de perfiles no tiene barra: ahí el botón también aparece solo con auth
  p.setAuthForTests({ auth: 'required', logged_in: true }); roots.app.children = [];
  global.fetch = (orig => async (route, opts) => route === '/api/profiles/list' ? rest.ok({ profiles: [] }) : orig(route, opts))(global.fetch);
  await p.profilesView(); assert.equal(buttons().filter(t => t === 'Cerrar sesión').length, 1);
  p.setAuthForTests(null); roots.app.children = []; await p.profilesView(); assert.ok(!buttons().includes('Cerrar sesión'));
  p.setAuthForTests({ auth: 'required', logged_in: true });

  // 401 por sesión caducada: mensaje claro y recarga
  global.location.reloads = 0;
  p.setAuthForTests({ auth: 'required', logged_in: true });
  const msg = await p.api('/api/needs-login', {}).then(() => null, e => e.message);
  assert.match(msg, /sesión terminó/);
  await new Promise(r => setTimeout(r, 800));
  assert.equal(global.location.reloads, 1, 'recarga para mostrar el inicio de sesión');

  // ---------------------------------------------------------------- 3. recordatorios
  p.setAuthForTests({ auth: 'off', logged_in: true });
  setup(mkGoal([]));
  p.setPageForTests('preferences'); roots.app.children = [];
  fetchLog.length = 0;
  p.preferencesView(); await settle();
  assert.ok(cls('reminders-panel').length === 1, 'panel de recordatorios en Preferencias');
  assert.ok(buttons().includes('Guardar preferencias'), 'las preferencias de antes siguen');
  assert.match(texts(), /PC encendida y Tailscale activo/, 'aviso honesto');
  assert.match(texts(), /no cuenta como estudio ni para la racha/);
  assert.match(texts(), /Recordatorios desactivados\./);
  assert.ok(buttons().includes('Activar recordatorios'));
  assert.ok(!buttons().includes('Regenerar enlace') && !buttons().includes('Desactivar'));
  assert.equal(findAll(e => e.tag === 'input' && e.type === 'checkbox').length, 3 + 7 + 1, 'tres preferencias + siete días + ocultar nombre');

  // activar: payload con hora, días, ocultar nombre y zona; muestra el enlace una vez
  const days = findAll(e => e.tag === 'input' && e.type === 'checkbox').slice(3, 10);
  const hide = findAll(e => e.tag === 'input' && e.type === 'checkbox')[10];
  days[5].checked = false; days[6].checked = false; hide.checked = true;
  fetchLog.length = 0;
  button('Activar recordatorios').onclick(); await settle();
  const save = fetchLog.find(c => c.route === '/api/reminders/save');
  assert.ok(save, 'llama a /api/reminders/save');
  assert.equal(save.body.time, '20:00');
  assert.deepEqual(save.body.days, [0, 1, 2, 3, 4]);
  assert.equal(save.body.hide_goal_name, true);
  assert.equal(save.body.profile_id, 'profile-test');
  assert.equal(typeof save.body.timezone, 'string');
  assert.ok(Number.isInteger(save.body.utc_offset_minutes));
  const link = findAll(e => e.tag === 'input' && e.readOnly)[0];
  assert.equal(link.value, 'http://100.101.102.103:8765/calendar/' + TOKEN + '.ics');
  const webcal = findAll(e => e.tag === 'a' && /webcal/.test(e.href || ''))[0];
  assert.equal(webcal.href, 'webcal://100.101.102.103:8765/calendar/' + TOKEN + '.ics');
  assert.match(texts(), /Ajustes → Calendario → Cuentas/);
  assert.match(texts(), /Recordatorios activos\./);
  assert.ok(buttons().includes('Copiar enlace') && buttons().includes('Descargar .ics') && buttons().includes('Regenerar enlace') && buttons().includes('Desactivar') && buttons().includes('Guardar cambios'));
  assert.ok(texts().indexOf(TOKEN) === -1 || findAll(e => e.textContent && e.textContent.includes(TOKEN)).length === 0, 'el token solo va en el campo de enlace, no en texto visible');

  // por HTTPS solo se ofrece https:// (webcal:// podría degradar a http)
  const httpsPath = '/calendar/' + TOKEN + '.ics';
  assert.deepEqual(p.reminderUrls(httpsPath), { url: 'http://100.101.102.103:8765' + httpsPath, webcal: 'webcal://100.101.102.103:8765' + httpsPath });
  global.location.origin = 'https://tutor.ejemplo.com';
  assert.deepEqual(p.reminderUrls(httpsPath), { url: 'https://tutor.ejemplo.com' + httpsPath, webcal: null });
  p.setAuthForTests({ auth: 'required', logged_in: true });
  reminderLinkSet: {
    roots.app.children = []; p.preferencesView(); await settle();
    button('Activar recordatorios').onclick(); await settle();
    assert.equal(findAll(e => e.tag === 'input' && e.readOnly)[0].value, 'https://tutor.ejemplo.com' + httpsPath);
    assert.equal(findAll(e => e.tag === 'a' && /webcal/.test(e.href || '')).length, 0, 'sin webcal con HTTPS');
    assert.ok(!buttons().includes('Suscribirme (webcal)'));
    assert.match(texts(), /copia el enlace y ve a Ajustes → Calendario/);
  }
  global.location.origin = 'http://100.101.102.103:8765';
  p.setAuthForTests({ auth: 'off', logged_in: true });
  roots.app.children = []; p.preferencesView(); await settle();
  button('Activar recordatorios').onclick(); await settle();

  // descargar: crea un enlace con download y lo pulsa
  button('Descargar .ics').onclick();

  // regenerar con confirmación: nuevo enlace
  fetchLog.length = 0;
  button('Regenerar enlace').onclick(); await settle();
  assert.ok(fetchLog.some(c => c.route === '/api/reminders/regenerate'));
  assert.match(findAll(e => e.tag === 'input' && e.readOnly)[0].value, /NUEVO/);
  const askedOnce = { n: 0 }; global.confirm = () => { askedOnce.n++; return false; };
  fetchLog.length = 0; button('Regenerar enlace').onclick(); await settle();
  assert.equal(askedOnce.n, 1); assert.ok(!fetchLog.some(c => c.route === '/api/reminders/regenerate'), 'si cancelas no se revoca nada');
  global.confirm = () => true;

  // desactivar
  fetchLog.length = 0; button('Desactivar').onclick(); await settle();
  assert.ok(fetchLog.some(c => c.route === '/api/reminders/disable'));
  assert.match(texts(), /Recordatorios desactivados\./);
  assert.equal(findAll(e => e.tag === 'input' && e.readOnly).length, 0, 'el enlace desaparece');

  // enlace ya activo pero no visible (recarga): no se vuelve a mostrar
  reminderGet = { configured: true, has_link: true, settings: { enabled: true, hour: 7, minute: 5, days: [0, 2], hide_goal_name: true, timezone: '' } };
  p.setAuthForTests({ auth: 'off', logged_in: true }); // limpia el enlace recordado
  roots.app.children = []; p.preferencesView(); await settle();
  assert.match(texts(), /no se vuelve a mostrar/);
  assert.equal(findAll(e => e.tag === 'input' && e.readOnly).length, 0);
  const boxes = findAll(e => e.tag === 'input' && e.type === 'checkbox');
  assert.deepEqual(boxes.slice(3, 10).map(b => b.checked), [true, false, true, false, false, false, false], 'refleja los días guardados');
  assert.equal(boxes[10].checked, true);
  assert.equal(findAll(e => e.tag === 'input' && e.type === 'time')[0].value, '07:05');
  reminderGet = { configured: false, has_link: false, settings: null };

  // ---------------------------------------------------------------- 4. aviso al abrir
  const due = [{ id: 'a', due: NOW - DAY, step: 0, history: [] }, { id: 'b', due: NOW - 1000, step: 0, history: [] }];
  setup(mkGoal(due)); p.setAuthForTests(null);
  p.setPageForTests('home');
  assert.deepEqual(p.reminderNoticeInfo(NOW), { due: 2 });
  roots.app.children = []; p.home();
  assert.equal(cls('reminder-notice').length, 1, 'aviso discreto, no bloqueante: una barra, el resto de la página sigue');
  assert.match(cls('reminder-notice')[0].children[0].textContent, /2 repasos vencidos y hoy aún no has estudiado/);
  assert.ok(buttons().includes('Metas') && buttons().includes('Empezar ruta'), 'la página sigue completa');
  button('Ahora no').onclick();
  assert.equal(p.reminderNoticeInfo(NOW), null, 'se puede descartar');
  p.setAuthForTests(null);
  // ya estudió hoy
  setup(Object.assign(mkGoal(due), { events: study(3) })); p.setPageForTests('home');
  assert.equal(p.reminderNoticeInfo(NOW), null);
  roots.app.children = []; p.home(); assert.equal(cls('reminder-notice').length, 0);
  // estudió ayer: sí avisa
  setup(Object.assign(mkGoal(due), { events: study(3, NOW - DAY) })); p.setPageForTests('home');
  assert.deepEqual(p.reminderNoticeInfo(NOW), { due: 2 });
  // sin repasos vencidos, o repaso futuro
  setup(mkGoal([])); p.setPageForTests('home'); assert.equal(p.reminderNoticeInfo(NOW), null);
  setup(mkGoal([{ id: 'a', due: NOW + 2 * DAY, step: 0, history: [] }])); p.setPageForTests('home'); assert.equal(p.reminderNoticeInfo(NOW), null);
  // no aparece durante una sesión de estudio
  setup(mkGoal(due)); p.setPageForTests('session'); assert.equal(p.reminderNoticeInfo(NOW), null);
  // el aviso no es evidencia: mostrarlo no cambia las respuestas de estudio de hoy
  setup(mkGoal(due)); p.setPageForTests('home');
  const events = () => JSON.stringify(p.getStoreForTests().goals[0].events);
  const evBefore = events(); roots.app.children = []; p.home(); assert.equal(events(), evBefore);

  // ---------------------------------------------------------------- 5. CSS de las clases nuevas
  for (const c of ['.reminder-notice', '.reminders-panel', '.reminder-days', '.reminder-link']) assert.ok(p.VISUAL_CSS.includes(c), 'falta estilo ' + c);
  console.log('OK hosting_ready.test.js');
})().catch(e => { console.error = console.log; console.error(e); process.exit(1); });
