# Preguntas reportadas v1 (`reported_items_v1`)

- En el diagnóstico, «Esto está mal» marca la pregunta como excluida en el servidor.
- Una pregunta excluida no se puede responder (`ITEM_EXCLUDED`), salvo repetir exactamente un
  intento ya registrado antes del reporte (idempotencia).
- La pregunta reportada no crea evidencia ni la quita; el diagnóstico pide otra pregunta para
  ese tema.
- El texto reportado se añade a las preguntas que el generador debe evitar.
- Solo se excluyen preguntas del propio perfil y meta, y solo de diagnóstico (`placement-`).

## Límites
- Las preguntas de otras modalidades (pasos, discriminación, composición…) siguen solo
  reportándose; no se excluyen.
- Si ya se respondió una pregunta antes de reportarla, esa evidencia no se retira.
