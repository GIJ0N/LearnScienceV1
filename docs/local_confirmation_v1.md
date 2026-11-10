# Confirmación local v1 (`local_confirmation_v1`)

Beto, los retos y la corrección escrita los valora el modelo, así que son provisionales. Una
**confirmación** es una pregunta nueva de opción múltiple con clave privada, en una situación
distinta, que se ofrece después de un resultado provisional positivo. Lo provisional nunca cuenta
solo, pero puede abrir la puerta a evidencia firme.

## Cuándo se ofrece
- Tras una respuesta abierta calificada solo por el modelo (origen `OPEN_ANSWER`, ver `open_answer_trust_v1`): una confirmación CORRECT crea el ancla local del tema; no suma a ninguna capa del panel.
- Tras un resultado provisional positivo: `BETO_SESSION` CORRECT, `CHALLENGE_REPORT` CORRECT o
  PARTIAL, `ERROR_FIX` CORRECT.
- Una confirmación por cada intento provisional (`confirms_attempt_id` único; para Beto se usa el
  `session_id`, para reto y corrección el `attempt_id`).
- El botón aparece en la pantalla de cierre de Beto, del reto y de «Práctica terminada» de
  Encuentra el error.

## Qué es
- Una pregunta con clave privada para el mismo tema, en una situación nueva, generada por el modelo,
  validada por el contrato local de opciones y auditada (`audit_content`, falla abierta).
- Si se descarta, un reintento con el motivo; si falla dos veces no se guarda nada.
- Calificación local (`_answer_choice_item`, versión `local_confirmation_v1`), idempotente, sin proveedor.

## Qué cuenta
- Evento `CONFIRMATION` con `confirms_type` y `confirms_attempt_id`. `expertOutcome` lo cuenta
  (CORRECT → acierto, MISCONCEPTION → fallo), así entra en la calibración.
- Capa del panel:
  - `CHALLENGE_REPORT` → **transferencia**: met si hay una confirmación CORRECT cuyo reto de origen
    fue CORRECT; partial si el origen fue PARTIAL. Una confirmación sin reto de origen no cuenta.
  - `BETO_SESSION` o `ERROR_FIX` → **comprensión**: una confirmación CORRECT cuenta como una
    comprobación de comprensión correcta.
- MISCONCEPTION adelanta el repaso del tema. UNKNOWN («No lo sé») no suma a ninguna capa.
- Nunca se crea un `EVIDENCE` nuevo; el provisional sigue siendo provisional.

## Límites
- La confirmación es una sola pregunta: abre la puerta a «partial/met» en una capa, no concede dominio.
- No sustituye la verificación de que el reto se hizo de verdad: solo comprueba que la idea se aplica.
