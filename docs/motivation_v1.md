# Racha y meta diaria (`motivation_v1`)

## Propósito

Dar un motivo para volver cada día sin falsear el progreso. Mide **constancia** (haber estudiado), nunca dominio.
Es solo presentación y una preferencia: no entra en el selector, la cobertura, el plan, el panel de experto ni el calendario.

## Qué cuenta como respuesta de estudio

Algo que la persona contestó: `EVIDENCE` con `evidence_role==='learning'` (incluye confirmación, discriminación, composición y repaso),
`DIRECT_CHECK` y `FADED_STEP`. Aciertos y fallos cuentan igual. No cuentan: leer o ver explicaciones (exposición), el «No sé» declarado
(`UNKNOWN` con `error_type:'lack_of_exposure'`), evaluaciones inciertas de `DIRECT_CHECK`/`FADED_STEP` en `UNKNOWN`, registros de
auditoría (`audit_only`), correcciones (`correction_of`, para no contar dos veces una respuesta) ni eventos de registro
(`DIRECT_TEACHING`, `STUCK_OFFER`, `PLAN_OVERRIDE`, …). Una evaluación `UNKNOWN` que no es «No sé» sí cuenta (la persona sí respondió).

## Funciones (puras, en `app.js`)

- `studyAnswers(store, dayStart, dayEnd)`: respuestas de estudio en un intervalo, sumando todas las metas.
- `streak(store, at, target)` → `{version, today, target, today_done, current, best, week}`. Días por **fecha local**.
  Un día cuenta con al menos `MIN_STUDY_ANSWERS = 3` respuestas. Se admite un día sin estudio por cada 7 (dos huecos separados por menos
  de 7 días rompen la racha); el hueco no suma. Hoy sin estudiar todavía no es un hueco. Racha rota: sin aviso, vuelve a «Racha: 1 día»
  al estudiar. `week` son los últimos 7 días (el último es hoy).
- Meta diaria 5 / 10 / 20 (por defecto 10) en `store.motivation.target`. Paso 0: `validate_store` copia el store completo y
  conserva claves nuevas (comprobado), así que no hace falta `localStorage`. Un valor inválido se trata como 10.

## Interfaz

- Navegación: «Racha: N días» con siete puntos de la semana y `aria-label` completo.
- Inicio de la meta: bloque «Tu constancia» con anillo («x de N respuestas hoy», `role="progressbar"`) y selector «Meta de 5 / 10 / 20».
- «Sesión de hoy» añade «Racha: N días».
- Hito `.milestone` «Meta de hoy cumplida»: una vez por día (`store.motivation.celebrated_day`); se ve hasta la siguiente respuesta.
- Palabras: «constancia» y «racha»; nunca «dominio», «nivel» ni «experto».

## Qué cuenta como evidencia

Nada. No hay eventos nuevos. Cambiar la meta diaria solo escribe `store.motivation`; no toca ninguna meta de aprendizaje.

## Compatibilidad y rollback

Campo aditivo `store.motivation`; el código anterior lo ignora. Sin migración. Revertir el commit quita racha y anillo.

## Sin validar

Cómo se siente la racha en uso real y en un teléfono; el hito en vivo tras una sesión larga.
