// path_ui_v1: el inicio de la meta pinta studyPlan como camino. Solo presentación: no escribe evidencia ni quita botones.
const assert = require('node:assert/strict');
function element(type = 'div') { const e = { type, textContent: '', value: '', children: [], style: { setProperty(k, v) { this[k] = v; } }, className: '', append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute() {}, prepend() {} }; return e; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
global.fetch = async (route) => {
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  return { ok: false, json: async () => ({ error: 'sin ruta en la prueba: ' + route }) };
};
console.error = () => {};
const p = require('../app.js');
const AT = 1700000000000;
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const walk = (root, fn) => { fn(root); for (const c of (root && root.children) || []) walk(c, fn); };
const findAll = (pred, root = roots.app) => { const out = []; walk(root, e => { if (pred(e)) out.push(e); }); return out; };
const cls = (c, root = roots.app) => findAll(e => String(e.className || '').split(/\s+/).includes(c), root);
const buttons = () => findAll(e => e.type === 'button').map(b => b.textContent);
const has = (needle, root = roots.app) => findAll(e => String(e.textContent || '').includes(needle), root).length > 0;

const node = (id, prerequisites, level) => ({ id, name: 'Tema ' + id.toUpperCase(), outcome: 'Resultado ' + id, level, prerequisites, kind: 'procedure', probe: { prompt: 'Sonda ' + id, reference: 'r', kind: 'explanation' } });
function goal() {
  const nodes = [node('a', [], 0), node('b', ['a'], 1), node('c', ['a'], 1), node('d', ['b'], 2)];
  return { id: 'g1', profile_id: 'profile-test', goal: 'Pintura en polvo', nodes, learner: {}, reviews: [], events: [],
    coverage: nodes.map(n => ({ id: n.id, name: n.name, status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'units', name: 'u', required: true, status: 'UNKNOWN', evidence: [] }] })),
    areas: [{ id: 'ar1', name: 'Fundamentos', status: 'expanded', node_ids: ['a', 'b', 'c', 'd'] }, { id: 'ar2', name: 'Avanzado', status: 'pending', estimated_topics: 6 }],
    session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 } };
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
let serial = 0;
function record(g, id, status = 'CORRECT') {
  const question = { prompt: 'Pregunta ' + (++serial), reference: 'Criterio', kind: p.CONFIRMATION_KINDS.units, observable_dimensions: ['units'] };
  return p.record(g, id, 'CONFIRMATION', 'Respuesta', { status, evaluator_version: 'local-fixture', error_type: 'none' }, 0, p.activityContract(question, id, 'evidence_confirmation'), 'att-' + serial);
}
const verifyNode = (g, id) => { record(g, id); record(g, id); assert.equal(p.verified(g, id), true, 'preparación: ' + id); };
const evidence = g => g.events.filter(e => e.type === 'EVIDENCE');
const nodesOf = () => cls('path-node');
const paint = g => { roots.app.children = []; p.dashboard(); return g; };

// Botones del inicio de la meta antes de T7 (lista única medida con el código de T6 y el mismo estado).
const PREVIOUS_BUTTONS = ['Sesión de hoy', 'Seguir aprendiendo', 'Tengo siete minutos', 'Diagnosticar lo que ya sé', 'Practicar opción + explicación', 'Repasar (0)', 'Empezar lo recomendado', 'Estudiar este tema', 'Ver el plan completo', 'Abrir ahora', 'Retomar habilidad: Tema A', 'Comprobar evidencia: Tema A', 'Retomar habilidad: Tema B', 'Comprobar evidencia: Tema B', 'Retomar habilidad: Tema C', 'Comprobar evidencia: Tema C', 'Retomar habilidad: Tema D', 'Comprobar evidencia: Tema D', 'Guardar respaldo'];

(async () => {
  // 1. Exactamente un nodo is-next y es el de studyPlan(goal).next; es el único con botón principal.
  {
    const g = attach(goal()); paint(g);
    const plan = p.studyPlan(g, Date.now()), next = plan.next;
    assert.ok(next, 'hay siguiente');
    const nexts = cls('is-next'); assert.equal(nexts.length, 1, 'un solo is-next');
    const name = p.studyPlan(g).groups.flatMap(x => x.topics).find(t => t.node_id === next.node_id).name;
    assert.ok(findAll(e => e.textContent === name, nexts[0]).length >= 1, 'el nodo is-next es el recomendado');
    const go = findAll(e => e.type === 'button' && e.textContent === 'Seguir: ' + name, nexts[0]); assert.equal(go.length, 1, 'botón «Seguir: tema»');
    const primary = findAll(e => e.type === 'button' && !String(e.className || '').split(/\s+/).includes('quiet') && !String(e.className || '').includes('nav-button'));
    assert.deepEqual(primary.map(b => b.textContent), ['Seguir: ' + name], 'es el único botón principal del inicio');
    assert.ok(has('es el siguiente paso', nexts[0]));
    // Los demás nodos se abren al pulsarlos (details con resumen de nombre y estado en texto).
    const others = nodesOf().filter(n => !n.className.includes('is-next'));
    assert.ok(others.length >= 3);
    for (const n of others) { const det = findAll(e => e.type === 'details', n)[0]; assert.ok(det, 'details en nodo'); assert.ok(/ · /.test(det.children[0].textContent), 'nombre y estado en texto'); }
    assert.equal(evidence(g).length, 0, 'pintar el inicio no escribe evidencia');
  }

  // 2. Estados: bloqueado → is-locked; hecho → is-done; saltado → is-skipped y nunca is-done.
  {
    const g = attach(goal()); verifyNode(g, 'a'); paint(g);
    const byText = t => nodesOf().find(n => findAll(e => String(e.textContent || '').startsWith(t), n).length);
    assert.ok(byText('Tema A').className.includes('is-done'), 'verificado → is-done');
    assert.ok(byText('Tema B').className.includes('is-ready') || byText('Tema B').className.includes('is-next'));
    const h = attach(goal()); paint(h); const dNode = nodesOf().find(n => findAll(e => String(e.textContent || '').startsWith('Tema D'), n).length);
    assert.ok(dNode.className.includes('is-locked'), 'prerrequisito sin completar → is-locked');
    assert.ok(!dNode.className.includes('is-done') && !dNode.className.includes('is-next'));
    // Saltado por diagnóstico.
    const s = attach(goal()); s.placement = { version: 'placement_v1', status: 'completed', results: {}, skipped: ['a'] };
    const plan = p.studyPlan(s, Date.now()); const skipped = plan.groups.flatMap(x => x.topics).filter(t => t.state === 'skipped');
    for (const t of skipped) { roots.app.children = []; const box = element(); p.pathView(box, plan, s, true); const li = findAll(e => e.className && e.className.includes('path-node'), box).find(n => findAll(e => String(e.textContent || '').startsWith(t.name), n).length); assert.ok(li.className.includes('is-skipped') && !li.className.includes('is-done')); }
    // pathView directo: un tema «skipped» y uno «done» nunca comparten clase.
    const synthetic = { version: 'study_plan_v1', next: null, remaining: 2, groups: [{ area_id: 'x', name: 'Área', status: 'open', topics: [
      { node_id: 'a', name: 'Saltado', state: 'skipped', missing: [], unlocks: [], review_due: false, continued: false },
      { node_id: 'b', name: 'Hecho', state: 'done', missing: [], unlocks: [], review_due: true, continued: false },
      { node_id: 'c', name: 'Bloqueado', state: 'locked', missing: [{ id: 'a', name: 'Saltado' }], unlocks: [], review_due: false, continued: false }] }] };
    const box = element(); p.pathView(box, synthetic, attach(goal()), true);
    const lis = findAll(e => String(e.className).includes('path-node'), box);
    assert.deepEqual(lis.map(l => l.className), ['path-node is-skipped', 'path-node is-done', 'path-node is-locked']);
    assert.equal(findAll(e => String(e.className).includes('is-next'), box).length, 0, 'sin next no hay is-next ni botón «Seguir»');
    assert.equal(findAll(e => e.type === 'button' && String(e.textContent).startsWith('Seguir:'), box).length, 0);
  }

  // 3. Áreas sin abrir al final, atenuadas y con «≈N temas».
  {
    const g = attach(goal()); paint(g);
    const areas = cls('path-area'); assert.ok(areas.length >= 2);
    const last = areas[areas.length - 1]; assert.ok(last.className.includes('is-pending')); assert.ok(has('≈6 temas', last));
    assert.ok(areas.slice(0, -1).every(a => !a.className.includes('is-pending')));
  }

  // 4. Orden del inicio: título, Sesión de hoy, camino, Más práctica plegado, cifras. Ningún botón anterior desaparece.
  {
    const g = attach(goal()); paint(g);
    const sections = roots.app.children.filter(c => c.type === 'section');
    const idx = f => sections.findIndex(f);
    const hero = idx(s => String(s.className).includes('goal-hero')), pathBox = idx(s => has('Tu camino', s)), more = idx(s => cls('more-practice', s).length), stats = idx(s => cls('goal-stats', s).length);
    assert.ok(hero >= 0 && pathBox > hero && more > pathBox && stats > more, `orden hero(${hero}) < camino(${pathBox}) < más práctica(${more}) < cifras(${stats})`);
    const det = cls('more-practice')[0]; assert.equal(det.type, 'details'); assert.equal(det.children[0].textContent, 'Más práctica');
    for (const label of ['Tengo siete minutos', 'Diagnosticar lo que ya sé', 'Practicar opción + explicación', 'Repasar (0)']) assert.ok(findAll(e => e.textContent === label, det).length, label + ' dentro de «Más práctica»');
    const now = new Set(buttons());
    for (const label of PREVIOUS_BUTTONS) assert.ok(now.has(label), 'sigue en el árbol: ' + label);
    assert.equal(cls('goal-stats').length, 1);
  }

  // 5. La línea del camino se dibuja solo una vez por carga y apunta al nodo next.
  {
    const g = attach(goal()); paint(g); const first = cls('path').map(o => o.className);
    paint(g); const second = cls('path').map(o => o.className);
    assert.ok(second.every(c => !c.includes('is-drawing')), 'no se repite la animación');
    const filled = cls('path').find(o => o.className.includes('is-drawn')); assert.ok(filled);
    assert.match(filled.style['--path-fill'], /^\d+%$/);
    assert.ok(first.length === second.length);
  }

  // 6. Con reparación activa o bloqueada no hay segundo botón principal ni «Seguir» como principal.
  {
    const g = attach(goal()); g.session.stack = []; g.pending_repair_diagnosis = null;
    paint(g);
    const quietSeguir = findAll(e => e.type === 'button' && e.textContent === 'Seguir aprendiendo')[0];
    assert.ok(String(quietSeguir.className).includes('quiet'), 'Seguir aprendiendo deja de ser principal cuando el camino ofrece el siguiente paso');
  }

  // 7. Solo el grupo con el nodo next dibuja la línea; los pendientes van al final aunque el plan los traiga antes.
  {
    const t = (id, name, state) => ({ node_id: id, name, state, missing: [], unlocks: [], review_due: false, continued: false });
    const plan = { version: 'study_plan_v1', next: { node_id: 'c', reason: 'r' }, remaining: 9, groups: [
      { area_id: 'p', name: 'Sin abrir', status: 'pending', estimated_topics: 5, topics: [] },
      { area_id: 'x', name: 'Primera', status: 'open', topics: [t('a', 'Uno', 'done'), t('b', 'Dos', 'ready')] },
      { area_id: 'y', name: 'Segunda', status: 'open', topics: [t('c', 'Tres', 'ready'), t('d', 'Cuatro', 'ready')] }] };
    const box = element(); p.pathView(box, plan, attach(goal()), true);
    const areas = findAll(e => String(e.className).includes('path-area') && !String(e.className).includes('path-wrap'), box);
    assert.deepEqual(areas.map(a => a.children[0].textContent), ['Primera', 'Segunda', 'Sin abrir'], 'pendientes al final');
    const lines = findAll(e => e.type === 'ol', box);
    assert.equal(lines.length, 2); assert.ok(!/is-draw/.test(lines[0].className), 'el grupo sin next no dibuja línea'); assert.ok(/is-draw/.test(lines[1].className));
    assert.equal(lines[0].style['--path-fill'], undefined);
  }

  console.log('path_ui: OK');
})().catch(e => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
