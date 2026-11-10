// expert_profile_v1 (cliente): competencias terminales por meta; solo lectura sobre las capas del panel de experto.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {} } }; }
console.error = () => {};
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: element };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
let calls = [], reply = null;
global.fetch = async (route, options) => {
  calls.push(route);
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  if (route === '/api/goal/expert-profile') { if (reply instanceof Error) return { ok: false, json: async () => ({ error: reply.message }) }; return { ok: true, json: async () => reply }; }
  throw Error('Ruta inesperada ' + route);
};
const p = require('../app.js');
const DAY = 86400000, NOW = Date.UTC(2026, 10, 10, 12);
p.setClockForTests(() => NOW);

const node = (id, i = 0) => ({ id, name: id, level: i, prerequisites: [], outcome: 'o', probe: { prompt: 'Explica ' + id, kind: 'explanation' } });
let n = 0;
// Eventos que cumplen 7 capas de un tema (todas frescas).
function fullEvents(id, at = NOW - DAY) {
  const ev = (extra) => ({ type: 'EVIDENCE', node_id: id, evidence_role: 'learning', result: 'CORRECT', status: 'CORRECT', help_used: 0, timestamp: at, evidence_id: 'e' + (++n), activity_id: 'act' + n, ...extra });
  const mix = type => ({ type, node_id: id, status: 'CORRECT', at, attempt_id: 'm' + (++n) });
  return [ev({ phase: 'COMPREHENSION' }), ev({ is_independent: true }), ev({ is_independent: true }), ev({ phase: 'REVIEW', delay_ms_from_last_exposure: 31 * DAY }), mix('DISCRIMINATION'), mix('DISCRIMINATION'), mix('COMPOSITION'), mix('COMPOSITION'), ev({ is_novel_variant: true, is_independent: true })];
}
const areas = () => [{ id: 'ar1', name: 'Superficie', outcome: 'o', status: 'expanded', node_ids: ['a', 'b'] }, { id: 'ar2', name: 'Aplicación', outcome: 'o', status: 'pending', node_ids: [] }, { id: 'ar3', name: 'Curado', outcome: 'o', status: 'expanded', node_ids: ['c'] }];
function goal(events = [], extra = {}) {
  return { id: 'g', profile_id: 'profile-test', goal: 'Pintura', depth: 'experto', nodes: [node('a'), node('b', 1), node('c', 2)], areas: areas(), learner: {}, reviews: [], lessons: {}, events,
    coverage: ['a', 'b', 'c'].map(id => ({ id, name: id, status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] })),
    session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 }, ...extra };
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'S', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }
const comp = (i, risk = 'medium', ids = ['ar1']) => ({ id: 'comp-' + i, name: 'Competencia ' + i, criterion: 'Mide el espesor y lo compara con el rango del proveedor.', risk, area_ids: ids });
const profile = (list = [comp(1), comp(2, 'high', ['ar1', 'ar2']), comp(3, 'low', ['ar3']), comp(4)]) => ({ schema_version: 'expert_profile_v1', competencies: list });

(async () => {
  assert.equal(p.EXPERT_PROFILE_VERSION, 'expert_profile_v1');
  assert.equal(p.expertLayers(goal(fullEvents('a')), 'a').met >= 5, true, 'fixture: tema con 5 o más capas');

  // applyExpertProfile: acepta un perfil válido; rechaza 3 o 9 competencias, riesgo o área ajena; no sobrescribe.
  let g = attach(goal());
  assert.equal(p.applyExpertProfile(g, profile()), true);
  assert.equal(g.expert_profile.version, 'expert_profile_v1');
  assert.equal(g.expert_profile.competencies.length, 4);
  assert.ok(Number.isFinite(g.expert_profile.generated_at));
  assert.equal(p.applyExpertProfile(g, profile()), false, 'no sobrescribe');
  for (const bad of [profile([comp(1), comp(2), comp(3)]), profile(Array.from({ length: 9 }, (_, i) => comp(i + 1))), profile([comp(1), comp(2), comp(3), comp(4, 'extreme')]), profile([comp(1), comp(2), comp(3), comp(4, 'low', ['ajena'])]), profile([comp(1), comp(2), comp(3), comp(4, 'low', [])]), { ...profile(), schema_version: 'x' }]) {
    const h = attach(goal());
    assert.throws(() => p.applyExpertProfile(h, bad), e => e.code === 'INVALID_EXPERT_PROFILE');
    assert.equal(h.expert_profile, undefined);
  }

  // Petición: éxito guarda; fallo o ruta caída → no pasa nada; sin áreas no se pide.
  g = attach(goal()); reply = profile(); calls = [];
  assert.equal(await p.requestExpertProfile(g), true);
  assert.ok(g.expert_profile);
  g = attach(goal()); reply = new Error('boom');
  assert.equal(await p.requestExpertProfile(g), false);
  assert.equal(g.expert_profile, undefined);
  g = attach(goal([], { areas: [] })); calls = [];
  assert.equal(await p.requestExpertProfile(g), false);
  assert.ok(!calls.includes('/api/goal/expert-profile'));

  // Estado de la competencia.
  const events = [...fullEvents('a'), ...fullEvents('b'), ...fullEvents('c')];
  g = attach(goal(events)); p.applyExpertProfile(g, profile());
  const [c1, c2, c3] = g.expert_profile.competencies;
  assert.equal(p.competencyState(g, c1).state, 'Demostrada', 'área abierta y temas con 5+ capas');
  assert.equal(p.competencyState(g, c2).state, 'En curso', 'con un área sin abrir nunca es Demostrada');
  assert.equal(p.competencyState(g, c2).unopened, 1);
  assert.equal(p.competencyState(g, c3).state, 'Demostrada');
  g = attach(goal(fullEvents('a'))); p.applyExpertProfile(g, profile());
  assert.equal(p.competencyState(g, g.expert_profile.competencies[0]).state, 'En curso', 'un tema sin evidencia impide Demostrada');
  assert.equal(p.competencyState(g, g.expert_profile.competencies[2]).state, 'Sin medir');
  // Tema con capa stale → no cuenta como cumplida.
  g = attach(goal([...fullEvents('a'), ...fullEvents('b', NOW - 90 * DAY)])); p.applyExpertProfile(g, profile());
  assert.equal(p.expertLayers(g, 'b').met < 5, true);
  assert.equal(p.competencyState(g, g.expert_profile.competencies[0]).state, 'En curso');

  // EXTERNAL_VALIDATION no cambia verified(), cobertura ni capas.
  g = attach(goal(events)); p.applyExpertProfile(g, profile());
  const snap = () => JSON.stringify({ cov: g.coverage, v: ['a', 'b', 'c'].map(id => p.verified(g, id)), layers: ['a', 'b', 'c'].map(id => p.expertLayers(g, id)), st: g.expert_profile.competencies.map(c => p.competencyState(g, c).state), rev: g.reviews });
  const before = snap();
  assert.throws(() => p.addExternalValidation(g, 'comp-2', { by: '', date: '2026-11-01' }), e => e.code === 'INVALID_VALIDATION');
  assert.throws(() => p.addExternalValidation(g, 'nope', { by: 'Mentor', date: '2026-11-01' }), e => e.code === 'INVALID_COMPETENCY');
  assert.equal(p.addExternalValidation(g, 'comp-2', { by: 'Mentora Ana', date: '2026-11-01', note: 'Observó una aplicación completa' }), true);
  assert.equal(snap(), before);
  const ev = g.events.find(e => e.type === 'EXTERNAL_VALIDATION');
  assert.deepEqual([ev.competency_id, ev.by, ev.date], ['comp-2', 'Mentora Ana', '2026-11-01']);
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, events.filter(e => e.type === 'EVIDENCE').length);

  // Interfaz: el aviso de alto riesgo y el formulario solo en risk:'high'; sin perfil, el panel no se rompe.
  const box = element(); p.expertProfileBlock(box, g);
  const texts = box.children.map(c => c.textContent || '').join('\n');
  assert.equal((texts.match(/Esta competencia tiene consecuencias reales\. La app registra tu aprendizaje; no certifica que puedas ejercerla sin supervisión\./g) || []).length, 1);
  assert.match(texts, /Validación externa registrada: Mentora Ana · 2026-11-01/);
  assert.match(texts, /1 área sin abrir/);
  assert.equal(box.children.filter(c => c.textContent === 'Registrar validación externa').length, 1);
  const none = attach(goal(events)); const nbox = element();
  assert.equal(p.expertProfileBlock(nbox, none), false);
  assert.equal(nbox.children.some(c => c.textContent === 'Definir qué es ser experto aquí'), true);
  const old = attach(goal(events, { areas: [] })); const obox = element();
  assert.equal(p.expertProfileBlock(obox, old), false);
  assert.equal(obox.children.length, 0, 'meta antigua sin áreas: el panel se ve como hoy');

  console.log('OK expert_profile');
})().catch(e => { console.log(e); process.exit(1); });
