// rich_content_v1: fórmulas legibles (LaTeX acotado -> MathML con nodos DOM) y «Explora la relación».
// Nada de esto crea evidencia. DOM simulado: se extiende aquí con createElementNS/createTextNode sin tocar otros tests.
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
let withNS = true;
global.document = {
  getElementById: id => roots[id], createElement: t => element(t),
  get createElementNS() { return withNS ? (ns, name) => element(name, ns) : undefined; },
  createTextNode: s => ({ type: '#text', textContent: s, children: [] }),
};
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const apiCalls = [];
let exploreReply = null;
global.fetch = async (route, options) => {
  const body = JSON.parse(options.body); apiCalls.push({ route, body });
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  if (route === '/api/explore') return exploreReply instanceof Error ? { ok: false, json: async () => ({ error: exploreReply.message }) } : { ok: true, json: async () => exploreReply };
  if (route === '/api/profile/history') return { ok: true, json: async () => ({ attempts: [{ phase: 'COMPREHENSION', result: 'CORRECT', help_used: 0, response_text: 'Mi respuesta $x^{2}$ literal', question: { prompt: 'Pregunta' }, evaluation: { feedback: 'ok' }, event: {} }] }) };
  throw Error('Ruta inesperada ' + route);
};
const logError = console.error;
console.error = () => {};
const p = require('../app.js');
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const walk = (root, fn) => { fn(root); for (const c of (root && root.children) || []) walk(c, fn); };
const findAll = (pred, root = roots.app) => { const out = []; walk(root, e => { if (pred(e)) out.push(e); }); return out; };
const find = (label, root = roots.app) => findAll(e => e.textContent === label, root)[0] || null;
const has = (needle, root = roots.app) => findAll(e => String(e.textContent || '').includes(needle), root).length > 0;
const byType = (type, root = roots.app) => findAll(e => e.type === type, root);
// Serializa un árbol MathML/SVG a una cadena comparable.
const ser = e => e.type === '#text' ? e.textContent : '<' + e.type + '>' + (e.textContent || '') + (e.children || []).map(ser).join('') + '</' + e.type + '>';
const mathOf = (src, display = false) => { const m = p.texToMathML(src, display); return m && ser(m); };

(async () => {
  // 1. Convertidor: casos válidos (estructura exacta).
  {
    assert.equal(mathOf('\\frac{a}{b}'), '<math><mfrac><mrow><mi>a</mi></mrow><mrow><mi>b</mi></mrow></mfrac></math>');
    assert.equal(mathOf('x^{2}'), '<math><msup><mi>x</mi><mrow><mn>2</mn></mrow></msup></math>');
    assert.equal(mathOf('x_1'), '<math><msub><mi>x</mi><mn>1</mn></msub></math>');
    assert.equal(mathOf('x_{i}^{2}'), '<math><msubsup><mi>x</mi><mrow><mi>i</mi></mrow><mrow><mn>2</mn></mrow></msubsup></math>');
    assert.equal(mathOf('\\sqrt{x}'), '<math><msqrt><mrow><mi>x</mi></mrow></msqrt></math>');
    assert.equal(mathOf('\\sqrt[3]{x}'), '<math><mroot><mrow><mi>x</mi></mrow><mrow><mn>3</mn></mrow></mroot></math>');
    assert.equal(mathOf('\\Delta T'), '<math><mi>Δ</mi><mi>T</mi></math>');
    assert.equal(mathOf('\\alpha\\cdot\\beta'), '<math><mi>α</mi><mo>⋅</mo><mi>β</mi></math>');
    assert.equal(mathOf('a \\times b \\pm c \\le d \\ge e \\neq f \\approx g'), '<math><mi>a</mi><mo>×</mo><mi>b</mi><mo>±</mo><mi>c</mi><mo>≤</mo><mi>d</mi><mo>≥</mo><mi>e</mi><mo>≠</mo><mi>f</mi><mo>≈</mo><mi>g</mi></math>');
    assert.equal(mathOf('180^\\circ'), '<math><msup><mn>180</mn><mo>°</mo></msup></math>');
    assert.equal(mathOf('25\\,\\text{mm}'), '<math><mn>25</mn><mspace></mspace><mtext>mm</mtext></math>');
    assert.equal(mathOf('\\sum_{i=1}^{n} x_i'), '<math><msubsup><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mrow><mi>n</mi></mrow></msubsup><msub><mi>x</mi><mi>i</mi></msub></math>');
    assert.equal(mathOf('\\int_0^1 f'), '<math><msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup><mi>f</mi></math>');
    assert.equal(mathOf('\\left( a+b \\right)^2'), '<math><msup><mrow><mo>(</mo><mi>a</mi><mo>+</mo><mi>b</mi><mo>)</mo></mrow><mn>2</mn></msup></math>');
    assert.equal(mathOf('1,5 - 2'), '<math><mn>1,5</mn><mo>−</mo><mn>2</mn></math>');
    assert.equal(mathOf('R = \\rho \\frac{L}{A}'), '<math><mi>R</mi><mo>=</mo><mi>ρ</mi><mfrac><mrow><mi>L</mi></mrow><mrow><mi>A</mi></mrow></mfrac></math>');
    const m = p.texToMathML('\\frac{a}{b}', true);
    assert.equal(m.ns, 'http://www.w3.org/1998/Math/MathML'); assert.equal(m.getAttribute('display'), 'block');
    assert.equal(m.getAttribute('alttext'), '\\frac{a}{b}', 'texto alternativo con el LaTeX original'); assert.equal(m.getAttribute('aria-label'), null, 'M3: sin aria-label con LaTeX crudo');
    assert.equal(p.texToMathML('a+b', false).getAttribute('display'), 'inline');
  }

  // 2. Inválidos o inseguros -> null (el llamador muestra el texto original).
  {
    for (const bad of ['\\foo', '\\begin{matrix}a\\end{matrix}', '{x', 'x}', '\\frac{a}', '\\frac{a}{b', '\\left( x', 'x \\right)', 'x^2^3', 'x_1_2', '\\text{a\\b}', '\\text{', 'a & b', '#', '\\\\', '\\href{x}{y}', '\\def\\x{1}', '^2', '\\sqrt', '', '   ', 'x'.repeat(241), '\\frac{' + '{'.repeat(12) + 'a' + '}'.repeat(12) + '}{b}', '😀'])
      assert.equal(p.texToMathML(bad), null, 'debe rechazar: ' + JSON.stringify(bad).slice(0, 40));
    assert.notEqual(p.texToMathML('x'.repeat(240)), null, 'el máximo exacto sí cabe');
    withNS = false; assert.equal(p.texToMathML('x^2'), null, 'sin createElementNS no hay MathML'); withNS = true;
  }

  // 3. Segmentación: texto mixto, texto original intacto si algo falla, `$` huérfano y precios.
  {
    const plain = ['Sin fórmulas', 'cuesta $5 y sube', 'cuesta $5 y luego $6', 'abre $x^2 y nunca cierra', 'termina en $', '$$', '$ $', 'dos $$ $$ vacíos', 'El valor $\\foo{x}$ no se soporta', 'mal $x^{2$ cierre', 'a $\\frac{1}{$ b', 'precio $12$5'];
    for (const t of plain) { assert.equal(p.richParts(t), null, 'sin fórmulas válidas: ' + t); const el = p.X('p', t); assert.equal(el.textContent, t, 'texto intacto: ' + t); assert.equal(el.children.length, 0); }
    const el = p.X('p', 'La resistencia es $R = \\rho \\frac{L}{A}$ en ohm y $$V = I R$$ al final.');
    assert.equal(el.textContent, '', 'con fórmulas se construyen nodos');
    assert.deepEqual(el.children.map(c => c.type), ['#text', 'math', '#text', 'span', '#text']);
    assert.equal(el.children[0].textContent, 'La resistencia es '); assert.equal(el.children[2].textContent, ' en ohm y '); assert.equal(el.children[4].textContent, ' al final.');
    assert.equal(el.children[3].className, 'math-block'); assert.equal(el.children[3].children[0].getAttribute('display'), 'block');
    assert.equal(el.children[1].getAttribute('alttext'), 'R = \\rho \\frac{L}{A}'); assert.equal(el.children[1].getAttribute('aria-label'), null);
    // una fórmula válida y otra inválida en el mismo texto: la inválida queda literal, la válida se pinta.
    const mixed = p.richParts('Bien $x^{2}$ y mal $\\foo$ fin');
    assert.deepEqual(mixed.map(c => c.type === '#text' ? c.textContent : c.type), ['Bien ', 'math', ' y mal $\\foo$ fin']);
    // \$ escapado es un signo de dólar literal
    assert.deepEqual(p.richParts('Cuesta \\$5 y $x$').map(c => c.type === '#text' ? c.textContent : c.type), ['Cuesta $5 y ', 'math']);
    // tope de fórmulas y de longitud
    const many = Array.from({ length: 30 }, () => '$x$').join(' ');
    assert.equal(p.richParts(many), null, 'M1: más de 24 fórmulas => todo literal');
    assert.equal(p.X('p', many).textContent, many); assert.equal(p.richParts(Array.from({ length: 24 }, () => '$x$').join(' ')).filter(c => c.type === 'math').length, 24, 'exactamente 24 sí');
    assert.equal(p.richParts('$x$ ' + 'a'.repeat(8100)), null, 'texto demasiado largo: no se interpreta');
    // sin createElementNS: texto tal cual
    withNS = false; assert.equal(p.X('p', 'a $x$ b').textContent, 'a $x$ b'); withNS = true;
    // X sin `$` es idéntico a E: undefined no añade texto, números se muestran
    assert.equal(p.X('p', undefined).textContent, ''); assert.equal(p.X('small', 'Hola', 'quiet').className, 'quiet');
  }

  // 4. El texto del APRENDIZ no se interpreta: ninguna superficie de respuesta usa X, y el historial lo muestra literal.
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    for (const forbidden of [/X\([^)]*response_text/, /X\([^)]*\.answer\b/, /X\([^)]*reasoning/, /X\([^)]*guess/, /X\([^)]*checkpoint\.response_text/, /X\('pre'[^)]*Respuesta/])
      assert.ok(!forbidden.test(src), 'texto del aprendiz pasaría por X: ' + forbidden);
    p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1);
    p.setStoreForTests({ goals: [{ id: 'g', profile_id: 'profile-test', goal: 'Pintura', nodes: [], coverage: [], learner: {}, reviews: [], events: [], lessons: {}, session: { mode: 'TEACH', node: null, stack: [] } }], active: 'g' });
    await p.learningView(); await settle();
    const shown = findAll(e => e.type === 'pre' && e.textContent === 'Respuesta: Mi respuesta $x^{2}$ literal');
    assert.equal(shown.length, 1, 'la respuesta del aprendiz se muestra literal');
    assert.equal(byType('math').length, 0, 'ninguna fórmula se construye a partir de texto del aprendiz');
  }

  // 5. Recorte seguro (espejo de `compact` del servidor).
  {
    const t = 'Calcula $\\frac{a}{b}$ ahora y luego sigue';
    assert.equal(p.richClip(t, 200), t);
    assert.equal(p.richClip(t, 12), 'Calcula', 'corte dentro de la fórmula: se corta antes de ella');
    assert.equal(p.richClip(t, 21), 'Calcula $\\frac{a}{b}$', 'corte justo tras el cierre: se conserva');
    assert.equal(p.richClip('Dato $x^2$ y $y^2$ fin', 16), 'Dato $x^2$ y', 'la segunda fórmula queda sin cerrar y se retira');
    assert.equal(p.richClip('$$x^2 + y^2$$ resto', 8), '$$x^2 + ', 'bloque cortado dentro de un bloque: no devuelve vacío');
    assert.equal(p.richClip('Precio \\$5 y más texto', 12), 'Precio \\$5 y', 'un \\$ escapado no abre fórmula');
    assert.equal(p.richClip('  hola  ', 100), 'hola');
  }

  // 3b. I1: código/shell no son fórmulas; fórmulas legítimas siguen funcionando.
  {
    const literal = ['echo $HOME/$USER', 'Usa $ab$ y $cd$ hoy', 'valor $12$ y $34$', 'Usa $x=$y; en el script', 'grep ^a$|^b$ archivo', 'Cuesta $5 y $6 en total', 'Tengo $a y $b', 'el precio $x/$y', 'ver `echo $x^2$` y `$y_1$`', 'a$x^2$b', '$x^2$y', '$x^2$5', '$x^2$/2', 'pre$x^2$ post'];
    for (const t of literal) { assert.equal(p.richParts(t), null, 'I1 debe quedar literal: ' + t); assert.equal(p.X('p', t).textContent, t); }
    const kinds = t => p.richParts(t).map(c => c.type === '#text' ? c.textContent : c.type);
    assert.deepEqual(kinds('Sea $x$ la incógnita'), ['Sea ', 'math', ' la incógnita']);
    assert.deepEqual(kinds('Si $a=b$ entonces'), ['Si ', 'math', ' entonces']);
    assert.deepEqual(kinds('Vale $x^2$.'), ['Vale ', 'math', '.']); assert.deepEqual(kinds('($x_1$)'), ['(', 'math', ')']); assert.deepEqual(kinds('$\\frac{a}{b}$'), ['math']);
    assert.deepEqual(kinds('Con `$x^2$` y $y^2$'), ['Con `$x^2$` y ', 'math']);
    // M2: `$a$$b$` pegadas se dejan literales (decisión documentada); display sí
    assert.equal(p.richParts('$a^2$$b^2$'), null);
    // `pre` nunca interpreta
    const pre = p.X('pre', 'Línea $x^2$'); assert.equal(pre.textContent, 'Línea $x^2$'); assert.equal(pre.children.length, 0);
    assert.ok(p.richSignal('x^2') && p.richSignal('a=b') && p.richSignal('\\alpha') && p.richSignal('x') && !p.richSignal('HOME/') && !p.richSignal('y; ') && !p.richSignal('ab'));
  }

  // 3c. I2: un argumento sin llaves es UN solo token. M2: caracteres de control/formato => fallback.
  {
    assert.equal(mathOf('\\frac12x'), '<math><mfrac><mn>1</mn><mn>2</mn></mfrac><mi>x</mi></math>');
    assert.equal(mathOf('x^10'), '<math><msup><mi>x</mi><mn>1</mn></msup><mn>0</mn></math>');
    assert.equal(mathOf('(x_1,2)'), '<math><mo>(</mo><msub><mi>x</mi><mn>1</mn></msub><mo>,</mo><mn>2</mn><mo>)</mo></math>');
    assert.equal(mathOf('x_{10}'), '<math><msub><mi>x</mi><mrow><mn>10</mn></mrow></msub></math>');
    assert.equal(mathOf('\\sqrt25'), '<math><msqrt><mn>2</mn></msqrt><mn>5</mn></math>');
    for (const bad of ['x‮^2', 'x​^2', 'x\u0007', '⁦x^2', 'x­^2']) assert.equal(p.texToMathML(bad), null, 'control/formato: ' + JSON.stringify(bad));
    assert.notEqual(p.texToMathML('a\n+\tb'), null, 'tab y salto de línea sí');
    assert.equal(p.richParts('mira $x^2‮$ ya'), null);
  }

  // 3d. C1 (espejo de compact_rich): corte idéntico salvo dentro de una fórmula cercana con delimitadores válidos.
  {
    const price = 'Pagué $500 por el horno ' + 'x'.repeat(100); assert.equal(p.richClip(price, 40), price.trim().slice(0, 40), 'precio: corte plano');
    assert.equal(p.richClip('Cuesta $5 y $6 en total y mucho más texto', 14), 'Cuesta $5 y $6', 'dos precios: plano');
    assert.equal(p.richClip('$$' + 'x'.repeat(300) + '$$', 100), ('$$' + 'x'.repeat(300) + '$$').slice(0, 100), 'bloque sin señal matemática: corte plano');
    assert.equal(p.richClip('Precio $ ' + 'a'.repeat(50), 20), ('Precio $ ' + 'a'.repeat(50)).slice(0, 20), 'apertura con espacio: plano');
    const longF = 'Hola $' + 'x^2+'.repeat(80) + '1$ fin'; assert.equal(p.richClip(longF, 300), longF.slice(0, 300), 'fórmula abierta a más de 240: plano');
    assert.equal(p.richClip('$x^2 + y^2$ resto muy largo del texto', 4), '$x^2', 'nunca vacío: el texto empieza por la fórmula abierta');
    assert.equal(p.richClip('', 5), ''); assert.equal(p.richClip(null, 5), ''); assert.equal(p.richClip('abcdef', 3), 'abc');
  }

  // 6. Evaluador: precedencia, lista blanca, inyección, división por cero.
  {
    const ev = (src, vars = {}) => { const { tree } = p.exploreParse(src, Object.keys(vars)); return p.exploreEval(tree, new Map(Object.entries(vars))); };
    assert.equal(ev('2+3*4'), 14); assert.equal(ev('(2+3)*4'), 20); assert.equal(ev('-2^2'), -4); assert.equal(ev('2^3^2'), 512); assert.equal(ev('2^-1'), 0.5);
    assert.equal(ev('10/4'), 2.5); assert.equal(ev('10-3-2'), 5); assert.equal(ev('8/4/2'), 1); assert.equal(ev('-(-3)'), 3); assert.equal(ev('+4'), 4);
    assert.equal(ev('sqrt(16)'), 4); assert.equal(ev('abs(-3)'), 3); assert.equal(ev('max(1,5,3)'), 5); assert.equal(ev('min(4,2)'), 2); assert.equal(ev('log10(1000)'), 3);
    assert.ok(Math.abs(ev('ln(exp(2))') - 2) < 1e-12); assert.ok(Math.abs(ev('sin(0)')) < 1e-12); assert.equal(ev('cos(0)'), 1); assert.equal(ev('tan(0)'), 0);
    assert.equal(ev('a*b+c', { a: 2, b: 3, c: 4 }), 10); assert.equal(ev('1.5e3'), 1500); assert.equal(ev('.5'), 0.5);
    for (const bad of ['', '   ', '2x', 'x', 'foo(1)', 'eval(1)', 'Function("return 1")()', 'constructor', '__proto__', 'window', 'this', 'globalThis', 'toString', 'a.b', 'x["y"]', 'x[0]', '1;2', '2 3', '(1', '1)', 'sqrt()', 'sqrt(1,2)', 'min(1)', 'max(1,2,3,4,5)', '2**3', '1,2', 'ln', '`a`', "'a'", '1+', '*2', 'sqrt', 'x'.repeat(201), '('.repeat(30) + '1' + ')'.repeat(30), '1+'.repeat(130) + '1', 'constructor.constructor("return 1")()'])
      assert.throws(() => p.exploreParse(bad, []), RangeError, 'debe rechazar: ' + bad.slice(0, 40));
    assert.throws(() => p.exploreParse('a+b', ['a']), RangeError, 'identificador no declarado');
    // división por cero y no finitos: «fuera de rango», sin lanzar
    const blk = { title: 'T', expression: '1/(x-5)', variables: [{ name: 'x', label: 'X', unit: '', min: 0, max: 9, step: 1, value: 2 }], output: { label: 'Y', unit: '' }, prompt_before: 'p', takeaway: 't' };
    assert.equal(p.exploreValidate(blk), null, 'I5: una asíntota no pasa el validador (aunque la rejilla de 5 puntos no la toque)'); assert.ok(Number.isNaN(p.exploreRun(blk, new Map([['x', 5]]))));
    assert.ok(Number.isFinite(p.exploreRun(blk, new Map([['x', 2]]))));
    const { tree } = p.exploreParse('1/0', []); assert.equal(p.exploreEval(tree, new Map()), Infinity);
    // el evaluador no ve globales: una variable declarada solo se resuelve con el Map recibido
    const probe = p.exploreParse('a', ['a']).tree; assert.ok(Number.isNaN(p.exploreEval(probe, new Map())), 'sin valor en el Map: NaN, no un global');
  }

  // 7. exploreValidate: contrato local.
  {
    const one = (expression, min, max, step, value) => ({ title: 'T', expression, variables: [{ name: 'x', label: 'X', unit: '', min, max, step, value }], output: { label: 'Y', unit: '' }, prompt_before: 'p', takeaway: 't' });
    // I5: discontinuidades que la rejilla de 5 puntos no veía
    assert.equal(p.exploreValidate(one('1/(x-1.3)', 1, 2, 0.1, 1.5)), null, 'asíntota en 1.3'); assert.equal(p.exploreValidate(one('tan(x)', 0, 3, 0.1, 1)), null, 'tan cruza pi/2');
    assert.ok(p.exploreValidate(one('x^2', 0.5, 4, 0.5, 2)), 'una función suave pasa'); assert.ok(p.exploreValidate(one('sin(x)', 0, 3, 0.1, 1)), 'sin suave pasa');
    // M4: el paso divide el rango y el valor cae en la malla (con tolerancia)
    assert.equal(p.exploreValidate(one('x*2', 0, 10, 3, 3)), null, 'paso que no divide el rango'); assert.equal(p.exploreValidate(one('x*2', 0, 10, 2, 3)), null, 'valor fuera de la malla');
    assert.ok(p.exploreValidate(one('x*2', 0, 1, 0.1, 0.3)), 'tolerancia de coma flotante: 0.3 en paso 0.1'); assert.ok(p.exploreValidate(one('x*2', 0, 10, 2, 4)));
    // M7: el tamaño se mide en bytes UTF-8 (igual que el servidor)
    assert.equal(p.exploreSize({ a: 'ñ' }), 10); assert.equal(p.exploreSize({ a: '😀' }), 12);
    const wide = one('x*2', 0, 10, 1, 5); wide.takeaway = 'ñ'.repeat(200); wide.prompt_before = 'ñ'.repeat(200); wide.title = 'ñ'.repeat(80); wide.output.label = 'ñ'.repeat(60); wide.variables[0].label = 'ñ'.repeat(60);
    assert.ok(p.exploreSize(p.exploreValidate(wide)) <= 4000);
    const base = () => ({ title: 'Espesor y masa', expression: 'k*t^2+c', variables: [{ name: 'k', label: 'Constante', unit: '', min: 1, max: 5, step: 0.5, value: 2 }, { name: 't', label: 'Espesor', unit: 'µm', min: 20, max: 120, step: 5, value: 60 }, { name: 'c', label: 'Base', unit: 'g', min: 0, max: 10, step: 1, value: 3 }], output: { label: 'Masa', unit: 'g' }, prompt_before: '¿Qué pasa si duplicas el espesor?', takeaway: 'Crece con el cuadrado.' });
    const ok = p.exploreValidate(base()); assert.ok(ok); assert.deepEqual(ok.variables.map(v => v.name), ['k', 't', 'c']); assert.equal(ok.expression, 'k*t^2+c');
    const mutate = fn => { const b = base(); fn(b); return p.exploreValidate(b); };
    assert.equal(mutate(b => { b.variables[0].name = 'constructor'; b.expression = 'constructor*t^2+c'; }), null, 'nombre reservado');
    assert.equal(mutate(b => { b.variables[0].name = '__proto__'; }), null);
    assert.equal(mutate(b => { b.variables[0].name = 'sqrt'; b.expression = 'sqrt*t+c'; }), null, 'nombre de función');
    assert.equal(mutate(b => { b.variables[1].name = 'k'; }), null, 'nombres repetidos');
    assert.equal(mutate(b => { b.expression = 'k*t^2'; }), null, 'variable declarada y no usada');
    assert.equal(mutate(b => { b.expression = 'k*t^2+c+z'; }), null, 'variable no declarada');
    assert.equal(mutate(b => { b.variables[0].value = 1; }), null, 'min<value exige estricto');
    assert.equal(mutate(b => { b.variables[0].value = 5; }), null, 'value<max exige estricto');
    assert.equal(mutate(b => { b.variables[0].min = 6; }), null);
    assert.equal(mutate(b => { b.variables[0].max = Infinity; }), null, 'rango finito');
    assert.equal(mutate(b => { b.variables[0].step = 0; }), null); assert.equal(mutate(b => { b.variables[0].step = -1; }), null); assert.equal(mutate(b => { b.variables[0].step = 0.0001; }), null, 'demasiados pasos');
    assert.equal(mutate(b => { b.variables = []; }), null); assert.equal(mutate(b => { b.variables = [...b.variables, { name: 'z', label: 'Z', unit: '', min: 0, max: 2, step: 1, value: 1 }, { name: 'w', label: 'W', unit: '', min: 0, max: 2, step: 1, value: 1 }]; b.expression += '+z+w'; }), null, 'más de 4 variables');
    assert.equal(mutate(b => { b.expression = 'k*t^2+c+$x$'; }), null, 'LaTeX no es expresión');
    assert.equal(mutate(b => { b.expression = '0*k*t+0*c+7'; }), null, 'la salida no varía');
    assert.equal(mutate(b => { b.expression = 'k*t+0*c+c-c'; }), null, 'una variable no cambia la salida');
    assert.equal(mutate(b => { b.expression = 'ln(k-3)+t+c'; }), null, 'no finita en la rejilla');
    assert.equal(mutate(b => { b.title = ''; }), null); assert.equal(mutate(b => { b.takeaway = '  '; }), null); assert.equal(mutate(b => { b.output.label = ''; }), null); assert.equal(mutate(b => { b.output = null; }), null);
    assert.equal(p.exploreValidate(null), null); assert.equal(p.exploreValidate([]), null); assert.equal(p.exploreValidate('x'), null);
    // un `$` huérfano por recorte no se guarda: el título largo con fórmula se corta antes de ella
    const long = mutate(b => { b.title = 'a'.repeat(75) + ' $x^2 + y^2$'; }); assert.equal(long.title, 'a'.repeat(75));
  }

  // 8. UI de «Explora la relación» sobre el DOM simulado.
  const block = () => ({ title: 'Masa de recubrimiento', expression: 'k*t', variables: [{ name: 'k', label: 'Densidad', unit: 'g/cm³', min: 1, max: 5, step: 0.5, value: 2 }, { name: 't', label: 'Espesor', unit: 'µm', min: 20, max: 120, step: 5, value: 60 }], output: { label: 'Masa', unit: 'g' }, prompt_before: 'Predice cómo cambia $m = k t$ al subir el espesor.', takeaway: 'La masa crece de forma lineal con el espesor.', explore_id: 'explore-test-1' });
  const node = { id: 'a', name: 'Espesor', level: 0, prerequisites: [], outcome: 'Controlar el espesor', probe: { prompt: 'Explica', kind: 'explanation' } };
  const Q = { check: { prompt: '¿Por qué medir $t$?', reference: 'r', kind: 'explanation' }, guided: { prompt: 'g', reference: 'r', kind: 'application' }, independent: { prompt: 'i', reference: 'r', kind: 'application' }, integration: { prompt: 'x', reference: 'r', kind: 'context_case' } };
  const goal = (lesson = {}) => ({ id: 'g', profile_id: 'profile-test', goal: 'Pintura', nodes: [node], learner: {}, reviews: [], events: [], coverage: [{ id: 'a', name: 'a', status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] }],
    lessons: { a: { explanation: 'El curado depende de $t$ = 60 µm.', example: 'Con $m = k t$ y k = 2: m = 120.', common_error: 'Ignorar las unidades.', ...Q, adaptation_mode: 'initial', ...lesson } }, session: { mode: 'TEACH', node: 'a', stack: [], tries: 0, hints: 0 } });
  const attach = g => { p.exploreFailed.clear(); p.setProfileForTests({ profile_id: 'profile-test', name: 'Sintético', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; };
  const types = g => g.events.map(e => e.type);
  const sliders = () => findAll(e => e.type === 'range');

  {
    // 8a. La lección renderiza las fórmulas de contenido como MathML en la superficie de explicación/ejemplo/error.
    const g = attach(goal()); await p.session(); await settle();
    assert.ok(byType('math').length >= 2, 'explicación y ejemplo con fórmulas');
    assert.equal(byType('math').find(m => m.getAttribute('alttext') === 'm = k t') !== undefined, true);
    assert.ok(find('Explorar con valores'), 'hay dígitos/fórmula: se ofrece explorar');
    assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0);
  }
  {
    // 8b. Sin números ni fórmulas no se ofrece; con explore_na tampoco.
    attach(goal({ explanation: 'Idea cualitativa.', example: 'Un caso sin cifras.' })); await p.session(); await settle();
    assert.equal(find('Explorar con valores'), null, 'sin relación cuantitativa aparente no se ofrece');
    attach(goal({ explore_na: true })); await p.session(); await settle();
    assert.equal(find('Explorar con valores'), null, 'tras un «no aplica» no vuelve a ofrecerse');
    assert.equal(byType('section').filter(s => s.className.includes('explore')).length, 0);
  }
  {
    // 8c. «No aplica» del servidor: nada roto, nada guardado salvo la marca.
    const g = attach(goal()); exploreReply = { applicable: false, message: 'Este tema no tiene una relación numérica que se pueda explorar.' }; apiCalls.length = 0;
    await p.session(); await settle(); find('Explorar con valores').onclick(); await settle(30);
    const call = apiCalls.find(c => c.route === '/api/explore'); assert.ok(call, 'llama a /api/explore');
    assert.equal(call.body.goal, 'Pintura'); assert.equal(call.body.node.id, 'a'); assert.ok(call.body.lesson.explanation);
    assert.equal(g.lessons.a.explore, undefined); assert.equal(g.lessons.a.explore_na, true); assert.equal(find('Explorar con valores'), null);
    assert.equal(g.events.filter(e => e.type.startsWith('EXPLORE')).length, 0, 'un «no aplica» no crea eventos');
    // bloque inválido del servidor: error en español, nada guardado
    const g2 = attach(goal()); exploreReply = { applicable: true, explore: { ...block(), expression: 'k*t+z' } };
    await p.session(); await settle(); find('Explorar con valores').onclick(); await settle(30);
    assert.equal(g2.lessons.a.explore, undefined); assert.ok(/no se guardó nada/.test(roots.status.textContent), roots.status.textContent);
    // M5: tras un fallo no se reintenta en la sesión: el botón desaparece y se explica
    await p.session(); await settle(); assert.equal(find('Explorar con valores'), null, 'fallo recordado: sin botón'); assert.ok(has('No se pudo preparar una exploración'));
    p.exploreFailed.clear();
    // error del servidor
    const g3 = attach(goal()); exploreReply = new Error('La exploración no cumplió el contrato; no se guardó nada. Reintenta.');
    await p.session(); await settle(); find('Explorar con valores').onclick(); await settle(30);
    assert.equal(g3.lessons.a.explore, undefined); assert.ok(/no se guardó nada/.test(roots.status.textContent));
    // bloque válido: se guarda con explore_id y se pinta
    const g4 = attach(goal()); exploreReply = { applicable: true, explore: (({ explore_id, ...rest }) => rest)(block()) };
    await p.session(); await settle(); find('Explorar con valores').onclick(); await settle(30);
    assert.ok(g4.lessons.a.explore && /^explore-/.test(g4.lessons.a.explore.explore_id), 'guardado en la lección con id');
    assert.ok(has('Explora la relación')); assert.equal(g4.events.filter(e => e.type === 'EVIDENCE').length, 0);
  }
  {
    // 8d. Predecir -> explorar -> comprobar.
    const g = attach(goal({ explore: block() })); p.exploreUi.clear();
    const before = JSON.stringify(g.coverage), answersBefore = p.studyAnswers(p.setStoreForTests({ goals: [g], active: g.id }), 0, Date.now() + 1e12);
    await p.session(); await settle();
    assert.ok(has('Primero predice; luego compruebas. Es exposición: no cuenta como evidencia'));
    assert.deepEqual(types(g).filter(t => t.startsWith('EXPLORE')), ['EXPLORE_VIEWED']);
    assert.equal(sliders().length, 0, 'los deslizadores aparecen tras la predicción (o al saltarla)');
    const pregunta = findAll(e => /^Si cambias Densidad de 2 a 4 g\/cm³/.test(e.textContent))[0];
    assert.ok(pregunta, 'pregunta cualitativa local con variable, valores y salida: ' + findAll(e => e.type === 'p').map(e => e.textContent).join(' | '));
    assert.ok(byType('math').some(m => m.getAttribute('alttext') === 'm = k t'), 'prompt_before admite fórmulas');
    for (const l of ['Sube', 'Baja', 'Queda casi igual']) assert.ok(find(l), l);
    find('Baja').onclick();   // la correcta es «sube» (k*t con k de 2 a 4): el cliente la calcula
    const pe = g.events.find(e => e.type === 'EXPLORE_PREDICTION'); assert.ok(pe);
    assert.equal(pe.predicted, 'baja'); assert.equal(pe.actual, 'sube'); assert.equal(pe.matched, false);
    assert.equal(pe.creates_evidence, false); assert.equal(pe.policy_version, 'rich_content_v1'); assert.equal(pe.node_id, 'a');
    assert.ok(has('No coincide'), 'retroalimentación no calificada de la predicción');
    const ranges = sliders(); assert.equal(ranges.length, 2);
    assert.deepEqual(ranges.map(r => r.attrs['aria-label']), ['Densidad', 'Espesor']);
    assert.ok(ranges.every(r => r.min !== undefined && r.max !== undefined && r.step !== undefined));
    assert.ok(has('Masa: 120 g'), 'resultado en vivo');
    ranges[1].value = '100'; ranges[1].oninput(); assert.ok(has('Masa: 200 g'), 'el resultado se actualiza al mover');
    assert.ok(has('100 µm'), 'valor con unidad junto al deslizador');
    ranges[1].value = '9999'; ranges[1].oninput(); assert.ok(has('Masa: 240 g'), 'el valor se acota al rango');
    const svg = byType('svg')[0]; assert.ok(svg, 'gráfica SVG'); assert.equal(svg.getAttribute('viewBox'), '0 0 320 190'); assert.equal(svg.ns, 'http://www.w3.org/2000/svg');
    assert.ok(findAll(e => e.getAttribute && e.getAttribute('class') === 'explore-curve', svg).length === 1); assert.ok(findAll(e => e.getAttribute && e.getAttribute('class') === 'explore-dot', svg).length === 1);
    assert.ok(/Gráfica de Masa frente a Densidad/.test(svg.getAttribute('aria-label')));
    const sel = byType('select')[0]; assert.ok(sel, 'selector de variable del eje (más de una variable)'); sel.value = 't'; sel.onchange(); assert.ok(/frente a Espesor/.test(byType('svg')[0].getAttribute('aria-label')));
    assert.ok(!has('La masa crece de forma lineal'), 'la conclusión aparece tras «Comprobar»');
    find('Comprobar').onclick(); assert.ok(has('La masa crece de forma lineal'));
    // volver a pintar no duplica eventos
    await p.session(); await settle();
    assert.equal(types(g).filter(t => t === 'EXPLORE_VIEWED').length, 1); assert.equal(types(g).filter(t => t === 'EXPLORE_PREDICTION').length, 1);
    // nada de esto es evidencia ni cambia cobertura, meta diaria o racha
    assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0); assert.equal(JSON.stringify(g.coverage), before);
    assert.equal(p.studyAnswers({ goals: [g], active: g.id }, 0, Date.now() + 1e12), answersBefore, 'EXPLORE_* no cuenta como respuesta de estudio');
    assert.equal(p.verified(g, 'a'), false); assert.equal(g.events.filter(e => e.type.startsWith('EXPLORE') && e.creates_evidence !== false).length, 0);
    assert.equal(p.lastExposure(g, 'a'), Math.max(0, ...g.events.filter(e => e.type === 'TEACHING_EXPOSURE').map(e => e.at)), 'EXPLORE_* no mueve la última exposición del calendario de repaso (solo cuenta la enseñanza de siempre)');
  }
  {
    // 8e. «Explorar sin predecir» no registra predicción; «fuera de rango» sin romper.
    const b = block(); b.expression = '1/(t-35)'; b.variables = [{ name: 't', label: 'Espesor', unit: 'µm', min: 20, max: 120, step: 5, value: 60 }];
    assert.equal(p.exploreValidate(b), null, 'ya no pasa el validador'); const g = attach(goal({ explore: b })); p.exploreUi.clear();
    await p.session(); await settle(); find('Explorar sin predecir').onclick();
    assert.equal(g.events.filter(e => e.type === 'EXPLORE_PREDICTION').length, 0);
    const r = sliders()[0]; r.value = '35'; r.oninput(); assert.ok(has('Masa: fuera de rango'), 'resultado no finito => fuera de rango');
    assert.equal(g.events.filter(e => e.type === 'EVIDENCE').length, 0);
    assert.equal(find('Explorar con valores'), null);
  }
  {
    // 8f. Predicción con salida que no cambia en el paso elegido, y la respuesta correcta la fija el cálculo, no el modelo.
    const b = block(); const pk = p.explorePrediction(b);
    assert.equal(pk.v.name, 'k'); assert.equal(pk.to, 4); assert.equal(pk.dir, 'sube'); assert.equal(pk.y0, 120); assert.equal(pk.y1, 240);
    const neg = { ...block(), expression: 'k*t', variables: [{ name: 'k', label: 'K', unit: '', min: -4, max: 4, step: 1, value: -2 }, { name: 't', label: 'T', unit: '', min: 1, max: 9, step: 1, value: 3 }] };
    const pn = p.explorePrediction(neg); assert.equal(pn.v.name, 't', 'I6: la variable con valor negativo se salta'); assert.equal(pn.to, 6);
    const only = (expression, min, max, step, value) => ({ ...block(), expression, variables: [{ name: 'x', label: 'X', unit: '', min, max, step, value }] });
    assert.equal(p.explorePrediction(only('x*2', -5, 5, 1, -2)), null, 'I6: solo valores negativos => sin predicción'); assert.equal(p.explorePrediction(only('x*2', -4, 4, 1, 0)), null, 'valor 0 => sin predicción');
    assert.equal(p.explorePrediction(only('x*x-4*x', 0, 8, 1, 3)), null, 'segmento no monótono (3 a 6 baja y sube) => sin predicción');
    assert.equal(p.explorePrediction(only('x-5', 1, 9, 1, 3)), null, 'el signo de la salida cambia en el segmento');
    assert.equal(p.explorePrediction(only('1000+0.1*x', 0, 1000, 5, 5)).dir, 'igual', 'I6: 1000+0.1x casi no cambia, con el umbral relativo al rango de la salida');
    assert.equal(p.explorePrediction(only('1000+x', 0, 1000, 10, 100)).dir, 'sube');
    assert.equal(p.explorePrediction(only('x*2', 1, 100, 1, 50)).dir, 'sube');
  }
  {
    // 8f2. M5 candidato, M7 etiquetas largas, M8 lección sustituida, I6 sin predicción => directo a explorar.
    const cand = (explanation, example = '') => p.exploreCandidate({ explanation, example });
    assert.equal(cand('Un recubrimiento tiene 5 capas.'), false, 'un número suelto no basta'); assert.equal(cand('Cuesta $5 y $6.'), false, 'precios no son fórmulas');
    assert.equal(cand('Aplica $m = k t$.'), true, 'fórmula con ='); assert.equal(cand('Con 25 mm de espesor y 80 °C de temperatura.'), true, 'dos magnitudes con unidad');
    assert.equal(cand('Con 25 mm de espesor.'), false, 'una sola magnitud'); assert.equal(cand('Fórmula $x^2$.'), false, 'sin igualdad no basta');
    assert.equal(cand('Tiene 3 piezas y 5 pasos.'), false, 'cantidades sin unidad');
    // M7: la etiqueta larga del eje Y cabe en el viewBox
    const wideBlock = { title: 'T', expression: 'k*t*1000000', variables: [{ name: 'k', label: 'K', unit: '', min: 1, max: 5, step: 0.5, value: 2 }, { name: 't', label: 'T', unit: '', min: 20, max: 120, step: 5, value: 60 }], output: { label: 'Y', unit: '' }, prompt_before: 'p', takeaway: 't' };
    const svgW = p.exploreChart(wideBlock, { chartVar: 'k', values: new Map([['k', 2], ['t', 60]]) });
    const texts = findAll(e => e.getAttribute && e.getAttribute('class') === 'explore-tick', svgW), yTick = texts.find(e => e.getAttribute('text-anchor') === 'end' && Number(e.getAttribute('x')) < 100);
    const axisPath = findAll(e => e.getAttribute && e.getAttribute('class') === 'explore-axis', svgW)[0]; const left = Number(/^M(\d+)/.exec(axisPath.getAttribute('d'))[1]);
    assert.ok(yTick && left >= yTick.textContent.length * 6, 'margen izquierdo >= ancho estimado de la etiqueta (' + left + ' vs ' + yTick.textContent.length + ')');
    // I5/chart: el trazo se corta en puntos no finitos
    const gap = { ...wideBlock, expression: '1/(t-35)', variables: [wideBlock.variables[1]] }; const svgG = p.exploreChart(gap, { chartVar: 't', values: new Map([['t', 60]]) });
    assert.ok((findAll(e => e.getAttribute && e.getAttribute('class') === 'explore-curve', svgG)[0].getAttribute('d').match(/M/g) || []).length >= 2, 'el trazo se interrumpe en la asíntota');
    // M8: si la lección fue sustituida mientras esperaba la respuesta, no se escribe en la vieja
    const gm = attach(goal()); exploreReply = { applicable: true, explore: (({ explore_id, ...rest }) => rest)(block()) };
    await p.session(); await settle(); const btn = find('Explorar con valores'), oldLesson = gm.lessons.a; gm.lessons.a = { ...oldLesson, explanation: 'Otra lección' };
    btn.onclick(); await settle(30); assert.equal(oldLesson.explore, undefined, 'M8: no escribe en la lección vieja'); assert.equal(gm.lessons.a.explore, undefined, 'ni en la nueva');
    // I6: sin predicción posible => va directo a explorar y lo dice
    const np = block(); np.expression = 'k*t-100'; np.variables[0].value = 2; np.variables[1].value = 20; np.variables[1].min = 10;
    const gn = attach(goal({ explore: { ...np, expression: 'x*x-4*x', variables: [{ name: 'x', label: 'X', unit: '', min: 0, max: 8, step: 1, value: 3 }], output: { label: 'Y', unit: '' } } })); p.exploreUi.clear();
    await p.session(); await settle();
    assert.ok(has('no hay un cambio simple que predecir'), 'nota local'); assert.equal(find('Sube'), null); assert.ok(find('Explorar')); find('Explorar').onclick(); assert.equal(sliders().length, 1);
    assert.equal(gn.events.filter(e => e.type === 'EXPLORE_PREDICTION').length, 0);
  }
  {
    // 8g. normalizeGoal: lo malformado se descarta sin rechazar la meta; lo válido sobrevive; tamaño acotado.
    const raw = goal({ explore: { ...block(), expression: 'k*t+zzz' } });
    const n1 = p.normalizeGoal(raw); assert.equal(n1.lessons.a.explore, undefined, 'bloque inválido descartado'); assert.equal(n1.lessons.a.explanation, raw.lessons.a.explanation);
    const n2 = p.normalizeGoal(goal({ explore: block(), explore_na: 'si' })); assert.equal(n2.lessons.a.explore.explore_id, 'explore-test-1'); assert.equal(n2.lessons.a.explore_na, undefined);
    const n3 = p.normalizeGoal(goal({ explore: { ...block(), explore_id: 'x'.repeat(200) } })); assert.ok(/^explore-/.test(n3.lessons.a.explore.explore_id), 'id demasiado largo: se regenera');
    const n4 = p.normalizeGoal(goal({ explore: 'texto' })); assert.equal(n4.lessons.a.explore, undefined);
    const n5 = p.normalizeGoal(goal({ explore: { ...block(), variables: [{ name: 'k', label: 'K'.repeat(5000), unit: '', min: 1, max: 5, step: 1, value: 2 }], expression: 'k*3' } }));
    assert.equal(n5.lessons.a.explore.variables[0].label.length, 60);
    const n6 = p.normalizeGoal(goal({ explore: block(), explore_na: true })); assert.equal(n6.lessons.a.explore_na, true);
    const big = block(); big.title = 'x'.repeat(10); assert.ok(JSON.stringify(p.exploreValidate(big)).length < 4000);
    assert.ok(!JSON.stringify(n2).includes('_tree'), 'el árbol compilado no se persiste');
  }
  {
    // 8h. CSS: toda clase nueva tiene estilo; objetivo táctil de 44 px; tokens del tema; sin colores fijos.
    const css = p.VISUAL_CSS;
    for (const c of ['math-block', 'lesson-example', 'explore', 'explore-title', 'explore-slider', 'explore-out', 'explore-pred', 'explore-takeaway', 'explore-chart', 'explore-svg', 'explore-axis', 'explore-curve', 'explore-dot', 'explore-tick'])
      assert.ok(css.includes('.' + c), 'sin estilo: ' + c);
    assert.ok(/\.explore-slider input\[type=range\]\{[^}]*min-height:44px/.test(css), 'deslizador >= 44 px');
    const rich = css.slice(css.indexOf('.math-block'), css.indexOf('@media(max-width:820px)'));
    assert.ok(!/#[0-9a-fA-F]{3,6}/.test(rich), 'solo tokens del tema, sin colores fijos'); assert.ok(/var\(--info\)/.test(rich) && /var\(--go\)/.test(rich));
    assert.ok(/prefers-reduced-motion/.test(css)); assert.ok(css.includes('.lesson-example'), 'contenedor del ejemplo con estilo');
  }
  {
    // 8i. Cada superficie de contenido usa el punto único X (explicación, ejemplo, error, pregunta, opción, feedback, escalera, pasos, ejemplo resuelto).
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    for (const needle of ["X('p',l.explanation)", "X('div',l.example,'lesson-example')", "X('h3',question.prompt)", "X('p',assessment.feedback)", "richInto(button,`${o.id}) ${o.text}`)", "X('p',pk.model_answer)", "X('p',pk.steps[stage-1].body)", "X('h3',step.predict.prompt)", "X('p',f.worked.prompt)", "X('p',teaching.explanation)", "X('p',String(result.explanation||''))"])
      assert.ok(src.includes(needle), 'falta el punto único en: ' + needle);
  }
  {
    // 9. Los helpers no usan eval/Function/innerHTML con texto del modelo.
    const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const start = src.indexOf('// ===== rich_content_v1'), end = src.indexOf('function installVisualTheme') > start ? src.length : src.indexOf('\nconst g=()=>');
    const rich = src.slice(start, src.indexOf('function requestExplore'));
    for (const forbidden of [/\beval\s*\(/, /new Function/, /\bFunction\s*\(/, /innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /setTimeout\s*\(\s*['"`]/])
      assert.ok(!forbidden.test(rich), 'API insegura en rich_content: ' + forbidden);
    assert.ok(end > start);
  }
  console.log('rich_content.test.js OK');
})().catch(e => { logError('FALLO', e); process.exit(1); });
