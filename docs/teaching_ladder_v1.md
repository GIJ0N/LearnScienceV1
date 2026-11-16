# Escalera de enseñanza (`teaching_ladder_v1`)

## Problema

Con `direct_teaching_v1`, cuando la persona no sabe, la app enseña UNA vez y después solo repite: la misma
pregunta, la misma lección guardada («Ver la lección completa») o un salto a otro tema. Hay que **escalar** en vez
de repetir: cada vez que la persona no lo logra con una pregunta, el siguiente apoyo es distinto del anterior.

## Regla única

Por pregunta del flujo principal (clave `node_id|enunciado`, donde antes vivía `s.direct_prompts`), cada «no lo logró»
sube un peldaño en `s.ladder` y **nunca se repite un peldaño ya visto**. `s.ladder` se vacía donde antes se vaciaba
`s.direct_prompts` (`chooseNext` con `newVisit`). Máximo 3 peldaños; después solo se ofrece «Seguir con otro tema»
(la pregunta ya quedó reprogramada), sin bucle.

`s.ladder = { "<node_id>|<enunciado>": {rung:0..3, avoid:[cuerpos ya mostrados], via:'prereq'|'answer'|null, model_shown:bool} }`.
Un estado sin `s.ladder` (anterior a esta función) se carga igual: se trata como `{}`.

## Peldaños

1. **Lo de hoy**: `make_direct_teaching` + `directTeachingView`, sin cambios.
2. **«Te lo explico de otra forma»**: la misma ruta `POST /api/teach/direct` con campos aditivos
   `rung:2`, `avoid` (cuerpos de los pasos ya mostrados, acotados con `compact`) y `misconception` (opcional: idea errónea
   conocida, del `DIRECT_CHECK` fallado o del feedback de la evaluación). El prompt exige otro ángulo o analogía, lenguaje
   más simple y un ejemplo resuelto distinto; el validador rechaza un paso cuyo cuerpo normalizado coincide con uno de
   `avoid`. Mismo validador, `audit_content` y un reintento que en el peldaño 1. Tras el `check` del peldaño 2, si el
   tema ya tiene un ejemplo con huecos generado (`lesson.faded` válido, `faded_exposed` no importa), se ofrece como paso
   siguiente opcional antes de «Volver a la pregunta» (reutiliza `fadedStage`; se permite aunque `fadedAllowed` lo
   impida por el modo de la lección, solo en este caso, siempre que no se haya hecho ni saltado ya). Si no existe, no se genera.
3. **Último peldaño**:
   a. Si `prerequisite(goal,id)` devuelve un tema sin evidencia suficiente: «Primero conviene: <tema>» con un botón que
      llama a `startTeach(goal,id)` (que enseña el prerrequisito y apila el tema actual como padre).
   b. Si no, **«Respuesta comentada»**: `/api/teach/direct` con `rung:3` devuelve `{model_answer, why:[2..4]}` para ESA
      pregunta (aquí sí se usa `reference`). Al mostrarla, la pregunta se reprograma (repaso corto con `schedule` +
      `lapseReview`; en `REVIEW` el calendario no cambia) y **en ese mismo momento** se invalida la pregunta: se borra la
      lección del tema (`goal.lessons[id]`, mismo mecanismo que «Volver a aprender esta habilidad») o, en `REVIEW`, se pone
      `review.question=null`. La vista sigue usando la pregunta guardada en `s.direct`; así salir por la navegación o
      «Retomar habilidad» no deja la misma pregunta con la respuesta a la vista. Botones: «Seguir con otro tema»
      (principal) y «Ver la lección de nuevo» (que ahora regenera).
   Tras un 3a, si la persona vuelve y `prerequisite(goal,id)` ya no devuelve nada, un nuevo intento puede abrir el 3b
   (una sola vez); si el prerrequisito sigue faltando, la escalera queda agotada. «Ir a ese tema» pone `hints=0` y
   `hint_level_max=null` antes de `startTeach`, para que la primera respuesta del prerrequisito no cuente con ayuda.

## Qué dispara subir de peldaño (flujo principal, fases de `DIRECT_PHASES`)

- Callejones de «misma lección» (H2): «No lo entendí; vuelve al ejemplo» en `COMPREHENSION` abre la escalera sobre la
  pregunta de comprobación (`not_understood`; si no puede abrirse conserva el comportamiento anterior); «No recuerdo;
  volvamos a aprenderlo» en `reviewView` (`not_remember`) y el fallo de un repaso (`review_failed`) abren la escalera con la
  pregunta del repaso en lugar de `startTeach` (si no puede abrirse, se borra `goal.lessons[id]` antes de `startTeach`). El
  calendario de `REVIEW` sigue exactamente las reglas anteriores.
- «No sé»: el primero abre el peldaño 1; los siguientes, 2 y 3. Sustituye al estado `status:'repeat'`.
- `directFull` («Ver la lección completa»): si ya se vio algún peldaño, pasa al siguiente en vez de repetir la lección.
  Con la escalera en 0 (la primera explicación no pudo prepararse) conserva el comportamiento anterior.
- Check de la enseñanza fallado (`MISCONCEPTION`): junto a «Volver a la pregunta» aparece «Explícamelo de otra forma».
- Tope de intentos (`adaptive.attempts>=MAX_NODE_ATTEMPTS` en `commitTransition`) tras un fallo de aprendizaje o un
  «No sé» declarado: antes de `chooseNext` se ofrece el peldaño 3 con la línea «Llevas varios intentos en esta pregunta…».
- Reparación cerrada a medias: los cierres `PARTIAL` desde `REPAIRING` (práctica independiente no demostrada, máximo de
  actividades) y desde `PARENT_RETEST` (reintentos agotados) usan `stuckClose`; al volver a la pregunta padre aparece la
  oferta de `stuckOffer` con una opción más, «Explícamelo de otra forma» (peldaño ≥2 de esa pregunta).
- Paso no resuelto de la lección por pasos (`markStepUnresolved`): al terminar, por cada uno (máx. 2) un botón
  «Explícame esto de otra forma» abre el peldaño 2 sobre la idea de ese paso (`question` = enunciado de su comprobación,
  `avoid` = cuerpo del paso). En este flujo la escalera llega solo al peldaño 2.
- **No** sube: un `UNKNOWN` de evaluación incierta (otro `error_type`). Para reducir esos casos, el servidor reconoce
  localmente como «No sé» (sin llamar al modelo) la respuesta completa normalizada (sin mayúsculas, sin acentos, sin
  puntuación en los extremos) cuando es una de: no sé, no se, no lo sé, ni idea, **no entiendo, no lo entiendo, no sé cómo
  empezar, no tengo idea, no me acuerdo, no recuerdo**. Una frase parecida dentro de una respuesta más larga se evalúa normal.

## Servidor

`POST /api/teach/direct` acepta además `rung` (1, 2 o 3; ausente = 1), `avoid` (lista de ≤6 textos) y `misconception`.
- Rung 1 (o campos ausentes): idéntico a hoy.
- Rung 2: respuesta `{schema_version, rung:2, needs, steps, worked, check, content_check}` y el `check` se guarda con
  `save_placement_items` (ids `direct-`, se responde por `/api/teach/direct/answer`). `avoid` no vacío rechaza todo paquete
  con un paso cuyo cuerpo normalizado coincida; un reintento con el motivo; si falla, `ValueError` y nada guardado.
- Rung 3: exige `reference` no vacío y rechaza (sin llamar al modelo) un enunciado que, normalizado, coincida con el de un
  ítem de clave privada guardado del perfil (colocación, confirmación, directo, pasos…), para no revelar su respuesta.
  `{schema_version, rung:3, model_answer, why:[2..4], content_check}`. `model_answer` de 20 a 700 caracteres y cada
  paso de 20 a 450. Pasa por `audit_content` y un reintento. No guarda nada (no hay ítem).
- `rung` fuera de 1..3, `avoid` que no sea lista y conteos o longitudes inválidos: `ValueError` en español, sin guardar.
- El enunciado, el criterio, `avoid` y `misconception` viajan entre `<<< >>>` (datos, no instrucciones).

## Evidencia (no negociable)

- Ningún evento `EVIDENCE` nuevo. Evento de registro aditivo `{type:'TEACHING_LADDER', node_id, rung, trigger, at}` al
  confirmarse un peldaño (contenido recibido u oferta de prerrequisito mostrada). `trigger` ∈ `no_se`, `direct_full`,
  `check_failed`, `attempt_cap`, `repair_partial`, `step_unresolved`, `not_understood`, `not_remember`, `review_failed`. `TEACHING_EXPOSURE` al mostrar contenido, como hoy.
  `DIRECT_CHECK` y `FADED_STEP` siguen siendo formativos.
- La respuesta a la pregunta original tras cualquier peldaño cuenta CON AYUDA (nunca independiente ni transferencia):
  peldaño 1, `hints>=1`; peldaño 2, `hints>=2`; peldaño 3 (se vio la respuesta o se envió al prerrequisito),
  `hints>=3` y `hint_level_max=HINT_LEVEL_MAX` (el 3a, sin respuesta vista, deja `hints=2` y no el nivel máximo). La ayuda se
  fija al confirmar el peldaño (no solo al volver). Además hay una **defensa persistente**: `goal.ladder_shown` (mapa
  `node_id|enunciado normalizado → nivel` con tope de 300 entradas, que `newVisit` no borra). En `prepareRecord`, si la pregunta
  del intento está ahí, la ayuda se fuerza a ≥ el nivel visto y, con nivel 3, `hint_level_max` al máximo: nunca independiente.
  Esto cubre también un reintento (tras `UNKNOWN`, `PARTIAL` o tras salir y volver) de una pregunta que ya tuvo un peldaño:
  sigue marcada con ayuda ≥ el nivel del peldaño. Es aditivo: una meta sin `ladder_shown` se comporta como antes. Un
  enunciado idéntico que el modelo regenere después también queda marcado (decisión conservadora). En `REVIEW` el peldaño 3
  invalida `review.question` al mostrar la respuesta; el calendario del repaso no cambia.
- `UNKNOWN` nunca suma. En `REVIEW` ni un `UNKNOWN` ni la escalera mueven el calendario (el peldaño 3 tampoco).
- No se activa en `DIAGNOSTIC`, `CONFIRMATION`, `CONTEXT`, colocación, ni con una reparación activa (`topContext`).
- Si la ruta falla en el peldaño N: no avanza de peldaño, no guarda nada, se ofrece «Reintentar» y «Seguir con otro
  tema». Sin cuota, el peldaño 3b no revela `reference` desde el cliente. Las respuestas obsoletas (cambió la meta, el
  nodo o el estado de la escalera mientras llegaba) se descartan como ya hace `fetchDirect`.

## Estado antiguo

Un `s.direct` con `status:'repeat'` o sin `question` válida (estado de `direct_teaching_v1`) se trata como nulo al pintar la
sesión: sin «Reintentar» roto ni pantalla vacía.

## Compatibilidad y rollback

Campos y evento aditivos; el código anterior ignora `s.ladder`, `goal.ladder_shown`, `s.direct.rung` y `TEACHING_LADDER`. Sin migración de
SQLite. Revertir devuelve el comportamiento de `direct_teaching_v1` (un segundo «No sé» vuelve a ofrecer la lección completa).

## Fuera de alcance

Fases `DIAGNOSTIC`/`CONFIRMATION`/`CONTEXT`, colocación, reparación activa, fuentes del aprendiz, el demo controlado
(`tools/serve_controlled_demo.py` no alcanza estos generadores) y la evidencia de independencia de otras actividades (criterio, producción, Beto) sobre una pregunta ya vista: la defensa de
`ladder_shown` solo actúa en el flujo principal (`prepareRecord`).

## Sin validar

Todo con proveedor simulado y funciones en Node; ni Gemini real ni navegador real (salvo `browser_smoke`). La calidad
pedagógica de «otra forma» y de la respuesta comentada solo se conoce con el modelo real.
