# Respuesta abierta con ancla local (`open_answer_trust_v1`)

## Propósito
Que el dominio inicial de un tema no dependa solo del juicio del modelo. Política aprobada por el dueño del proyecto.

## Regla (única)
En un tema, los aciertos calificados solo por el modelo cuentan para suficiencia únicamente si el tema tiene un **ancla**:
un acierto corregido localmente, posterior a la última contradicción. Basta una ancla por tema.

## Campos
- `activityEvidence` añade `evaluator_trust`: `deterministic` (versión `local-*` o `placement-key*`), `user` (corregido) o `model_single`, y `trust_policy_version:'open_answer_trust_v1'`.
- Evento `TRUST_ANCHOR {node_id, source:'CONFIRMATION'|'PRODUCTION', source_attempt_id, at}`.
- Marcador `{type:'TRUST', status:'CORRECT', source_attempt_id, timestamp}` en `d.evidence` de todas las dimensiones del tema
  (`updateCoverage` acumula la evidencia; no se reconstruye desde `goal.events`).

## El marcador
No es un intento, un acierto ni una contradicción: `independentSuccesses` lo salta, `deriveCoverage` no lo toma como acierto,
`learningState` y la comprobación de memoria lo ignoran. Solo `independentSuccesses` lo lee para saber si hay ancla después de la última contradicción.

## Cómo nace un ancla
- Práctica de cálculo (`local_production_v1`) CORRECT → `source:'PRODUCTION'`.
- Confirmación con origen `OPEN_ANSWER` (nuevo en `CONF_SOURCES`) CORRECT → `source:'CONFIRMATION'`.
  MISCONCEPTION adelanta el repaso (`lapseReview`); UNKNOWN no hace nada.
- Un `CONFIRMATION` de otro `confirms_type` no crea ancla.
- `OPEN_ANSWER` no entra en las capas de comprensión ni transferencia del panel experto.

## Interfaz
Si una dimensión tiene al menos 2 aciertos del modelo y el tema no tiene ancla, la cobertura (sesión y panel de cobertura) muestra
«Falta una confirmación rápida» y el botón que abre `startMixed(goal,'confirm',{source_type:'OPEN_ANSWER'})`.

## Compatibilidad y reversión
Los eventos sin `trust_policy_version` (anteriores) cuentan como antes; no se reescribe nada. El código anterior ignora los campos nuevos
y vuelve a contar los aciertos del modelo; los marcadores `TRUST` se ignoran.

## Pruebas
`tests/open_answer_trust.test.js` y `test_open_answer_source_accepted` en `tests/local_confirmation_backend.test.py`.

## Ajuste (auditoría del plan)
Además del aviso «Falta una confirmación rápida» (2 aciertos del modelo sin ancla), tras un solo acierto abierto calificado por el modelo en práctica independiente, integración o repaso se ofrece «Confirma con una pregunta rápida» (`anchorSuggest`), si el tema no tiene ancla, esa respuesta no se confirmó ya y no hay otra práctica ni reparación activa. El nacimiento del ancla se prueba por el flujo real de `applyDiscrimination`.
