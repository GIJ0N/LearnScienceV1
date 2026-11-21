// bare_latex_render_v1: enunciados con comandos LaTeX sin `$` (p. ej. `f(x) = \frac{x^{2}-4}{x-2}`) se pintan como MathML.
// Sin `$` y sin comando conocido, el texto queda idéntico a E(). Con `$`, el comportamiento de rich_content_v1 no cambia.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function element(type = 'div', ns = null) {
  return {
    type, ns, textContent: '', value: '', children: [], style: {}, className: '', attrs: {},
    append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; }, prepend() {},
  };
}
const roots = { app: element(), status: element() };
global.document = {
  getElementById: id => roots[id], createElement: t => element(t),
  createElementNS: (ns, name) => element(name, ns),
  createTextNode: s => ({ type: '#text', textContent: s, children: [] }),
};
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
global.fetch = async () => { throw Error('sin red en este test'); };
const p = require('../app.js');

// Serializa un árbol MathML o de texto a una cadena comparable.
const ser = e => e.type === '#text' ? e.textContent : '<' + e.type + '>' + (e.textContent || '') + (e.children || []).map(ser).join('') + '</' + e.type + '>';
const kinds = t => (p.richParts(t) || []).map(c => c.type === '#text' ? c.textContent : c.type);
const hasTag = (el, tag) => el.type === tag || (el.children || []).some(c => hasTag(c, tag));
const rendered = t => p.X('p', t);

// 1. Comandos sin `$`: se convierten en matemática completa.
{
  const frac = 'f(x) = \\frac{x^{2}-4}{x-2}';
  assert.deepEqual(kinds(frac), ['math'], 'sin $: la fórmula completa es un único nodo math');
  const el = rendered(frac);
  assert.ok(hasTag(el, 'math') && hasTag(el, 'mfrac'), 'el enunciado produce MathML con fracción');
  assert.ok(!el.textContent.includes('\\frac'), 'no queda \\frac en texto crudo');
  assert.equal(ser(el.children[0]), ser(p.texToMathML(frac, false)), 'mismo mecanismo que texToMathML');

  for (const t of ['\\int_0^1 f(x)\\,dx', '\\frac{d}{dx}(x^2)', '\\sum_{i=1}^{n} x_i', '\\sqrt{x}+1', 'x \\to \\infty']) {
    assert.deepEqual(kinds(t), ['math'], 'comando sin $ convertido: ' + t);
    assert.ok(!rendered(t).textContent.includes('\\'), 'sin barra invertida cruda: ' + t);
  }
}

// 2. Texto sin comandos ni `$` no cambia: richParts devuelve null y X() equivale a E().
{
  const plain = ['Calcula la pendiente de la recta', 'x + 2 = 5', 'Sin fórmulas aquí.', 'precio 5 y 6 pesos', 'a/b'];
  for (const t of plain) {
    assert.equal(p.richParts(t), null, 'texto plano intacto: ' + t);
    const el = rendered(t);
    assert.equal(el.textContent, t);
    assert.equal(el.children.length, 0);
  }
}

// 3. Comandos desconocidos o no convertibles sin `$`: quedan literales (sin romper nada).
{
  for (const t of ['El comando \\foo{x} no se soporta', '\\frac{a}', '\\begin{matrix}a\\end{matrix}']) {
    assert.equal(p.richParts(t), null, 'no convertible queda literal: ' + t);
    assert.equal(rendered(t).textContent, t);
  }
  const long = '\\frac{a}{b} ' + 'a'.repeat(300);
  assert.equal(p.richParts(long), null, 'más largo que el límite de fórmula: literal');
  assert.equal(rendered(long).textContent, long);
}

// 4. Texto con `$` sigue igual que antes (rich_content_v1).
{
  assert.deepEqual(kinds('Sea $x$ la incógnita'), ['Sea ', 'math', ' la incógnita']);
  assert.equal(p.richParts('Usa $ab$ y $cd$ hoy'), null);
  const mixed = 'Pendiente $m = \\frac{y_2-y_1}{x_2-x_1}$ fin';
  assert.deepEqual(kinds(mixed), ['Pendiente ', 'math', ' fin']);
}

// 5. El texto del aprendiz y el historial siguen usando X() (sin innerHTML) y el prompt de historial se pinta con X().
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(src.includes("X('p','Pregunta: '+q)"), 'historial: el enunciado usa X()');
  assert.ok(!src.includes("E('p','Pregunta: '+q)"), 'historial: no queda E() con el enunciado');
  assert.ok(src.includes("X('p','Evaluación: '+"), 'historial: la evaluación del modelo usa X()');
  assert.ok(!src.includes('innerHTML'), 'sin innerHTML');
}

console.log('bare_latex_render tests: OK');
