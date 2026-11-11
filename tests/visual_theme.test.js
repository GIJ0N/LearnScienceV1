// visual_theme_v2: tokens, contraste WCAG, foco, movimiento reducido, cobertura de clases y tema seguro sin localStorage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
function element(type = 'div') { return { type, textContent: '', id: '', children: [], style: {}, dataset: {}, append(...x) { this.children.push(...x); }, setAttribute() {}, ariaLabel: '' }; }
const head = element('head');
const documentElement = element('html');
const roots = { app: element(), status: element() };
global.document = { getElementById: id => (id === 'ruta-visual-v2' ? head.children.find(c => c.id === id) || null : roots[id]), createElement: element, head, documentElement };
let storage = {}, storageThrows = false;
global.localStorage = { getItem: k => { if (storageThrows) throw new Error('bloqueado'); return storage[k] ?? null; }, setItem: (k, v) => { if (storageThrows) throw new Error('bloqueado'); storage[k] = String(v); } };
const p = require('../app.js');
const css = p.VISUAL_CSS;

const tokens = ['bg', 'surface', 'ink', 'muted', 'line', 'go', 'go-deep', 'on-go', 'sun', 'info', 'bad', 'good-bg', 'bad-bg', 'unknown-bg'];
const light = { bg: '#F3F6F1', surface: '#FFFFFF', ink: '#16211C', muted: '#55655D', line: '#D9E0D6', go: '#1F7A5C', 'go-deep': '#145C44', 'on-go': '#FFFFFF', sun: '#8A5A0C', info: '#2F5FD0', bad: '#B93A26', 'good-bg': '#E3F3EA', 'bad-bg': '#FBE9E5', 'unknown-bg': '#EEF0F4' };
const dark = { bg: '#0E1512', surface: '#17211C', ink: '#EEF4EF', muted: '#A7B6AD', line: '#2C3A33', go: '#57C79E', 'go-deep': '#2F8F6D', 'on-go': '#08110D', sun: '#F2B33D', info: '#8FB0FF', bad: '#FF9C8A', 'good-bg': '#16352A', 'bad-bg': '#3A1C17', 'unknown-bg': '#222A33' };
const block = sel => { const i = css.indexOf(sel + '{'); assert.ok(i >= 0, 'falta el bloque ' + sel); return css.slice(i, css.indexOf('}', i)); };
const read = (blk, name) => { const m = blk.match(new RegExp('--' + name + ':(#[0-9A-Fa-f]{6})')); return m && m[1].toUpperCase(); };
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

(async () => {
  // Tokens presentes y exactos en ambos temas.
  const L = block(':root'), D = block(':root[data-theme="dark"]');
  for (const t of tokens) { assert.equal(read(L, t), light[t].toUpperCase(), 'claro --' + t); assert.equal(read(D, t), dark[t].toUpperCase(), 'oscuro --' + t); }
  assert.ok(L.includes('color-scheme:light') && D.includes('color-scheme:dark'));

  // Contraste WCAG AA (≥ 4.5) en ambos temas.
  const pairs = [['ink', 'bg'], ['ink', 'surface'], ['muted', 'surface'], ['on-go', 'go'], ['bad', 'bad-bg'], ['sun', 'surface'], ['info', 'surface']];
  for (const [name, set] of [['claro', light], ['oscuro', dark]]) for (const [a, b] of pairs) {
    const r = ratio(set[a], set[b]); assert.ok(r >= 4.5, `contraste ${name} --${a} sobre --${b}: ${r.toFixed(2)} < 4.5`);
  }

  // Accesibilidad y movimiento.
  assert.ok(css.includes('prefers-reduced-motion'), 'respeta movimiento reducido');
  assert.ok(css.includes(':focus-visible'), 'foco visible');
  assert.ok(/min-height:44px/.test(css), 'objetivo táctil de 44 px');
  assert.ok(/@media\(max-width:640px\)/.test(css), 'regla móvil a 640 px');
  assert.ok(!/ui-sans-serif|Inter,/.test(css), 'solo fuentes del sistema');

  // Toda clase asignada con className= está definida en VISUAL_CSS.
  const src = fs.readFileSync(require.resolve('../app.js'), 'utf8').replace(/const VISUAL_CSS=`[\s\S]*?\n`;/, '');
  const used = new Set();
  for (const m of src.matchAll(/className\s*=\s*(['"`])(.*?)\1/g)) for (const c of m[2].split(/\s+/)) if (c && !c.endsWith('-')) used.add(c);
  const missing = [...used].filter(c => !new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '(?![\\w-])').test(css));
  assert.deepEqual(missing, [], 'clases sin estilo: ' + missing.join(', '));

  // Instalación: una sola vez, id v2, tema claro por defecto.
  // La instalación ocurre al cargar app.js.
  assert.equal(head.children[0].id, 'ruta-visual-v2');
  assert.equal(p.installVisualTheme(), false, 'no se duplica');
  assert.equal(documentElement.dataset.theme, 'light');

  // Alternar y recordar.
  assert.equal(p.toggleTheme(), 'dark'); assert.equal(documentElement.dataset.theme, 'dark'); assert.equal(storage['ruta-theme'], 'dark');
  assert.equal(p.preferredTheme(), 'dark');
  assert.equal(p.toggleTheme(), 'light'); assert.equal(storage['ruta-theme'], 'light');

  // Valor guardado inválido → claro; localStorage bloqueado no rompe nada.
  storage['ruta-theme'] = 'neón'; assert.equal(p.preferredTheme(), 'light');
  storageThrows = true;
  assert.equal(p.preferredTheme(), 'light'); assert.doesNotThrow(() => p.toggleTheme()); assert.equal(documentElement.dataset.theme, 'dark', 'el tema cambia aunque no se pueda guardar');
  storageThrows = false;

  // El tema no escribe eventos ni toca la meta.
  const goal = { id: 'g1', events: [], coverage: [], nodes: [], reviews: [], learner: {}, session: {} };
  p.setProfileForTests({ profile_id: 'profile-test', name: 'S', preferences: {} }, 1); p.setStoreForTests({ goals: [goal], active: 'g1' });
  const before = JSON.stringify(goal); p.toggleTheme(); p.toggleTheme();
  assert.equal(JSON.stringify(goal), before, 'cambiar de tema no modifica la meta');

  console.log('visual_theme: OK');
})().catch(e => { console.error(e); process.exit(1); });
