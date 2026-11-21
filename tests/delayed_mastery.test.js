// delayed_mastery_v1 (L2a): dominio solo con un acierto determinista, por tu cuenta, otro día local
// y al menos 8 h después de la última exposición de enseñanza. La zona horaria se fija aquí y en CI.
process.env.TZ = 'America/Mexico_City';
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', children: [], style: {}, append(...xs) { this.children.push(...xs); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...xs) { this.children = xs; }, setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {} } }; }
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id] || element('main'), createElement: element };
global.localStorage = { getItem: () => null, setItem() {} };
global.confirm = () => true;
global.fetch = async route => { if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) }; throw Error('Ruta inesperada ' + route); };
const p = require('../app.js');
const DAY = 86400000;
// America/Mexico_City no usa horario de verano desde 2022: UTC-6 fijo.
const mx = (d, h = 0, mi = 0) => Date.UTC(2026, 10, d, h + 6, mi);
let NOW = mx(10, 20);
p.setClockForTests(() => NOW);

let seq = 0;
const ev = (at, extra = {}) => { seq++; return { type: 'EVIDENCE', evidence_id: 'e' + seq, attempt_id: 'att' + seq, activity_id: 'act' + seq, node_id: 'a', phase: 'INDEPENDENT', result: 'CORRECT', status: 'CORRECT', is_independent: true, help_used: 0, observed_dimensions: ['direct_application'], question: { prompt: 'Problema distinto ' + seq }, timestamp: at, evidence_role: 'learning', evaluator_trust: 'deterministic', evaluator_version: 'local-production-v1', purpose: 'practice', ...extra }; };
const model = (at, extra = {}) => ev(at, { evaluator_trust: 'model_single', trust_policy_version: p.TRUST_POLICY_VERSION, evaluator_version: 'gemini-eval-v1', ...extra });
const teach = (at, node = 'a') => ({ type: 'TEACHING_EXPOSURE', node_id: node, at, policy_version: 'retrieval_gap_v1' });
const hardAnchor = at => ({ type: 'TRUST', status: 'CORRECT', source: 'PRODUCTION', anchor_policy_version: p.HARDENING_VERSION, timestamp: at });
const legacyAnchor = at => ({ type: 'TRUST', status: 'CORRECT', source_attempt_id: 'old-' + at, timestamp: at });
const failure = at => ({ type: 'EVIDENCE', evidence_id: 'fail' + at, attempt_id: 'fail-' + at, node_id: 'a', phase: 'INDEPENDENT', result: 'MISCONCEPTION', status: 'MISCONCEPTION', is_independent: false, help_used: 0, observed_dimensions: ['direct_application'], question: { prompt: 'Fallo ' + at }, timestamp: at, evidence_role: 'learning', evaluator_trust: 'deterministic', evaluator_version: 'local-production-v1', purpose: 'practice' });
const nodes = () => [{ id: 'a', name: 'Tema A', level: 0, prerequisites: [], outcome: 'Resolver' }, { id: 'b', name: 'Tema B', level: 1, prerequisites: [], outcome: 'Resolver' }];
// extraDim: entradas de dimensión que no son eventos del ledger (anclas TRUST).
function goalOf(events, extraDim = [], opts = {}) {
  const evidence = [...events.filter(e => e.type === 'EVIDENCE' && e.node_id === 'a'), ...extraDim];
  return { id: 'g', profile_id: 'profile-test', goal: 'Meta', nodes: opts.nodes || nodes(), learner: {}, reviews: [], lessons: {}, events, coverage: [{ id: 'a', name: 'Tema A', dimensions: [{ id: 'direct_application', name: 'Aplicación', required: true, evidence }] }], session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 } };
}
const verifiedOf = (events, extraDim = []) => p.verified(goalOf(events, extraDim), 'a');
const textOf = el => el ? [el.textContent || '', ...(el.children || []).map(textOf)].join(' ') : '';

// (1) Dos aciertos el mismo día: suficientes por dimensión, pero el dominio queda por confirmar.
{
  const g = goalOf([teach(mx(10, 9)), ev(mx(10, 10)), ev(mx(10, 11))]);
  assert.equal(p.verified(g, 'a'), false, 'dos aciertos el mismo día no bastan');
  assert.equal(p.sufficient(g.coverage[0].dimensions[0], { events: g.events }), true, 'la suficiencia por dimensión no cambia');
  assert.equal(p.deriveCoverage(g.coverage[0], { events: g.events }).delayed, 'pending');
  assert.equal(p.awaitingDelayed(g, 'a'), true, 'todas las requeridas suficientes y falta lo diferido');
  assert.equal(p.readyToAdvance(g, 'a'), true, 'por confirmar no bloquea la ruta');
  assert.equal(p.nextNode(g).id, 'b', 'nextNode avanza');
  assert.equal(p.masteredCount(g), 0, 'el conteo de dominados baja hasta confirmar');
}

// (2) Un acierto otro día (con 8 h o más desde la enseñanza) confirma: dos aciertos en total bastan.
{
  const g = goalOf([teach(mx(10, 9)), ev(mx(10, 10)), ev(mx(11, 10))]);
  assert.equal(p.verified(g, 'a'), true, 'acierto al día siguiente confirma');
  assert.equal(p.masteredCount(g), 1);
}

// (3) Límites de tiempo y fecha local: enseñanza, acierto del mismo día y acierto candidato.
for (const [name, teachAt, sameDayAt, candidateAt, expected] of [
  ['20:00 a 08:00 del día siguiente (12 h)', mx(10, 20), mx(10, 21), mx(11, 8), true],
  ['exactamente 8 h entre días distintos', mx(10, 20), mx(10, 21), mx(11, 4), true],
  ['23:50 a 00:10 (20 min)', mx(10, 23, 50), mx(10, 23, 55), mx(11, 0, 10), false],
  ['06:00 a 23:30 del mismo día', mx(10, 6), mx(10, 10), mx(10, 23, 30), false],
  ['17:00 a 19:00 del mismo día', mx(10, 17), mx(10, 18), mx(10, 19), false],
]) {
  assert.equal(verifiedOf([teach(teachAt), ev(sameDayAt), ev(candidateAt)]), expected, name);
}

// (4) Fecha local con cambio de horario (America/New_York): la fecha es la local, no la UTC.
{
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    // Estudio 31 oct 20:00 EDT; acierto 1 nov 06:00 EST: fechas locales distintas y 11 h.
    assert.equal(verifiedOf([teach(Date.parse('2026-11-01T00:00:00Z')), ev(Date.parse('2026-11-01T01:00:00Z')), ev(Date.parse('2026-11-01T11:00:00Z'))]), true, 'fecha local distinta con cambio de horario');
    // Estudio 1 nov 00:30 EDT; acierto 1 nov 23:00 EST (UTC ya es 2 nov): misma fecha local, no cuenta.
    assert.equal(verifiedOf([teach(Date.parse('2026-11-01T04:30:00Z')), ev(Date.parse('2026-11-01T15:00:00Z')), ev(Date.parse('2026-11-02T04:00:00Z'))]), false, 'la fecha UTC no decide');
  } finally { process.env.TZ = previous; }
}

// (5) Negativos, cada uno con su control: el acierto candidato con el defecto no confirma; sin él, sí.
{
  const base = { difficulty_band: 'base', difficulty_policy_version: p.PRACTICE_DIFFICULTY_VERSION };
  const defects = {
    'banda base': base,
    'con ayuda': { help_used: 1, is_independent: false },
    'corregido por el usuario': { corrected: true },
    'calificado por el modelo sin ancla': { evaluator_trust: 'model_single', trust_policy_version: p.TRUST_POLICY_VERSION, evaluator_version: 'gemini-eval-v1' },
    'clave de colocación': { evaluator_version: 'placement-key-v1' },
  };
  for (const [name, defect] of Object.entries(defects)) {
    const candidate = ev(mx(11, 10), defect);
    assert.equal(verifiedOf([teach(mx(10, 9)), ev(mx(10, 10)), candidate]), false, 'defecto no confirma: ' + name);
    assert.equal(verifiedOf([teach(mx(10, 9)), ev(mx(10, 10)), ev(mx(11, 10))]), true, 'control sin defecto confirma (' + name + ')');
  }
  // Un acierto anterior a una contradicción no confirma; el mismo sin contradicción sí.
  assert.equal(verifiedOf([teach(mx(10, 9)), ev(mx(10, 10)), ev(mx(11, 10)), failure(mx(11, 11))]), false, 'antes de contradicción');
  assert.equal(verifiedOf([teach(mx(10, 9)), ev(mx(10, 10)), ev(mx(11, 10))]), true, 'control sin contradicción');
}

// (6) Un acierto del modelo, aunque haya ancla dura, no confirma lo diferido; un acierto local sí.
{
  const anchor = [hardAnchor(mx(10, 9, 30))];
  const g = goalOf([teach(mx(10, 9)), model(mx(10, 10)), model(mx(11, 10))], anchor);
  assert.equal(p.sufficient(g.coverage[0].dimensions[0], { events: g.events }), true, 'con ancla, dos aciertos del modelo bastan por dimensión');
  assert.equal(p.verified(g, 'a'), false, 'el modelo no confirma lo diferido');
  assert.equal(verifiedOf([teach(mx(10, 9)), model(mx(10, 10)), ev(mx(11, 10))], anchor), true, 'un acierto local sí confirma');
}

// (7) Releer la lección y acertar en esa misma sesión no confirma (la referencia es la última exposición).
{
  assert.equal(verifiedOf([teach(mx(10, 9)), ev(mx(10, 10)), teach(mx(13, 9)), ev(mx(13, 10))]), false, 'relectura en la misma sesión');
  assert.equal(verifiedOf([teach(mx(10, 9)), ev(mx(10, 10)), ev(mx(13, 10))]), true, 'control sin relectura');
}

// (8) Sin enseñanza: la referencia es la evidencia más antigua del tema, sin contar anclas TRUST.
{
  assert.equal(verifiedOf([ev(mx(10, 10)), ev(mx(11, 10))]), true, 'sin enseñanza, un día después confirma');
  assert.equal(verifiedOf([ev(mx(10, 10)), ev(mx(10, 11))]), false, 'sin enseñanza, mismo día no confirma');
  assert.equal(verifiedOf([ev(mx(10, 10)), ev(mx(10, 11))], [legacyAnchor(mx(9, 12))]), false, 'el TRUST antiguo no fija la referencia');
}

// (9) Exposiciones con marcas de tiempo inválidas se ignoran (no NaN, no cadenas).
{
  assert.equal(verifiedOf([teach(NaN), teach('2026-11-10T09:00'), teach(mx(10, 9)), ev(mx(10, 10)), ev(mx(11, 10))]), true, 'la exposición válida manda');
  assert.equal(verifiedOf([teach(NaN), ev(mx(10, 10)), ev(mx(11, 10))]), true, 'sin exposición válida, respaldo a la evidencia más antigua');
}

// (10) Selector: el mismo día espera; otro día ofrece la confirmación; una pausa por política no bloquea.
{
  const single = () => goalOf([teach(mx(10, 9)), ev(mx(10, 10)), ev(mx(10, 11))], [], { nodes: [nodes()[0]] });
  let g = single();
  let d = p.selectTutorAction(g, mx(10, 20));
  assert.equal(d.action, 'CONTINUE', 'mismo día: continuar');
  assert.equal(d.purpose, 'wait');
  assert.match(d.reason, /Este tema se confirma otro día\./);
  assert.equal(g.events.filter(e => e.type === 'CURRICULUM_CONTINUED').length, 0);

  g = single();
  d = p.selectTutorAction(g, mx(11, 10));
  assert.equal(d.action, 'CONFIRM', 'otro día: confirmación diferida');
  assert.equal(d.node_id, 'a');
  assert.equal(d.purpose, 'delayed');

  g = single();
  g.events.push({ type: 'CURRICULUM_CONTINUED', node_id: 'a', source: 'POLICY_NOTICE', policy_version: p.HARDENING_VERSION, at: mx(10, 21) });
  assert.equal(p.selectTutorAction(g, mx(11, 10)).purpose, 'delayed', 'un acuse de política no impide la confirmación');

  g = single();
  g.events.push({ type: 'CURRICULUM_CONTINUED', node_id: 'a', pending_dimensions: [], at: mx(10, 21), policy_version: 'tutor' });
  d = p.selectTutorAction(g, mx(11, 10));
  assert.notEqual(d.purpose, 'delayed', 'seguir con la ruta a mano sí deja el tema fuera del selector');
}

// (10b) chooseNext: la espera no escribe CURRICULUM_CONTINUED; la confirmación diferida entra en modo de confirmación.
{
  const g = goalOf([teach(mx(10, 9)), ev(mx(10, 10)), ev(mx(10, 11))], [], { nodes: [nodes()[0]] });
  p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1);
  p.setStoreForTests({ goals: [g], active: g.id });
  // chooseNext lee Date.now() (no el reloj de pruebas): se fija solo durante la llamada.
  const realNow = Date.now;
  try {
    NOW = mx(10, 20); Date.now = () => NOW; p.chooseNext(g);
    assert.equal(g.events.filter(e => e.type === 'CURRICULUM_CONTINUED').length, 0, 'la espera no escribe decisión curricular');
    assert.notEqual(g.session.mode, 'CONFIRMATION');
    NOW = mx(11, 10); p.chooseNext(g);
    assert.equal(g.session.mode, 'CONFIRMATION');
    assert.equal(g.session.confirmation.purpose, 'delayed');
  } finally { Date.now = realNow; NOW = mx(10, 20); }
}

// (11) Desafío: exige la confirmación diferida; el mismo día no basta.
{
  const g = goalOf([teach(mx(10, 9)), ev(mx(10, 10)), ev(mx(10, 11))]);
  assert.equal(p.nodeSufficientForBand(g, 'a'), false, 'mismo día');
  assert.equal(p.practiceBand(g, 'a', 'challenge').band, 'standard', 'sin confirmación diferida no hay desafío');
  const next = goalOf([teach(mx(10, 9)), ev(mx(10, 10)), ev(mx(11, 10))]);
  assert.equal(p.nodeSufficientForBand(next, 'a'), true);
}

// (12) Panel experto: independencia es «parcial» hasta la confirmación diferida.
{
  const same = goalOf([teach(mx(10, 9)), ev(mx(10, 10)), ev(mx(10, 11))]);
  assert.equal(p.expertLayers(same, 'a').layers.independence, 'partial');
  const later = goalOf([teach(mx(10, 9)), ev(mx(10, 10)), ev(mx(11, 10))]);
  assert.equal(p.expertLayers(later, 'a').layers.independence, 'met');
}

// (13) Datos guardados: impacto diferido medido sin la regla nueva; aviso L2 tras L1; acuses idempotentes.
{
  const legacy = goalOf([teach(mx(10, 9)), ev(mx(10, 10)), ev(mx(10, 11))]);
  assert.deepEqual(p.delayedImpact(legacy).map(x => x.node_id), ['a']);
  assert.equal(p.hardeningImpact(legacy).length, 0, 'el aviso L1 no se ve afectado por la regla de otro día');
  const notice = p.policyNoticeView(legacy);
  assert.ok(notice, 'aviso L2 visible');
  assert.match(textOf(notice), /Cambiamos otra regla/);
  assert.match(textOf(notice), /problema escrito corto mañana/);
  const first = p.acknowledgePolicyNotice(legacy, NOW, p.DELAYED_VERSION);
  const second = p.acknowledgePolicyNotice(legacy, NOW + 5, p.DELAYED_VERSION);
  assert.equal(first.written, 1);
  assert.equal(second.written, 0, 'dos clics no duplican');
  assert.equal(legacy.events.filter(e => e.type === 'POLICY_NOTICE_ACK' && e.policy_version === p.DELAYED_VERSION).length, 1);
  assert.equal(legacy.events.filter(e => e.type === 'CURRICULUM_CONTINUED' && e.policy_version === p.DELAYED_VERSION && e.source === 'POLICY_NOTICE').length, 1);
  assert.equal(p.policyNoticeView(legacy), null, 'acusado');
}

// (14) L1 no silencia L2; tras L2 el tema impactado queda programado para confirmarse al día siguiente.
{
  const g = goalOf([teach(mx(10, 9)), model(mx(10, 10)), model(mx(10, 11))], [legacyAnchor(mx(9, 12))]);
  g.coverage.push({ id: 'b', name: 'Tema B', dimensions: [{ id: 'direct_application', name: 'Aplicación', required: true, evidence: [ev(mx(10, 10), { node_id: 'b' }), ev(mx(10, 11), { node_id: 'b' })] }] });
  g.events.push(teach(mx(10, 9), 'b'), ...g.coverage[1].dimensions[0].evidence);
  assert.deepEqual(p.hardeningImpact(g).map(x => x.node_id), ['a'], 'L1 afecta a a');
  assert.deepEqual(p.delayedImpact(g).map(x => x.node_id), ['b'], 'L2 afecta a b');
  assert.match(textOf(p.policyNoticeView(g)), /Cambiamos una regla/);
  p.acknowledgePolicyNotice(g, NOW);
  assert.match(textOf(p.policyNoticeView(g)), /Cambiamos otra regla/, 'L1 no silencia L2');
  p.acknowledgePolicyNotice(g, NOW, p.DELAYED_VERSION);
  assert.equal(p.policyNoticeView(g), null);
  const d = p.selectTutorAction(g, mx(11, 10));
  assert.equal(d.action, 'CONFIRM');
  assert.equal(d.node_id, 'b', 'confirmación programada para mañana');
  assert.equal(d.purpose, 'delayed');
}

// (15) Hito de confirmación pendiente.
{
  const g = goalOf([teach(mx(10, 9)), ev(mx(10, 10)), ev(mx(10, 11))]);
  const m = p.makeMilestone(g, 'a', g.events[2]);
  assert.equal(m.awaiting_delayed, true);
}

console.log('delayed_mastery.test.js OK');
