const assert = require('node:assert/strict');

function element(tag = 'div') {
  return { tag, children: [], style: {}, attributes: {}, textContent: '',
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    replaceChildren(...items) { this.children = items; },
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) { return this.attributes[key]; },
    querySelectorAll() { return []; },
  };
}
global.document = { getElementById: () => element(), createElement: element,
  createElementNS: (_ns, tag) => element(tag) };
global.localStorage = { getItem: () => null, setItem: () => { throw Error('Map must not write storage'); } };
global.fetch = () => { throw Error('Map must not request or save'); };
const policy = require('../app.js');

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
function observation(id, prompt, extra = {}) {
  const activity = policy.activityContract({ activity_id: `activity-${id}`, prompt,
    reference: 'PRIVATE REFERENCE MUST NOT RENDER', kind: 'explanation',
    observable_dimensions: ['conceptual'] }, 'n1', 'evidence_confirmation');
  return { type: 'EVIDENCE', ...policy.activityEvidence(activity, { status: extra.result || 'CORRECT' }, 0,
    { attempt_id: id, timestamp: 1000 }), ...extra };
}
function goal(evidence = []) {
  return { id: 'synthetic-map', nodes: [
    { id: 'n1', name: 'Unidad', outcome: 'Definir el entero', prerequisites: [] },
    { id: 'n2', name: 'Comparar fracciones', prerequisites: ['n1'] },
    { id: 'n3', name: 'Dato legacy', prerequisites: [] },
  ], coverage: [
    { id: 'n1', dimensions: [{ id: 'conceptual', required: true, evidence }] },
    { id: 'n2', dimensions: [{ id: 'conceptual', required: true, evidence: [] }] },
  ], session: { mode: 'CONTEXT', node: 'n1' }, events: evidence,
    pending_repair_diagnosis: { status: 'POSTPONED', request_id: 'pending' },
    contextStack: [{ context_id: 'context-1' }], repairEpisodes: [{ episode_id: 'episode-1' }] };
}
function all(root) { return [root, ...root.children.flatMap(all)]; }
function text(root) { return all(root).map(x => x.textContent).join('\n'); }

const first = observation('attempt-1', 'Explica el entero de referencia');
const second = observation('attempt-2', 'Por qué cambia una parte al cambiar la unidad');
const frozen = freeze(goal([first, second]));
const before = JSON.stringify(frozen);
const map = policy.evidenceMapSnapshot(frozen);
assert.equal(map.nodes[0].status, policy.deriveCoverage(frozen.coverage[0]).status);
assert.equal(map.nodes[0].status, 'MASTERED');
assert.deepEqual(map.nodes[0].dimensions[0].independent_attempt_ids, ['attempt-1', 'attempt-2']);
assert.equal(map.nodes[1].status, 'UNKNOWN', 'mastery does not propagate through prerequisites');
assert.equal(map.nodes[2].has_contract, false, 'legacy gets no invented coverage');
assert.deepEqual(map.edges, [{ from: 'n1', to: 'n2' }]);
assert.ok(map.nodes[1].column > map.nodes[0].column);
assert.equal(JSON.stringify(frozen), before);

for (const extra of [
  { help_used: 1 }, { is_independent: false }, { evidence_scope: 'repair_episode' },
  { corrected: true }, { observed_dimensions: [] }, { result: 'UNKNOWN' },
]) {
  const value = freeze(goal([first, { ...second, ...extra }]));
  assert.notEqual(policy.evidenceMapSnapshot(value).nodes[0].status, 'MASTERED', JSON.stringify(extra));
}
assert.notEqual(policy.evidenceMapSnapshot(goal([first, { ...first }])).nodes[0].status, 'MASTERED');
assert.notEqual(policy.evidenceMapSnapshot(goal([first, second,
  observation('failed', 'Otra comprobación', { result: 'MISCONCEPTION' })])).nodes[0].status, 'MASTERED');

const cyclic = goal(); cyclic.nodes[0].prerequisites = ['n2'];
const cycleView = policy.evidenceMapSnapshot(freeze(cyclic));
assert.equal(cycleView.edges.length, 0); assert.match(cycleView.warnings.join(), /ciclo/);
const malformed = goal(); malformed.nodes[1].prerequisites = ['missing', 'n2'];
assert.equal(policy.evidenceMapSnapshot(freeze(malformed)).edges.length, 0);
assert.match(policy.evidenceMapSnapshot(malformed).warnings.join(), /inválido/);

const box = element(); policy.renderEvidenceMap(box, frozen);
assert.equal(all(box).filter(e => e.tag === 'svg').length, 1);
assert.match(text(box), /attempt-1/); assert.doesNotMatch(text(box), /PRIVATE REFERENCE/);
const secondButton = all(box).find(e => e.tag === 'button' && e.textContent === 'Comparar fracciones');
secondButton.onclick(); assert.equal(secondButton.ariaPressed, 'true');
assert.match(text(box), /No hay intentos registrados/);
assert.equal(JSON.stringify(frozen), before, 'browsing does not change session, pending diagnosis, episodes or evidence');
const legacyButton = all(box).find(e => e.tag === 'button' && e.textContent === 'Dato legacy');
legacyButton.onclick(); assert.match(text(box), /No se inventa cobertura/);

// Native text nodes, not generated markup: names cannot execute HTML.
const unsafe = goal(); unsafe.nodes[0].name = '<img src=x onerror=alert(1)>';
const safeBox = element(); policy.renderEvidenceMap(safeBox, freeze(unsafe));
assert.ok(all(safeBox).some(e => e.textContent === unsafe.nodes[0].name));
assert.ok(all(safeBox).every(e => !Object.hasOwn(e, 'innerHTML')));

const empty = element(); policy.renderEvidenceMap(empty, {}); assert.match(text(empty), /Todavía no hay/);
const large = goal(); large.nodes = Array.from({ length: 41 }, (_, i) => ({ id: `large-${i}`, name: `Habilidad ${i}`, prerequisites: [] }));
const list = element(); policy.renderEvidenceMap(list, freeze(large));
assert.equal(all(list).filter(e => e.tag === 'svg').length, 0);
assert.equal(all(list).filter(e => e.tag === 'button').length, 41);
console.log('PASS: read-only evidence map, policy parity, no propagation, legacy, help/scope/duplicates, cycles, accessible controls and safe text');
