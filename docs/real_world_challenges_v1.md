# Retos del mundo real v1 (`real_world_challenges_v1`)

Origen: la capa más débil de la medición es la **transferencia**. Todas las demás
modalidades ocurren dentro de la app, con texto que el modelo puede haber sugerido. Un reto
pide predecir, hacer algo fuera de la app y volver con lo observado.

## Flujo

1. `/api/challenge/start`: el modelo propone un reto para un tema ya aprendido.
   Público: título, escenario, pregunta de predicción, minutos. Privado: materiales, pasos,
   campos de evidencia, nota de seguridad, criterio de éxito.
2. `/api/challenge/commit`: el aprendiz **bloquea su predicción** (texto + confianza) antes
   de ver los pasos. Se guarda en el servidor (idempotente por `attempt_id`). Solo entonces
   se devuelven materiales, pasos, campos de evidencia y nota de seguridad.
3. El aprendiz lo hace fuera de la app. Puede salir y volver (el estado persiste).
4. `/api/challenge/report`: entrega lo observado por campo y una reflexión. Exige un
   `commit` previo; usa la predicción guardada, no la que mande el cliente.

## Qué decide el modelo y qué decide el código

- El modelo propone el reto y valora el informe con una rúbrica
  (`SUPPORTED`, `PARTIAL`, `NOT_SUPPORTED`, `INSUFFICIENT`).
- El código decide: contrato del reto (2–6 pasos, 2–3 campos, 10–45 min, textos no vacíos),
  filtro local de **seguridad** (descarta retos con fuego, enchufes, cuchillos, ácidos,
  hervir, ingerir, alturas, etc.), auditoría de contenido (`audit_content`, falla abierta),
  puerta mínima del informe (cada campo ≥ 12 caracteres, reflexión ≥ 20) y la
  idempotencia.
- La valoración es **provisional**: nunca es EVIDENCE, `expertOutcome` la ignora, no concede
  dominio. Solo puede adelantar un repaso (`lapseReview`) cuando NOT_SUPPORTED.
- `INSUFFICIENT` no crea evento y permite reenviar con otro intento. Un informe no puede
  verificarse: es autoinformado. Por eso no cuenta como dominio.

## Evento

`CHALLENGE_REPORT` (provisional): SUPPORTED→CORRECT, PARTIAL→PARTIAL,
NOT_SUPPORTED→MISCONCEPTION; incluye `prediction_confidence` y `prediction_match`
(calibración de la predicción, informativa).

## Límites conocidos

- Solo texto (sin fotos) en v1.
- El informe es autodeclarado; el modelo valora coherencia, no veracidad.
- La seguridad es un filtro local por palabras más la nota del modelo; no sustituye el
  criterio del aprendiz. Los pasos son de bajo riesgo y con materiales cotidianos.

## Ajustes tras la primera prueba real

- La generación se reintenta una vez con el motivo del descarte (contrato, seguridad o auditoría).
- El prompt exige que los datos a registrar cubran todo lo que piden los pasos, que los materiales coincidan con los pasos y que el tiempo sea realista.
- Una medición corta cuenta si tiene al menos 2 caracteres y un dígito («20»); el resto de los campos sigue exigiendo 12 caracteres.

Un resultado positivo puede confirmarse con una pregunta local (`local_confirmation_v1`).
