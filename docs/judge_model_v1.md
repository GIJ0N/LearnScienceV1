# Modelo que califica y modelo que audita (judge_model_v1)

## Propósito

Hoy un solo modelo genera el contenido, lo audita y califica las respuestas abiertas: un error del modelo pasa dos veces. Esta función permite (sin obligar) usar un modelo distinto para auditar y otro para calificar, deja constancia de qué modelo juzgó y hace visible a la persona si genera y califica el mismo modelo. No cambia ninguna regla de evidencia.

## Variables de entorno (opcionales)

| Variable | Rol | Si no está definida |
|---|---|---|
| `GEMINI_MODEL` | genera contenido (como siempre) | `gemini-3.1-flash-lite` |
| `LEARNSCIENCE_AUDIT_MODEL` | audita el contenido generado | se usa `GEMINI_MODEL` |
| `LEARNSCIENCE_JUDGE_MODEL` | califica respuestas del aprendiz | se usa `GEMINI_MODEL` |

- Mismo proveedor Gemini y misma `GEMINI_API_KEY`. No hay proveedores ni dependencias nuevas. Con `LLM_PROVIDER=anthropic` los roles no se pueden separar: se ignoran y se usa `ANTHROPIC_MODEL`.
- Validación: el nombre debe tener de 1 a 64 caracteres (letras, números, `.`, `-`, `_`), empezar por letra o número y no contener `..`. Un valor no válido nunca llega a la URL: el juez responde con error en español y la auditoría falla abierta (ver abajo). La clave nunca se imprime; los errores del proveedor ya la ocultan.
- Sin ninguna variable definida el comportamiento es idéntico al anterior.

## Roles: qué función usa cada uno

Enrutado por `judge_gemini(...)` y `audit_gemini(...)`, que llaman a `gemini(...)` con un rol (el parámetro opcional `role` de `gemini` también existe; por defecto `generate`).

- **Juez** (califica lo que escribe el aprendiz): `evaluate` (`/api/evaluate`; también `micro_step`, que lo reutiliza), `evaluate_criterion_activity` (criterio de explicación; la parte de opción es determinista y no usa modelo), `grade_error_fix` (corrección del paso erróneo), `challenge_report` (valoración del informe de un reto), `beto_turn` (estado CORRECTED/PARTIAL/PERSISTS del turno con «Beto»; esa llamada además redacta la réplica de Beto, y se enruta entera al juez porque su veredicto sobre lo que explicó la persona es lo que importa).
- **Auditor**: `audit_content` (todas sus llamadas: lecciones, preguntas de diagnóstico y de confirmación, escalera, reto, Beto, ejemplos con huecos, producción, perfil de experto, etc.).
- **Generador** (`GEMINI_MODEL`): todo lo demás, incluidas las pistas (`make_hint`), el diagnóstico y la enseñanza de la reparación y la extracción de grafo. Estas llamadas no califican una respuesta ni deciden evidencia; si más adelante alguna pasa a calificar, debe enrutarse al juez y añadirse al test `test_every_judge_function_uses_the_judge_role`.
- Las preguntas con clave privada (opción múltiple) se califican localmente, sin modelo.

## Fallos del modelo de juez o de auditor

Decisión conservadora: **no hay reintento silencioso con el modelo barato.** Hacerlo reproduciría justo el problema que se quiere evitar (el modelo que genera calificando su propio contenido) sin que la persona lo supiera.

- **Juez que falla** (modelo inexistente, cuota 429, red, variable no válida): se lanza un error en español («El modelo calificador (X) no respondió: …»). La ruta responde 400, el cliente no recibe veredicto, no se crea evento ni evidencia y la persona puede reintentar. En el criterio de explicación (`evaluate_criterion_activity`) el resultado es `NOT_EVALUATED` / `UNKNOWN` con `method: provider_unavailable`, como ya ocurría con cualquier fallo del proveedor, y no lleva `judge_model`. Nunca se convierte en evidencia positiva. No existe `judge_fallback`: no se decide nada con el modelo barato.
- **Auditor que falla**: sigue «fallando abierta» (el contenido se entrega con `checked: false`, forma idéntica a la actual), pero ahora queda constancia: línea en la terminal del servidor con el modelo auditor y el motivo (sin secretos), la llamada fallida en la telemetría de uso (`ok = 0`, con el modelo real) y el contador `audit_failed_open` de `/api/models`. Esto no afloja nada: el contenido sin auditar sigue marcado como no verificado y la auditoría nunca concedió evidencia.

## Constancia en los datos

- `/api/evaluate` devuelve `judge_model` cuando un modelo calificó (no en «No sé», que se resuelve localmente). `prepareRecord` (cliente) lo copia al evento `EVIDENCE` solo si es un nombre válido; ese evento ya se guarda completo en `attempts.event_json`, así que **no hay migración**.
- `evaluate_criterion_activity`, `grade_error_fix`, `challenge_report` y `beto_turn` incluyen `judge_model` en el resultado que ya persisten (`criterion_evaluations.assessment_json` / `placement_answers.result_json`).
- Los eventos y resultados anteriores no tienen el campo y **no se les inventa**: la herramienta de revisión los marca «no registrado (dato anterior)». La telemetría de uso (`llm_calls.model`) ahora registra el modelo realmente usado por rol.

## Qué cuenta como evidencia

Nada cambia. `judge_model` es un metadato: no altera `is_independent`, la cobertura, la retención ni la transferencia. Un veredicto `UNKNOWN`, incompleto o fallido sigue sin ser evidencia positiva. Usar un modelo más fuerte no sube por sí solo el nivel de confianza de una evaluación; esa política (`evaluator_trust`, confirmaciones locales) no se toca.

## Visible para la persona

- `GET/POST /api/models` (solo lectura, sin secretos): `{provider, generate, audit, judge, same_generate_judge, same_generate_audit, all_same, errors, audit_failed_open, roles_configurable}`. `/api/health` sigue como estaba.
- En el **Informe de uso** aparece el bloque «Modelos de IA»: qué modelo genera, cuál audita y cuál califica, con aviso «El mismo modelo genera, audita y califica: un error puede pasar dos veces» (o la variante genera/califica y genera/audita) y aviso si una variable no es válida.

## Revisión manual: `tools/sample_for_review.py`

```text
python tools/sample_for_review.py --db RUTA\ruta.sqlite3 --list-profiles
python tools/sample_for_review.py --db RUTA\ruta.sqlite3 --profile ID_PERFIL --n 30 --out muestra.md
```

Abre la base en solo lectura (`mode=ro` y `query_only`), no llama a ningún proveedor, solo lee el perfil indicado y escribe un Markdown con hasta N elementos (30 por defecto) repartidos por rondas entre lecciones, preguntas con su clave, explicaciones de la escalera y veredictos del juez (con la respuesta del aprendiz y el modelo que juzgó). Cada elemento trae las casillas «¿Correcto? / ¿Claro? / Nota». Si la base está en uso por el servidor, la lectura sigue siendo segura; conviene apuntar a una copia si se quiere evitar cualquier contención.

Qué se persiste realmente (y por tanto qué puede muestrearse):

- **Lecciones y sus preguntas con referencia**: sí (`stores.store_json`, `lessons`). No tienen fecha propia: «reciente» significa el último tema generado.
- **Preguntas con clave privada** (diagnóstico, confirmación, errores, retos…): sí (`placement_items`, con fecha).
- **Veredictos del juez**: sí (`attempts`, con respuesta del aprendiz) y los de errores/retos/Beto (`placement_answers`).
- **Explicaciones de la escalera**: solo se persiste la oferta activa (`session.direct.package`) y, recortados a 450 caracteres, los textos que la escalera evita repetir (`session.ladder[*].avoid`). Las explicaciones ya mostradas y descartadas no se conservan, por lo que no se inventan.

## Compatibilidad y rollback

Sin variables, nada cambia. Los datos nuevos son campos opcionales dentro de JSON existente; versiones anteriores del cliente o del servidor los ignoran. Revertir es quitar las variables (vuelve el modelo único) o la rama; los `judge_model` ya escritos son inertes.

## Fuera de alcance

Proveedores nuevos; comparar o puntuar automáticamente la calidad de los modelos; promover un veredicto por haber sido emitido por un modelo más fuerte; mostrar `judge_model` en cada tarjeta de feedback; `judge_model` dentro de los eventos del criterio en el cliente (el servidor sí lo guarda en la evaluación); activar los módulos `*_service.py`; probar con Gemini real o en navegador.

## Pruebas

`python tests/judge_model.test.py` (proveedor `urlopen` simulado, SQLite temporal) y `node tests/judge_model.test.js`. No se probó con Gemini real ni en navegador.
