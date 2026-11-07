# Informe de uso v1 (`usage_report_v1`)

Objetivo: leer el uso real (Fase 3) sin revisar eventos a mano.

## Reglas
- Solo lectura. No crea, borra ni reinterpreta evidencia.
- Se calcula en el cliente a partir de `goal.events`, `goal.reviews` y `goal.flagged_content`.
- Lo provisional (Beto, retos, corrección escrita) se muestra aparte y marcado «provisional».
- Retención: solo repasos (`EVIDENCE` con `phase:'REVIEW'`) sin ayuda, agrupados por el
  tiempo transcurrido desde la última exposición.
- Calibración: reutiliza `calibrationSummary` (misma lógica que «Nivel experto»).
- La descarga JSON contiene solo los agregados, nunca respuestas escritas ni la meta completa
  de otros perfiles.

## Límites
- Sin tiempo de sesión (la app no lo mide).
- Con pocos datos los porcentajes no significan nada: se muestran solo con n ≥ 3.
