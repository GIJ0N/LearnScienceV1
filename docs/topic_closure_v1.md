# Cierre de tema: «Ideas clave» (`topic_closure_v1`, L3)

## Propósito

Al terminar un tema, mostrar en pocas líneas qué se enseñó, cómo se conectan esas ideas y, si el aprendiz quiere, una explicación con sus propias palabras. Es presentación y autoexplicación: no cambia ningún veredicto, cobertura, calendario, dominio ni transferencia.

## Fuentes del resumen

`closureIdeas(goal, nodeId, payload, lesson)` devuelve `{source, ideas, chains, shared}`:

- `graph`: proposiciones del grafo del tema (`/api/graph/get` con `node_id`). Primero las de la `lesson_ref` actual (`goal.graph.extracted[id]`); dentro, conclusiones de cadenas, luego premisas, luego el resto. Sin duplicados, tope de 7 ideas. Cadenas con referencias fuera de las ideas mostradas se descartan. Hace falta al menos 2 ideas; si no, se usa la lección.
- `lesson`: si no hay grafo, si la lectura falla o si tiene menos de 2 ideas. Por pasos: primera oración de cada `steps[].resolution` (o `body`), máximo 5. Si no hay pasos: hasta 3 oraciones de `explanation`, sin partir fórmulas `$…$`. `common_error` se muestra aparte como «Error habitual».
- `none`: sin grafo ni lección. Se muestra «No hay un resumen guardado de este tema».

Conexiones (dentro de «Conexiones», cerrado): cadenas (máximo 3) con esquema de chips y conector en DOM/CSS, «Se apoya en», «Te prepara para» (desde `prerequisites`) y «La idea N también aparece en …» (desde `node_ids` filtrado a los nodos de la misma meta). Nunca se muestran relaciones entre metas (`goal_relation_v1`).

## Momentos en que aparece

- Sola, tras una práctica de INTEGRATE con acierto (`CORRECT`): `completed` (`finishPractice`) o `awaiting_delayed` (`finishAwaitingDelayed`).
- Tras «Continuar la ruta con pendientes visibles» (`continued`), solo si la última evidencia fue correcta.
- Por botón «Ideas clave del tema»: tras un REVIEW correcto, tras «Confirmado: … queda aprendido» (confirmación diferida), en el plan para temas en estado hecho o repaso, y en el panel de detalle del mapa.
- Nunca tras fallo, `UNKNOWN`, `PARTIAL`, colocación, intercalado, sondeo de transferencia o cierre de reparación.

El estado en memoria `closure` se limpia en cada transición y al pulsar «Seguir». Mostrar el cierre no escribe nada.

## Bloqueo al reabrir

No se muestran ideas si el tema tiene confirmación diferida pendiente (`awaitingDelayed`), si el repaso vence en menos de un día o ya venció, si la sesión activa está en ese tema en REVIEW, CONFIRMATION o TRANSFER_CHECK, o si hay un sondeo de transferencia emitido sin respuesta posterior. El texto es: «Tienes un repaso pendiente de este tema. Recordar sin mirar es lo que lo fija; después verás el resumen.»

## Eventos nuevos

- `TOPIC_CLOSURE_OPENED {version, node_id, source, at, creates_evidence:false}`: solo al abrir el resumen con botón, nunca al pintar. `source` ∈ `path`, `map`, `review_milestone`, `delayed_confirmed`.
- `TOPIC_SELF_EXPLANATION {version, node_id, closure_id, source, text, at, creates_evidence:false}`: al guardar «Guardar mi explicación». `source` es `reopen` si el resumen se abrió con botón y `closure` si apareció solo tras el acierto. `text` tiene 1 a 600 caracteres. No lleva `attempt_id`, `phase`, `result`, `evidence_role` ni `dimensions`.

Ninguno está en `EXPOSURE_TYPES`, `TEACHING_REF_TYPES` ni `isStudyAnswer`. No se envían a `/api/evaluate` ni al modelo. No alimentan `self_explanation`. El servidor (`validate_store`) recorta `text` a 600, fuerza `creates_evidence=false` y mantiene la regla de `node_id` existente.

Por qué no son evidencia ni exposición: leer el resumen es exposición, no desempeño, y la explicación escrita es un dato para decidir la siguiente intervención, no un acierto. Ninguno de los dos tipos está en `EXPOSURE_TYPES`, así que no mueven `lastExposure` ni la referencia de repaso (probado en `tests/topic_closure.test.js`).

## Backend

- `/api/graph/get` acepta `node_id` opcional. Con `node_id` devuelve solo las cadenas de ese tema y las proposiciones que usan o citan ese tema. Cada proposición lleva `node_ids` (todas sus fuentes, sin duplicados ni vacíos, así una idea fusionada cita a todos sus temas) y `lesson_refs` (acotado al tema cuando hay `node_id`). Sin `node_id` la respuesta es la de siempre, con los dos campos adicionales.
- `load_graph` ordena proposiciones por `created_at, prop_id` (orden determinista).
- No hay cambio de esquema SQLite. `extract_graph` sigue devolviendo la misma forma, con los campos adicionales.

## Compatibilidad

- Metas legacy sin `graph` ni `lessons[id]` no muestran el botón (`closureAvailable`).
- El grafo no viaja en el respaldo; tras restaurar, el resumen usa la lección si existe, o «none».
- Los eventos nuevos son aditivos. Versiones anteriores ignoran tipos desconocidos.

## Caché

El cliente guarda en memoria, por meta y tema, la respuesta de `/api/graph/get` (incluido el fallo, que no se reintenta). No se persiste.

## Rollback

Revertir `app.js`, `app_legacy.py` y `memory_store.py` a `58c95f0` quita la pantalla. Los eventos `TOPIC_*` se conservan, y el validador antiguo los ignora sin romper la lectura.

## Pruebas

- `node tests/topic_closure.test.js` (cliente, DOM simulado, sin navegador): fuentes, tope, cadenas, vecinos, una sola ruta de lectura, tarjeta tras acierto y no tras REVIEW/PARTIAL/UNKNOWN, lectura fallida sin bucle, autoexplicación sin efectos, bloqueo, texto hostil como texto, sin `innerHTML` en el bloque y meta legacy.
- `python tests/topic_closure_backend.test.py` (SQLite temporal): filtro por tema, orden determinista, otro perfil o meta vacío, tema inexistente, validación de eventos.

Mutaciones comprobadas (se rompe, falla, se restaura): sin filtro por tema en cliente; node_ids ajenos; sin bloqueo; `innerHTML`; `OPENED` al pintar; tarjeta tras PARTIAL o UNKNOWN; texto enviado a `/api/evaluate`; sin `ORDER BY`; sin filtro por `node_id` en servidor (dos variantes); sin forzar `creates_evidence`; sin recorte; evento en `EXPOSURE_TYPES`.

## No validado

- Navegador real y móvil (solo DOM simulado).
- Calidad del resumen generado por el modelo real. La extracción del grafo no tiene auditoría `content_trust`; la etiqueta «resumen automático» es la mitigación.
- Restauración de una meta real desde respaldo con grafo ya extraído.
- El sondeo de transferencia pendiente se aproxima con «emitido y sin respuesta posterior»; no se leyó un estado dedicado.
- El botón de «Por confirmar» en el plan no existe: solo `done` y `review`.
- Relectura de más de 24 h antes del repaso no está modelada (se audita con `TOPIC_CLOSURE_OPENED`).
