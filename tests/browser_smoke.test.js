// browser_smoke_v1: comprobación en un Chromium real contra el demo controlado (sin Gemini, SQLite temporal).
// Cubre lo que el DOM simulado no ve: alto real de la barra, visibilidad por CSS y desbordes horizontales.
// No sustituye una prueba en un teléfono real ni en Safari/iOS.
const assert = require('node:assert/strict');
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

function loadPlaywright() {
  const errors = [];
  try { return require('playwright'); } catch (e) { errors.push('require("playwright"): ' + e.message.split('\n')[0]); }
  try { return require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch (e) { errors.push('npm root -g: ' + e.message.split('\n')[0]); }
  console.error('FALLO: Playwright no está disponible, así que la prueba de navegador NO se ejecutó.\n' + errors.join('\n') +
    '\nInstálalo con «npm install -g playwright» y «npx playwright install chromium» (en CI lo hace tools/ensure_playwright.py).');
  process.exit(1);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

function run(args) {
  return new Promise((resolve, reject) => {
    const c = spawn(PYTHON, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', d => { out += d; }); c.stderr.on('data', d => { out += d; });
    c.on('exit', code => code === 0 ? resolve(out) : reject(new Error('falló ' + args.join(' ') + '\n' + out)));
    c.on('error', reject);
  });
}

let server = null, tmp = null;
function stopServer() { if (server && server.exitCode === null && !server.killed) server.kill('SIGKILL'); }
process.on('exit', stopServer);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopServer(); process.exit(130); });

async function startServer() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learnscience-browser-smoke-'));
  const db = path.join(tmp, 'demo.sqlite3');
  await run(['tools/serve_controlled_demo.py', '--prepare', '--db', db]);
  const port = await freePort();
  server = spawn(PYTHON, ['tools/serve_controlled_demo.py', '--resume', '--db', db, '--port', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('el servidor demo no arrancó en 30 s\n' + log)), 30000);
    const onData = d => { log += d; if (log.includes('DEMOSTRACI') && log.includes('http://127.0.0.1:' + port)) { clearTimeout(timer); resolve(); } };
    server.stdout.on('data', onData); server.stderr.on('data', onData);
    server.on('exit', code => { clearTimeout(timer); reject(new Error('el servidor demo terminó (' + code + ')\n' + log)); });
  });
  return 'http://127.0.0.1:' + port + '/';
}

const PROFILE = 'DEMO VISUAL SINTÉTICA';

async function openGoal(page, url) {
  await page.goto(url);
  await page.getByRole('button', { name: PROFILE }).click();
  await page.getByRole('button', { name: 'Comprender y resolver ecuaciones lineales' }).click();
  await page.getByRole('button', { name: /^Seguir: /, }).first().waitFor({ state: 'visible', timeout: 10000 });
}

// «Menú» y la marca «Ruta» en la misma fila, barra baja y sin desbordes; no depende de la fuente exacta.
async function checkClosedBar(page, etiqueta) {
  const m = await page.evaluate(() => {
    const nav = document.querySelector('.app-nav'), r = nav.getBoundingClientRect();
    const brand = nav.querySelector('.nav-brand').getBoundingClientRect(), toggle = nav.querySelector('.nav-toggle').getBoundingClientRect();
    return { height: r.height, brand: [brand.top, brand.bottom], toggle: [toggle.top, toggle.bottom, toggle.left, toggle.right, toggle.height, toggle.width],
      navRight: r.right, innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth };
  });
  console.log(etiqueta + ': barra ' + Math.round(m.height) + ' px');
  assert.ok(Math.min(m.brand[1], m.toggle[1]) - Math.max(m.brand[0], m.toggle[0]) > 0, etiqueta + ': «Menú» y «Ruta» deben estar en la misma fila ' + JSON.stringify(m));
  assert.ok(m.height <= 110, etiqueta + ': barra cerrada demasiado alta: ' + m.height + ' px');
  assert.ok(m.toggle[4] >= 43.5 && m.toggle[5] >= 43.5, etiqueta + ': «Menú» debe medir ≥ 44 px');
  assert.ok(m.toggle[3] <= m.navRight + 0.5 && m.scrollWidth <= m.innerWidth, etiqueta + ': desbordamiento horizontal ' + JSON.stringify(m));
}

const visible = (page, name) => page.getByRole('button', { name, exact: true }).first().isVisible();

async function main() {
  const { chromium } = loadPlaywright();
  let browser = null;
  try {
    const url = await startServer();
    browser = await chromium.launch();
    // --- Teléfono 390×844 ---
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', e => problems.push('pageerror: ' + e.message));
      page.on('console', m => { if (m.type() === 'error') problems.push('console.error: ' + m.text()); });
      await openGoal(page, url);

      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);
      assert.ok(noOverflow, 'desplazamiento horizontal en 390 px');

      // Barra: no cubre más del 15 % del alto tras desplazarse.
      await page.evaluate(() => window.scrollTo(0, 1400));
      const cover = await page.evaluate(() => {
        const r = document.querySelector('.app-nav').getBoundingClientRect();
        const h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
        return { h, ratio: h / window.innerHeight, position: getComputedStyle(document.querySelector('.app-nav')).position, navHeight: r.height, scrolled: window.scrollY };
      });
      console.log('390 px: barra ' + Math.round(cover.navHeight) + ' px, position:' + cover.position + ', cubre ' + (cover.ratio * 100).toFixed(1) + ' % del viewport con scrollY=' + Math.round(cover.scrolled));
      assert.ok(cover.scrolled > 0, 'la página debe poder desplazarse para que la prueba tenga sentido');
      assert.equal(cover.position, 'static', 'en móvil la barra no debe quedar fija (position: ' + cover.position + ')');
      assert.ok(cover.ratio <= 0.15, 'la barra cubre ' + (cover.ratio * 100).toFixed(1) + ' % del viewport (máximo 15 %)');

      // Exactamente un botón principal visible en el inicio.
      const primary = await page.evaluate(() => [...document.querySelectorAll('button')]
        .filter(b => !b.classList.contains('quiet') && !b.classList.contains('nav-button') && !b.classList.contains('option-card'))
        .filter(b => b.getClientRects().length > 0 && getComputedStyle(b).visibility !== 'hidden')
        .map(b => b.textContent));
      assert.equal(primary.length, 1, 'botones principales visibles en el inicio: ' + JSON.stringify(primary));

      // Barra cerrada: fuente normal y, después, una fuente más ancha (reproduce el runner de CI y teléfonos reales).
      await page.evaluate(() => window.scrollTo(0, 0));
      await checkClosedBar(page, '390 px fuente normal');
      await page.addStyleTag({ content: '.app-nav,.app-nav *{letter-spacing:.06em;font-size:20px !important}' });
      await checkClosedBar(page, '390 px fuente ancha');
      await page.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('letter-spacing:.06em')) s.remove(); });

      // Menú: «Plan» oculto hasta pulsar «Menú».
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await visible(page, 'Plan'), false, '«Plan» no debe verse con el menú cerrado');
      assert.ok(await visible(page, 'Menú'), '«Menú» debe verse en móvil');
      const menu = page.getByRole('button', { name: 'Menú', exact: true });
      assert.equal(await menu.getAttribute('aria-expanded'), 'false');
      const box = await menu.boundingBox();
      assert.ok(box.height >= 44 - 0.5 && box.width >= 44 - 0.5, 'objetivo táctil de «Menú» ≥ 44 px: ' + JSON.stringify(box));
      await menu.click();
      assert.equal(await page.getByRole('button', { name: 'Menú', exact: true }).getAttribute('aria-expanded'), 'true');
      assert.ok(await visible(page, 'Plan'), '«Plan» debe verse tras pulsar «Menú»');
      const small = await page.evaluate(() => [...document.querySelectorAll('.nav-links button')].map(b => ({ t: b.textContent, h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width })).filter(b => b.h < 43.5 || b.w < 43.5));
      assert.deepEqual(small, [], 'botones del menú con objetivo táctil < 44 px');
      assert.ok((await page.locator('.nav-links button').count()) >= 10, 'el menú abierto debe tener todos los botones');
      // Teclado: Enter sobre «Menú» alterna y conserva el foco en el botón.
      await page.getByRole('button', { name: 'Plan', exact: true }).first().waitFor({ state: 'visible' });
      await page.evaluate(() => document.getElementById('nav-toggle').focus());
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Plan', exact: true }).first().waitFor({ state: 'hidden', timeout: 5000 });
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'nav-toggle', 'tras Enter el foco debe seguir en «Menú»');
      await page.keyboard.press('Enter');
      await page.getByRole('button', { name: 'Plan', exact: true }).first().waitFor({ state: 'visible', timeout: 5000 });
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'nav-toggle', 'tras reabrir el foco debe seguir en «Menú»');
      // Con el menú abierto y la página desplazada la barra tampoco puede tapar la pantalla.
      await page.evaluate(() => window.scrollTo(0, 1400));
      const openCover = await page.evaluate(() => { const r = document.querySelector('.app-nav').getBoundingClientRect(); return Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)) / window.innerHeight; });
      assert.ok(openCover <= 0.15, 'con el menú abierto la barra cubre ' + (openCover * 100).toFixed(1) + ' % del viewport');
      await page.evaluate(() => window.scrollTo(0, 0));
      // Al navegar, el menú se cierra.
      await page.getByRole('button', { name: 'Plan', exact: true }).first().click();
      await page.getByRole('button', { name: 'Plan', exact: true }).first().waitFor({ state: 'hidden', timeout: 5000 });
      assert.equal(await page.getByRole('button', { name: 'Menú', exact: true }).getAttribute('aria-expanded'), 'false', 'tras navegar el menú vuelve a cerrarse');

      assert.deepEqual(problems, [], 'errores de página o consola:\n' + problems.join('\n'));
      await ctx.close();
    }
    // --- Navegar desde el contenido cierra el menú (contexto nuevo: la sesión cambia de página) ---
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await openGoal(page, url);
      await page.getByRole('button', { name: 'Menú', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Menú', exact: true }).getAttribute('aria-expanded'), 'true');
      await page.getByRole('button', { name: /^Seguir: / }).first().click();
      await page.getByRole('button', { name: /^Seguir: / }).first().waitFor({ state: 'detached', timeout: 10000 });
      assert.equal(await page.getByRole('button', { name: 'Menú', exact: true }).getAttribute('aria-expanded'), 'false', 'navegar desde el contenido cierra el menú');
      await ctx.close();
    }
    // --- rich_content_v1: fórmulas (MathML real) y «Explora la relación» sin desbordar a 390 px ---
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', e => problems.push('pageerror: ' + e.message));
      page.on('console', m => { if (m.type() === 'error') problems.push('console.error: ' + m.text()); });
      await openGoal(page, url);
      // Se prepara la lección EN LA PÁGINA (la semilla del demo no cambia): una fórmula válida en línea, una de bloque, una no soportada y un precio.
      await page.evaluate(() => {
        const goal = store.goals.find(x => x.id === 'visual-goal'), l = goal.lessons.ecuaciones;
        l.explanation = 'Se cumple $x = \\frac{b - c}{a}$ cuando $a \\neq 0$; cuesta $5 y sube. Esto no se soporta: $\\foo{x}$ y queda tal cual.';
        l.example = 'Resuelve $$2x + 4 = 10 \\to x = \\frac{10 - 4}{2}$$ y comprueba con $\\sqrt{x^{2}}$.';
        const q = (id, prompt, kind, dim) => ({ activity_id: id, prompt, reference: 'r', kind, observable_dimensions: [dim] });
        Object.assign(l, { check: q('smoke-check', '¿Por qué importa $a \\neq 0$?', 'explanation', 'conceptual'), guided: q('smoke-guided', 'Guiada', 'application', 'direct_application'), integration: q('smoke-integration', 'Integra', 'context_case', 'contextual_application') });
        const want = lessonRequest(goal, goal.nodes.find(x => x.id === 'ecuaciones')).target_dimension; if (want) l.target_dimension = want; else delete l.target_dimension;
        l.steps_skipped = true; l.faded_skipped = true;
        l.explore = { title: 'Despeje de x', expression: 'm*t+c', variables: [{ name: 'm', label: 'Pendiente', unit: '', min: 1, max: 9, step: 1, value: 2 }, { name: 't', label: 'Tiempo', unit: 's', min: 0, max: 10, step: 0.5, value: 4 }, { name: 'c', label: 'Constante', unit: '', min: 0, max: 20, step: 1, value: 4 }], output: { label: 'Resultado', unit: 'u' }, prompt_before: 'Predice qué pasa con $y = m t + c$.', takeaway: 'Es lineal en t.', explore_id: 'explore-smoke' };
        goal.session = { ...goal.session, mode: 'TEACH', node: 'ecuaciones', stack: [], tries: 0, hints: 0 };
        page = 'session'; render();
      });
      await page.locator('.explore').waitFor({ state: 'visible', timeout: 10000 });
      const info = await page.evaluate(() => {
        const maths = [...document.querySelectorAll('math')];
        return {
          count: maths.length, namespaces: [...new Set(maths.map(m => m.namespaceURI))],
          boxes: maths.map(m => { const r = m.getBoundingClientRect(); return { w: r.width, h: r.height, right: r.right, label: m.getAttribute('aria-label') }; }),
          hasFraction: maths.some(m => m.querySelector('mfrac')), literal: document.body.textContent.includes('$\\foo{x}$') && document.body.textContent.includes('cuesta $5 y sube'),
          scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, blockDisplay: document.querySelector('.math-block') && getComputedStyle(document.querySelector('.math-block')).display,
        };
      });
      assert.ok(info.count >= 4, 'se esperan ≥ 4 elementos math, hay ' + info.count);
      assert.deepEqual(info.namespaces, ['http://www.w3.org/1998/Math/MathML']);
      assert.ok(info.hasFraction, 'la fracción produce <mfrac>');
      assert.ok(info.boxes.every(b => b.w > 4 && b.h > 4), 'Chromium debe renderizar las fórmulas con tamaño real: ' + JSON.stringify(info.boxes));
      assert.ok(info.boxes.every(b => b.right <= info.innerWidth + 0.5), 'una fórmula se sale de la pantalla: ' + JSON.stringify(info.boxes));
      assert.ok(info.literal, 'la fórmula no soportada y el precio se muestran tal cual');
      assert.equal(info.blockDisplay, 'block');
      assert.ok(info.scrollWidth <= info.innerWidth, 'desplazamiento horizontal con fórmulas: ' + info.scrollWidth + ' > ' + info.innerWidth);
      // Predecir -> explorar: deslizadores táctiles, gráfica SVG dentro de la pantalla.
      await page.getByRole('button', { name: 'Sube', exact: true }).click();
      const ex = await page.evaluate(() => {
        const sliders = [...document.querySelectorAll('.explore input[type=range]')].map(i => { const r = i.getBoundingClientRect(); return { h: r.height, w: r.width, right: r.right }; });
        const svg = document.querySelector('.explore-svg'), r = svg && svg.getBoundingClientRect();
        return { sliders, svg: r && { w: r.width, h: r.height, right: r.right }, curve: Boolean(document.querySelector('.explore-curve')), dot: Boolean(document.querySelector('.explore-dot')),
          stroke: svg && getComputedStyle(document.querySelector('.explore-curve')).stroke, out: document.querySelector('.explore-out')?.textContent,
          scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
      });
      assert.equal(ex.sliders.length, 3);
      assert.ok(ex.sliders.every(s => s.h >= 43.5), 'deslizadores < 44 px: ' + JSON.stringify(ex.sliders));
      assert.ok(ex.sliders.every(s => s.right <= ex.innerWidth + 0.5), 'deslizador fuera de pantalla');
      assert.ok(ex.svg && ex.svg.w > 100 && ex.svg.right <= ex.innerWidth + 0.5, 'gráfica fuera de pantalla: ' + JSON.stringify(ex.svg));
      assert.ok(ex.curve && ex.dot, 'curva y punto actual'); assert.ok(/^rgb\(/.test(ex.stroke), 'la curva usa un token de color: ' + ex.stroke);
      assert.ok(/Resultado: 12 u/.test(ex.out), 'resultado en vivo: ' + ex.out); assert.ok(ex.scrollWidth <= ex.innerWidth, 'desplazamiento horizontal con la exploración');
      await page.locator('.explore input[type=range]').nth(1).focus(); await page.keyboard.press('ArrowRight');
      assert.ok(/Resultado: 1[0-9]/.test(await page.locator('.explore-out').textContent()), 'el teclado mueve el deslizador y el resultado cambia');
      // Tema oscuro: los tokens cambian y la curva sigue siendo visible.
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      const dark = await page.evaluate(() => ({ stroke: getComputedStyle(document.querySelector('.explore-curve')).stroke, bg: getComputedStyle(document.querySelector('.explore')).backgroundColor }));
      assert.ok(/^rgb\(/.test(dark.stroke) && dark.stroke !== ex.stroke, 'el tema oscuro cambia el trazo: ' + dark.stroke + ' vs ' + ex.stroke);
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
      assert.deepEqual(problems, [], 'errores de página o consola:\n' + problems.join('\n'));
      await ctx.close();
    }
    // --- Escritorio 1280×900 ---
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', e => problems.push('pageerror: ' + e.message));
      page.on('console', m => { if (m.type() === 'error') problems.push('console.error: ' + m.text()); });
      await openGoal(page, url);
      assert.ok(await visible(page, 'Plan'), '«Plan» debe verse sin menú en escritorio');
      assert.equal(await visible(page, 'Menú'), false, '«Menú» no debe verse en escritorio');
      const position = await page.evaluate(() => getComputedStyle(document.querySelector('.app-nav')).position);
      assert.equal(position, 'sticky', 'en escritorio la barra sigue fija');
      assert.deepEqual(problems, [], 'errores de página o consola:\n' + problems.join('\n'));
      await ctx.close();
    }
    console.log('browser_smoke.test.js OK');
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopServer();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0), e => { console.error(e && e.stack || e); stopServer(); process.exit(1); });
