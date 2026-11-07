// usage_report_v1: informe de solo lectura con retención, calibración, independencia y modalidades.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', className: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; }, setAttribute() {} }; }
global.document = { getElementById: () => element(), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
const p = require('../app.js');
const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const DAY = 86400000, NOW = Date.UTC(2026, 10, 10);

// 1. Meta vacía: ceros y sin lanzar.
const empty = p.usageReport({ id: 'g', goal: 'M', nodes: [], events: [], reviews: [] }, NOW);
assert.equal(empty.version, 'usage_report_v1');
assert.equal(empty.period.active_days, 0);
assert.equal(empty.period.first, null);
assert.deepEqual(empty.modalities, []);
assert.equal(empty.retention.length, 5);
assert.ok(empty.retention.every(r => r.n === 0 && r.rate === null));
assert.deepEqual(empty.reviews, { due: 0, overdue_3d: 0, total: 0 });
assert.equal(p.usageReport({}, NOW).content_flags, 0, 'un objeto sin campos tampoco lanza');

// 2. Fixture completo.
const rev = (delayDays, result, extra = {}) => ({ type: 'EVIDENCE', node_id: 'a', phase: 'REVIEW', evidence_role: 'learning', result, delay_ms_from_last_exposure: delayDays * DAY, timestamp: NOW - 1 * DAY, ...extra });
const goal = {
  id: 'g1', goal: 'Meta', nodes: [],
  events: [
    rev(2, 'CORRECT'), rev(2, 'CORRECT'), rev(2, 'CORRECT'), rev(10, 'MISCONCEPTION'),
    rev(2, 'CORRECT', { help_used: 1 }),
    { type: 'EVIDENCE', node_id: 'a', phase: 'INDEPENDENT', evidence_role: 'learning', result: 'CORRECT', help_used: 1, timestamp: NOW - 20 * DAY },
    { type: 'EVIDENCE', node_id: 'a', phase: 'INDEPENDENT', evidence_role: 'learning', result: 'CORRECT', help_used: 0, timestamp: NOW - 20 * DAY },
    { type: 'DISCRIMINATION', node_id: 'a', status: 'CORRECT', timestamp: NOW - 2 * DAY },
    { type: 'DISCRIMINATION', node_id: 'a', status: 'MISCONCEPTION', variant: 'error_hunt', timestamp: NOW - 2 * DAY },
    { type: 'BETO_SESSION', node_id: 'a', status: 'CORRECT', provisional: true, timestamp: NOW - 3 * DAY },
    { type: 'CHALLENGE_REPORT', node_id: 'a', status: 'PARTIAL', provisional: true, timestamp: NOW - 3 * DAY },
  ],
  reviews: [{ id: 'a', due: NOW - 5 * DAY }, { id: 'b', due: NOW + 3 * DAY }],
  flagged_content: [{ node_id: 'a' }, { node_id: 'b' }],
};
const rep = p.usageReport(goal, NOW);
const band = id => rep.retention.find(r => r.id === id);
assert.deepEqual([band('d1_3').n, band('d1_3').correct, band('d1_3').rate], [3, 3, 1]);
assert.deepEqual([band('d7_21').n, band('d7_21').rate], [1, null], 'con menos de 3 respuestas no hay porcentaje');
assert.equal(rep.retention_with_help, 1);
assert.equal(rep.retention.reduce((a, r) => a + r.n, 0), 4, 'los repasos con ayuda no entran en las franjas');
const mod = id => rep.modalities.find(m => m.id === id);
assert.deepEqual([mod('discrimination').n, mod('discrimination').correct, mod('discrimination').provisional], [1, 1, false]);
assert.deepEqual([mod('error_hunt').n, mod('error_hunt').correct], [1, 0]);
assert.deepEqual([mod('beto').correct, mod('beto').provisional], [1, true]);
assert.deepEqual([mod('challenge').correct, mod('challenge').provisional], [0, true]);
assert.equal(mod('review').n, 5);
assert.equal(mod('learning').n, 2);
assert.equal(mod('composition'), undefined, 'una modalidad sin datos se omite');
assert.equal(rep.period.active_days, 4);
assert.equal(rep.period.events_last_7_days, 9);
assert.deepEqual(rep.reviews, { due: 1, overdue_3d: 1, total: 2 });
assert.equal(rep.content_flags, 2);
assert.deepEqual([rep.independence.learning, rep.independence.with_help], [7, 2]);
assert.equal(rep.independence.rate_with_help, 2 / 7);

// 3. No muta la meta.
const before = JSON.stringify(goal);
p.usageReport(goal, NOW);
assert.equal(JSON.stringify(goal), before);

// 4. El JSON no contiene respuestas escritas.
const leaky = { ...goal, events: [...goal.events, { type: 'EVIDENCE', node_id: 'a', phase: 'INDEPENDENT', evidence_role: 'learning', result: 'CORRECT', answer: 'SECRETO', timestamp: NOW }] };
assert.equal(JSON.stringify(p.usageReport(leaky, NOW)).includes('SECRETO'), false);

// 5. Navegación, ruteo y recarga.
assert.ok(p.RESTORABLE_PAGES.has('report'));
assert.ok(src.includes("else if(page==='report')reportView();"));
assert.ok(src.includes("add('Informe','report'"));
console.log('usage_report.test.js OK');
