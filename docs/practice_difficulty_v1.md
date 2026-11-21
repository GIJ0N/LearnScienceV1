# Dificultad adaptativa de la práctica (`practice_difficulty_v1`)

## Propósito

La práctica más útil se acierta con esfuerzo: demasiado fácil no fortalece y demasiado difícil no se fija. Esta versión ajusta el nivel de la **siguiente práctica de un tema** (`base`, `standard` o `challenge`) según el desempeño reciente de la persona en ese tema.

Regla de oro: **la dificultad es dato de selección, nunca crédito.** La banda decide qué se pregunta; no decide cuánto se sabe. No cambia el juez, los umbrales de suficiencia de `docs/evidence_policy_v1.md` ni el calendario de repasos.

## Bandas

| Banda | Qué se pregunta | Cuenta para `sufficient()` | Cuándo se usa |
|---|---|---|---|
| `base` | Una sola idea por pregunta, datos explícitos, contexto cercano al ejemplo, sin distractores; el mismo criterio de corrección y sin regalar la respuesta | **No.** Nunca suma como acierto independiente | Cuando el desempeño reciente es bajo (≤ 50 %) |
| `standard` | Exactamente lo que se pregunta hoy (el prompt no cambia) | Sí, como siempre | Banda de partida, sin historial y cuando el desempeño está en el medio |
| `challenge` | Una restricción relevante y justificar una decisión dentro de la misma habilidad; sin prerrequisitos nuevos y sin llamarlo transferencia | Sí, como un acierto independiente más (el nodo ya era suficiente); **su fallo no contradice la suficiencia** | Solo cuando el tema ya tiene suficiencia, como propósito `CHALLENGE` del selector o en la práctica de cálculo de un tema suficiente |

Sin historial del tema la banda es `standard`, idéntica al comportamiento anterior.

Qué calidad tienen en el modelo las preguntas `base` y `challenge` no está validado: la banda es una instrucción adicional al prompt (ver «Fuera de alcance»).

## Cuándo cambia la banda

La banda se **recalcula siempre desde los eventos** (nada nuevo que persistir ni migrar). Se repite la historia del tema en orden y se evalúa un posible cambio tras cada evidencia válida.

Constantes (en `app.js`, con nombre):

| Constante | Valor | Justificación |
|---|---|---|
| `DIFFICULTY_WINDOW` | 5 | Últimas 5 evidencias válidas: suficientes para ver una tendencia sin que el pasado lejano pese |
| `DIFFICULTY_MIN_SAMPLE` | 3 | Con menos de 3 respuestas no se mueve: una o dos no distinguen suerte de nivel |
| `DIFFICULTY_UP_RATE` | 0,85 | Banda productiva de ≈ 85 % de acierto (`learning_science.md`): por encima, la práctica está floja. Con ventana 5 equivale a 5 de 5 |
| `DIFFICULTY_BASE_EXIT_RATE` | 0,80 | Umbral de salida de `base` (4 de 5): `base` ya es la rampa más fácil y exigir 5 de 5 dejaba atascada a quien acierta casi todo. Solo afecta a `base` → `standard`; `standard` → `challenge` sigue en 0,85 y exige suficiencia |
| `DIFFICULTY_DOWN_RATE` | 0,50 | Con la mitad o menos de aciertos independientes la tarea supera a la persona |
| `DIFFICULTY_HYSTERESIS` | 2 | Tras un cambio hacen falta al menos 2 evidencias nuevas para el siguiente |

Son valores de ingeniería conservadores, no calibrados con datos reales.

- Sube un nivel si la tasa de acierto independiente de la ventana es ≥ 85 % (≥ 80 % para salir de `base`); baja un nivel si es ≤ 50 %; en medio se mantiene. Un cambio mueve una sola banda.
- **Histéresis.** Tras un cambio, hasta que lleguen 2 evidencias nuevas no se evalúa otro. Con ventana 5 y mínimo 3 un vaivén de una sola respuesta no es posible, y la histéresis impide encadenar dos subidas (o dos bajadas) en evidencias consecutivas.
- **Qué cuenta** en la muestra: evidencias de aprendizaje (`evidence_role='learning'`) de las fases con capacidad de independencia (`INDEPENDENT`, `INTEGRATE`, `CONFIRMATION`), vigentes (una corrección manual sustituye al original y ninguno de los dos cuenta), con `attempt_id` distinto. Un **acierto** es `CORRECT` independiente y sin pistas ni ayuda.
- **Qué no cuenta:** `UNKNOWN` («No sé» o evaluación incierta), duplicados (mismo `attempt_id`), correcciones manuales, auditorías, reparaciones (`repair_episode`), diagnóstico, la comprobación de comprensión y la práctica guiada (no producen independencia), y repasos diferidos (el calendario ya trata el olvido).
- **Ayuda nunca sube la banda.** Un acierto con pista o ayuda es un «no acierto» en la tasa: no sube y, si es frecuente, baja.
- Los eventos sin banda (anteriores a esta política o de otras actividades) se tratan como `standard`. Los aciertos `base` entran a la muestra (son la rampa de subida) pero **no a la suficiencia**. Los fallos en `challenge` entran a la muestra (si fallas el desafío repetidamente, bajas) pero no al dominio.

### Banda efectiva por propósito

La banda calculada se ajusta según para qué es la práctica (`practiceBand(goal, nodeId, purpose)`):

- `lesson`: nunca `challenge` (una lección no es un desafío).
- `confirmation` / `production`: `challenge` solo si el tema ya es suficiente (todas las dimensiones requeridas); si no, `standard`.
- `challenge` (acción `CHALLENGE` del selector, que ya exige suficiencia): `challenge` si el tema es suficiente y el desempeño reciente no pide `base`; si no, `standard`.

## Suficiencia intacta

1. Las comprobaciones que cuentan para `sufficient()` son siempre `standard` o más. `independentSuccesses` ignora los eventos `base`, de modo que una práctica `base` no suma ni sola ni combinada con otra. La política de suficiencia no se modifica. Lo mismo vale para los demás consumidores de independencia: la capa «independencia» del panel experto (`expertLayers`) ignora los aciertos `base`; `anchorSuggest` no sugiere ancla local tras un acierto `base`; y una práctica de cálculo `base` correcta no crea ancla local (`applyProductionResult`).
2. `challenge` solo se concede con suficiencia. `prepareRecord` comprueba la suficiencia previa y la pasa a `activityEvidence` (`sufficient_before`); sin ella la actividad `challenge` se **registra como `standard`** y su fallo contradice. `activityEvidence` por sí sola nunca exime. La excepción es estrictamente `challenge` con suficiencia previa: un fallo en `base` o `standard` (o en un evento sin banda) contradice, reinicia `lastFailure`, quita la suficiencia y abre reparación como siempre.
3. Una banda con versión desconocida o valor inválido se descarta (`validate_store`) y el evento se trata como `standard`; si era un fallo de aprendizaje con la exención marcada (`contradicts_sufficiency:false`), la exención se retira (vuelve a `true`): sin banda verificable el fallo contradice.

## Decisión sobre fallos en `challenge`

Un fallo en `challenge` **no es una contradicción de suficiencia**. Es una prueba voluntaria por encima del mínimo, no una señal de que lo ya demostrado fuera falso. Por tanto:

- el evento se registra con `contradicts_sufficiency: false` y `counts_as_learning_failure: false`;
- no reinicia `lastFailure`: los aciertos previos siguen contando y `sufficient()` no cambia;
- no abre reparación ni cuenta en `errors`; tampoco dispara el aviso de «seguridad alta con error» (`committed_misconception`) del selector;
- queda como **dato para la banda** (varios fallos seguidos bajan de `challenge` a `standard`) y en el ledger. El calendario de repasos no se toca en esta versión.

El mismo fallo en `standard` o `base` sigue siendo una contradicción como hoy.

*Nota de versión (`prerequisite_review_v1`, corrección):* un acierto independiente en banda `base` tampoco reinicia el conteo de fallos de `prerequisite_review_v1` (solo `standard`/`challenge`); no cambia ninguna política de esta versión.

## Precedencia con `lesson_adaptation`

`lesson_adaptation` fija la **profundidad de la enseñanza** a partir del último intento (`initial`, `repair`, `scaffold`, `consolidate`). La banda de práctica no la reemplaza. Si ambas dan señales distintas, **gana la profundidad de la lección** y la práctica se queda en `standard`:

| Profundidad de la lección | `base` pedida | `standard` | `challenge` pedida |
|---|---|---|---|
| `initial` | standard | standard | standard |
| `repair` | **base** | standard | standard |
| `scaffold` | **base** | standard | standard |
| `consolidate` | standard | standard | standard |

La función `lesson_band` aplica la tabla en el servidor y la respuesta de la lección incluye `difficulty_band` (efectiva) y `difficulty_requested`. Si difieren, el cliente muestra «La lección ya ajusta el apoyo según tu último intento; la práctica queda en estándar.». `lesson_adaptation` no se modifica.

## Dónde viaja la banda (cero llamadas nuevas)

La banda es un parámetro de las llamadas que ya existen; no se añade ninguna llamada al modelo (ni al juez ni a la auditoría):

- `POST /api/lesson` (`make_lesson`): `difficulty_band` opcional. Con `base` y lección de apoyo, se añade una instrucción a la generación de las preguntas de práctica. Responde con `difficulty_band`, `difficulty_requested` y `difficulty_policy_version`.
- `POST /api/confirmation` (`evidence_confirmation`): `difficulty` acepta `base`, `standard` y `challenge` (antes solo las dos últimas). Responde con `difficulty_band`.
- `POST /api/practice/produce` (`make_production_item`): `difficulty_band` opcional; se guarda en el ítem público y se devuelve.
- Valor fuera de la lista (`'hard'`, `'Base'`, vacío, `null`, número…): error en español («Dificultad inválida: usa base, standard o challenge.») antes de llamar al modelo y sin guardar nada. Ausente = `standard`.
- La corrección (`/api/evaluate`, `/api/practice/produce/answer`) no recibe ni devuelve la banda.

## Eventos y compatibilidad

- Los eventos `EVIDENCE` de una actividad con banda llevan `difficulty_band` y `difficulty_policy_version: 'practice_difficulty_v1'`. Solo las lecciones/confirmaciones/producciones nuevas la llevan; **nunca se inventa una banda para datos anteriores**.
- La línea visible «Nivel: base / estándar / desafío · motivo» se guarda en la actividad (`difficulty_reason`) y se pinta como texto plano.
- No hay migración ni tabla nueva: el evento completo ya se guarda en `attempts.event_json`. `validate_store` tolera eventos sin banda, conserva las válidas y descarta (sin rechazar el almacén) las de valor o versión inválidos, tanto en `events` como en `coverage[].dimensions[].evidence`. Restaurar un respaldo funciona; las bandas son por perfil y meta.
- Rollback: revertir deja `difficulty_*` como campos inertes. Pero **no revertir** el cambio de `contradicts_sufficiency` sin cuidado: una versión anterior contaría esos fallos en `challenge` por su resultado y podría reabrir reparaciones o quitar suficiencia al recalcular; es el comportamiento antiguo y conservador.

## Visible, sin ruido

Una línea discreta bajo el enunciado de la práctica que cuenta (independiente, integración, comprobación y práctica de cálculo): «Nivel: estándar · Subiste porque acertaste 4 de 5 sin pistas». Sin números técnicos ni umbrales. Las actividades anteriores sin banda no muestran nada.

«Subiste» o «Bajaste de nivel» solo aparece si cambió la banda **efectiva** (un desafío recortado a estándar por falta de suficiencia no cuenta como cambio) y el cambio ocurrió dentro de la ventana actual de 5 evidencias; en otro caso el texto es neutro («Se mantiene porque tus respuestas recientes están en un punto medio.» o el aviso de que el desafío espera a la evidencia inicial).

## Lecciones en caché

Una lección guardada recuerda la banda que pidió (`difficulty_requested`). Al empezar a enseñar (modo `TEACH`, antes de la práctica) se regenera si la banda que ahora corresponde difiere de la pedida, para que el contenido coincida con su etiqueta; si el servidor degradó la banda pedida no hay bucle, porque se compara con lo pedido y no con lo aplicado. A mitad de la práctica no se reemplaza nada: el contenido ya generado conserva la etiqueta con que se generó (una base sigue siendo base y no suma). Las lecciones sin banda no se tocan.

## Fuera de alcance

- No cambia el juez, los umbrales de suficiencia (dos aciertos independientes distintos por dimensión, ancla local, etc.) ni el calendario de repasos (`adaptive_schedule_v1`, `spaced_practice_v1`).
- No hay banda en repasos diferidos, reparaciones, diagnóstico, casos, retos, discriminación ni práctica de errores: solo lección, comprobación/desafío y práctica de cálculo.
- No se valida que el modelo real distinga de verdad las bandas (es una instrucción de prompt); los umbrales no están calibrados con datos.
- Riesgo conocido: quien se mantiene en `base` con un 51–79 % de aciertos no sale (ni baja) y, como `base` no suma para suficiencia, no acumula evidencia hasta mejorar; la salida existente es «Continuar con pendientes visibles». Con el umbral de salida de 0,80 quien acierta 4 de 5 ya sale; con 0,85 el estancamiento abarcaría 51–99 %.
- Límite de confianza en el cliente: la banda de la comprobación y de la práctica de cálculo la elige y la envía el cliente (se calcula de sus propios eventos) y el servidor no puede verificarla; solo `/api/lesson` queda protegido por `lesson_band`. Por eso la banda nunca concede crédito (`base` no suma) y la única exención (`challenge`) exige suficiencia previa que `prepareRecord` comprueba en el cliente al registrar y que `validate_store` no puede reconstruir: una banda manipulada solo puede dar preguntas más fáciles o más difíciles, no dominio.

## Pruebas

`tests/practice_difficulty.test.py` (con `tests/practice_difficulty_runner.js`) y `tests/practice_difficulty.test.js`.


## Nota de versión L2a

- `nodeSufficientForBand` exige dominio completo, con acierto diferido. Una práctica de desafío requiere ese dominio.
- El acierto diferido también entra en la muestra de banda como cualquier evidencia. Las pruebas que construyen dominio completo lo reflejan en sus conteos.
- Ver `docs/delayed_mastery_v1.md`.
