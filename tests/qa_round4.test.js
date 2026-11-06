// Ronda QA 4: pantalla de criterios sin códigos internos, historial con su propia pregunta, «Listo.» se apaga.
const assert = require('node:assert/strict');
function element(type = 'div') { return { type, textContent: '', value: '', className: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; }, setAttribute() {} }; }
global.document = { getElementById: () => element(), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
const p = require('../app.js');
const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');

for (const [code, text] of [['SATISFIED', 'cumplido'], ['NOT_SATISFIED', 'no cumplido'], ['option_choice', 'Elección de opción'], ['explanation', 'Explicación'],
  ['recognition', 'reconocimiento'], ['deterministic_option_key', 'clave local de la opción'], ['provider_semantic', 'valoración del modelo']]) assert.equal(p.humanLabel(code), text, code);

// Razones guardadas antes de la corrección se muestran bien.
assert.equal(p.humanReason('El intento mostró conceptual. Reparamos ese punto.'), 'El intento mostró una dificultad de comprensión. Reparamos ese punto.');
assert.equal(p.humanReason('Otra razón.'), 'Otra razón.');

// El intento de criterios guarda SU pregunta, no la de la lección vigente.
const goal = { id: 'g1', criterion_draft: { activity_id: 'act-1', activity: { activity_id: 'act-1', prompt: '¿Cuánto cuesta 1 kg de manzanas?' } } };
assert.deepEqual(p.criterionQuestion(goal, { activity_id: 'act-1' }), { prompt: '¿Cuánto cuesta 1 kg de manzanas?', activity_id: 'act-1' });
assert.equal(p.criterionQuestion(goal, { activity_id: 'otra' }), null, 'si no coincide la actividad no se inventa una pregunta');
assert.ok(src.includes('question:criterionQuestion(goal,assessment)'));
assert.ok(src.includes("(item.event?.criterion_assessment?.criteria||[]).map(c=>humanLabel(c.criterion_id)"), 'el historial resume la evaluación por criterio');

// Mensajes y botones.
assert.ok(src.includes("if(s==='Listo.'){let t=setTimeout("), '«Listo.» se apaga solo');
assert.ok(src.includes("goal.mixed.status!=='done'"), 'una práctica terminada no se ofrece como «en curso»');
assert.ok(src.includes("E('small','Motivo: '+failure)"), 'si falla la microlección se muestra el motivo');
assert.ok(!src.includes("d.name+'='+coverageLabel"), 'cobertura sin «=»');
console.log('qa_round4.test.js OK');
