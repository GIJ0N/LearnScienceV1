# Dominio confirmado otro día (`delayed_mastery_v1`, L2a)

## Propósito

Un acierto del mismo día no basta para dar un tema por dominado. Para marcar un tema como dominado hace falta, además de la suficiencia en cada dimensión requerida, un acierto escrito calificado localmente en otro día, al menos 8 horas después de la última enseñanza del tema. Este documento cubre solo L2a. La transferencia (`transfer_probe_v1`) queda fuera y se trata en L2b.

## Regla de dominio

`mastered = todas las dimensiones requeridas suficientes Y delayedConfirmed`.

Un acierto confirma lo diferido solo si cumple todo lo siguiente:

- Es una producción escrita calificada localmente (`evaluator_trust` `deterministic` y `evaluator_version` que empieza por `local-production`). Ni la opción múltiple, ni la clave de colocación, ni el modelo confirman.
- Es un acierto independiente: sin ayuda, sin corrección del usuario, sin pista y fuera de banda `base`.
- Su referencia es la última `TEACHING_EXPOSURE` o `FORMATIVE_EXPOSURE` del tema anterior a ese acierto. Si no hay ninguna, la referencia es la evidencia más antigua del tema, sin contar `TRUST`.
- Cae en otro día civil local y al menos `DELAYED_MIN_GAP_MS` (8 h) después de la referencia.

La referencia se deriva del ledger de eventos al leer. No se guarda ningún campo `first_teaching_at`.

## Decisiones del dueño

| Id | Decisión | Estado |
|----|----------|--------|
| D1 | «Otro día» = fecha local distinta y al menos 8 h. | Cumplido (`otherLocalDay`). |
| D2 | El acierto que confirma es determinista y escrito; el modelo y la colocación no confirman. | Cumplido (`writtenDeterministic`). Prueba: `delayed_mastery.test.js`. |
| D3 | Para temas afectados por el aviso L2, la confirmación se ofrece al día siguiente. | Cumplido en el selector (propósito `delayed`). Prueba: confirmación programada para el tema b. |
| D4 | No aparece en la especificación recibida (L2a lista D1, D2, D3 y D5). | No implementado ni inventado. Pendiente de confirmación del dueño. |
| D5 | Temas sin producción escrita posible quedan «por confirmar» con la salida «Seguir con la ruta» (`CURRICULUM_CONTINUED`). | Cumplido. El texto `ANCHOR_UNAVAILABLE_NOTE` lo explica en el aviso. |

## Correcciones del supervisor

| Id | Corrección | Estado |
|----|-----------|--------|
| C1 | Hay seis lugares que escriben `TEACHING_EXPOSURE`. | Parcial. Las escrituras siguen dispersas (`submitStepPrediction`, `applyStepRepair`, `session`, `directTeachingView`, `fadedStage`, `prqRevisited`). No se añadió un helper común. La lectura del ledger las ve todas, así que la regla funciona, pero el helper pedido no existe. |
| C2 | `settled(goal,id) = verified || awaitingDelayed` en lugar de `verified` donde un tema por confirmar no debe bloquear. | Parcial. `settled` se usa en `nextAfterLesson` y en el cierre de INTEGRATE (`finishAwaitingDelayed`). Los demás puntos de la lista (`prerequisite_review`, placement, áreas, camino, botón «Comprobar evidencia») no se revisaron uno por uno contra la lista. |
| C3 | `learningState` expone `dims_sufficient` además de `sufficient`. El selector no escribe `CURRICULUM_CONTINUED` al esperar. | Cumplido. Prueba: `CONTINUE` con propósito `wait` el mismo día. |
| C4 | El camino de confirmación es una producción escrita con propósito `delayed`, alcanzable aunque exista un `CURRICULUM_CONTINUED` de política. | Cumplido. `selectorDone` ignora `CURRICULUM_CONTINUED` con `source` `POLICY_NOTICE`. |
| C5 | La referencia es la última exposición anterior al acierto, derivada del ledger, no un campo confiado. | Cumplido. Prueba: releer el mismo día no confirma. |
| C6 | Sanear timestamps nuevos (no finitos, no positivos, cadenas). | Parcial. `eventTime` descarta valores no finitos y no positivos. No rechaza timestamps futuros. |
| C-a | Solo una práctica de propósito `anchor` crea ancla local. | Cumplido (`applyProductionResult` y `createTrustAnchor`). Ver `evidence_l2_fixes.test.js`. |
| C-b | Texto explícito de «práctica escrita no disponible» en lugar de un reintento vacío. | Cumplido (`ANCHOR_UNAVAILABLE_NOTE` en `policyNoticeView` y `anchorOffer`). Solo aparece tras un intento fallido. |
| C-c | `fetchProduction` pasa de `numeric` a `ordering` solo ante `PRODUCTION_NOT_APPLICABLE`. Una respuesta malformada no marca el tema como sin práctica. | Cumplido. Prueba: `evidence_l2_fixes.test.js`. |

## Aviso de política

- L1 (`hardeningImpact`) mide la suficiencia con el legado. L2 (`delayedImpact`) mide el dominio diferido.
- `policyNoticeView` muestra L1 primero y después L2. L1 no silencia L2.
- `acknowledgePolicyNotice(goal, at, version)` es idempotente por versión y escribe `POLICY_NOTICE_ACK`.
- Los temas afectados por L2 reciben una confirmación programada para el día siguiente (D3).

## Cambios de interfaz

- `deriveCoverage` devuelve `delayed` (`confirmed` o `pending`) y `mastered` incluye el diferido. Sin `events`, `deriveCoverage` falla cerrado: no concede dominio.
- `readyToAdvance` incluye `awaitingDelayed`. El tema por confirmar se marca como `awaiting_delayed` y en la vista aparece «Por confirmar otro día».
- `expertLayers` usa `delayedConfirmed` para la capa de independencia: dos aciertos del mismo día quedan en `partial`.
- `nodeSufficientForBand` exige dominio completo. Por eso una banda de desafío necesita el acierto diferido.

## Lo que no hace

- No concede dominio por conexiones entre metas.
- No convierte la exposición en evidencia.
- No toca el juez, `MIN_INDEPENDENT_SUCCESSES`, `DAY`, la regla de memoria de 24 h, `INTERVALS` ni los `*_service.py`.
- No llama a ningún proveedor real: las pruebas usan respuestas controladas.

## Compatibilidad y rollback

- Los eventos anteriores no se reescriben ni se borran. Un tema ya dominado con datos legacy sigue `verified` solo si su evidencia cumple la nueva regla. Si no la cumple, aparece como «por confirmar» con aviso.
- Rollback: revertir `app.js` y `app_legacy.py` vuelve a la regla anterior. Los eventos `POLICY_NOTICE_ACK` y los `TEACHING_EXPOSURE` nuevos se conservan y no rompen la lectura.

## Pruebas

- `node tests/delayed_mastery.test.js` (TZ `America/Mexico_City`; incluye el caso `America/New_York` con DST).
- `node tests/evidence_l2_fixes.test.js` (C-a, C-b, C-c y producción diferida).
- `python tests/delayed_mastery_store.test.py` (guarda: no se guarda `first_teaching_at`).
- Tests existentes ajustados al dominio diferido: ver el mensaje del commit `Ajusta pruebas existentes al dominio diferido (L2a)`.

Mutaciones comprobadas (se rompe, falla, se restaura, y el hash de `app.js` coincide): sin mínimo de 8 h; fecha UTC; evidencia cruda; primera enseñanza; sin `awaitingDelayed`; sin filtro de versión del reconocimiento; acierto de modelo que confirma; sin `purpose === 'anchor'` (C-a); bucle antiguo (C-c); sin `settled` en `nextAfterLesson`.

## Sin validar

- Aceptación con Gemini real. Las pruebas usan respuestas controladas.
- Navegador real. Las pruebas usan un DOM simulado.
- Rechazo de timestamps futuros (C6 parcial) y helper común de `TEACHING_EXPOSURE` (C1 parcial).
- Revisión completa de todos los usos de `settled` frente a la lista C2.
