// evidence_hardening_v1: el ancla exige una respuesta escrita calificada localmente, las anclas antiguas se degradan al leer,
// la exposición formativa no crea evidencia y el aviso de política se confirma una sola vez.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; }, addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {} } }; }
global.document = { getElementById: () => element('main'), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');
const NOW = Date.UTC(2026, 10, 10, 12);
const DAY = 86400000;
p.setClockForTests(() => NOW);

let n = 0;
const ok = extra => { n++; return { type: 'EVIDENCE', evidence_id: 'e' + n, attempt_id: 'a' + n, activity_id: 'act' + n, node_id: 'a', phase: 'INDEPENDENT', result: 'CORRECT', status: 'CORRECT', is_independent: true, help_used: 0, observed_dimensions: ['conceptual'], question: { prompt: 'pregunta distinta ' + n }, timestamp: NOW - 1000 + n, evidence_role: 'learning', ...extra }; };
const model = () => ok({ evaluator_trust: 'model_single', trust_policy_version: p.TRUST_POLICY_VERSION });
const fail = () => { n++; return { type: 'EVIDENCE', evidence_id: 'f' + n, attempt_id: 'f' + n, node_id: 'a', result: 'MISCONCEPTION', status: 'MISCONCEPTION', observed_dimensions: ['conceptual'], timestamp: NOW - 1000 + n }; };
const legacyAnchor = (id = 'src') => ({ type: 'TRUST', status: 'CORRECT', source_attempt_id: id, timestamp: NOW - 1000 + (++n) });
const hardAnchor = (id = 'src') => ({ type: 'TRUST', status: 'CORRECT', source: 'PRODUCTION', anchor_policy_version: p.HARDENING_VERSION, source_attempt_id: id, timestamp: NOW - 1000 + (++n) });
const dim = evidence => ({ id: 'conceptual', name: 'Comprensión', required: true, evidence });
const nodes = [{ id: 'a', name: 'Tema A', outcome: 'Resolver', prerequisites: [] }];
const freshGoal = (extra = {}) => ({ id: 'g', profile_id: 'profile-test', goal: 'Meta', nodes, learner: {}, reviews: [{ id: 'a', due: NOW + 9 * DAY, step: 1, history: [] }], lessons: {}, events: [], coverage: [{ id: 'a', name: 'Tema A', dimensions: [dim([])] }], session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 }, ...extra });

assert.equal(p.HARDENING_VERSION, 'evidence_hardening_v1');
assert.ok(p.EXPOSURE_TYPES.includes('FORMATIVE_EXPOSURE'), 'FORMATIVE_EXPOSURE cuenta como exposición');
for (const legacy of ['DISCRIMINATION', 'COMPOSITION', 'CONFIRMATION', 'ERROR_FIX', 'CHALLENGE_REPORT', 'BETO_SESSION', 'DIRECT_CHECK', 'STEP_CHECK', 'FADED_STEP', 'TEACHING_EXPOSURE', 'FEEDBACK_EXPOSURE']) {
  assert.ok(p.EXPOSURE_TYPES.includes(legacy), 'tipo de exposición ' + legacy);
}

// (1) Una confirmación OPEN_ANSWER correcta ya no crea ancla: el ancla nace solo de una producción calificada localmente.
{
  p.setProfileForTests({ profile_id: 'profile-test', name: 'S', preferences: {} }, 1);
  const g = freshGoal({ coverage: [{ id: 'a', name: 'a', dimensions: [dim([model(), model()])] }] });
  p.setStoreForTests({ goals: [g], active: g.id });
  const m = p.startMixed(g, 'confirm', { node_id: 'a', source_type: 'OPEN_ANSWER', source_attempt_id: 'src-1' });
  const item = { item_id: 'conf-1', node_id: 'a', prompt: 'q', options: [] };
  m.items = [item];
  p.applyDiscrimination(g, item, { status: 'CORRECT', item_id: item.item_id, node_id: 'a' }, 'att-1', 'x', 80);
  assert.equal(p.trustAnchored(g, 'a'), false, 'OPEN_ANSWER CORRECT no crea ancla');
  assert.equal(g.events.filter(e => e.type === 'TRUST_ANCHOR').length, 0);
  assert.equal(p.sufficient(g.coverage[0].dimensions[0]), false, 'dos aciertos del modelo siguen sin bastar');
}

// (2) Un marcador legacy no ancla; un marcador de la política nueva sí.
{
  const d = dim([model(), model(), legacyAnchor()]);
  assert.equal(p.sufficient(d), false, 'marcador legacy degradado');
  assert.equal(p.sufficient(dim([model(), model(), hardAnchor()])), true, 'marcador nuevo ancla');
  assert.equal(p.sufficient(dim([model(), model(), legacyAnchor()]), { acceptLegacyAnchors: true }), true, 'solo para medir impacto');
  assert.equal(p.trustAnchored({ id: 'g', coverage: [{ id: 'a', dimensions: [dim([model(), legacyAnchor()])] }] }, 'a'), false, 'trustAnchored también degrada el marcador legacy');
  assert.equal(p.isHardAnchor(hardAnchor()), true);
  assert.equal(p.isHardAnchor(legacyAnchor()), false);
  const sourceNoVersion = { ...hardAnchor(), anchor_policy_version: undefined };
  assert.equal(p.isHardAnchor(sourceNoVersion), false, 'origen PRODUCTION sin versión no ancla');
  assert.equal(p.sufficient(dim([model(), model(), sourceNoVersion])), false, 'ni cuenta para suficiencia');
  assert.equal(p.isHardAnchor({ ...hardAnchor(), source: 'CONFIRMATION' }), false, 'origen CONFIRMATION no ancla');
}

// (3) createTrustAnchor rechaza fuentes que no son PRODUCTION, sin escribir.
{
  const g = freshGoal();
  assert.equal(p.createTrustAnchor(g, 'a', 'CONFIRMATION', 'x', NOW, { basis: 'numeric' }), false);
  assert.equal(g.events.length, 0);
  assert.equal(g.coverage[0].dimensions[0].evidence.length, 0);
}

// (4) Ordenar exige 4 pasos para anclar; numeric ancla; el aviso de base no llega aquí.
{
  const g = freshGoal();
  assert.equal(p.createTrustAnchor(g, 'a', 'PRODUCTION', 'o3', NOW, { basis: 'ordering', steps: 3 }), false, 'ordering de 3 pasos no ancla');
  assert.equal(p.createTrustAnchor(g, 'a', 'PRODUCTION', 'o4', NOW, { basis: 'ordering', steps: 4, purpose: 'anchor' }), true, 'ordering de 4 pasos ancla');
  const h = freshGoal();
  assert.equal(p.createTrustAnchor(h, 'a', 'PRODUCTION', 'n1', NOW, { basis: 'numeric', purpose: 'anchor' }), true, 'numeric ancla');
  const marker = h.events.find(e => e.type === 'TRUST_ANCHOR');
  assert.equal(marker.anchor_basis, 'numeric');
  assert.equal(marker.anchor_policy_version, 'evidence_hardening_v1');
  assert.equal(p.createTrustAnchor(h, 'a', 'PRODUCTION', 'x', NOW, { basis: 'desconocido' }), false, 'base no reconocida no ancla');
}

// (5) anchorOffer abre una producción con purpose anchor; sin pendiente de confirmar, startProduction se niega.
{
  const g = freshGoal({ coverage: [{ id: 'a', name: 'a', dimensions: [dim([model(), model()])] }] });
  g.events = [{ type: 'EVIDENCE', evidence_id: 'pending', attempt_id: 'src-p', node_id: 'a', phase: 'INDEPENDENT', result: 'CORRECT', status: 'CORRECT', evidence_role: 'learning', evaluator_trust: 'model_single', trust_policy_version: p.TRUST_POLICY_VERSION, timestamp: NOW - 5 }];
  g.coverage[0].dimensions[0].evidence = g.events.slice();
  p.setStoreForTests({ goals: [g], active: g.id });
  assert.equal(p.anchorNeed(g, 'a') || p.anchorSuggest(g, 'a'), 'src-p', 'hay acierto de modelo pendiente');
  const production = p.startProduction(g, { node_id: 'a', purpose: 'anchor', source_attempt_id: 'src-p' });
  assert.equal(production.purpose, 'anchor');
  assert.equal(production.anchor_for_attempt_id, 'src-p');
  g.production = null;
  assert.throws(() => p.startProduction(freshGoal(), { node_id: 'a', purpose: 'anchor', source_attempt_id: 'nada' }), /Falta una respuesta escrita/);
}

// (6) Un fallo de ancla enfría el nodo: no se vuelve a ofrecer sin nueva enseñanza o 24 h.
{
  const g = freshGoal({ coverage: [{ id: 'a', name: 'a', dimensions: [dim([model(), model()])] }] });
  g.events = [{ type: 'EVIDENCE', evidence_id: 'pending', attempt_id: 'src-p', node_id: 'a', phase: 'INDEPENDENT', result: 'CORRECT', status: 'CORRECT', evidence_role: 'learning', evaluator_trust: 'model_single', trust_policy_version: p.TRUST_POLICY_VERSION, timestamp: NOW - 5 }];
  g.coverage[0].dimensions[0].evidence = g.events.slice();
  g.events.push({ type: 'EVIDENCE', evidence_id: 'ancla-f', attempt_id: 'af', node_id: 'a', purpose: 'anchor', anchor_for_attempt_id: 'src-p', result: 'MISCONCEPTION', status: 'MISCONCEPTION', evidence_role: 'learning', timestamp: NOW - 4 });
  assert.equal(p.anchorCooling(g, 'a'), true, 'tras el fallo de ancla el nodo se enfría');
  assert.equal(p.anchorOffer(g, 'a'), null, 'la oferta se suprime durante el enfriamiento');
  g.events.push({ type: 'TEACHING_EXPOSURE', node_id: 'a', at: NOW - 2 });
  assert.equal(p.anchorCooling(g, 'a'), false, 'una nueva enseñanza levanta el enfriamiento');
}

// (6b) ANCHOR_UNAVAILABLE: un evento por nodo, formativo, sin EVIDENCE.
{
  const g = freshGoal();
  p.recordAnchorUnavailable(g, 'a', { retryUsed: false, at: NOW });
  p.recordAnchorUnavailable(g, 'a', { retryUsed: true, at: NOW + 1 });
  const events = g.events.filter(e => e.type === 'ANCHOR_UNAVAILABLE');
  assert.equal(events.length, 1, 'un evento por nodo');
  assert.equal(events[0].node_id, 'a');
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0);
}

// (7) hardeningImpact detecta temas que dejarían de estar cerrados; el aviso se reconoce una vez y no cambia la evidencia.
{
  const g = freshGoal({ coverage: [{ id: 'a', name: 'Tema A', dimensions: [dim([model(), model(), legacyAnchor()])] }] });
  const before = g.coverage[0].dimensions[0].evidence.length;
  assert.equal(p.hardeningImpact(g).length, 1);
  assert.equal(p.hardeningImpact(g)[0].node_id, 'a');
  const first = p.acknowledgePolicyNotice(g, NOW);
  const second = p.acknowledgePolicyNotice(g, NOW + 5);
  assert.equal(g.events.filter(e => e.type === 'POLICY_NOTICE_ACK').length, 1, 'dos clics no duplican');
  assert.equal(g.events.filter(e => e.type === 'CURRICULUM_CONTINUED').length, 1);
  assert.equal(g.coverage[0].dimensions[0].evidence.length, before, 'no se borra ni reescribe evidencia');
  assert.equal(first.written > 0, true);
  assert.equal(second.written, 0);
}

// (8) Exposición formativa: no crea EVIDENCE ni toca cobertura ni calendario; es idempotente por (source, refId, node).
{
  const g = freshGoal();
  const due = g.reviews[0].due, cov = JSON.stringify(g.coverage);
  p.recordFormativeExposure(g, 'a', 'BETO', 'beto-1');
  p.recordFormativeExposure(g, 'a', 'BETO', 'beto-1');
  assert.equal(g.events.filter(e => e.type === 'FORMATIVE_EXPOSURE').length, 1);
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0);
  assert.equal(g.reviews[0].due, due);
  assert.equal(JSON.stringify(g.coverage), cov);
  assert.ok(p.lastExposure(g, 'a') >= NOW - 1000 || p.lastExposure(g, 'a') > 0);
}

// (9) Milestone: cuenta solo aciertos independientes y sin ayuda, incluido el evento ya guardado.
{
  const g = freshGoal();
  const ev = { type: 'EVIDENCE', evidence_id: 'm1', attempt_id: 'm1', node_id: 'a', result: 'CORRECT', status: 'CORRECT', is_independent: true, help_used: 0, phase: 'INDEPENDENT', evidence_role: 'learning', timestamp: NOW };
  g.events.push(ev);
  assert.equal(p.makeMilestone(g, 'a', ev).unaided, 1, 'el evento actual ya está guardado y cuenta');
  const helped = { ...ev, evidence_id: 'm2', attempt_id: 'm2', help_used: 1, is_independent: false };
  g.events.push(helped);
  assert.equal(p.makeMilestone(g, 'a', helped).unaided, 1, 'con ayuda no cuenta');
  g.events.push({ ...ev, evidence_id: 'm3', attempt_id: 'm3', is_independent: false, help_used: 0, phase: 'GUIDED' });
  assert.equal(p.makeMilestone(g, 'a', ev).unaided, 1, 'guiado sin ayuda tampoco cuenta como sin ayuda por tu cuenta');
  assert.equal(p.milestoneUnaidedText(0), 'Aún sin aciertos por tu cuenta en esta visita');
}

// (10) Intercalado justo antes de un repaso: la exposición queda marcada en el repaso (retención no elegible) sin tocar due.
{
  const g = freshGoal();
  g.reviews[0].question = { prompt: 'repaso' };
  const due = g.reviews[0].due;
  g.events.push({ type: 'DISCRIMINATION', node_id: 'a', attempt_id: 'x', at: NOW - 1000 });
  assert.equal(p.lastExposure(g, 'a') > 0, true, 'DISCRIMINATION legacy cuenta como exposición');
  p.recordFormativeExposure(g, 'a', 'BETO', 'beto-10', NOW - 500);
  assert.equal(g.reviews[0].last_exposure_at, NOW - 500);
  assert.equal(g.reviews[0].exposure_before_response, true, 'la exposición llega antes de responder el repaso');
  assert.equal(g.reviews[0].due, due, 'due no cambia');
}
// (8b) Reto: el compromiso de predicción marca exposición formativa una sola vez y no crea evidencia.
{
  const g = freshGoal();
  g.challenge = { status: 'active', stage: 'prediction', item_id: 'ch1', node_id: 'a', pub: {} };
  const res = { item_id: 'ch1', node_id: 'a', stage: 'commit', prediction: 'Predigo que sube', confidence: 60, materials: [], steps: ['Paso uno'], evidence_fields: [{ id: 'f1', label: 'Dato' }] };
  assert.equal(p.applyChallengeCommit(g, res, 'ch-att-1'), true);
  assert.equal(g.events.filter(e => e.type === 'FORMATIVE_EXPOSURE' && e.source === 'CHALLENGE').length, 1);
  assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0);
  assert.equal(g.reviews[0].due, NOW + 9 * DAY);
}

console.log('evidence_hardening.test.js OK');
