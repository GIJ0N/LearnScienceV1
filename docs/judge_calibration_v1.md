# Informe de calibración del juez (`judge_calibration_v1`)

## Qué mide

`tools/judge_calibration.py` lee una base SQLite y produce un informe en Markdown con cuánto coinciden tres fuentes sobre una misma respuesta: el **veredicto del modelo juez** (`judge_model` + `result` del evento `EVIDENCE`), la **confirmación local** (evento `CONFIRMATION` con `confirms_attempt_id` igual al `attempt_id` evaluado; calificación local con clave privada) y la **corrección manual** del aprendiz (evento con `correction_of` / `original_attempt_id` que apunta al evento original).

Por modelo de juez (y «local (sin modelo)» para evaluaciones deterministas, y «unknown (dato anterior)» para eventos sin `judge_model`):

- número de evaluaciones, válidas, `UNKNOWN` e inválidas (separadas);
- acuerdo juez↔confirmación local: acierto contra no acierto (`PARTIAL` y `MISCONCEPTION` cuentan como no acierto), con el número de pares comparables;
- confirmaciones `UNKNOWN` y evaluaciones sin confirmación, aparte;
- tasa de corrección manual sobre las evaluaciones válidas;
- distribución de `error_type` (solo etiquetas acotadas) de las evaluaciones válidas.

Muestra mínima: una celda con menos de 30 casos se marca «insuficiente (n=N)» y no muestra porcentaje.

## Qué NO decide

Es solo informativo. **No cambia el juez, los umbrales, las reglas de evidencia (`evidence_policy_v2`, `open_answer_trust_v1`), los eventos ni los datos**, y no recomienda cambiarlos. `UNKNOWN`, evaluaciones inválidas y campos ausentes nunca cuentan como acuerdo ni como acierto. **Cualquier cambio posterior de juez o de umbrales requiere su propio lote**, con su documento y sus pruebas.

## Cómo se usa

```text
python tools/judge_calibration.py --db RUTA\ruta.sqlite3 [--profile ID_PERFIL] [--out informe.md]
```

- Sin `--profile` analiza todos los perfiles de la base, cada uno por separado (los `attempt_id` no se cruzan).
- `--out` por defecto es `judge_calibration_report.md` en el directorio temporal del sistema (fuera del repo). Se rechaza si es la propia base o termina en `.sqlite3`/`.sqlite`/`.db`.
- La base se abre `file:...?mode=ro` con `query_only`, sin escribir; no llama a ningún proveedor; solo lee `attempts` y `stores`.
- Conviene apuntar a una copia si el servidor está en uso.

## Privacidad

El informe contiene solo conteos y tasas, nombres de modelo y etiquetas de `error_type` con patrón acotado (cualquier otro valor se agrupa como `otro`). No incluye texto de respuestas ni de preguntas, ni ids de perfil en claro: los perfiles aparecen como un hash corto (SHA-256, 8 caracteres).

## Límites

- **Datos legacy:** los eventos anteriores a `judge_model_v1` no tienen `judge_model` y quedan en «unknown (dato anterior)»; no se les inventa modelo. Un evento sin `result` es inválido, no acierto.
- **Confirmación:** hoy solo se enlaza la confirmación con el intento por `confirms_attempt_id` (confirmación de respuestas abiertas, Beto, retos, corrección de errores). La mayoría de las evaluaciones no tiene confirmación, así que los pares comparables serán pocos. Una confirmación es una sola pregunta de opción múltiple: no mide con precisión la calidad del juez.
- **Los eventos `EVIDENCE` solo guardan el modelo de juez de la evaluación principal.** Los veredictos de errores, retos y Beto viven en `placement_answers` y no se incluyen en esta versión (hueco documentado, no inventado).
- **Sesgo de selección:** las confirmaciones se ofrecen sobre todo tras un acierto provisional, y las correcciones manuales dependen de que el aprendiz las haga; ninguna es una muestra aleatoria. Hace falta revisión manual (`tools/sample_for_review.py`) para saber la verdad de base.
- **Muestra pequeña:** con menos de 30 casos por celda no hay porcentaje destacado.

## Pruebas

`python tests/judge_calibration.test.py` (SQLite temporal con eventos sintéticos): acuerdo con confirmación, desacuerdo, corrección manual aparte, `UNKNOWN` sin acuerdo, legacy sin campo como `unknown`/inválido, celda de 29 casos «insuficiente», informe sin texto de respuesta ni id de perfil, base idéntica (hash) antes y después. No se probó con datos reales ni con Gemini real.
