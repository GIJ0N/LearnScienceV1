# Calidad y costo de prompts v1 (`prompt_quality_v1`)

## Qué hay y qué falta

Hecho (verificable sin red): una **compuerta de calidad** local para toda pregunta de opción múltiple y un **banco de evaluación** que reproduce respuestas grabadas a través de los contratos.
Pendiente (necesita un modelo real): medir si los prompts producen buenas preguntas y lecciones. Ninguna prueba offline puede decirlo; el banco está listo para hacerlo con tu clave (ver «Cómo grabar respuestas reales»).

## Compuerta de calidad (`choice_quality_issue`)

El modelo propone; el servidor descarta preguntas con pistas que permiten acertar sin saber. Se aplica a diagnóstico, pasos de lección, reparación, discriminación y composición:

| Defecto | Regla |
|---|---|
| Opciones repetidas | Mismo texto normalizado (sin acentos ni signos) |
| «Todas/ninguna de las anteriores» o «a y b» | Expresión regular acotada: «Si a y b son positivos…» **no** se descarta |
| Correcta delatada por longitud | Mide ≥ 40 caracteres y ≥ 2× el promedio de las incorrectas |
| Enunciado que contiene la respuesta | El texto normalizado (≥ 12 caracteres) de la correcta aparece en el enunciado |

Un descarte baja el número de preguntas; si un lote queda por debajo de su mínimo, el flujo ya cae a su respaldo (por ejemplo, la explicación completa en lugar de pasos). Los cinco prompts generadores incluyen además `CHOICE_QUALITY_RULES`, con las mismas reglas dichas al modelo. El servidor sigue **barajando** las opciones, porque los modelos tienden a poner la clave primera.

## Banco de evaluación (`tools/prompt_bench.py`)

- `evals/prompts/cases.json`: casos con flujo, entrada, respuesta grabada y expectativas. Los 8 actuales son **sintéticos** (escritos a mano, marcados `source: synthetic`), incluidos dos que fallan a propósito: uno con sesgos típicos del modelo y otro con pasos insuficientes.
- **Reproducción** (por defecto, en CI): sin red ni clave; verifica que cada caso cumpla sus expectativas y que los defectos se detecten.
- **Métricas por caso**: llamadas al modelo, tokens aproximados de entrada (caracteres / 3,5) y presupuesto de salida, propuestos vs aceptados, motivos de descarte, y sesgos *antes de barajar* (porcentaje de claves en primera posición y de correctas más largas).

### Cómo grabar respuestas reales

```
export LLM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=...        # en tu computadora, nunca en el repo
python tools/prompt_bench.py --live --record
```
Ejecuta cada caso contra el modelo, imprime la misma tabla y reemplaza las grabaciones por las reales (`source: real`). Revisa a mano las preguntas que salgan: la tabla mide cumplimiento de contrato y sesgos, no si la pedagogía es buena. Cada ejecución consume llamadas de tu cuota (≈ 9 en total).

## Costo: llamadas al modelo por flujo

Contadas del código (máximos de salida = `max_tokens` de cada llamada):

| Flujo | Llamadas | Salida máx. (tokens) |
|---|---|---|
| Crear meta (áreas + primera área) | 2 | 1 800 + 4 200 |
| Abrir otra área | 1 | 4 200 |
| Diagnóstico | 1 por lote de ≤ 8 temas | 2 400 |
| Lección (explicación) | 1 | según `make_lesson` |
| Lección por pasos | 1 + hasta 2 reparaciones por paso fallado | 3 200 + 1 400 c/u |
| Extracción de grafo | 1 por lección | 1 800 |
| Cada respuesta abierta evaluada | 1 | según `evaluate` |
| Repaso | 1 por repaso | según `review_question` |
| Práctica intercalada / composición | 1 por sesión | 2 400 |
| Corrección de opción múltiple (diagnóstico, pasos, discriminación, composición) | **0** | — |

Estimación para un tema típico (lección + pasos + grafo + ~4 respuestas abiertas): **7 a 9 llamadas**, más repasos y prácticas posteriores.

### Hallazgo: el tope diario

`DAILY_CALL_LIMIT` vale **30** por defecto y se comparte entre todos los flujos. Con 7–9 llamadas por tema alcanza para unos **3–4 temas al día**, muy por debajo de lo que pide una meta amplia. No lo cambié: es una decisión de costo tuya. `/api/health` ahora informa `daily_limit` y `calls_today`. Con el modelo de pago, un valor entre 200 y 400 permite varias sesiones al día; defínelo con la variable de entorno `DAILY_CALL_LIMIT`.

El contador es en memoria: se reinicia al reiniciar el servidor.

## Compatibilidad y rollback

Solo endurece la aceptación de preguntas y agrega herramientas y campos de lectura. Revertir deja de descartar esas preguntas; no hay datos que migrar.

## Fuera de alcance

Evaluar la calidad pedagógica con un modelo juez, pruebas A/B de prompts con personas y mover los prompts largos a archivos.
