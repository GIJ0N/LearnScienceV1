// faded_examples_v1 (cliente): se ofrece solo en modo initial/scaffold, falla en silencio y nunca crea EVIDENCE.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute() {}, prepend() {} }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');

let calls = [], fadedResponse = null, fadedError = null;
const blankItem = (id, n) => ({ schema_version: 'faded_examples_v1', item_id: id, node_id: 'a', prompt: `¿Qué paso falta ${n}?`, options: [{ id: 'a', text: 'Calcular la masa total' }, { id: 'b', text: 'Dividir el área entre el tiempo' }, { id: 'c', text: 'Restar la densidad' }] });
const goodPackage = () => ({ schema_version: 'faded_examples_v1', worked: { prompt: 'Problema resuelto 120 g sobre 2 m²', steps: ['Paso uno', 'Paso dos', 'Paso tres'] },
  faded: { prompt: 'Problema con huecos 300 g sobre 5 m²', steps: [{ text: 'Dato uno' }, { blank: true, check: blankItem('fade-1', 1) }, { text: 'Dato tres' }] } });
global.fetch = async (route, options) => {
  const body = JSON.parse(options.body);
  calls.push({ route, body });
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  if (route === '/api/lesson/faded') {
    if (fadedError) return { ok: false, json: async () => ({ error: fadedError }) };
    return { ok: true, json: async () => fadedResponse };
  }
  if (route === '/api/lesson/faded/answer') return { ok: true, json: async () => ({ schema_version: 'faded_examples_v1', status: body.selected_option_id === 'a' ? 'CORRECT' : body.selected_option_id ? 'MISCONCEPTION' : 'UNKNOWN', item_id: body.item_id, node_id: 'a', explanation: 'Porque conserva la masa.', error_type: 'none' }) };
  throw Error('Ruta inesperada ' + route);
};

const node = { id: 'a', name: 'Masa por área', level: 0, prerequisites: [], outcome: 'Resolver', probe: { prompt: 'Explica', kind: 'explanation' } };
const stepItem = n => ({ schema_version: 'step_lessons_v1', item_id: 'step-' + n, node_id: 'a', prompt: '¿Cuál?', options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }] });
function goal(mode, extra = {}) {
  const steps = [1, 2].map(n => ({ step_id: 'step-' + n, predict: { prompt: 'Predice ' + n }, resolution: 'Resolución ' + n, body: 'Cuerpo ' + n, check: stepItem(n) }));
  return {
    id: 'g', profile_id: 'profile-test', goal: 'Pintura', nodes: [node], learner: {}, reviews: [], events: [],
    coverage: [{ id: 'a', name: 'a', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] }],
    lessons: { a: { explanation: 'Explicación', example: 'Ejemplo', common_error: 'Error', check: { prompt: 'c', reference: 'r', kind: 'explanation' }, guided: { prompt: 'g', reference: 'r', kind: 'application' }, independent: { prompt: 'i', reference: 'r', kind: 'application' }, integration: { prompt: 'n', reference: 'r', kind: 'context_case' }, adaptation_mode: mode, steps, ...extra } },
    session: { mode: 'TEACH', node: 'a', stack: [], tries: 0, hints: 0 },
  };
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
const find = (label, root = roots.app) => { if (root && root.textContent === label) return root; for (const c of (root && root.children) || []) { const f = find(label, c); if (f) return f; } return null; };
const has = (needle, root = roots.app) => { if (root && String(root.textContent || '').includes(needle)) return true; return ((root && root.children) || []).some(c => has(needle, c)); };
async function openDone(g) { await p.session(); g.session.step.stage = 'done'; g.session.step.index = g.lessons.a.steps.length; roots.app.children = []; await p.session(); }
const evidenceCount = g => g.events.filter(e => e.type === 'EVIDENCE').length;

(async () => {
  // Modos que nunca piden el ejemplo: consolidate y repair (y lecciones legacy sin modo).
  for (const mode of ['consolidate', 'repair', undefined]) {
    const g = attach(goal(mode)); calls = []; fadedResponse = goodPackage(); fadedError = null;
    assert.equal(p.fadedAllowed(g.lessons.a), false, String(mode));
    await openDone(g);
    assert.equal(calls.filter(c => c.route === '/api/lesson/faded').length, 0, 'no se pide en modo ' + mode);
    assert.ok(has('Terminamos las ideas de este tema'));
    assert.ok(find('Ahora lo intento'));
  }

  // Fallo de la ruta: la lección continúa como hoy, sin aviso de error y sin reintentos en bucle.
  for (const failure of [Error('x'), 'La práctica no cumplió el contrato']) {
    const g = attach(goal('initial')); calls = []; fadedResponse = goodPackage(); fadedError = typeof failure === 'string' ? failure : 'El servidor falló'; roots.status.textContent = '';
    await openDone(g);
    assert.equal(g.lessons.a.faded, null);
    assert.equal(calls.filter(c => c.route === '/api/lesson/faded').length, 1);
    assert.ok(has('Terminamos las ideas de este tema'), 'la lección continúa');
    assert.ok(find('Ahora lo intento'));
    assert.ok(!has('No pude'), 'sin aviso de error');
    roots.app.children = []; await p.session();
    assert.equal(calls.filter(c => c.route === '/api/lesson/faded').length, 1, 'no se vuelve a pedir');
  }
  // Paquete inválido: se descarta en silencio.
  { const g = attach(goal('scaffold')); fadedError = null; fadedResponse = { schema_version: 'faded_examples_v1', worked: { prompt: 'a', steps: ['x'] }, faded: { prompt: 'b', steps: [] } };
    await openDone(g); assert.equal(g.lessons.a.faded, null); assert.ok(find('Ahora lo intento')); }

  // Camino feliz en initial y scaffold: ejemplo resuelto, hueco como pregunta, y ningún EVIDENCE nuevo.
  for (const mode of ['initial', 'scaffold']) {
    const g = attach(goal(mode)); calls = []; fadedError = null; fadedResponse = goodPackage();
    const before = evidenceCount(g);
    await openDone(g);
    assert.equal(p.fadedAllowed(g.lessons.a), true);
    assert.ok(has('Un ejemplo resuelto') && has('Problema resuelto') && has('Problema con huecos'));
    assert.ok(find('Saltar ejemplo'), 'saltar siempre visible');
    assert.ok(has('¿Qué paso falta 1?'));
    assert.equal(g.events.filter(e => e.type === 'TEACHING_EXPOSURE').length, 1, 'ver el ejemplo es exposición');
    // Responder el hueco.
    const item = g.lessons.a.faded.faded.steps[1].check;
    const ok = p.applyFadedStep(g, 'a', item, { status: 'CORRECT', item_id: item.item_id, node_id: 'a' }, 'att-f1', 'a', 90);
    assert.equal(ok, true);
    const fs = g.events.filter(e => e.type === 'FADED_STEP');
    assert.equal(fs.length, 1);
    assert.deepEqual(Object.keys(fs[0]).sort(), ['at', 'attempt_id', 'item_id', 'learner_confidence', 'node_id', 'policy_version', 'status', 'type']);
    assert.equal(fs[0].learner_confidence, 90);
    assert.equal(p.applyFadedStep(g, 'a', item, { status: 'CORRECT', item_id: item.item_id, node_id: 'a' }, 'att-f1', 'a', 90), false, 'idempotente');
    assert.throws(() => p.applyFadedStep(g, 'a', item, { status: 'CORRECT', item_id: 'otro', node_id: 'a' }, 'att-f2', 'a', 90), e => e.code === 'INVALID_FADED_RESULT');
    // Sin evidencia, cobertura ni calendario.
    assert.equal(evidenceCount(g), before);
    assert.ok(g.coverage[0].dimensions.every(d => d.evidence.length === 0));
    assert.equal(g.reviews.length, 0);
    assert.equal(p.verified(g, 'a'), false);
    // Tras el último hueco aparece «Continuar»; luego se sigue a la comprobación sin pedir de nuevo.
    roots.app.children = []; await p.session();
    assert.ok(has('Completaste el ejemplo con huecos'));
    find('Continuar').onclick(); roots.app.children = []; await p.session();
    assert.equal(g.lessons.a.faded_done, true);
    assert.ok(find('Ahora lo intento'));
    assert.equal(calls.filter(c => c.route === '/api/lesson/faded').length, 1);
  }

  // Saltar ejemplo: sigue la lección y no vuelve a ofrecerse.
  { const g = attach(goal('initial')); fadedError = null; fadedResponse = goodPackage(); await openDone(g);
    find('Saltar ejemplo').onclick(); roots.app.children = []; await p.session();
    assert.equal(g.lessons.a.faded_skipped, true); assert.ok(find('Ahora lo intento')); assert.ok(!has('Un ejemplo resuelto')); assert.equal(evidenceCount(g), 0); }

  // T3 (fase 5): también tras la explicación completa. El botón «Ahora lo intento» lleva primero al ejemplo con huecos.
  const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
  const openFull = async g => { g.lessons.a.steps_skipped = true; roots.app.children = []; await settle(); await p.session(); };
  const faded = () => calls.filter(c => c.route === '/api/lesson/faded').length;
  for (const mode of ['initial', 'scaffold']) {
    const g = attach(goal(mode)); calls = []; fadedResponse = goodPackage(); fadedError = null;
    await openFull(g);
    assert.ok(has('Una idea a la vez'), 'explicación completa'); assert.equal(faded(), 0, 'no se pide antes de pulsar');
    find('Ahora lo intento').onclick(); await settle(); roots.app.children = []; await p.session();
    assert.equal(faded(), 1, 'se pide el ejemplo antes de la comprobación (' + mode + ')');
    assert.equal(g.session.mode, 'TEACH', 'aún no pasa a la comprobación');
    assert.ok(has('Un ejemplo resuelto') && has('Problema con huecos')); assert.ok(find('Saltar ejemplo'), 'saltar siempre visible');
    assert.equal(evidenceCount(g), 0, 'formativo: sin EVIDENCE');
    // Saltar lleva a la comprobación y no vuelve a ofrecerse.
    find('Saltar ejemplo').onclick(); await settle(); roots.app.children = []; await p.session(); await settle();
    assert.equal(g.session.mode, 'COMPREHENSION'); assert.equal(g.lessons.a.faded_skipped, true); assert.equal(faded(), 1);
    assert.equal(g.lessons.a.faded_requested, false);
  }
  { // Terminar los huecos y pulsar «Continuar» también lleva a la comprobación.
    const g = attach(goal('initial')); calls = []; fadedResponse = goodPackage(); fadedError = null;
    await openFull(g); find('Ahora lo intento').onclick(); await settle(); roots.app.children = []; await p.session();
    const item = g.lessons.a.faded.faded.steps[1].check;
    p.applyFadedStep(g, 'a', item, { status: 'CORRECT', item_id: item.item_id, node_id: 'a' }, 'att-t3', 'a', 70);
    roots.app.children = []; await p.session(); assert.ok(has('Completaste el ejemplo con huecos'));
    find('Continuar').onclick(); await settle(); roots.app.children = []; await p.session(); await settle();
    assert.equal(g.lessons.a.faded_done, true); assert.equal(g.session.mode, 'COMPREHENSION'); assert.equal(faded(), 1);
    assert.equal(evidenceCount(g), 0); assert.equal(p.verified(g, 'a'), false);
  }
  for (const mode of ['consolidate', 'repair', undefined]) {
    const g = attach(goal(mode)); calls = []; fadedResponse = goodPackage(); fadedError = null;
    await openFull(g); find('Ahora lo intento').onclick(); await settle(); roots.app.children = []; await p.session(); await settle();
    assert.equal(faded(), 0, 'no se pide en modo ' + mode); assert.equal(g.session.mode, 'COMPREHENSION');
  }
  { // Ya mostrado tras la lección por pasos (hecho, saltado o visto): no se repite.
    for (const flag of ['faded_done', 'faded_skipped', 'faded_exposed']) {
      const g = attach(goal('initial')); calls = []; fadedResponse = goodPackage(); fadedError = null; g.lessons.a[flag] = true; g.lessons.a.faded = goodPackage();
      await openFull(g); find('Ahora lo intento').onclick(); await settle(); roots.app.children = []; await p.session(); await settle();
      assert.equal(faded(), 0, 'no se repite con ' + flag); assert.equal(g.session.mode, 'COMPREHENSION');
    }
  }
  for (const failure of ['El servidor falló', 'No cumplió el contrato']) { // Fallo de la ruta: se continúa sin aviso de error.
    const g = attach(goal('initial')); calls = []; fadedResponse = goodPackage(); fadedError = failure; roots.status.textContent = '';
    await openFull(g); find('Ahora lo intento').onclick(); await settle(); roots.app.children = []; await p.session(); await settle(40);
    assert.equal(g.lessons.a.faded, null); assert.equal(faded(), 1, 'un solo intento');
    assert.equal(g.session.mode, 'COMPREHENSION', 'pasa a la comprobación'); assert.ok(!has('No pude'));
  }
  { // Paquete inválido: se descarta y se continúa.
    const g = attach(goal('scaffold')); calls = []; fadedError = null; fadedResponse = { schema_version: 'faded_examples_v1', worked: { prompt: 'a', steps: ['x'] }, faded: { prompt: 'b', steps: [] } };
    await openFull(g); find('Ahora lo intento').onclick(); await settle(); roots.app.children = []; await p.session(); await settle(40);
    assert.equal(g.lessons.a.faded, null); assert.equal(g.session.mode, 'COMPREHENSION');
  }
  console.log('faded_examples: OK');
})().catch(e => { console.error(e); process.exit(1); });
