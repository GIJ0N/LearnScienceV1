// grounded_sources_v1 (cliente): insignias de fuente, página «Fuentes» y oferta de regenerar; nunca escribe evidencia.
const assert = require('node:assert/strict');
function element(type = 'div', text = '') { return { type, textContent: text, value: '', children: [], style: {}, append(...x) { this.children.push(...x); }, appendChild(x) { this.children.push(x); return x; }, replaceChildren(...x) { this.children = x; }, addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {} } }; }
console.error = () => {};
const roots = { app: element(), status: element() };
global.document = { getElementById: id => roots[id], createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
let sources = [], calls = [], failList = false;
global.fetch = async (route, options) => {
  const body = options?.body ? JSON.parse(options.body) : {};
  calls.push({ route, body });
  if (route === '/api/profile/save') return { ok: true, json: async () => ({ ok: true, revision: 2 }) };
  if (route === '/api/sources/list') { if (failList) return { ok: false, json: async () => ({ error: 'caído' }) }; return { ok: true, json: async () => ({ sources }) }; }
  if (route === '/api/sources/add') { if (body.title === 'dup') return { ok: true, json: async () => ({ source: { source_id: 'src-1' }, duplicate: true }) }; const source = { source_id: 'src-' + (sources.length + 1), title: body.title, source_date: body.source_date, chars: body.text.length }; sources.push(source); return { ok: true, json: async () => ({ source, duplicate: false }) }; }
  if (route === '/api/sources/delete') { sources = sources.filter(s => s.source_id !== body.source_id); return { ok: true, json: async () => ({ deleted: true }) }; }
  throw Error('Ruta inesperada ' + route);
};
const p = require('../app.js');
const all = root => [root, ...(root.children || []).filter(c => c && typeof c === 'object').flatMap(all)];
const texts = root => all(root).map(x => x.textContent).filter(Boolean).join('\n');
const find = (root, label) => all(root).find(x => x.textContent === label);

const node = id => ({ id, name: id, level: 0, prerequisites: [], outcome: 'o', probe: { prompt: 'Explica ' + id, kind: 'explanation' } });
const lesson = grounding => ({ explanation: 'e', example: 'x', common_error: 'c', check: { prompt: 'p' }, ...(grounding ? { grounding } : {}) });
function goal(l) {
  return { id: 'g', profile_id: 'profile-test', goal: 'Pintura', nodes: [node('a')], learner: {}, reviews: [], events: [], coverage: [], lessons: l ? { a: l } : {}, session: { mode: 'TEACH', node: 'a', stack: [], tries: 0, hints: 0 } };
}
function attach(g) { p.setProfileForTests({ profile_id: 'profile-test', name: 'S', preferences: {} }, 1); p.setStoreForTests({ goals: [g], active: g.id }); return g; }

(async () => {
  assert.equal(p.SOURCES_VERSION, 'grounded_sources_v1');
  assert.match(p.SOURCES_NOTICE, /El texto se envía a Gemini \(Google\) para preparar tus lecciones\. No pegues información confidencial de tu empresa sin permiso\./);

  // Las tres insignias.
  let box = element();
  p.groundingBadge(box, lesson({ status: 'cited', citations: [{ source_id: 's1', title: 'Ficha técnica', source_date: '2026-10-01', quote: 'sesenta a ochenta micras' }, { source_id: 's1', title: 'Ficha técnica', source_date: '2026-10-01', quote: 'veinte minutos a ciento ochenta' }] }));
  assert.match(texts(box), /Con fuente: Ficha técnica \(2026-10-01\)/);
  assert.match(texts(box), /«sesenta a ochenta micras»/);
  assert.equal(all(box).filter(x => x.type === 'details').length, 1, 'citas desplegables');
  assert.equal((texts(box).match(/Con fuente:/g) || []).length, 1);
  box = element(); p.groundingBadge(box, lesson({ status: 'uncited', citations: [] }));
  assert.equal(texts(box), 'Sin fuente en este punto');
  box = element(); p.groundingBadge(box, lesson({ status: 'no_sources', citations: [] }));
  assert.equal(texts(box), 'Generado por el modelo: verifícalo');
  box = element();
  assert.equal(p.groundingBadge(box, lesson()), null, 'lecciones antiguas sin grounding: no se muestra nada');
  assert.equal(box.children.length, 0);

  // Oferta de regenerar: solo con fuentes en la meta y lección sin cita; no regenera sola.
  let g = attach(goal(lesson({ status: 'no_sources', citations: [] })));
  assert.equal(p.sourcesOffer(element(), g, g.nodes[0]), null, 'sin fuentes en la meta no se ofrece');
  g.sources_count = 2;
  const offerBox = element(); const btn = p.sourcesOffer(offerBox, g, g.nodes[0]);
  assert.equal(btn.textContent, 'Regenerar con mis fuentes');
  assert.ok(g.lessons.a, 'ofrecer no regenera');
  g.lessons.a = lesson({ status: 'cited', citations: [{ source_id: 's', title: 't', quote: 'q' }] });
  assert.equal(p.sourcesOffer(element(), g, g.nodes[0]), null, 'ya citada: no se ofrece');
  g.lessons.a = lesson();
  assert.ok(p.sourcesOffer(element(), g, g.nodes[0]), 'lección antigua sin grounding: se ofrece');
  assert.equal(p.regenerateWithSources(g, g.nodes[0]), true);
  assert.equal(g.lessons.a, undefined);

  // Auditoría del plan: la insignia también aparece en la lección por pasos.
  {
    const cited = { status: 'cited', citations: [{ source_id: 's1', title: 'Ficha técnica', source_date: '', quote: 'sesenta a ochenta micras' }] };
    const step = i => ({ step_id: 's' + i, predict: 'p', body: 'b', check: { item_id: 'step-' + i } });
    const sg = attach(goal({ ...lesson(cited), adaptation_mode: 'consolidate', steps: [step(1), step(2)] }));
    const sb = element();
    await p.stepLessonView(sb, sg, sg.nodes[0], sg.lessons.a);
    assert.match(texts(sb), /Con fuente: Ficha técnica/);
  }

  // Página «Fuentes»: lista, aviso fijo, formulario, alta, duplicado y borrado.
  sources = [{ source_id: 'src-1', title: 'Ficha técnica', source_date: '2026-10-01', chars: 4200 }, { source_id: 'src-2', title: 'Nota breve', source_date: '', chars: 312 }];
  g = attach(goal()); calls = [];
  await p.sourcesView();
  const page = roots.app;
  assert.match(texts(page), /El texto se envía a Gemini \(Google\)/);
  assert.match(texts(page), /Ficha técnica · 2026-10-01 · 4 mil caracteres/);
  assert.ok(find(page, 'Añadir fuente') && find(page, 'Borrar'));
  assert.match(texts(page), /Nota breve · 312 caracteres/, 'una fuente corta no se muestra como «1 mil»');
  assert.doesNotMatch(texts(page), /1 mil caracteres/);
  assert.equal(g.sources_count, 2);
  assert.deepEqual(calls.filter(c => c.route === '/api/sources/list').map(c => c.body.goal_id), ['g']);
  assert.equal(calls.find(c => c.route === '/api/sources/list').body.profile_id, 'profile-test');

  const added = await p.addSource(g, { title: 'Norma', source_date: '', text: 'x'.repeat(300) });
  assert.equal(added.duplicate, false);
  assert.equal(calls.find(c => c.route === '/api/sources/add').body.goal_id, 'g');
  assert.equal((await p.fetchSources(g)).length, 3);
  assert.equal(g.sources_count, 3);
  assert.equal((await p.addSource(g, { title: 'dup', text: 'y' })).duplicate, true);
  await p.removeSource(g, 'src-1');
  assert.equal((await p.fetchSources(g)).length, 2);

  // Fallo al listar: mensaje, sin romper.
  failList = true; attach(goal()); await p.sourcesView();
  assert.match(texts(roots.app), /No se pudo leer la lista de fuentes/);
  failList = false;

  // Ninguna operación de fuentes escribe evidencia ni eventos.
  g = attach(goal()); await p.fetchSources(g); await p.addSource(g, { title: 'Otra', text: 'z'.repeat(250) });
  assert.deepEqual(g.events, []);
  assert.deepEqual(g.coverage, []);

  console.log('OK grounded_sources');
})().catch(e => { console.log(e); process.exit(1); });
