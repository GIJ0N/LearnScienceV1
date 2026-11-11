// motivation_v1: racha y meta diaria. Solo cuenta respuestas de estudio; no toca evidencia, selector, cobertura ni plan.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: { setProperty(k, v) { this[k] = v; } }, className: '', title: '', append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, setAttribute(k, v) { this['@' + k] = v; }, prepend() {} }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
let saves = 0;
global.fetch = async (route) => { if (route === '/api/profile/save') { saves++; return { ok: true, json: async () => ({ ok: true, revision: 2 }) }; } return { ok: false, json: async () => ({ error: 'sin ruta: ' + route }) }; };
console.error = () => {};
const p = require('../app.js');
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const walk = (root, fn) => { fn(root); for (const c of (root && root.children) || []) walk(c, fn); };
const findAll = (pred, root = roots.app) => { const out = []; walk(root, e => { if (pred(e)) out.push(e); }); return out; };
const has = (needle, root = roots.app) => findAll(e => String(e.textContent || '').includes(needle), root).length > 0;
const at = (y, m, d, h = 12) => new Date(y, m, d, h, 0, 0).getTime();
const NOW = at(2026, 10, 11, 14);
let serial = 0;
const ev = (t, extra = {}) => ({ type: 'EVIDENCE', node_id: 'a', evidence_role: 'learning', result: 'CORRECT', status: 'CORRECT', error_type: 'none', timestamp: t, attempt_id: 'e' + (++serial), ...extra });
const day = (offset, n, extra = {}) => Array.from({ length: n }, (_, i) => ev(at(2026, 10, 11 + offset, 8 + i), extra));
const mk = (...lists) => ({ goals: [{ id: 'g1', nodes: [{ id: 'a' }], events: lists.flat() }] });

(async () => {
  const S = (store, t = NOW) => p.streak(store, t, 10);
  // 1. Qué cuenta como respuesta de estudio.
  {
    const d0 = at(2026, 10, 11), d1 = at(2026, 10, 12);
    const events = [ev(NOW), ev(NOW, { result: 'PARTIAL', status: 'PARTIAL' }), ev(NOW, { result: 'UNKNOWN', status: 'UNKNOWN', error_type: 'attention' }),
      ev(NOW, { result: 'UNKNOWN', status: 'UNKNOWN', error_type: 'lack_of_exposure' }), ev(NOW, { audit_only: true }), ev(NOW, { correction_of: 'x' }), ev(NOW, { evidence_role: 'diagnostic' }), ev(NOW, { evidence_role: 'evaluation' }),
      { type: 'TEACHING_EXPOSURE', node_id: 'a', at: NOW }, { type: 'DIRECT_TEACHING', node_id: 'a', at: NOW }, { type: 'STUCK_OFFER', node_id: 'a', at: NOW }, { type: 'PLAN_OVERRIDE', node_id: 'a', at: NOW }, { type: 'CURRICULUM_CONTINUED', node_id: 'a', at: NOW },
      { type: 'DIRECT_CHECK', status: 'CORRECT', at: NOW }, { type: 'DIRECT_CHECK', status: 'UNKNOWN', at: NOW }, { type: 'FADED_STEP', status: 'MISCONCEPTION', at: NOW }, { type: 'FADED_STEP', status: 'UNKNOWN', at: NOW },
      ev(NOW + 5 * 86400000), ev(NaN, {}), { type: 'EVIDENCE', evidence_role: 'learning', result: 'CORRECT' }];
    const store = mk(events);
    // Cuentan: CORRECT, PARTIAL, UNKNOWN incierto (no es «No sé»), DIRECT_CHECK ok, FADED_STEP fallado.
    assert.equal(p.studyAnswers(store, d0, d1), 5);
    assert.equal(p.studyAnswers({ goals: [] }, d0, d1), 0); assert.equal(p.studyAnswers(null, d0, d1), 0);
  }
  // 2. Días y racha.
  assert.equal(S(mk()).current, 0); assert.deepEqual(S(mk()).week, Array(7).fill(false));
  assert.equal(S(mk(day(0, 2))).current, 0, 'dos respuestas no hacen día');
  assert.equal(S(mk(day(0, 3))).current, 1); assert.equal(p.MIN_STUDY_ANSWERS, 3);
  assert.equal(S(mk(day(0, 3), day(-1, 3), day(-2, 3), day(-3, 3), day(-4, 3))).current, 5, 'cinco días seguidos');
  assert.equal(S(mk(day(-1, 3), day(-2, 3), day(-3, 4))).current, 3, 'hoy aún sin estudiar no rompe la racha');
  assert.equal(S(mk(day(-1, 3), day(-3, 3), day(-4, 3))).current, 3, 'hoy abierto no cuenta como segundo hueco');
  // Un hueco en 7 días no la rompe; el hueco no suma.
  assert.equal(S(mk(day(0, 3), day(-1, 3), day(-3, 3), day(-4, 3))).current, 4);
  // Dos huecos a menos de 7 días sí.
  assert.equal(S(mk(day(0, 3), day(-2, 3), day(-4, 3), day(-5, 3))).current, 1, 'segundo hueco a 2 días del primero rompe');
  assert.equal(S(mk(day(0, 3), day(-2, 3), day(-3, 3), day(-4, 3), day(-5, 3))).current, 5, 'un solo hueco en la ventana no rompe');
  // Hueco permitido cada 7 días.
  assert.equal(S(mk(day(0, 3), day(-1, 3), day(-2, 3), day(-3, 3), day(-4, 3), day(-5, 3), day(-7, 3), day(-8, 3))).current, 8, 'un hueco en 8 días no rompe');
  // Racha rota y retomada: simplemente 1.
  assert.equal(S(mk(day(-9, 3), day(-10, 3), day(-11, 3), day(0, 3))).current, 1);
  assert.equal(S(mk(day(-9, 3), day(-10, 3), day(-11, 3), day(0, 3))).best, 3, 'mejor racha recuerda la anterior');
  assert.equal(S(mk(day(-9, 3), day(-10, 3), day(-11, 3))).current, 0, 'rota sin aviso: vuelve a 0, nada más');
  // Semana: 7 booleanos, el último es hoy.
  assert.deepEqual(S(mk(day(0, 3), day(-2, 3))).week, [false, false, false, false, true, false, true]);
  // Cruce de medianoche con la fecha local.
  {
    const late = new Date(2026, 10, 10, 23, 59, 0).getTime(), early = new Date(2026, 10, 11, 0, 1, 0).getTime();
    const store = mk([ev(late - 2000), ev(late - 1000), ev(late), ev(early), ev(early + 1000), ev(early + 2000)]);
    assert.equal(p.streak(store, late + 60000, 10).current, 2, 'dos días locales distintos');
    assert.equal(p.streak(store, late, 10).today, 3); assert.equal(p.streak(store, early, 10).today, 3);
  }
  // Varias metas suman al mismo día.
  { const store = { goals: [{ id: 'g1', events: day(0, 2) }, { id: 'g2', events: day(0, 1) }] }; assert.equal(S(store).current, 1); assert.equal(S(store).today, 3); }
  // La meta diaria y su cumplimiento.
  assert.equal(p.streak(mk(day(0, 4)), NOW, 5).today_done, false); assert.equal(p.streak(mk(day(0, 5)), NOW, 5).today_done, true);
  assert.equal(p.streak(mk(day(0, 3)), NOW, 7).target, 10, 'meta inválida → 10');

  // 3. Meta diaria persistida en store.motivation, sin tocar metas de aprendizaje.
  {
    const goal = { id: 'g1', profile_id: 'profile-test', goal: 'X', nodes: [{ id: 'a', name: 'A', level: 0, prerequisites: [], outcome: 'o', probe: { prompt: 'p', kind: 'explanation' } }], learner: {}, reviews: [], coverage: [], events: [], session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 } };
    p.setProfileForTests({ profile_id: 'profile-test', name: 'S', preferences: {} }, 1); p.setStoreForTests({ goals: [goal], active: 'g1' }); p.setClockForTests?.(() => NOW);
    assert.equal(p.dailyTarget(), 10);
    const before = JSON.stringify(goal);
    for (const bad of [0, 7, 15, 'x', null, undefined, NaN]) assert.equal(p.setDailyTarget(bad), false, 'meta rechazada ' + bad);
    assert.equal(p.setDailyTarget(20), true); assert.equal(p.dailyTarget(), 20);
    assert.equal(JSON.stringify(goal), before, 'cambiar la meta diaria no modifica la meta de aprendizaje');
    assert.equal(goal.events.length, 0, 'sin eventos');
    await settle(); assert.ok(saves > 0, 'se persiste');
    p.setStoreForTests({ goals: [goal], active: 'g1', motivation: { target: 99 } }); assert.equal(p.dailyTarget(), 10, 'valor guardado inválido → 10');
    p.setStoreForTests({ goals: [goal], active: 'g1' });
  }

  // 4. Pantalla: racha en la navegación, anillo, selector y hito una sola vez por día.
  {
    const nodes = [{ id: 'a', name: 'A', level: 0, prerequisites: [], outcome: 'o', probe: { prompt: 'p', kind: 'explanation' } }];
    const goal = { id: 'g1', profile_id: 'profile-test', goal: 'Pintura', nodes, learner: {}, reviews: [], coverage: [{ id: 'a', name: 'A', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] }], events: [], session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 } };
    const realNow = Date.now; Date.now = () => NOW;
    try {
      goal.events.push(...day(-1, 3), ...day(0, 4));
      p.setProfileForTests({ profile_id: 'profile-test', name: 'S', preferences: {} }, 1); p.setStoreForTests({ goals: [goal], active: 'g1', motivation: { target: 5 } });
      p.clearDailyMilestone(); roots.app.children = []; p.dashboard(); await settle();
      assert.ok(has('Racha: 2 días'), 'racha en la navegación');
      const dots = findAll(e => /^streak-dot( |$)/.test(String(e.className))); assert.equal(dots.length, 7);
      assert.equal(dots.filter(d => d.className.includes('is-on')).length, 2);
      const nav = findAll(e => String(e.className) === 'nav-streak')[0]; assert.match(nav['@aria-label'], /Racha: 2 días.*hoy sí/);
      const ring = findAll(e => String(e.className) === 'ring')[0]; assert.equal(ring.style['--p'], '80'); assert.equal(ring['@aria-valuenow'], '4');
      assert.ok(has('4 de 5 respuestas hoy')); assert.ok(!findAll(e => String(e.className).includes('milestone')).length, 'aún sin hito');
      const targets = findAll(e => e.type === 'button' && /^Meta de \d+$/.test(e.textContent)); assert.deepEqual(targets.map(b => b.textContent), ['Meta de 5', 'Meta de 10', 'Meta de 20']);
      assert.ok(targets[0].className.includes('is-selected') && targets[0]['@aria-pressed'] === 'true');
      // Las palabras de la constancia nunca dicen dominio, nivel ni experto.
      const panel = findAll(e => String(e.className).includes('daily-goal'))[0], text = []; walk(panel, e => text.push(e.textContent || ''));
      assert.ok(!/dominio|nivel|experto/i.test(text.join(' ') + nav.children.map(c => c.textContent).join(' ')));
      // Cruzar la meta: hito una vez; desaparece con la siguiente respuesta; no reaparece el mismo día.
      goal.events.push(ev(NOW + 1000)); roots.app.children = []; p.dashboard(); await settle();
      assert.ok(has('Meta de hoy cumplida'), 'hito al cumplir'); assert.equal(p.getDailyMilestone().answers, 5);
      const store1 = JSON.stringify(goal.events);
      roots.app.children = []; p.dashboard(); assert.ok(has('Meta de hoy cumplida'), 'sigue visible hasta la siguiente respuesta');
      assert.equal(JSON.stringify(goal.events), store1, 'el hito no escribe eventos');
      goal.events.push(ev(NOW + 2000)); roots.app.children = []; p.dashboard(); assert.ok(!has('Meta de hoy cumplida'), 'desaparece tras otra respuesta');
      p.clearDailyMilestone(); roots.app.children = []; p.dashboard(); assert.ok(!has('Meta de hoy cumplida'), 'no se repite el mismo día');
      // Racha de 1 día en singular.
      const solo = { ...goal, events: day(0, 3) }; p.setStoreForTests({ goals: [solo], active: 'g1' }); roots.app.children = []; p.dashboard(); assert.ok(has('Racha: 1 día') && !has('Racha: 1 días'));
    } finally { Date.now = realNow; }
  }

  // 5. Aislamiento: la constancia no entra en selector, cobertura ni plan.
  {
    const nodes = [{ id: 'a', name: 'A', level: 0, prerequisites: [], outcome: 'o', probe: { prompt: 'p', kind: 'explanation' } }];
    const base = { id: 'g1', profile_id: 'profile-test', goal: 'X', nodes, learner: {}, reviews: [], coverage: [{ id: 'a', name: 'A', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] }], events: [], session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 } };
    p.setProfileForTests({ profile_id: 'profile-test', name: 'S', preferences: {} }, 1); p.setStoreForTests({ goals: [base], active: 'g1' });
    const plan0 = JSON.stringify(p.studyPlan(base, NOW)), cov0 = JSON.stringify(base.coverage);
    p.setDailyTarget(5); p.streak(p.getStoreForTests ? p.getStoreForTests() : { goals: [base] }, NOW, 5);
    assert.equal(JSON.stringify(p.studyPlan(base, NOW)), plan0); assert.equal(JSON.stringify(base.coverage), cov0);
  }
  console.log('motivation: OK');
})().catch(e => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
