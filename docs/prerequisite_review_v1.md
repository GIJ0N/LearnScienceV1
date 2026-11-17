# Revisión de prerrequisitos desde errores (`prerequisite_review_v1`, lote 4a)

## Propósito

Si X depende de P y el aprendiz falla X por una base que falta en P, el sistema repetía X. Esta función **solo propone revisar P**. No crea ni modifica aristas del mapa (eso es P3b), no crea evidencia y no cambia dominio ni suficiencia.

## Disparador exacto (una sola regla)

Para un tema X y un prerrequisito directo P con arista X→P **ya existente** en el mapa de la misma meta, y P sin dominio (`verified(P)` falso):

- hay **al menos 2 fallos de aprendizaje de X** (`counts_as_learning_failure=true`, `evidence_role='learning'`, `error_type='prerequisite'`),
- en **intentos distintos**,
- **posteriores al último acierto independiente de X**.

Se calcula solo con eventos ya guardados (`error_type` lo emite el juez que ya existe): **cero llamadas nuevas al modelo**.

Qué cuenta y qué no:

| No cuenta | Motivo |
|---|---|
| Fallos de diagnóstico (`DIAGNOSTIC`, `evidence_role='diagnostic'`) | no son fallos de aprendizaje (`evidence_policy_v2`) |
| `UNKNOWN` | indeterminado, no es fallo |
| Otro `error_type` (`algebra`, `conceptual`, …) | no señala una base ausente |
| Intentos de reparación (`evidence_scope='repair_episode'`), auditoría, sustituidos por una corrección | no son intentos vigentes |
| Un `attempt_id` repetido | idempotencia: el duplicado se rechaza al registrar |
| Fallos anteriores a un acierto independiente de X | X ya se demostró después |
| Fallo en `challenge` con suficiencia previa | ya no es contradicción (`practice_difficulty_v1`) |

Una corrección manual no cuenta dos veces: se cuenta el intento raíz (`original_attempt_id`) y el evento original sustituido no entra.

## Regla única: qué cambia respecto a `placement_v1`

Antes, `placementSkipped` anulaba el salto de P con **un solo** fallo de un dependiente con `error_type='prerequisite'`. Esa cláusula **se elimina**. Ahora el salto de P deja de valer por (a) un fallo de aprendizaje en P (sin cambios) o (b) una propuesta `PREREQUISITE_REVIEW` activa sobre P. Un solo fallo ya no reabre P. No hay dos reglas.

## Acciones permitidas (solo dos)

- (a) **P saltado por el diagnóstico**: se quita el efecto de `PLACEMENT_SKIP` (P pasa de `skipped` a `ready`; el evento `PLACEMENT_SKIP` no se borra, deja de valer mientras la propuesta esté activa) y se **adelanta su repaso programado** a «ahora» (se guardan `review_from_due` y `review_to_due`).
- (b) **P no saltado y sin dominio** (p. ej. se siguió con pendientes): se **marca para comprobación**. No se toca `CURRICULUM_CONTINUED`. El selector lo ofrece antes que X (repaso si lo tiene vencido; si P nunca se ha visto, su sonda corta; si ya se vio, enseñanza).

Prohibido: crear `EVIDENCE`, cobertura, dominio, retención o suficiencia en cualquier tema; borrar evidencia o eventos de P; crear/modificar aristas; relacionar metas.

## Eventos

`PREREQUISITE_REVIEW` y `PREREQUISITE_REVIEW_REVOKED` se guardan en `goal.events` **sin `node_id`** (como `REVIEW_DEFERRED`) y con `creates_evidence:false`, para que ninguna lectura por nodo los tome por exposición. Campos: `proposal_id`, `source_node_id` (X), `prerequisite_node_id` (P), `source_attempt_ids` (los dos primeros fallos), `action` (`unskip`|`check`), `review_from_due`, `review_to_due`, `at`, `policy_version`. Idempotente: no se emite otra propuesta mientras exista una activa para X→P; repetir la sincronización o un tercer fallo no duplica.

## Revocación

Si un intento disparador se corrige manualmente y deja de ser fallo de aprendizaje con `error_type='prerequisite'` (o deja de ser vigente), se registra `PREREQUISITE_REVIEW_REVOKED {proposal_id, reason:'correction'}`; el salto de P vuelve a valer y, si el repaso seguía en la fecha adelantada, recupera `review_from_due`. Si los demás fallos siguen cumpliendo el disparador, la sincronización emite una propuesta nueva con otros intentos. Un acierto independiente posterior de X no revoca una propuesta ya emitida: solo reinicia el conteo para propuestas futuras.

## Lo que ve el aprendiz

Frase en español llano, sin números: «Vamos a repasar «P» antes porque «X» depende de «P».» (razón del selector y nota en el tema P del plan/ruta). Al quitar el salto, **X y sus dependientes no aparecen `locked` si X tiene evidencia propia** (evita «perdí progreso»); P pasa a `ready`.

## Límites

- **No se adivina P.** `error_type='prerequisite'` no dice qué prerrequisito falla. Solo se propone cuando la arista X→P ya existe en el mapa. Si X tiene varios prerrequisitos directos sin dominio, se proponen todos (no se elige uno) y se ofrece primero el más antiguo en el orden del mapa. Sin arista no hay propuesta.
- Solo prerrequisitos **directos** de la misma meta; nunca crédito entre metas.
- La fiabilidad de `error_type` depende del juez del modelo; no se validó con un modelo real.

## Reversión de una decisión documentada

`docs/adaptive_schedule_v1.md` decía que un fallo en X no adelanta P. Esta fase lo revierte **solo en el caso del disparador** (≥2 fallos); fuera de él no cambia. Ver nota de versión en ese documento y en `docs/evidence_policy_v1.md`.

## Compatibilidad y rollback

Eventos aditivos; `validate_store` los tolera y los conserva (exportar/restaurar los mantiene); sin eventos `PREREQUISITE_REVIEW` todo se comporta como antes salvo la regla única (un fallo ya no reabre un salto; datos antiguos con un fallo conservan el salto). `REVIEW_DEFERRED` y `PLACEMENT_SKIP` no cambian de significado. Revertir deja los eventos inertes en versiones anteriores; sus saltos volverían a la regla de un fallo y el repaso adelantado seguiría siendo un repaso válido.

## Fuera de alcance (P3b)

Aristas nuevas en la tienda, rechazo de ciclos, identificar qué P falla, `/api/map/update`.

## Pruebas

`tests/prerequisite_review.test.js` y `tests/prerequisite_review.test.py`.
