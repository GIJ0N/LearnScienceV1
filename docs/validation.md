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

Un PR debe mostrar las dos suites, `node --check`, el self-test y la compilación de `app_legacy.py` en PASS, además de la comprobación de paridad. También debe demostrar que no cambió la aplicación fuera de su alcance, que no añadió secretos ni dependencias innecesarias y que la documentación describe las limitaciones como `BLOCKED` cuando corresponde. La revisión humana debe comprobar los contratos de evidencia, la idempotencia, la persistencia legacy y las rutas de RepairEpisode; esta CI no sustituye esas revisiones.

