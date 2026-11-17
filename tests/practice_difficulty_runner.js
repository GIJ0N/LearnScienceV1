// Puente de practice_difficulty.test.py: calcula la banda y la suficiencia de historias sintéticas con la lógica real de app.js.
const fs = require('node:fs');
function element(type = 'div') {
  return { type, textContent: '', value: '', children: [], style: {}, append(...items) { this.children.push(...items); }, appendChild(item) { this.children.push(item); return item; }, replaceChildren(...items) { this.children = items; } };
}
global.document = { getElementById: () => element('main'), createElement: type => element(type) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.fetch = async () => { throw new Error('Sin red.'); };
const p = require('../app.js');
const T0 = Date.UTC(2026, 10, 10, 15);
let seq = 0;
function goalFor(text, sufficient) {
  const goal = {
    id: 'g1', goal: 'Meta', learner: {}, events: [], reviews: [], repairEpisodes: [], contextStack: [], lessons: {},
    nodes: [{ id: 'n1', name: 'Tema', level: 0, prerequisites: [], outcome: 'Resolver', probe: { prompt: 'Explica', kind: 'explanation' } }],
    coverage: [{ id: 'n1', name: 'n1', dimensions: ['direct_application', 'conceptual'].map(d => ({ id: d, name: d, required: true, evidence: [] })) }],
    session: { mode: 'DIAGNOSTIC', node: 'n1', stack: [], tries: 0, hints: 0 }
  };
  const direct = goal.coverage[0].dimensions[0];
  const seen = [];
  for (const [, prefix, code] of text.matchAll(/([blc]?)([SFHUD])/g)) {
    seq++;
    const band = prefix === 'b' ? 'base' : prefix === 'c' ? 'challenge' : prefix === 'l' ? null : 'standard';
    const question = { prompt: 'Pregunta ' + seq, reference: 'c', kind: 'application', observable_dimensions: ['direct_application'], ...(band ? { difficulty_band: band } : {}) };
    const activity = p.activityContract(question, 'n1', 'independent_practice');
    const status = code === 'F' ? 'MISCONCEPTION' : code === 'U' ? 'UNKNOWN' : 'CORRECT';
    // D repite el attempt_id del evento anterior (duplicado).
    const attempt = code === 'D' && seen.length ? seen[seen.length - 1] : 'att-' + seq;
    const event = p.activityEvidence(activity, { status, evaluator_version: 'local-fixture' }, 0, { attempt_id: attempt, timestamp: T0 + seq * 1000, hint_level_max: code === 'H' ? 1 : undefined });
    seen.push(attempt);
    goal.events.push({ type: 'EVIDENCE', ...event });
    direct.evidence.push(event);
  }
  if (sufficient) for (const i of [1, 2]) goal.coverage[0].dimensions[1].evidence.push({ evidence_id: 'k' + i, attempt_id: 'k' + i, type: 'EVIDENCE', result: 'CORRECT', status: 'CORRECT', is_independent: true, observed_dimensions: ['conceptual'], question: { prompt: 'Concepto ' + i }, phase: 'CONFIRMATION', timestamp: T0 + i });
  return goal;
}
const input = JSON.parse(fs.readFileSync(0, 'utf8')), out = {};
for (const s of input.scenarios) {
  const goal = goalFor(s.history, s.sufficient === true);
  p.setStoreForTests({ goals: [goal], active: goal.id });
  const state = p.practiceBandState(goal, 'n1');
  out[s.name] = {
    replayed: state.band, band: p.practiceBand(goal, 'n1', 'confirmation').band, evidences: state.evidences,
    direct_sufficient: p.sufficient(goal.coverage[0].dimensions[0]), mastered: p.deriveCoverage(goal.coverage[0]).mastered,
    independent: p.independentSuccesses(goal.coverage[0].dimensions[0]).length
  };
}
process.stdout.write(JSON.stringify(out));
