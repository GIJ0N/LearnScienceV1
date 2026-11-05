# Pistas graduadas v1 (`graded_hints_v1`)

## Propósito

`help_used` cuenta cuántas ayudas recibió un intento, pero no dice cuánto revelaron. Esta
vertical añade al evento de evidencia el peldaño más revelador usado en el intento, según la
escalera de pistas:

| Nivel | Qué hace la pista |
|---|---|
| 0 | redirige la atención ("relee el segundo dato") |
| 1 | redescribe el patrón |
| 2 | nombra la clase candidata |
| 3 | nombra la idea (le da al aprendiz la recuperación) |
| 4 | esboza el movimiento (le da la ejecución) |
| 5 | muestra el paso resuelto |

## Campos nuevos

- `hint_level_max` en cada evento `EVIDENCE`: `null` si no se usó ninguna pista; si se usó,
  un entero de 0 a 5.
- `hint_ladder_version: 'graded_hints_v1'` en los eventos nuevos.
- Estado transitorio: `session.hint_level_max` (lección activa), `episode.current_hint_level_max`
  y `attempt_checkpoint.hint_level_max` (reparación), `criterion_draft.hint_level_max` y el
  campo `hint_level_max` en la evaluación por criterio.
- `hint_history[].level` en los episodios de reparación.

## Qué cuenta y qué no cuenta como evidencia

- **Cualquier pista, incluida la P0, impide la independencia.** Basta con que
  `hint_level_max` no sea `null` para que `is_independent` sea `false` y `help_used` valga
  al menos 1. Eso se comprueba en cuatro lugares: `activityEvidence`, `independentSuccesses`
  (suficiencia), `correctIndependent` (cierre de la reparación) y `validate_store` (store
  importado o guardado). Esto se cumple aunque un evento declare `is_independent: true`.
- El nivel **no cambia la corrección**: un acierto con pista sigue siendo `CORRECT`.
- El nivel **no crea crédito de dominio**. Es un dato para decidir la siguiente intervención
  (lo reciben `lesson_adaptation` y la memoria relevante, y se pasa acotado al prompt de
  lección y de criterio).
- Si el valor no se puede leer (texto, NaN, booleano), se toma como 5, y un decimal se
  redondea hacia arriba. Ante la duda se asume la pista más reveladora.

## Asignación de niveles hoy (decisión conservadora)

El modelo no clasifica hoy las pistas que genera. Por eso, el nivel lo asigna el código según
la fuente de la pista:

| Fuente | Nivel |
|---|---|
| "Dame una pista" en GUIDED de la lección (muestra el error común) | 2 |
| Pista de la actividad por criterio (nombra el tipo de principio) | 1 |
| Pista genérica de reparación ("vuelve al principio, identifica el dato") | 0 |
| `guided_hints[i]` de reparación v2 (generadas por el modelo y sin verificar) | 3 + i, tope 4 |
| Pista del evaluador mostrada tras la respuesta | 3 |
| `registerRepairHint` sin nivel declarado | 5 |

Una pista generada por el modelo puede revelar más de lo que pretende, así que nunca se le
asigna un nivel por debajo de 3. Estos valores son provisionales: cuando el generador declare
y el servidor valide el peldaño de cada pista, se podrán ajustar.

## Fuera de alcance

- Hacer que P3 o superior cuente como fallo de recuperación en el calendario de repaso
  (lo propone `learnscience-pedagogy`). El repaso ya trata cualquier ayuda como
  `DELAY_UNVERIFIABLE`. Cambiar `r.step` es un cambio de política aparte.
- Pedirle al modelo que clasifique sus pistas.

## Compatibilidad y rollback

- A los eventos legacy sin el campo no se les inventa un nivel. Siguen decidiéndose solo
  por `help_used` y `is_independent`, igual que antes.
- La huella de la evaluación por criterio solo incluye `hint_level_max` cuando no es `null`,
  así que las huellas antiguas se mantienen.
- No hay migración SQLite. El nivel viaja en `event_json`.
- Rollback: el código anterior ignora `hint_level_max`. Los eventos que `validate_store` ya
  marcó como no independientes por tener pista se quedan así. Es la dirección conservadora
  y no se revierte.
