const assert = require('node:assert/strict');

function element(type = 'div') {
  return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; } };
}
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: id => (id === 'app' ? roots.app : roots.status), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const policy = require('../app.js');

const ok = { status: 'CORRECT', error_type: 'none', feedback: 'f', hint: '' };
const novel = { prompt: 'Decide en planta', reference: 'r', kind: 'context_case', is_novel_variant: true, supports_transfer: true, novelty_basis: 'Cambia el contexto: decisión en planta' };
const legacy = { prompt: 'Integra', reference: 'r', kind: 'context_case' };

assert.ok(policy.activityContract && policy.activityEvidence, 'app.js debe exportar activityContract y activityEvidence');

// Integración correcta, sin ayuda y con novedad: variante nueva independiente.
let contract = policy.activityContract(novel, 'n1', 'integration');
assert.equal(contract.supports_transfer, true);
assert.equal(contract.is_novel_variant, true);
let event = policy.activityEvidence(contract, ok, 0, { attempt_id: 'a1' });
assert.equal(event.is_novel_variant, true);
assert.equal(event.is_independent, true);

// Con ayuda: la novedad se declara, pero no es independiente.
event = policy.activityEvidence(contract, ok, 1, { attempt_id: 'a2' });
assert.equal(event.is_novel_variant, true);
assert.equal(event.is_independent, false);

// Un rol guiado con novedad declarada no obtiene transferencia.
contract = policy.activityContract(novel, 'n1', 'guided_practice');
assert.equal(contract.supports_transfer, false);
assert.equal(contract.is_novel_variant, false);

// Lección legacy sin el campo: contrato idéntico al actual (sin novedad ni transferencia).
contract = policy.activityContract(legacy, 'n1', 'integration');
assert.equal(contract.is_novel_variant, false);
assert.equal(contract.supports_transfer, false);
event = policy.activityEvidence(contract, ok, 0, { attempt_id: 'a3' });
assert.equal(event.is_novel_variant, false);
assert.equal(event.is_independent, true);

console.log('integration_novelty: OK');
