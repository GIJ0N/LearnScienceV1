# Sondeo de transferencia (`transfer_probe_v1`, L2b)

## Propósito

Hasta L2a, la transferencia se daba por buena con una integración de novedad declarada por el propio tutor. Esa señal se puede
acertar con una pregunta casi copiada del tema. `transfer_probe_v1` cambia la regla: la transferencia solo cuenta con un
**problema escrito nuevo, en otro contexto**, emitido por el servidor y corregido localmente de forma determinista, sin juez ni
modelo en la corrección.

Es transferencia **cercana**: otro contexto con la misma estructura de cálculo o procedimiento. No demuestra transferencia lejana.

## Contrato del endpoint

`POST /api/practice/transfer` con `{profile_id, goal_id, node_id}`.

- La meta y el tema salen del almacén (`_case_goal`). Un tema inexistente falla antes de llamar al modelo.
- El servidor elige el tipo: primero `numeric`; `ordering` solo si `numeric` responde `applicable:false`. Hasta dos generaciones
  por tipo; cada candidato que pasa el contrato recibe una auditoría. Peor caso: cinco llamadas (`TRANSFER_CALL_LIMIT`).
- Contexto: una de `TRANSFER_CONTEXTS` (hogar, salud y deporte, dinero, naturaleza, transporte, cocina, taller, tecnología). Se toma
  la primera no usada por sondeos previos del tema.
- El prompt contiene solo: la meta como dato, nombre y resultado esperado del tema, el tipo y el contexto. No contiene ejemplo,
  comprobaciones, guías, prácticas independientes ni preguntas previas. Pide no nombrar el tema.
- La banda se fuerza a `standard` en el servidor. La publicación sigue `local_production_v1` (`expected_unit` publicado; valor, tolerancia y
  solución privados). `ordering` exige de 4 a 6 pasos.
- Respuesta: el ítem público con `purpose:'transfer'`, `transfer_probe_version:'transfer_probe_v1'`, `context_family`,
  `distance_checked:true`.
- `/api/practice/produce` sigue rechazando `purpose:'transfer'` antes de llamar al modelo (test de regresión).

### Distancia con preguntas previas

- **Misma meta y mismo tema** (lección `check`, `guided`, `independent`, `integration`; enunciado del `example`; `EVIDENCE` del tema;
  reseñas; `node.probe`; sondeos previos del tema): rechazo si hay igualdad, contención de al menos 20 caracteres, o Jaccard de
  términos de 4 o más letras ≥ `CASE_SIMILARITY_LIMIT` (0,5). El ejemplo se compara con `_example_overlap`.
- **Resto de preguntas del perfil**: solo igualdad o contención. No se usa Jaccard.
- Un rechazo por distancia reintenta una vez con el motivo genérico «demasiado parecido a una pregunta anterior; cambia el contexto y
  la estructura de la situación». El reintento **no cita** el texto previo. Si vuelve a fallar, error y no se guarda nada.

**Límite:** la comparación es léxica. Una plantilla clonada que cambia solo cifras o nombres puede pasar contra preguntas de otras
metas del mismo perfil. Una paráfrasis de la misma situación tampoco se detecta.

## Tope, reutilización y candado (servidor)

- **Reutilización:** un sondeo emitido y sin respuesta se devuelve sin llamadas nuevas. Cuenta si tiene fila en `placement_answers`.
- **Tope por tema:** cuatro sondeos desde la última `TEACHING_EXPOSURE` del tema. Se libera con una enseñanza nueva o siete días
  después del último sondeo (`TRANSFER_LIMIT`, sin llamar al modelo).
- **Tope diario por perfil:** `TRANSFER_DAILY_LIMIT` (10 por defecto). Solo cuenta solicitudes que llegan a generar. Igual que `_case_quota`,
  vive en memoria: **se reinicia al reiniciar el servidor**.
- **Candado en vuelo:** conjunto propio `_TRANSFER_INFLIGHT` por (perfil, meta, tema), liberado en `finally`. Una segunda solicitud
  simultánea responde `TRANSFER_BUSY` sin llamar al modelo.
- **Conteo:** `memory_store.transfer_probe_items(profile_id, goal_id)` es la única consulta nueva: solo lectura, sin cambio de esquema.
  Lee `placement_items` y `placement_answers`.

## Corrección y evidencia (cliente)

- La corrección usa `/api/practice/produce/answer` (determinista). El rol es `transfer_probe`
  (`stage:'TRANSFER_PROBE'`, dimensión `transfer`, independencia sí, transferencia sí, novedad sí). El `kind` del contrato es
  `transfer_calculation` o `transfer_procedure`; `kindDimensions` resuelve cualquier `kind` que contenga `transfer` a la dimensión `transfer`
  dentro del rol.
- El evento de evidencia guarda `transfer_probe_version`, `context_family`, `purpose:'transfer'`, `evaluator_trust:'deterministic'`.
- **Nunca** crea `TRUST` ni usa `anchor_for_attempt_id`.
- Un fallo solo contradice la dimensión `transfer`. No abre reparación, no borra `goal.lessons` y no reabre la lección.

### Qué acredita transferencia

`sufficient(transfer)` cuenta solo los aciertos independientes con `transfer_probe_version === 'transfer_probe_v1'` y
`evaluator_trust === 'deterministic'`. Dos aciertos distintos bastan.

- La novedad declarada en INTEGRATE **ya no da transferencia**. Los eventos guardados no se reescriben: se degradan al leer.
  `sufficient(d, {legacyTransfer:true})` los cuenta solo para medir el impacto del aviso.
- La capa de transferencia del panel experto usa el mismo predicado (`transferProbeEvent`).
- Los `CHALLENGE_REPORT` confirmados siguen contando como hoy en la capa de transferencia del panel. Es una excepción documentada, no
  una ampliación.

## Cuándo se ofrece (cliente)

`transferBlock(goal, nodeId, at)` devuelve el motivo de bloqueo (o `null`), en este orden:

1. `TRANSFER_BUSY`: hay otra actividad activa. Una práctica ya respondida (`status:'done'`) no cuenta.
2. `TRANSFER_NOT_DUE`: el tema no tiene dominio diferido confirmado, falta una dimensión requerida distinta de transferencia o
   la transferencia ya es suficiente.
3. `TRANSFER_TODAY`: ya hay un sondeo emitido el mismo día local para este tema.
4. `TRANSFER_COOLING`: fallo de transferencia dentro de las últimas 24 horas, sin enseñanza nueva después.
5. `TRANSFER_LIMIT`: el mismo tope que el servidor.

Sin un sondeo posible no se calcula nada: la transferencia queda **pendiente y visible** en el tablero.

### Sin práctica escrita posible (D5)

Si el servidor responde `TRANSFER_UNAVAILABLE` (cálculo y orden no aplican), el cliente registra `TRANSFER_UNAVAILABLE` una vez por
intento. La oferta muestra «Intentar de nuevo» una sola vez y la salida **«Seguir con la ruta»**, que escribe un
`CURRICULUM_CONTINUED` con `source:'TRANSFER_PENDING'`, `pending_dimensions:['transfer']`, una sola vez por tema. No es evidencia.

**Pendiente de confirmación del dueño:** el efecto de `CURRICULUM_CONTINUED` sobre el orden de la ruta lo decide la lógica existente
(`curriculumContinued`). Las pruebas no verifican ese recorrido de punta a punta.

## Eventos nuevos

| Tipo | Campos | Evidencia |
|---|---|---|
| `TRANSFER_PROBE_ISSUED` | `node_id`, `item_id`, `context_family`, `at`, `policy_version` | No (registro de emisión) |
| `TRANSFER_UNAVAILABLE` | `node_id`, `at`, `policy_version`, `retry_used` | No (formativo) |
| `CURRICULUM_CONTINUED` (`source:'TRANSFER_PENDING'`) | `node_id`, `pending_dimensions`, `at`, `policy_version` | No |
| `POLICY_NOTICE_ACK` (`policy_version:'transfer_probe_v1'`) | `policy_version`, `at` | No |
| `EVIDENCE` del sondeo | `transfer_probe_version`, `context_family`, `purpose`, `evaluator_trust` | Sí, con las reglas de siempre |

**Adición respecto a la especificación:** `TRANSFER_UNAVAILABLE` se registra **como máximo dos veces por tema**: una en el primer
intento (`retry_used:false`) y otra si falla el reintento (`retry_used:true`). Así se sabe si el reintento ya se usó sin un tercer
evento. No se duplica nada más.

## Aviso de política (L3)

`TRANSFER_VERSION='transfer_probe_v1'` se muestra después de L1 y de L2. `transferImpact(goal)` lista los temas que estaban
dominados con la regla anterior y ya no lo están. El texto: «Cambiamos otra regla: la aplicación a situaciones nuevas ya no se da
por buena con preguntas del propio tutor. En M tema(s) se comprobará con un problema nuevo en otro contexto. No se borró nada.
Puedes seguir con la ruta.»

El acuse escribe solo `POLICY_NOTICE_ACK`. A diferencia de L1 y L2, **no** escribe `CURRICULUM_CONTINUED` por tema: la transferencia
pendiente no bloquea nada y no debe marcarse como curricularmente continuada.

## Qué no hace

- No concede dominio por conexiones entre metas ni por exposición.
- No llama a ningún proveedor real: las pruebas usan un proveedor controlado.
- No toca el juez, `MIN_INDEPENDENT_SUCCESSES`, `DAY`, `INTERVALS`, `CASE_SIMILARITY_LIMIT`, las reglas de L1 y L2a, ni los `*_service.py`.
- No cambia `memory_store.py` en esquema ni en validación. Solo añade la consulta de lectura.

## Compatibilidad y rollback

- Los eventos anteriores no se borran ni se reescriben. Un tema que estaba dominado por integración de novedad aparece como
  «por sondear» con el aviso L3.
- Rollback: revertir `app.js` y `app_legacy.py` vuelve a la regla anterior. Los `TRANSFER_PROBE_ISSUED`, `TRANSFER_UNAVAILABLE` y
  `POLICY_NOTICE_ACK` nuevos se conservan; las versiones anteriores los ignoran.
- Los sondeos en `placement_items` no se borran. No se ha verificado cómo los lee una versión anterior; la versión anterior no los usa como evidencia porque no tiene el rol `transfer_probe`.

## Pruebas

- `node tests/transfer_probe.test.js` (cliente, TZ `America/Mexico_City`): suficiencia, rol y evidencia, fallo sin reparación,
  cuándo se ofrece, tope y válvulas, ocupado, emisión y reutilización sin duplicar, D5 con reintento, aviso L3 idempotente, panel,
  oferta visible.
- `python tests/transfer_probe_backend.test.py` (servidor, SQLite temporal, proveedor controlado): contrato y ruta, `purpose:'transfer'`
  rechazado por `/api/practice/produce`, banda `standard`, prompt aislado, reintento sin texto previo, reutilización, tope y válvulas,
  tope diario, candado con dos solicitudes simultáneas, `TRANSFER_UNAVAILABLE`, distancia de la misma meta y de otra meta, persistencia
  de los eventos en guardar, cargar, exportar y restaurar.

### Pruebas existentes que cambiaron

| Archivo | Cambio | Por qué |
|---|---|---|
| `tests/evidence_sufficiency.test.js` | Las observaciones de transferencia son sondeos; se añade el caso negativo y `legacyTransfer`. | La novedad de integración ya no acredita transferencia. |
| `tests/expert_panel.test.js` | La capa de transferencia exige sondeo; la novedad sola queda en `none`. | Mismo motivo: panel con el predicado nuevo. |
| `tests/expert_profile.test.js` | La fixture de 7 capas usa un sondeo como evidencia de transferencia. | Sin ese cambio, la fixture ya no llega a 5 capas. |
| `tests/judge_model.test.py` | Se registra `_transfer_attempts` en el conjunto de generación. | Nuevo sitio de llamada al modelo. No se toca el juez. |

## Mutaciones comprobadas

Cada una se rompió, falló la prueba indicada y se restauró (verificado por hash):

| Mutación | Prueba que la detecta |
|---|---|
| Permitir `transfer` en `/api/practice/produce` | `ContractAndRoute.test_produce_endpoint_still_rejects_transfer_before_model` |
| No forzar `standard` (servidor) | `test_public_item_is_standard_and_has_no_key` |
| No forzar `standard` (cliente) | `transfer_probe.test.js` (8) |
| Meter el ejemplo en el prompt | `test_prompt_is_isolated_and_does_not_name_the_topic` |
| Citar el texto previo en el reintento | `test_retry_prompt_is_generic_and_does_not_quote_previous_text` |
| Quitar el filtro `transfer_probe_version` | `transfer_probe.test.js` (1) |
| Quitar la válvula (servidor) | `test_seven_days_after_last_probe_releases_the_cap` |
| Quitar la válvula (cliente) | `transfer_probe.test.js` (6) |
| Quitar el candado en vuelo | `test_concurrent_requests_generate_once` |
| Quitar Jaccard frente a la misma meta | `test_same_node_high_jaccard_rejects_and_retries` |

## Sin validar

- Aceptación con Gemini real. Las pruebas usan respuestas controladas.
- Navegador real. El flujo de sondeo y la oferta visible solo se prueban con un DOM simulado.
- Efecto de «Seguir con la ruta» sobre el orden de la ruta (ver arriba).
- Tope diario: se reinicia al reiniciar el servidor.
- Distancia léxica: no detecta paráfrasis ni plantillas con otras cifras frente a preguntas de otras metas.
