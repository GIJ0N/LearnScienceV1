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

Reproducción cronológica con `stretch = 1`, `dificultad = 0,5`, `n = 0`. Para cada evento válido, `n += 1` y:

- retraso relativo `L = clamp(retraso_real / intervalo_programado, 0,5, 2)`, con `intervalo_programado = due_at − last_exposure_at` (si falta, `L = 1`);
- **acierto** con confianza ≥ 50 o sin indicar: `stretch ×= 1 + 0,10·(1 − dificultad)·L`; `dificultad −= 0,1`. Llegar tarde y aun así acertar (L>1) crece más; un tema difícil crece menos;
- **acierto con confianza < 50** (frágil): sin cambio (igual que la escalera);
- **fallo**: `stretch ×= 0,8`; `dificultad += 0,2`. (La escalera ya evita volver siempre a 1 día: baja a ⌊peldaño/2⌋, salvo creencia firme errónea.)

`stretch` se acota a [0,5, 2,0], la dificultad a [0, 1]. **Si `n < 2` el resultado es `stretch = 1`**.

## Factor personal (`schedulePersonal`)

Sobre los últimos 60 eventos válidos **vencidos** (`AT_DUE` o `AFTER_DUE`) de la meta: `tasa = aciertos / n`. Con `n < 20`, `factor = 1,0`. Si no, `factor = clamp(1 + 2·(tasa − 0,875), 0,6, 1,6)` (objetivo 87,5 %, centro de 85–90 %): 98 % → ×1,25; 75 % → ×0,75; 50 % → ×0,6. Se muestra con `n` y es por meta (los eventos son de la meta y del perfil activo: no hay mezcla entre metas ni perfiles).

## Crédito jerárquico (solo calendario)

Cuando se registra un acierto válido diferido (los mismos criterios, confianza no frágil) en el tema `X`, para cada prerrequisito **directo** `P` de `X` en el mismo mapa de la meta que tenga repaso programado con `due` entre 3 días atrás y 7 días adelante:

- `días = min(14, ⌊0,5 · intervalo_original(P)⌋)`; si es < 1 no se hace nada;
- como máximo 2 aplazamientos por ciclo y la suma ≤ el intervalo original; el intervalo total desde la última exposición ≤ `max_días`;
- `P.due = max(P.due, ahora) + días`.

Reglas estrictas: **no** crea evento `EVIDENCE`, cobertura, dominio, retención ni independencia en `P`; no toca `step`, `history`, `question`, `last_exposure_at`, `answered_at`, `origin_*`; no aparece como intento de `P`. No se usan relaciones entre metas. Un fallo en `X` **no** toca a `P` (decisión: no se adelanta; se evita acoplar el calendario a un fallo que puede deberse al tema avanzado). Idempotente por `source_attempt_id`. Auditoría: `P.deferrals[]` y un evento de ledger `REVIEW_DEFERRED {review_node_id, source_node_id, source_attempt_id, from_due, to_due, days, policy_version, creates_evidence:false}` (sin `node_id`, para que ninguna lectura por nodo lo tome por exposición). Al responder `P`, `deferrals` se reinicia (el ledger conserva el historial).

## Tope diario (`reviewQueue`)

`tope = goal.schedule_config.daily_cap` (entero 1–50) o, por defecto, `clamp(redondear(meta_diaria/2), 3, 10)` (meta 5→3, 10→5, 20→10). `restan = tope − repasos respondidos hoy` (intentos distintos de fase `REVIEW`, no `UNKNOWN`, fecha local). Si los vencidos caben en `restan`, no cambia nada (orden `due, id` como antes). Si no, se eligen para hoy según: prerrequisitos directos del tema en estudio, mayor retraso relativo `(ahora−due)/intervalo`, `due`, `id`; el resto queda en `later` con un día planificado (`+1 día` cada `tope`). **No se modifica `due` ni se pierde ningún repaso**: siguen vencidos y la cola se recalcula. El selector automático y la sesión de hoy solo ofrecen los de hoy; «Tengo siete minutos» puede tomar uno diferido si lo pides.

## Visible

Inicio de la meta: «N repasos vencidos; hoy van M», factor personal con su respaldo («Ajuste personal ×1,2 (24 repasos)» o «aún sin ajuste: 7 de 20 repasos»), y los próximos repasos con el motivo. Hito y pantalla de repaso: motivo de la fecha. Informe: línea del calendario. Ejemplos: «acertaste tras 14 días → 32 días», «aplazado 7 días porque practicaste «X»», «acertaste con ayuda: no alarga».

## Compatibilidad y rollback

Campos nuevos opcionales: `reviews[].schedule_note`, `reviews[].deferrals`, `goal.schedule_config`, evento `REVIEW_DEFERRED`. Todo el modelo se recalcula de los eventos; `schedule_note` es solo un texto de apoyo y se ignora si su `attempt_id` no coincide con el último intento del repaso. Revertir deja esos campos inertes y el calendario vuelve a la escalera fija (las fechas ya guardadas se conservan). Los tests existentes del calendario no cambian de expectativa.

## Fuera de alcance

Memoria por proposición, recordatorios externos, penalizar o adelantar prerrequisitos tras un fallo, crédito entre metas, reconstruir historial legacy y la ruta/servidor (no hay lógica de calendario en Python).

## Pruebas

`tests/adaptive_schedule.test.js`.
