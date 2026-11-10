# Panel de nivel experto y calibración v1 (`expert_panel_v1`)

## Propósito

Mostrar con honestidad qué tan cerca está la persona de un nivel experto en cada tema, sin crear datos nuevos: es una **lectura derivada** de la evidencia ya registrada. Cada tema se mide en 7 capas observables; una capa es `met` (cumplida), `partial` (hay indicios) o `none` (sin datos). Que falten datos no es un fallo: significa «aún no medido».

## Las 7 capas (por tema)

| # | Capa | `met` | `partial` | Fuente |
|---|---|---|---|---|
| 1 | Comprensión | Un acierto en la comprobación de comprensión | Hubo intentos, ninguno correcto | `EVIDENCE` de aprendizaje, fase `COMPREHENSION` |
| 2 | Independencia | Dos aciertos independientes en actividades distintas | Uno | `EVIDENCE` con `is_independent` |
| 3 | Retención | Repaso acertado sin ayuda tras ≥ 30 días desde la última exposición (v1.1; antes 7) | Repaso acertado sin ayuda tras ≥ 7 días (v1.1; antes 1) | `EVIDENCE` fase `REVIEW`, `help_used = 0` |
| 4 | Discriminación | Dos aciertos y el último acierto | Un acierto, o último intento fallido | `DISCRIMINATION` |
| 5 | Composición | Igual que discriminación | Igual | `COMPOSITION` |
| 6 | Transferencia | Un acierto independiente en una variante nueva | Un acierto con ayuda en variante nueva | `EVIDENCE` con `is_novel_variant` |
| 7 | Calibración | ≥ 4 respuestas decisivas con ≥ 75 % de coincidencia | ≥ 2 respuestas decisivas | confianza declarada |

**Respuesta decisiva** (capa 7): una con confianza declarada ≥ 70 % (la persona predice acierto) o ≤ 40 % (predice fallo); las intermedias no cuentan. **Coincide** si el resultado fue el predicho. Se cuentan todas las respuestas con confianza del tema, incluidas las del diagnóstico, los pasos de lección, la discriminación y la composición. «No sé» sin confianza no cuenta.

## Etiqueta del tema

Es un resumen de cuántas capas están `met`; nunca una certificación:

| Capas cumplidas | Etiqueta |
|---|---|
| 0 | Sin medir |
| 1–2 | Base |
| 3–4 | Competente |
| 5–6 | Sólido |
| 7 | Experto (según la evidencia registrada) |

Se indica siempre la **siguiente capa a trabajar** (la primera no cumplida, en el orden de la tabla) y una acción concreta.

## Calibración global

Resumen por meta (y por tema): coincidencias sobre respuestas decisivas, cantidad de **sobreconfianza** (fallo con confianza ≥ 70 %, `committed_misconception`) y de **infraconfianza** (acierto con confianza ≤ 40 %), y aciertos por tramo de confianza (0–39, 40–69, 70–100) para ver si la confianza sube con la precisión.

## Lo que NO hace

No modifica dominio, calendario ni evidencia; no escribe eventos. No se envía al servidor. Si cambian las reglas de evidencia, el panel cambia solo porque se recalcula.

## Compatibilidad y rollback

Solo lectura en el cliente. Revertir elimina la vista; ningún dato se pierde ni se migra.

## Fuera de alcance

Ponderar por antigüedad (olvido), comparar entre metas y exportar el panel.

## v1.1: caducidad (`expert_panel_v1.1`)

«Experto» no es para siempre. Cada capa calcula `last_at`: la fecha del evento más reciente que la sostiene. Si una capa estaría
cumplida (`met`) y han pasado más de `EXPERT_STALE_DAYS = 60` desde `last_at`, su estado es `stale` y se muestra «Por revalidar» (↻).
`stale` no cuenta en `met`, así que la etiqueta del tema baja; si no queda ninguna capa cumplida pero hay alguna parcial o caducada,
la etiqueta es «Iniciando». La acción siguiente de una capa caducada es «Haz un repaso para revalidar».

- Retención: un repaso correcto sin ayuda en los últimos 60 días la mantiene; un repaso con ayuda no la revalida.
- Los umbrales de retención suben a 30 días (cumplida) y 7 días (parcial), antes 7 y 1.
- Un evento sin fecha (datos legacy) no caduca: no se inventa antigüedad.
- Sin eventos la capa sigue en `none`, nunca `stale`.
- Solo lectura: el panel no escribe eventos ni cambia dominio, evidencia ni calendario de repasos.

Rollback: revertir la vista; no hay datos nuevos. Límite: 60 días es un valor de ingeniería, no un umbral científico universal.
