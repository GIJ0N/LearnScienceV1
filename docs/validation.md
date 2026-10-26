# Validación reproducible

Este repositorio mantiene `app_legacy.py` como entrada de compatibilidad. La CI valida esa entrada y las dos suites JavaScript sin cambiar la lógica pedagógica ni iniciar servicios externos.

## Requisitos locales

- Node.js 14 o posterior por la sintaxis de `app.js` (la CI usa Node.js 22 LTS).
- Python 3.7 o posterior por las clases HTTP usadas por `app_legacy.py` (la CI usa Python 3.12).
- No hay `package.json`, `requirements.txt` ni `pyproject.toml`; las validaciones usan únicamente la biblioteca estándar de Node.js y Python.

No se ha declarado una versión mínima formal del proyecto. Las versiones anteriores son el límite práctico derivado del código; la matriz reproducible y revisada es Node.js 22 y Python 3.12.

## Comandos completos

Desde la raíz del repositorio:

```text
node tests/evidence_policy.test.js
node tests/evidence_sufficiency.test.js
python tests/evidence_confirmation.test.py
python tests/adaptive_lesson.test.py
python tests/reachable_dimensions.test.py
node tests/delayed_review.test.js
python tests/delayed_review_backend.test.py
python tests/durable_memory.test.py
node tests/durable_memory_frontend.test.js
node tests/microtutoring_repair_episode.test.js
node tests/repair_teaching_v2.test.js
python tests/repair_teaching_backend.test.py
node tests/repair_diagnosis_recovery.test.js
python tests/repair_diagnosis_recovery_backend.test.py
node --check app.js
python app_legacy.py --self-test
python -m py_compile app_legacy.py
python tools/check_parity.py
python tests/check_parity.test.py
```

`python tools/check_parity.py` extrae el valor de `HTML` con el parser AST de Python y exige una única pareja `<script>...</script>`. Compara `app.js` con ese bloque en una representación canónica LF: convierte únicamente `CRLF` y `CR` aislados en `LF`, sin ignorar espacios, tabulaciones, comillas, etiquetas ni ningún otro byte.

Git almacena los archivos de este repositorio con LF, pero un checkout de Windows con `core.autocrlf=true` puede materializar `app.js` con CRLF. La canonicalización evita que ese detalle del checkout produzca un falso fallo de paridad. Una diferencia de contenido, incluso de un solo carácter, sigue terminando con código distinto de cero e informa las longitudes canónicas, el primer byte distinto y su contexto.

`python tests/check_parity.test.py` verifica los casos LF/CRLF, diferencias reales de caracteres o longitud, etiquetas ausentes o ambiguas y escapes UTF-8 decodificados por el literal Python.

`python tests/reachable_dimensions.test.py` simula sin red el generador activo, normaliza mapa y microlección en el backend y entrega las preguntas a `app.js`. Verifica para `variables`, `units`, `equation_manipulation` y `method_selection` el recorrido contrato → evaluación simulada → evento → evidencia → cobertura, además de los casos negativos de familia, rol, ayuda, `UNKNOWN`, idempotencia, reparación hija y datos legacy. También fuerza contratos dirigidos incompatibles y comprueba que el rechazo deja la cobertura intacta, conserva `target_dimension` y ofrece un reintento explícito de una sola solicitud.

`python tests/durable_memory.test.py` usa una base SQLite temporal. Verifica persistencia tras reinicio, aislamiento de perfiles, respuesta y evaluación completas, conflicto de revisión sin sobreescritura, importación idempotente sin evidencia inventada, exportación/restauración y contexto de memoria acotado con procedencia. `node tests/durable_memory_frontend.test.js` verifica el error visible de escritura, su recuperación, la asociación de perfil y la pausa de una sesión breve sin escribir el progreso completo en `localStorage`.

`node tests/repair_teaching_v2.test.js` recorre diagnóstico, selección de laguna, enseñanza, omisión mediante CHECK, ayuda guiada, retirada de apoyo, actividad independiente alternativa, retorno al padre, pausa, recarga, checkpoint e idempotencia. `python tests/repair_teaching_backend.test.py` usa respuestas controladas y valida los dos contratos del generador y la persistencia durable. Ninguna de estas pruebas llama a Gemini.

`node tests/repair_diagnosis_recovery.test.js` verifica error de red, contrato inválido, reintento, doble clic, respuesta tardía, recarga, pausa y fallos de persistencia del diagnóstico inicial. `python tests/repair_diagnosis_recovery_backend.test.py` valida que el estado pendiente solo pueda apuntar al intento y actividad padre existentes. Un diagnóstico pendiente no es un episodio y no añade evidencia.

`python tests/criterion_assessment.test.py` y `node tests/criterion_assessment_frontend.test.js` cubren la vertical `criterion_assessment_v1`: actividad de opción múltiple con explicación separada, clave privada solo en el servidor, evaluación determinista de la opción, explicación `NOT_EVALUATED` cuando el proveedor controlado no responde, ayuda que impide independencia, idempotencia por `attempt_id` y persistencia compatible. Estas pruebas usan respuestas controladas y no validan eficacia pedagógica ni Gemini real.

`python tests/criterion_durability.test.py` comprueba el contrato privado completo en SQLite aislado, borradores tras reinicio, recuperación de evaluaciones ya persistidas, rechazo de fingerprints distintos, reserva concurrente, recuperación explícita de una reserva cuyo propietario pertenece a un proceso anterior, rechazo de respuestas tardías del propietario anterior, aislamiento por perfil/meta, exportación sin claves, restauración sin contrato privado, eliminación por cascada y compatibilidad con stores legacy. El registro `PENDING` no mantiene una transacción abierta durante la llamada al proveedor: la misma instancia no puede iniciar una segunda evaluación, pero una instancia nueva reclama el mismo `attempt_id` y fingerprint. Si el proceso cae durante la llamada, la recuperación no garantiza que el proveedor se ejecutara una sola vez; sí evita duplicar evidencia y evita que una respuesta tardía sobrescriba la evaluación recuperada.

`python tests/criterion_server_lock.test.py` usa procesos reales y SQLite temporales. Comprueba que una segunda instancia no puede servir la misma base mientras el primer proceso conserva el handle bloqueado, que la caída abrupta libera el bloqueo, que el mismo intento puede recuperarse después, que dos solicitudes del servidor activo no ejecutan dos evaluaciones, que bases distintas funcionan simultáneamente y que una respuesta HTTP perdida no duplica la evaluación. El bloqueo cubre una SQLite local en un solo equipo; no es un protocolo distribuido.

`node tests/repair_acceptance_controlled.test.js` completa un episodio sintético con diagnóstico confirmado, enseñanza, reintento padre y transferencia novedosa, y comprueba la recarga sin duplicados. `python tests/repair_persistence_acceptance.test.py` usa SQLite temporal y un servidor de prueba que confirma el commit antes de cerrar la respuesta HTTP; la siguiente escritura con revisión antigua recibe conflicto y la recarga conserva exactamente el único intento comprometido. Estas son comprobaciones HTTP/SQLite controladas, no aceptación visual de navegador.

La misma secuencia se ejecuta en `.github/workflows/ci.yml`. Si falta una suite, falla un comando o no se puede usar la versión fijada de Node.js/Python, el paso correspondiente termina con error y el job falla. No se silencian errores ni se convierten en advertencias.

## Respuestas simuladas y Gemini

Las suites automatizadas usan respuestas locales simuladas. `python app_legacy.py --self-test` también sustituye la llamada de red y la clave de Gemini dentro de la prueba; no necesita `GEMINI_API_KEY` y no evalúa respuestas reales. La CI no configura, imprime ni envía ninguna clave y no inicia servicios externos.

Una validación `BLOCKED` significa que una prueba no se pudo ejecutar por falta de navegador, permisos, credenciales o un servicio externo. Debe informarse como `BLOCKED`, nunca como `PASS`. Las pruebas de navegador completo, recarga real, consola y Gemini real no forman parte de esta CI.

## Aceptación manual de `criterion_assessment_v1`

- Sin proveedor pueden comprobarse el arranque, `/api/health`, perfiles sintéticos, recarga de datos existentes, exportación pública, mapa de solo lectura y las suites automatizadas.
- La conservación visual de selección y explicación requiere una actividad sintética ya precargada en una SQLite temporal. El repositorio todavía no incluye un harness visual que la cargue y controle el evaluador desde el navegador.
- Crear una meta, generar una nueva actividad y evaluar semánticamente su explicación usan el proveedor configurado. No forman parte de una prueba local sin API.
- La aceptación visual end-to-end queda `NO EJECUTADA` hasta disponer de ese harness o autorización expresa para Gemini real. Las pruebas HTTP/SQLite controladas no deben presentarse como aceptación visual.

Arranque aislado que no usa la base habitual:

```powershell
cd <worktree>
$env:PORT = '8897'
$env:RUTA_DB_PATH = Join-Path $env:TEMP 'criterion-assessment-review.sqlite3'
python app_legacy.py
```

## Limitaciones conocidas

- No hay una prueba completa de navegador en CI.
- No se evalúan respuestas reales de Gemini.
- La detección de novedad de microtutoría es textual y conservadora; no afirma equivalencia semántica total.
- La detección de copias en ejemplos y pistas también es textual. Una aceptación con Gemini debe revisar manualmente que el ejemplo no filtre la solución del padre ni de la actividad independiente.
- Los servicios modulares extraídos todavía no son la ruta ejecutable principal.
- `config.py` y `gemini_client.py` conservan errores de sintaxis legacy preexistentes en `main`; quedan fuera de esta validación y no se modifican.

## Lista previa a un merge

Un PR debe mostrar todas las suites, `node --check`, el self-test y la compilación de `app_legacy.py` en PASS, además de la comprobación de paridad. También debe demostrar que no cambió la aplicación fuera de su alcance, que no añadió secretos ni dependencias innecesarias y que la documentación describe las limitaciones como `BLOCKED` cuando corresponde. La revisión humana debe comprobar los contratos de evidencia, la idempotencia, la persistencia legacy y las rutas de RepairEpisode; esta CI no sustituye esas revisiones.

## Prueba manual de una dimensión dirigida

1. Inicia `python app_legacy.py` con una configuración válida de Gemini.
2. Crea una meta cuyo mapa requiera claramente una de las cuatro dimensiones, por ejemplo resolución dimensional para `units`.
3. En el dashboard confirma que la dimensión aparece requerida y `UNKNOWN`.
4. Elige “No sé; enséñamelo” si aparece el diagnóstico inicial y avanza hasta práctica guiada e independiente.
5. En las herramientas del navegador comprueba que `/api/lesson` recibió `target_dimension` y devolvió el `kind` canónico con una única `observable_dimensions`.
6. Tras un resultado independiente correcto, confirma que solo esa dimensión recibe evidencia y cambia de estado. Una respuesta `UNKNOWN` o una familia incompatible debe dejarla sin evidencia positiva.


## Suficiencia v2

La regresión `adaptive_cycle.test.js` ahora finaliza naturalmente: el fixture responde también al guardado posterior a la respuesta tardía y restaura `fetch`; cinco ejecuciones consecutivas terminaron con código 0.

Las suites Python se compararon en el padre `05bbd8289d0494c2cef94491382af100f9bda6fb` y en el integrado `196f394acc6b5105753c2971c0511c9c3c164f82`: ambas pasan en el padre y ambas fallaron inicialmente en el integrado por regresiones de integración en `app_legacy.py`. Tras restaurar selectivamente sus capacidades, las dos suites pasan en el integrado.

La validación histórica del checkout limpio fue parcial respecto al workflow: omitió `node tests/adaptive_cycle.test.js`. La comprobación actual del fixture configura un perfil sintético, espera de forma acotada la pregunta y el contexto de reparación, y conserva la expectativa `session.mode === "CONTEXT"`.

Las pruebas nuevas cubren dos preguntas independientes, exclusión de ayuda/duplicados, correcciones, demora mínima de memoria, visita limitada y continuación provisional. El recorrido HTTP usa la ruta activa `/api/confirmation` y SQLite temporal; comprueba recarga, exportación y restauración de la sesión pendiente. La generación y evaluación del proveedor siguen simuladas; estas pruebas no validan aprendizaje humano ni novedad semántica.

## Microlecciones adaptadas según evidencia durable

Cuando un usuario solicita volver a aprender, se genera una microlección nueva usando hasta cinco intentos recientes almacenados en SQLite para el nodo y, si existe, la dimensión objetivo. Un error reciente elige refuerzo, una respuesta asistida elige apoyo gradual, un acierto independiente elige consolidación y la evidencia ausente o legacy incompleta conserva enseñanza inicial. Esta adaptación solo modifica el contenido y muestra su razón: no acredita dominio ni sustituye los contratos de evidencia v2. El proveedor real todavía requiere prueba manual.

## Repaso diferido verificable

El flujo registra un primer repaso desde un intento correcto de integración
aceptado para el nodo. La programación es idempotente y conserva el intento
de origen, la fecha de origen, la última exposición conocida, el vencimiento,
las fechas de presentación y respuesta, la ayuda y `delayed_review_v1`.

`required` sigue significando que una dimensión debe ser suficiente según
Evidence Policy v1; no implica independencia configurable por meta. La
independencia se exige según la política por dimensión. La programación o la
espera no acreditan dominio. La interfaz distingue práctica inmediata,
recuperación diferida observada y demora no verificable. Los datos legacy sin
ancla temporal quedan en la última categoría y no reciben evidencia inventada.

Para probarlo sin esperar un día, ejecuta `node tests/delayed_review.test.js`.
La prueba inyecta un reloj local y comprueba el estado antes, en y después del
vencimiento, ayuda, fechas inválidas o futuras, contratos dirigidos y
persistencia de los campos en una normalización v4. El reloj del equipo no se
modifica y el resultado no demuestra retención humana.
