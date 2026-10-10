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
python tests/reachable_dimensions.test.py
node tests/microtutoring_repair_episode.test.js
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

La misma secuencia se ejecuta en `.github/workflows/ci.yml`. Si falta una suite, falla un comando o no se puede usar la versión fijada de Node.js/Python, el paso correspondiente termina con error y el job falla. No se silencian errores ni se convierten en advertencias.

## Respuestas simuladas y Gemini

Las dos suites JavaScript usan respuestas locales simuladas. `python app_legacy.py --self-test` también sustituye la llamada de red y la clave de Gemini dentro de la prueba; no necesita `GEMINI_API_KEY` y no evalúa respuestas reales. La CI no configura, imprime ni envía ninguna clave y no inicia servicios externos.

Una validación `BLOCKED` significa que una prueba no se pudo ejecutar por falta de navegador, permisos, credenciales o un servicio externo. Debe informarse como `BLOCKED`, nunca como `PASS`. Las pruebas de navegador completo, recarga real, consola y Gemini real no forman parte de esta CI.

## Limitaciones conocidas

- No hay una prueba completa de navegador en CI.
- No se evalúan respuestas reales de Gemini.
- La detección de novedad de microtutoría es textual y conservadora; no afirma equivalencia semántica total.
- Los servicios modulares extraídos todavía no son la ruta ejecutable principal.
- `config.py` y `gemini_client.py` conservan errores de sintaxis legacy preexistentes en `main`; quedan fuera de esta validación y no se modifican.

## Lista previa a un merge

Un PR debe mostrar las tres suites, `node --check`, el self-test y la compilación de `app_legacy.py` en PASS, además de la comprobación de paridad. También debe demostrar que no cambió la aplicación fuera de su alcance, que no añadió secretos ni dependencias innecesarias y que la documentación describe las limitaciones como `BLOCKED` cuando corresponde. La revisión humana debe comprobar los contratos de evidencia, la idempotencia, la persistencia legacy y las rutas de RepairEpisode; esta CI no sustituye esas revisiones.

## Prueba manual de una dimensión dirigida

1. Inicia `python app_legacy.py` con una configuración válida de Gemini.
2. Crea una meta cuyo mapa requiera claramente una de las cuatro dimensiones, por ejemplo resolución dimensional para `units`.
3. En el dashboard confirma que la dimensión aparece requerida y `UNKNOWN`.
4. Elige “No sé; enséñamelo” si aparece el diagnóstico inicial y avanza hasta práctica guiada e independiente.
5. En las herramientas del navegador comprueba que `/api/lesson` recibió `target_dimension` y devolvió el `kind` canónico con una única `observable_dimensions`.
6. Tras un resultado independiente correcto, confirma que solo esa dimensión recibe evidencia y cambia de estado. Una respuesta `UNKNOWN` o una familia incompatible debe dejarla sin evidencia positiva.

