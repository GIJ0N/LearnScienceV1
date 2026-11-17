// placement_production_v1: la producción abierta del diagnóstico (regla de estado, evidencia, errores de cuota/juez).
const assert = require('node:assert/strict');

function element(type = 'div') {
  return {
    type, textContent: '', value: '', disabled: false, children: [], className: '',
    append(...items) { this.children.push(...items); },
    appendChild(item) { this.children.push(item); return item; },
    replaceChildren(...items) { this.children = items; },
    setAttribute() {}, prepend() {},
  };
}
const roots = { app: element('main'), status: element('div') };
global.document = { getElementById: (id) => (id === 'app' ? roots.app : roots.status), createElement: (type) => element(type), createElementNS: (ns, type) => element(type) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;

const policy = require('../app.js');

function node(id, prerequisites = [], level = 0) {
  return { id, name: id, outcome: 'Usar ' + id, level, prerequisites, kind: 'concept', probe: { prompt: 'Explica ' + id, kind: 'explanation' } };
}
// a -> b -> c -> d, e depende de b. Plan de producción esperado: d (3 ancestros), e y c (2).
function goal(nodes) {
  nodes = nodes || [node('a', [], 0), node('b', ['a'], 1), node('c', ['b'], 2), node('e', ['b'], 2), node('d', ['c'], 3)];
  return {
    id: 'goal-pp', profile_id: 'profile-test', goal: 'Meta', nodes, learner: {}, events: [], reviews: [], lessons: {},
    coverage: nodes.map(n => ({ id: n.id, name: n.id, status: 'UNKNOWN', confidence: 0, dimensions: [{ id: 'conceptual', name: 'c', required: true, status: 'UNKNOWN', evidence: [] }] })),
    session: { mode: 'DIAGNOSTIC', node: null, stack: [], tries: 0, hints: 0 },
  };
}
function started(nodes) { const g = goal(nodes); policy.setStoreForTests({ goals: [g], active: g.id }); policy.startPlacement(g); return g; }
let counter = 0;
function mc(g, nodeId, status, confidence = null) {
  const item = { item_id: 'item-' + (++counter), node_id: nodeId, prompt: '¿' + nodeId + '?', options: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }] };
  g.placement.items[item.item_id] = { ...item, used: false };
  const result = { status, item_id: item.item_id, node_id: nodeId, correct_option_id: 'a', explanation: 'e', error_type: status === 'CORRECT' ? 'none' : 'conceptual' };
  assert.equal(policy.applyPlacementAnswer(g, item, result, 'att-mc-' + counter, status === 'UNKNOWN' ? null : status === 'CORRECT' ? 'a' : 'b', confidence), true);
}
function prodItem(g, nodeId) {
  const item = { item_id: 'pprod-' + (++counter), node_id: nodeId, prompt: 'Explica ' + nodeId + ' con tus palabras en un caso concreto.' };
  g.placement.production.items[item.item_id] = { ...item, used: false };
  return item;
}
function prodResult(item, status) {
  return { status, item_id: item.item_id, node_id: item.node_id, feedback: 'comentario', error_type: status === 'CORRECT' ? 'none' : 'conceptual', evaluator_version: 'placement-production-judge-v1', judge_model: 'modelo-juez' };
}
function produce(g, nodeId, status, attempt) {
  const item = prodItem(g, nodeId);
  assert.equal(policy.applyPlacementProduction(g, item, prodResult(item, status), attempt || 'att-pp-' + counter, 'Mi explicación con palabras propias del tema ' + nodeId), true);
  return item;
}
const prodEvents = g => g.events.filter(e => e.type === 'EVIDENCE' && e.activity_kind === 'placement_open_production');

(async () => {
  // 1. Plan: hasta 3 temas clave con prerrequisitos; excluye los que ya tenían evidencia; nada si no hay estructura.
  {
    const g = started();
    assert.equal(g.placement.production.status, 'planned');
    assert.deepEqual([...g.placement.production.node_ids].sort(), ['c', 'd', 'e']);
    assert.ok(g.placement.production.node_ids.length <= policy.placementProductionPlan(g).node_ids.length + 3);
    assert.deepEqual(g.placement.productions, [], 'arreglo propio, vacío al empezar');
    const flat = started([node('x'), node('y'), node('z')]);
    assert.equal(flat.placement.production.status, 'none');
    assert.equal(flat.placement.production.node_ids.length, 0);
  }

  // 2. Regla de estado: held exige opción múltiple correcta Y producción correcta.
  {
    const g = started();
    mc(g, 'd', 'CORRECT', 95);
    assert.equal(policy.placementStatuses(g).d, 'fragile', 'acierto de opción múltiple sin producción no es held en un tema clave');
    assert.equal(policy.placementProductionState(g, 'd').pending, true);
    const item = produce(g, 'd', 'CORRECT');
    assert.equal(policy.placementStatuses(g).d, 'held', 'opción múltiple correcta + producción correcta');
    assert.equal(g.placement.production.items[item.item_id].used, true);
    // Un tema fuera del plan sigue la regla anterior (opción múltiple sola).
    mc(g, 'b', 'CORRECT', 95);
    assert.ok(!g.placement.production.node_ids.includes('b'));
    assert.equal(policy.placementStatuses(g).b, 'held');
  }

  // 3. Opción múltiple correcta + producción fallida => NO held (ningún estado de fallo).
  for (const bad of ['PARTIAL', 'MISCONCEPTION', 'UNKNOWN']) {
    const g = started();
    mc(g, 'd', 'CORRECT', 95);
    produce(g, 'd', bad);
    const st = policy.placementStatuses(g);
    assert.equal(st.d, 'fragile', bad + ' deja el tema frágil');
    assert.notEqual(st.d, 'unknown');
    assert.ok(!['held', 'inferred_held', 'gap', 'misconception', 'unprobed'].includes(st.d));
    assert.equal(st.c, 'unprobed', 'un tema frágil no propaga a sus prerrequisitos');
  }

  // 4. Inferencia bloqueada: heldInf no sube a held un tema con producción fallida o sin producción correcta.
  {
    const g = started();
    mc(g, 'd', 'CORRECT', 95); produce(g, 'd', 'CORRECT');
    mc(g, 'c', 'CORRECT', 20);                       // frágil por poca confianza; d (held) lo deduciría
    let st = policy.placementStatuses(g);
    assert.equal(st.c, 'fragile', 'sin producción correcta la inferencia no lo sube a held');
    produce(g, 'c', 'PARTIAL');
    st = policy.placementStatuses(g);
    assert.equal(st.c, 'fragile', 'con producción fallida tampoco');
    assert.equal(st.b, 'inferred_held', 'los demás prerrequisitos siguen deduciéndose desde d, que sí está confirmado');
  }
  {
    const g = started();
    mc(g, 'd', 'CORRECT', 95); produce(g, 'd', 'CORRECT');
    mc(g, 'c', 'CORRECT', 20); produce(g, 'c', 'CORRECT');
    assert.equal(policy.placementStatuses(g).c, 'held', 'con producción correcta, la inferencia vuelve a aplicar');
  }

  // 5. Producción sola nunca da held ni propaga.
  {
    const g = started();
    g.placement.productions.push({ attempt_id: 'x1', item_id: 'i1', node_id: 'd', status: 'CORRECT', at: 1 }, { attempt_id: 'x2', item_id: 'i2', node_id: 'd', status: 'CORRECT', at: 2 });
    const st = policy.placementStatuses(g);
    assert.equal(st.d, 'unprobed', 'dos producciones correctas sin opción múltiple no dan held');
    assert.equal(st.c, 'unprobed'); assert.equal(st.a, 'unprobed');
    assert.equal(policy.placementProductionState(g, 'd').demanded, false);
    // con opción múltiple fallida tampoco cambia nada
    mc(g, 'd', 'MISCONCEPTION', 90);
    assert.equal(policy.placementStatuses(g).d, 'misconception');
    // y aplicarla sin un acierto previo se rechaza
    const g2 = started();
    const item = prodItem(g2, 'd');
    assert.throws(() => policy.applyPlacementProduction(g2, item, prodResult(item, 'CORRECT'), 'att-solo', 'texto largo de explicación'), e => e.code === 'PRODUCTION_WITHOUT_CHOICE');
    assert.equal(prodEvents(g2).length, 0); assert.equal(g2.placement.productions.length, 0);
  }

  // 6. Arreglo aparte: las producciones no entran en p.answers ni en probedPlacementStatus.
  {
    const g = started();
    mc(g, 'd', 'CORRECT', 95);
    const before = g.placement.answers.length;
    produce(g, 'd', 'CORRECT');
    assert.equal(g.placement.answers.length, before, 'p.answers solo tiene opción múltiple');
    assert.equal(g.placement.productions.length, 1);
    assert.ok(g.placement.answers.every(a => !('production' in a)) && g.placement.answers.every(a => a.item_id.startsWith('item-')));
    assert.equal(policy.probedPlacementStatus(g.placement.answers.filter(a => a.node_id === 'd')), 'held', 'probedPlacementStatus solo mira opción múltiple');
    assert.equal(policy.probedPlacementStatus([{ status: 'CORRECT', learner_confidence: null }]), 'fragile');
  }

  // 7. Evento: diagnóstico, sin independencia, sin fallo de aprendizaje, sin contradicción de suficiencia.
  {
    const g = started();
    mc(g, 'd', 'CORRECT', 95);
    const item = produce(g, 'd', 'MISCONCEPTION');
    const [ev] = prodEvents(g);
    assert.equal(ev.evidence_role, 'diagnostic'); assert.equal(ev.phase, 'DIAGNOSTIC');
    assert.equal(ev.is_independent, false); assert.equal(ev.independent, false);
    assert.equal(ev.counts_as_learning_failure, false);
    assert.equal(ev.contradicts_sufficiency, false, 'decisión: el diagnóstico no es prueba de suficiencia, tampoco su contradicción');
    assert.equal(ev.evaluator_trust, 'model_single');
    assert.equal(ev.policy_version, 'placement_production_v1');
    assert.equal(ev.judge_model, 'modelo-juez');
    assert.equal(ev.activity_kind, 'placement_open_production');
    assert.equal(ev.help_used, 0);
    assert.equal(policy.placementProductionContract(item).supports_independence, false);
    assert.equal(policy.isLearningFailure(ev), false);
    assert.equal(policy.isContradiction(ev), false);
    assert.equal(policy.isContradiction({ ...ev, contradicts_sufficiency: true }), false, 'defensa: aunque el dato viniera marcado, una producción de diagnóstico no contradice');
    assert.equal(g.learner[item.node_id].errors.length, 0, 'no registra error de aprendizaje');
    // el acierto tampoco es independiente aunque se fuerce el dato
    const ok = policy.activityEvidence(policy.placementProductionContract(item), { status: 'CORRECT', evaluator_version: 'placement-production-judge-v1' }, 0, { attempt_id: 'a-ok' });
    assert.equal(ok.is_independent, false); assert.equal(ok.evaluator_trust, 'model_single'); assert.equal(ok.policy_version, 'placement_production_v1');
  }

  // 8. lastFailure no se reinicia y la producción no cuenta como éxito independiente.
  {
    const g = started();
    mc(g, 'd', 'CORRECT', 95);
    const item = prodItem(g, 'd');
    const prodFail = policy.activityEvidence(policy.placementProductionContract(item), { status: 'MISCONCEPTION', evaluator_version: 'placement-production-judge-v1' }, 0, { attempt_id: 'pf' });
    const prodOk = policy.activityEvidence(policy.placementProductionContract(item), { status: 'CORRECT', evaluator_version: 'placement-production-judge-v1' }, 0, { attempt_id: 'po' });
    const contractFor = (n, stage = 'INDEPENDENT') => ({ activity_id: 'act-' + n, node_id: 'd', stage, kind: 'explanation', observable_dimensions: ['conceptual'], supports_independence: true, question_prompt: 'Pregunta distinta ' + n });
    const win = n => policy.activityEvidence(contractFor(n), { status: 'CORRECT', evaluator_version: 'local-x' }, 0, { attempt_id: 'w' + n });
    const realFail = policy.activityEvidence(contractFor(9), { status: 'MISCONCEPTION', evaluator_version: 'local-x' }, 0, { attempt_id: 'real-fail' });
    const dim = events => ({ id: 'conceptual', evidence: events });
    const opts = { ignoreTrust: true };
    assert.equal(policy.independentSuccesses(dim([win(1), win(2), prodFail]), opts).length, 2, 'un fallo de producción de diagnóstico no borra los éxitos anteriores');
    assert.equal(policy.independentSuccesses(dim([win(1), win(2), realFail]), opts).length, 0, 'control: un fallo de aprendizaje real sí los borra');
    assert.equal(policy.independentSuccesses(dim([win(1), prodOk]), opts).length, 1, 'la producción correcta no cuenta como éxito independiente');
    assert.equal(policy.independentSuccesses(dim([{ ...prodOk, is_independent: true, independent: true }]), opts).length, 0, 'ni aunque se fuerce el dato');
  }

  // 9. Duplicados: mismo attempt_id o misma pregunta no suman dos veces.
  {
    const g = started();
    mc(g, 'd', 'CORRECT', 95);
    const item = prodItem(g, 'd');
    assert.equal(policy.applyPlacementProduction(g, item, prodResult(item, 'CORRECT'), 'dup-1', 'primera explicación con palabras propias'), true);
    assert.equal(policy.applyPlacementProduction(g, item, prodResult(item, 'CORRECT'), 'dup-1', 'primera explicación con palabras propias'), false);
    assert.equal(policy.applyPlacementProduction(g, item, prodResult(item, 'CORRECT'), 'dup-2', 'segunda explicación con palabras propias'), false);
    assert.equal(g.placement.productions.length, 1); assert.equal(prodEvents(g).length, 1);
    assert.throws(() => policy.applyPlacementProduction(g, item, { ...prodResult(item, 'CORRECT'), node_id: 'c' }, 'dup-3', 'texto'), e => e.code === 'INVALID_PLACEMENT_RESULT');
  }

  // 10. Un tema con producción fallida no se re-pregunta por opción múltiple ni se salta; los demás se saltan como antes.
  {
    const g = started();
    mc(g, 'd', 'CORRECT', 95); produce(g, 'd', 'PARTIAL');
    mc(g, 'b', 'CORRECT', 95); mc(g, 'a', 'CORRECT', 95);
    const next = policy.nextPlacementNode(g);
    assert.notEqual(next, 'd', 'no se gasta otra pregunta de opción múltiple en un tema bloqueado por producción');
    const out = policy.finishPlacement(g, 'resolved', false);
    assert.ok(!out.skipped.includes('d'), 'un tema con producción fallida nunca recibe PLACEMENT_SKIP');
    assert.equal(out.statuses.d, 'fragile');
    assert.ok(policy.placementSummary(g).unconfirmed.some(n => n.id === 'd'));
    assert.equal(policy.verified(g, 'd'), false);
  }

  // 11. Quedarse sin cuota o sin juez deja el tema frágil sin romper el diagnóstico.
  {
    assert.equal(policy.placementProductionReason(new Error('Límite local alcanzado; continúa con contenido guardado.')), 'quota');
    assert.equal(policy.placementProductionReason(new Error('El modelo calificador (x) no respondió: 500')), 'judge');
    assert.equal(policy.placementProductionReason(new Error('No se pudo contactar al servidor local.')), 'error');
    for (const failure of ['Límite local alcanzado; continúa con contenido guardado.', 'El modelo calificador (juez-x) no respondió: 429']) {
      const g = started();
      mc(g, 'd', 'CORRECT', 95);
      const item = prodItem(g, 'd');
      global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: failure }) });
      const box = element('section');
      const ui = policy.renderPlacementProductionItem(box, g, item);
      ui.answer.value = 'Una explicación suficientemente larga con mis propias palabras.';
      await ui.send.onclick();
      const rec = g.placement.productions.find(x => x.item_id === item.item_id);
      assert.equal(rec.status, 'UNAVAILABLE');
      assert.ok(['quota', 'judge'].includes(rec.reason));
      assert.equal(prodEvents(g).length, 0, 'sin veredicto no hay evento ni evidencia');
      assert.equal(policy.placementStatuses(g).d, 'fragile');
      assert.notEqual(g.placement.status, 'done');
      const out = policy.finishPlacement(g, 'resolved', false);          // el diagnóstico sigue y termina
      assert.ok(out && !out.skipped.includes('d'));
    }
    // cuota agotada al GENERAR el lote: estado unavailable, una sola llamada, el tema queda frágil, el diagnóstico sigue
    const g = started();
    let calls = 0;
    global.fetch = async () => { calls++; return { ok: false, status: 400, json: async () => ({ error: 'Límite local alcanzado; continúa con contenido guardado.' }) }; };
    mc(g, 'd', 'CORRECT', 95);
    assert.equal(policy.placementPendingProduction(g), 'd');
    assert.equal(await policy.ensurePlacementProduction(g, 'd'), null);
    assert.equal(g.placement.production.status, 'unavailable'); assert.equal(g.placement.production.error, 'quota');
    assert.equal(policy.placementPendingProduction(g), null, 'no se vuelve a intentar');
    assert.equal(await policy.ensurePlacementProduction(g, 'd'), null);
    assert.equal(calls, 1, 'un solo intento de generación por diagnóstico');
    assert.equal(policy.placementStatuses(g).d, 'fragile');
    assert.notEqual(policy.nextPlacementNode(g), null, 'el diagnóstico continúa con opción múltiple');
  }

  // 12. Lote: una sola petición para todos los temas clave; tope de 3.
  {
    const g = started();
    let calls = 0, body = null;
    global.fetch = async (url, init) => {
      calls++; body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ items: body.node_ids.map((id, i) => ({ item_id: 'pprod-srv-' + i, node_id: id, prompt: 'Explica ' + id + ' con tus palabras' })) }) };
    };
    mc(g, 'd', 'CORRECT', 95); mc(g, 'e', 'CORRECT', 95); mc(g, 'c', 'CORRECT', 95);
    for (const id of ['d', 'e', 'c']) assert.ok(await policy.ensurePlacementProduction(g, id), 'hay pregunta para ' + id);
    assert.equal(calls, 1, 'una sola generación para todo el diagnóstico');
    assert.ok(body.node_ids.length <= 3);
    assert.equal(JSON.stringify(body).includes('rubric'), false);
    assert.equal(g.placement.production.status, 'ready');
  }

  // 13. Seguir solo con opción múltiple: no concede dominio, conserva el repaso programado y NO convierte en held lo que estaba pendiente.
  {
    const g = started();
    mc(g, 'd', 'CORRECT', 95); produce(g, 'd', 'PARTIAL');
    mc(g, 'c', 'CORRECT', 95);                     // producción pendiente
    mc(g, 'a', 'CORRECT', 95);
    assert.equal(policy.placementStatuses(g).c, 'fragile');
    assert.equal(policy.skipPlacementProductions(g), true);
    assert.equal(policy.skipPlacementProductions(g), false);
    assert.ok(g.events.some(e => e.type === 'PLACEMENT_PRODUCTION_SKIPPED'));
    assert.equal(policy.placementPendingProduction(g), null);
    assert.deepEqual(g.placement.production.declined_node_ids, ['c']);
    const st = policy.placementStatuses(g);
    assert.equal(st.c, 'fragile', 'el tema cuya producción estaba pendiente queda frágil, no held');
    assert.equal(st.d, 'fragile', 'una producción ya fallida sigue contando aunque se omita el resto');
    assert.equal(st.a, 'held', 'un tema fuera del plan sigue la regla de opción múltiple');
    assert.equal(policy.placementProductionState(g, 'c').declined, true);
    assert.equal(policy.nextPlacementNode(g) === 'c', false, 'no se re-pregunta por opción múltiple');
    const out = policy.finishPlacement(g, 'resolved', false);
    assert.ok(out.skipped.includes('a') && !out.skipped.includes('c') && !out.skipped.includes('d'));
    assert.equal(policy.verified(g, 'a'), false, 'PLACEMENT_SKIP no concede dominio');
    assert.ok(g.events.some(e => e.type === 'PLACEMENT_REVIEW_SCHEDULED' && e.node_id === 'a'), 'conserva el repaso programado');
    assert.ok(g.reviews.some(r => r.id === 'a'));
  }

  // 13b. Caso del supervisor (d/a/b/c): saltar no hace held a d ni propaga a sus prerrequisitos.
  {
    const g = started();
    mc(g, 'd', 'CORRECT', 95);                     // tema clave, producción pendiente
    assert.equal(policy.placementStatuses(g).c, 'unprobed');
    policy.skipPlacementProductions(g);
    const st = policy.placementStatuses(g);
    assert.equal(st.d, 'fragile', 'd sigue frágil tras saltar');
    for (const id of ['a', 'b', 'c']) assert.equal(st[id], 'unprobed', id + ' no se deduce desde un tema no confirmado');
    mc(g, 'a', 'CORRECT', 95); mc(g, 'b', 'CORRECT', 95);
    const after = policy.placementStatuses(g);
    assert.equal(after.d, 'fragile'); assert.equal(after.c, 'unprobed');
    const out = policy.finishPlacement(g, 'resolved', false);
    assert.ok(!out.skipped.includes('d') && !out.skipped.includes('c'));
  }

  // 13c. Un lote ready con pregunta solo para e no bloquea en el primer tema pendiente (c).
  {
    const g = started();
    mc(g, 'c', 'CORRECT', 95); mc(g, 'e', 'CORRECT', 95);
    g.placement.production.status = 'ready';
    const it = prodItem(g, 'e');
    assert.equal(policy.placementPendingProduction(g), 'e', 'salta c (sin pregunta libre) y ofrece e');
    produce(g, 'e', 'CORRECT');
    assert.equal(policy.placementPendingProduction(g), null, 'c no tiene pregunta: no bloquea el diagnóstico');
    assert.equal(policy.placementStatuses(g).c, 'fragile');
    assert.ok(it);
  }

  // 13d. Un nuevo diagnóstico no trata como evidenciado un tema cuyo único evento fue una producción fallida.
  {
    const g = started();
    mc(g, 'd', 'CORRECT', 95); produce(g, 'd', 'MISCONCEPTION');
    assert.ok(g.events.some(e => e.type === 'EVIDENCE' && e.node_id === 'd' && e.evidence_role === 'diagnostic'));
    assert.ok(!policy.placementPriorEvidence(g).includes('d'), 'las producciones (evidencia de diagnóstico) no cuentan como evidencia previa');
    g.placement.status = 'done';
    policy.startPlacement(g);
    assert.ok(!g.placement.evidenced_nodes.includes('d'));
    assert.ok(g.placement.production.node_ids.includes('d'), 'd vuelve a ser tema clave en el nuevo diagnóstico');
  }

  // 13e. Tiempo de espera: se consulta otra vez con el MISMO attempt_id antes de marcar no disponible.
  {
    const g = started();
    mc(g, 'd', 'CORRECT', 95);
    const item = prodItem(g, 'd');
    const bodies = [];
    let n = 0;
    global.fetch = async (url, init) => {
      bodies.push(JSON.parse(init.body)); n++;
      if (n === 1) throw Object.assign(new Error('abortado'), { name: 'AbortError' });
      return { ok: true, status: 200, json: async () => prodResult(item, 'CORRECT') };
    };
    const ui = policy.renderPlacementProductionItem(element('section'), g, item);
    ui.answer.value = 'Una explicación suficientemente larga con mis propias palabras.';
    await ui.send.onclick();
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].attempt_id, bodies[1].attempt_id, 'misma identidad de intento');
    assert.equal(g.placement.productions.find(x => x.item_id === item.item_id).status, 'CORRECT');
    assert.equal(policy.placementStatuses(g).d, 'held');
    // si el segundo intento también agota el tiempo: no disponible (frágil)
    const g2 = started();
    mc(g2, 'd', 'CORRECT', 95);
    const item2 = prodItem(g2, 'd');
    let calls = 0;
    global.fetch = async () => { calls++; throw Object.assign(new Error('abortado'), { name: 'AbortError' }); };
    const ui2 = policy.renderPlacementProductionItem(element('section'), g2, item2);
    ui2.answer.value = 'Una explicación suficientemente larga con mis propias palabras.';
    await ui2.send.onclick();
    assert.equal(calls, 2);
    assert.equal(g2.placement.productions[0].status, 'UNAVAILABLE');
    // un error definitivo (cuota) no se reintenta
    const g3 = started();
    mc(g3, 'd', 'CORRECT', 95);
    const item3 = prodItem(g3, 'd');
    calls = 0;
    global.fetch = async () => { calls++; return { ok: false, status: 400, json: async () => ({ error: 'Límite local alcanzado; continúa con contenido guardado.' }) }; };
    const ui3 = policy.renderPlacementProductionItem(element('section'), g3, item3);
    ui3.answer.value = 'Una explicación suficientemente larga con mis propias palabras.';
    await ui3.send.onclick();
    assert.equal(calls, 1);
    assert.equal(g3.placement.productions[0].reason, 'quota');
  }

  // 13f. Motivo del fallo con cualquier proveedor (el servidor normaliza el mensaje del juez).
  {
    assert.equal(policy.placementProductionReason(new Error('El modelo calificador (claude-x) no respondió: Anthropic respondió 529')), 'judge');
    assert.equal(policy.placementProductionReason(new Error('Límite local alcanzado; continúa con contenido guardado.')), 'quota');
  }

  // 13g. El lote lleva la identidad del diagnóstico (tope por meta y diagnóstico en el servidor).
  {
    const g = started();
    let body = null;
    global.fetch = async (url, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ items: [] }) }; };
    mc(g, 'd', 'CORRECT', 95);
    await policy.ensurePlacementProduction(g, 'd');
    assert.equal(body.diagnostic, String(g.placement.started_at));
    assert.ok(body.diagnostic.length > 0);
  }

  // 14. Compatibilidad: un diagnóstico anterior (sin plan) se comporta como antes y no se inventan producciones.
  {
    const g = started();
    delete g.placement.production; delete g.placement.productions;
    mc(g, 'd', 'CORRECT', 95);
    assert.equal(policy.placementStatuses(g).d, 'held');
    assert.equal(policy.placementPendingProduction(g), null);
    assert.equal(policy.placementProductionBlocked(g, 'd'), false);
    assert.equal(prodEvents(g).length, 0);
  }

  // 15. La pantalla no usa innerHTML con datos (la pregunta se pinta con nodos de texto).
  {
    const g = started(); mc(g, 'd', 'CORRECT', 95);
    const item = prodItem(g, 'd'); item.prompt = '<img src=x onerror=alert(1)> explica d';
    const box = element('section');
    policy.renderPlacementProductionItem(box, g, item);
    assert.ok(box.children.length >= 4);
    assert.equal(box.innerHTML, undefined);
  }

  console.log('placement_production: OK');
})().catch(e => { console.error(e); process.exit(1); });
