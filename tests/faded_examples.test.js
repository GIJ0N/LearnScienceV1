// faded_examples_v1 (cliente, flujo antiguo): se ofrece solo en modo initial/scaffold, falla en silencio y nunca crea EVIDENCE.
// L4b (worked_examples_v1): las lecciones NUEVAS piden /api/lesson/worked (ver tests/worked_examples.test.js). Este archivo cubre las
// lecciones que ya traen `faded` (objeto o null), que siguen el flujo antiguo. Cambio justificado: antes, una lección nueva pedía
// /api/lesson/faded; ahora esa ruta no se llama desde la interfaz para lecciones nuevas (esto lo garantiza el bloque F).
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute() {}, prepend() {} }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');

let calls = [], fadedResponse = null, fadedError = null, workedError = 'sin conjunto en esta prueba';
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
  if (route === '/api/lesson/worked') return { ok: false, json: async () => ({ error: workedError }) };
  if (route === '/api/lesson/faded/answer') return { ok: true, json: async () => ({ schema_version: 'faded_examples_v1', status: body.selected_option_id === 'a' ? 'CORRECT' : body.selected_option_id ? 'MISCONCEPTION' : 'UNKNOWN', item_id: body.item_id, node_id: 'a', explanation: 'Porque conserva la masa.', evaluator_version: 'local-production-v1' }) };
  if (route === '/api/lesson/steps') return { ok: false, json: async () => ({ error: 'sin pasos en esta prueba' }) };
  throw Error('Ruta inesperada ' + route);
};

const node = { id: 'a', name: 'Masa por área', level: 0, prerequisites: [], outcome: 'Resolver', probe: { prompt: 'Explica', kind: 'explanation' } };
const stepItem = n => ({ schema_version: 'step_lessons_v1', item_id: 'step-' + n, node_id: 'a', prompt: '¿Cuál?', options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }] });
function goal(mode, extra = {}) {
  const steps = [1, 2].map(n => ({ step_id: 'step-' + n, predict: { prompt: 'Predice ' + n }, resolution: 'Resolución ' + n, body: 'Cuerpo ' + n, check: stepItem(n) }));
  return {
    id: 'g', profile_id: 'profile-test', goal: 'Pintura', nodes: [node], learner: {}, reviews: [], events: [],
    coverage: [{ id: 'a', name: 'a', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] }],
    lessons: { a: { explanation: 'Explicación', example: 'Ejemplo', common_error: 'Error', check: { prompt: 'c', reference: 'r', kind: 'explanation' }, guided: { prompt: 'g', reference: 'r', kind: 'application' }, independent: { prompt: 'i', reference: 'r', kind: 'application' }, integration: { prompt: 'x', reference: 'r', kind: 'application' }, adaptation_mode: mode, steps, ...extra } },
    session: { mode: 'TEACH', node: 'a', stack: [], tries: 0, hints: 0 },
  };
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
const find = (label, root = roots.app) => { if (root && root.textContent === label) return root; for (const c of (root && root.children) || []) { const f = find(label, c); if (f) return f; } return null; };
const has = (needle, root = roots.app) => { if (root && String(root.textContent || '').includes(needle)) return true; return ((root && root.children) || []).some(c => has(needle, c)); };
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const evidenceCount = g => g.events.filter(e => e.type === 'EVIDENCE').length;
const routeCount = r => calls.filter(c => c.route === r).length;
const openFull = async g => { g.lessons.a.steps_skipped = true; roots.app.children = []; await settle(); await p.session(); };
// Terminar la lección por pasos (estado «done») antes de la comprobación: así aparece «Terminamos las ideas de este tema».
async function openDone(g) { await p.session(); g.session.step.stage = 'done'; g.session.step.index = g.lessons.a.steps.length; roots.app.children = []; await p.session(); }

(async () => {
  // A. Lección con faded (objeto) en initial: el ejemplo con huecos sigue su flujo antiguo, sin pedir nada.
  for (const mode of ['initial', 'scaffold']) {
    const g = attach(goal(mode)); calls = []; fadedError = null; fadedResponse = goodPackage(); workedError = 'no';
    g.lessons.a.faded = goodPackage(); g.lessons.a.created_at = 1; g.lessons.a.worked = undefined;
    assert.equal(p.fadedAllowed(g.lessons.a), true, 'el flujo antiguo sigue vivo para lecciones con faded');
    await openFull(g); find('Ahora lo intento').onclick(); await settle(); roots.app.children = []; await p.session(); await settle();
    assert.equal(routeCount('/api/lesson/faded'), 0, 'no vuelve a pedir: ya estaba guardado (' + mode + ')');
    assert.equal(routeCount('/api/lesson/worked'), 0, 'no mezcla el flujo nuevo');
    assert.ok(has('Un ejemplo resuelto') && has('Problema resuelto') && has('Problema con huecos'));
    assert.ok(find('Saltar ejemplo'), 'saltar siempre visible');
    assert.ok(has('¿Qué paso falta 1?'));
    const item = g.lessons.a.faded.faded.steps[1].check;
    const before = evidenceCount(g);
    assert.equal(p.applyFadedStep(g, 'a', item, { status: 'CORRECT', item_id: item.item_id, node_id: 'a' }, 'att-f1', 'a', 90), true);
    const fs = g.events.filter(e => e.type === 'FADED_STEP');
    assert.equal(fs.length, 1);
    assert.deepEqual(Object.keys(fs[0]).sort(), ['at', 'attempt_id', 'item_id', 'learner_confidence', 'node_id', 'policy_version', 'status', 'type']);
    assert.equal(p.applyFadedStep(g, 'a', item, { status: 'CORRECT', item_id: item.item_id, node_id: 'a' }, 'att-f1', 'a', 90), false, 'idempotente');
    assert.throws(() => p.applyFadedStep(g, 'a', item, { status: 'CORRECT', item_id: 'otro', node_id: 'a' }, 'att-f2', 'a', 90), e => e.code === 'INVALID_FADED_RESULT');
    assert.equal(evidenceCount(g), before, 'sin EVIDENCE');
    assert.equal(g.reviews.length, 0);
    assert.equal(p.verified(g, 'a'), false);
    roots.app.children = []; await p.session();
    assert.ok(has('Completaste el ejemplo con huecos'));
    find('Continuar').onclick(); roots.app.children = []; await p.session(); await settle();
    assert.equal(g.lessons.a.faded_done, true); assert.equal(g.session.mode, 'COMPREHENSION');
  }

  // B. Lección con faded: los modos consolidate, repair y sin modo nunca ofrecen el ejemplo (flujo antiguo intacto).
  for (const mode of ['consolidate', 'repair', undefined]) {
    const g = attach(goal(mode)); calls = []; fadedResponse = goodPackage(); fadedError = null;
    g.lessons.a.faded = goodPackage();     assert.equal(p.fadedAllowed(g.lessons.a), false, String(mode));
    await openDone(g); assert.ok(has('Terminamos las ideas de este tema'));
    assert.ok(find('Ahora lo intento'));
    assert.equal(routeCount('/api/lesson/faded'), 0, 'no se pide en modo ' + mode);
  }

  // C. Lección con faded null (no disponible): nunca se ofrece ejemplo ni se pide.
  { const g = attach(goal('initial')); calls = []; g.lessons.a.faded = null; g.lessons.a.worked = undefined;
    assert.equal(p.fadedAllowed(g.lessons.a), false);
    await openFull(g); find('Ahora lo intento').onclick(); await settle(); roots.app.children = []; await p.session(); await settle();
    assert.equal(routeCount('/api/lesson/faded'), 0); assert.equal(g.session.mode, 'COMPREHENSION'); }

  // D. Saltar ejemplo: sigue la lección y no vuelve a ofrecerse.
  { const g = attach(goal('initial')); calls = []; g.lessons.a.faded = goodPackage();     await openFull(g); find('Ahora lo intento').onclick(); await settle(); roots.app.children = []; await p.session(); await settle();
    find('Saltar ejemplo').onclick(); await settle(); roots.app.children = []; await p.session(); await settle();
    assert.equal(g.lessons.a.faded_skipped, true); assert.equal(g.session.mode, 'COMPREHENSION'); assert.equal(evidenceCount(g), 0); }

  // E. Ya mostrado (hecho, saltado o visto): no se repite.
  for (const flag of ['faded_done', 'faded_skipped', 'faded_exposed']) {
    const g = attach(goal('initial')); calls = []; g.lessons.a[flag] = true; g.lessons.a.faded = goodPackage();     await openFull(g); find('Ahora lo intento').onclick(); await settle(); roots.app.children = []; await p.session(); await settle();
    assert.equal(routeCount('/api/lesson/faded'), 0, 'no se repite con ' + flag); assert.equal(g.session.mode, 'COMPREHENSION');
  }

  // F. Lección nueva (sin faded ni worked): ya no pide /api/lesson/faded; pide /api/lesson/worked una sola vez.
  // Un fallo de esa ruta degrada a worked=null, sin aviso y sin reintento automático. El detalle está en worked_examples.test.js.
  { const g = attach(goal('initial')); calls = []; fadedResponse = goodPackage(); fadedError = null; workedError = 'El conjunto no cumplió el contrato';
    await openFull(g); find('Ahora lo intento').onclick(); await settle(); roots.app.children = []; await p.session(); await settle(40);
    assert.equal(routeCount('/api/lesson/faded'), 0, 'lección nueva: nunca la ruta antigua');
    assert.equal(routeCount('/api/lesson/worked'), 1, 'un solo intento');
    assert.equal(g.lessons.a.worked, null, 'degrada a null');
    assert.equal(g.session.mode, 'COMPREHENSION', 'pasa a la comprobación'); assert.ok(!has('No pude'));
  }

  // G. Lección nueva en consolidate: no se pide ningún ejemplo.
  { const g = attach(goal('consolidate')); calls = []; await openFull(g); find('Ahora lo intento').onclick(); await settle(); roots.app.children = []; await p.session(); await settle(40);
    assert.equal(routeCount('/api/lesson/faded') + routeCount('/api/lesson/worked'), 0, 'consolidate no pide ejemplos'); assert.equal(g.session.mode, 'COMPREHENSION'); }

  console.log('faded_examples: OK');
})().catch(e => { console.error(e); process.exit(1); });
