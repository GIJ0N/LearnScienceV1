# Calendario de repasos adaptativo y jerárquico (`adaptive_schedule_v1`)

## Cómo funciona hoy (verificado en `app.js`)

- Cada tema tiene como máximo un registro en `goal.reviews` (`{id, due, step, history[], question, deferrals?…}`). El estado vive en la meta (cliente) y el servidor solo lo valida y lo guarda; **toda la lógica de calendario está en `app.js`**.
- Escalera fija `INTERVALS=[1,3,7,14,30,60,90]` días. `schedule()` crea el repaso con `due = origen + 1 día`, `step = 0`.
- Al responder un repaso (`applyResult`, fase `REVIEW`): `UNKNOWN` no cambia nada; en los demás casos `r.step = nextReviewStep(...)` (acierto limpio +1; con ayuda o confianza < 50 igual; fallo ⌊peldaño/2⌋; fallo con confianza ≥ 70, a 0) y `r.due = momento + INTERVALS[step]·DAY`. El evento `EVIDENCE` guarda `temporal_classification` (`DELAYED_RETRIEVAL_OBSERVED` solo si hubo ≥ 24 h, sin ayuda ni exposición previa), `delay_ms_from_last_exposure`, `due_at`, `review_schedule_state` (`BEFORE_DUE/AT_DUE/AFTER_DUE`), `help_used`, `learner_confidence`.
- Otros movimientos del calendario que **no cambian**: «No recuerdo» (peldaño 0, mañana), `lapseReview` (fallo en discriminación/Beto/confirmación/reto adelanta), reprogramación de la escalera de enseñanza, repasos de placement (1–5 días).
- Consumidores: el selector (`selectTutorAction`, como máximo un repaso automático por visita), «Tengo siete minutos» (`startBrief`), «Sesión de hoy» (`buildDailyPlan`, hasta 3 repasos por `due,id`), el inicio de la meta (cuenta de pendientes) y el informe de uso.

## Qué cambia (v1)

1. **Estiramiento por tema** (`stretch`, 0,5–2,0) y **dificultad** (0–1) derivados solo de eventos `EVIDENCE` de repaso válidos.
2. **Factor personal** por meta (0,6–1,6) de la tasa de acierto en repasos vencidos.
3. **Crédito jerárquico** que solo puede posponer la fecha de prerrequisitos directos.
4. **Tope diario** de repasos vencidos con reparto visible.
5. Texto visible con el motivo de cada fecha y el factor personal.

La escalera y `nextReviewStep` **no cambian**: siguen decidiendo el peldaño. El intervalo efectivo es

```
días = clamp( redondear( INTERVALS[peldaño] · stretch · factor_personal ), 1, max_días )
```

Sin historial suficiente `stretch = 1` y `factor = 1`, así que `días = INTERVALS[peldaño]` exactamente (compatibilidad: una persona o un tema nuevos no notan diferencia).

## Qué evidencia alimenta el modelo

Solo eventos `EVIDENCE` con `phase='REVIEW'` que cumplan todo: no son `audit_only`; no están sustituidos por una corrección (`effectiveEvidence`); resultado distinto de `UNKNOWN`; `temporal_classification === 'DELAYED_RETRIEVAL_OBSERVED'` (por construcción sin ayuda); `attempt_id` presente. Un mismo `attempt_id` cuenta una sola vez. Eventos antiguos sin esos campos simplemente no cuentan: no se inventa nada ni hace falta migración.

Acierto = `CORRECT`; cualquier otro resultado no `UNKNOWN` es fallo. Los aciertos con ayuda nunca entran (su clasificación es `DELAY_UNVERIFIABLE`) y por eso no alargan; el peldaño tampoco sube (regla existente).

## Modelo por tema (`scheduleNodeModel`)

Reproducción cronológica de **las últimas 12 entradas válidas** del tema (los fallos antiguos no pesan para siempre) con `stretch = 1`, `dificultad = 0,5`. `n` es el total de entradas válidas del tema (activa el modelo con `n ≥ 2`). Para cada entrada:

- retraso relativo `L = clamp(retraso_real / intervalo_programado, 0,5, 2)`, con `intervalo_programado = due_at − last_exposure_at` (si falta, `L = 1`; `due_at` es la fecha original, ver «Aplazados»);
- **acierto** con confianza ≥ 50 o sin indicar: `g = 1 + 0,10·max(0,3, 1 − dificultad)·L` y `stretch ×= g`; si `stretch < 1` (venía de fallos) `g = max(g, 1,12)` para recuperarse con rapidez; después `dificultad −= 0,1`. Llegar tarde y acertar (L>1) crece más; un tema difícil crece menos, pero con piso (0,3) para no quedar atrapado;
- **acierto con confianza < 50** (frágil): sin cambio (igual que la escalera);
- **fallo**: `stretch ×= 0,8`; `dificultad += 0,2`. (La escalera ya evita volver siempre a 1 día: baja a ⌊peldaño/2⌋, salvo creencia firme errónea.)

`stretch` se acota a [0,5, 2,0] y se redondea a milésimas (`Math.round(x·1000)/1000`); la dificultad a [0, 1]. **Si `n < 2` el resultado es `stretch = 1`**. Tres fallos iniciales seguidos de ocho aciertos limpios dejan `stretch ≥ 1`.

## Factor personal (`schedulePersonal`)

Sobre los últimos 60 eventos válidos **vencidos** (`AT_DUE` o `AFTER_DUE`) de la meta: `tasa = aciertos / n`. Con `n < 20`, `factor = 1,0`. Si no, `factor = clamp(1 + 2·(tasa − 0,875), 0,6, 1,6)` (objetivo 87,5 %, centro de 85–90 %): 98 % → ×1,25; 75 % → ×0,75; 50 % → ×0,6. Con esta fórmula el **máximo real es ×1,25** (tasa 100 %; la constante 1,6 es solo una cota de seguridad, decisión deliberada: alargar «un poco») y el mínimo ×0,6 se alcanza con tasa ≤ 67,5 %. Se muestra con `n` y es por meta (los eventos son de la meta y del perfil activo: no hay mezcla entre metas ni perfiles).

## Crédito jerárquico (solo calendario)

Cuando se registra un acierto válido diferido (los mismos criterios, confianza no frágil) en el tema `X`, para cada prerrequisito **directo** `P` de `X` en el mismo mapa de la meta que tenga repaso programado con `due` entre 3 días atrás y 7 días adelante:

- `días = min(14, ⌊0,5 · intervalo_original(P)⌋)`; si es < 1 no se hace nada;
- como máximo 2 aplazamientos por ciclo y la suma ≤ el intervalo original; el intervalo total desde la última exposición ≤ `max_días`;
- `P.due = max(P.due, ahora) + días`.

Reglas estrictas: **no** crea evento `EVIDENCE`, cobertura, dominio, retención ni independencia en `P`; no toca `step`, `history`, `question`, `last_exposure_at`, `answered_at`, `origin_*`; no aparece como intento de `P`. No se usan relaciones entre metas. Un fallo en `X` **no** toca a `P` (decisión: no se adelanta; se evita acoplar el calendario a un fallo que puede deberse al tema avanzado). **Nota de versión (`prerequisite_review_v1`):** esta decisión se revierte solo en el caso del disparador de `docs/prerequisite_review_v1.md` (≥2 fallos de aprendizaje de `X` con `error_type='prerequisite'`, en intentos distintos y posteriores a su último acierto independiente, con la arista `X→P` ya existente): entonces se adelanta el repaso programado de `P` saltado por el diagnóstico (`PREREQUISITE_REVIEW`, sin `node_id`, `creates_evidence:false`). Fuera de ese caso, un fallo en `X` sigue sin tocar a `P`. Idempotente por `source_attempt_id`. **Aplazados:** un prerrequisito aplazado y respondido antes del `due` aplazado se clasifica contra su fecha **original** (`from_due` del primer aplazamiento, mientras la fecha siga siendo la aplazada); así no queda como `BEFORE_DUE` ni fuera del factor personal. **Correcciones:** si una corrección manual deja de ser un acierto válido, `REVIEW_DEFERRAL_REVOKED` devuelve la fecha original (`from_due`; con aplazamientos encadenados se desplazan los posteriores) y quita el aplazamiento; el evento corregido conserva `temporal_classification`, `delay_ms_from_last_exposure`, `due_at`, `review_schedule_state` del original (sigue en el modelo, ahora como fallo) y la `schedule_note` del intento corregido se borra. La fecha propia del repaso corregido no se recalcula (queda la ya guardada); una corrección de fallo a acierto no concede crédito retroactivo. Auditoría: `P.deferrals[]` y un evento de ledger `REVIEW_DEFERRED {review_node_id, source_node_id, source_attempt_id, from_due, to_due, days, policy_version, creates_evidence:false}` (sin `node_id`, para que ninguna lectura por nodo lo tome por exposición). Al responder `P`, `deferrals` se reinicia (el ledger conserva el historial).

## Tope diario (`reviewQueue`)

`tope = goal.schedule_config.daily_cap` (entero 1–50) o, por defecto, `clamp(redondear(meta_diaria/2), 3, 10)` (meta 5→3, 10→5, 20→10). `restan = tope − repasos respondidos hoy` (intentos distintos de fase `REVIEW`, no `UNKNOWN`, no `audit_only`, vigentes tras correcciones —una corrección no cuenta dos veces—, fecha local). Si los vencidos caben en `restan`, no cambia nada (orden `due, id` como antes). Si no, se eligen para hoy según: prerrequisitos directos del tema en estudio (`studyFocus`: el tema de la sesión activa o, si no hay, el siguiente de la ruta), mayor prioridad `(ahora−due)/intervalo + (ahora−due)/14 días` (retraso relativo más **envejecimiento en días absolutos**: un repaso largo muy vencido no queda semanas detrás de los cortos), `due`, `id`; el resto queda en `later` con una fecha **estimada** (`estimated_for`, `+1 día` cada `tope`) que no es un compromiso: la interfaz solo dice «quedan pendientes para los días siguientes, según prioridad y sin fecha comprometida». **No se modifica `due` ni se pierde ningún repaso**: siguen vencidos y la cola se recalcula. `queue.offer` es la lista ofrecible (cola ordenada si hay desborde; orden `due,id` si no; vacía con el cupo agotado). El selector automático toma de `offer` el primer repaso vencido y sin exposición en las últimas 24 h (los de exposición reciente se saltan, no bloquean). La tarjeta/botón de repasos del inicio, el panel, la sesión de hoy, el selector y «Tengo siete minutos» usan esta misma cola, el mismo `studyFocus` y el mismo tope. El selector automático y la sesión de hoy solo ofrecen los de hoy; «Tengo siete minutos» puede tomar uno diferido si lo pides.

## Visible

Inicio de la meta: «N repasos vencidos; hoy van M», factor personal con su respaldo («Ajuste personal ×1,2 (24 repasos)» o «aún sin ajuste: 7 de 20 repasos»), y los próximos repasos con el motivo. Hito y pantalla de repaso: motivo de la fecha. Informe: línea del calendario. Ejemplos: «acertaste tras 14 días → 32 días», «aplazado 7 días porque practicaste «X»», «acertaste con ayuda: no alarga».

## Compatibilidad y rollback

Campos nuevos opcionales (el evento `REVIEW_DEFERRAL_REVOKED` también): `reviews[].schedule_note`, `reviews[].deferrals`, `goal.schedule_config`, evento `REVIEW_DEFERRED`. Todo el modelo se recalcula de los eventos; `schedule_note` y cada aplazamiento guardan la fecha (`due` / `to_due`) que explican: el motivo solo se muestra si `r.due` coincide (si `lapseReview`, «No recuerdo» o la escalera de enseñanza movieron la fecha, se muestra un texto genérico), y la misma regla gobierna cuándo la sesión de hoy marca un repaso aplazado como saltado. `normalizeGoal` y `validate_store` (servidor) descartan sin rechazar `deferrals` y `schedule_note` malformados (no lista/objeto, números no finitos, más de 10 aplazamientos; `reason` ≤ 200 caracteres). Revertir deja esos campos inertes y el calendario vuelve a la escalera fija (las fechas ya guardadas se conservan). Los tests existentes del calendario no cambian de expectativa, con una excepción deliberada: `usageReport.reviews` ahora ignora repasos de nodos que ya no existen en la meta, así que el fixture de `tests/usage_report.test.js` (que tenía `nodes: []` con repasos de `a` y `b`) declara esos dos nodos; las cifras esperadas son las mismas.

## Fuera de alcance

Memoria por proposición, recordatorios externos, penalizar o adelantar prerrequisitos tras un fallo (salvo el disparador de `prerequisite_review_v1`), crédito entre metas, reconstruir historial legacy y la ruta/servidor (no hay lógica de calendario en Python).

## Pruebas

`tests/adaptive_schedule.test.js` y `tests/adaptive_schedule_backend.test.py`.
