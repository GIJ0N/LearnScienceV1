# Escapes LaTeX en la salida del modelo (`latex_escapes_v1`)

## Problema

El modelo escribe fórmulas como `\frac`, `\beta`, `\times`, `\neq`, `\rho`, con una sola barra invertida, que es lo que se espera en LaTeX. Dentro de una cadena JSON, esas secuencias son escapes válidos o inválidos:

- `\f`, `\b`, `\t`, `\n`, `\r` son escapes JSON válidos. `json.loads` los convierte en caracteres de control (avance de página, retroceso, tabulación, salto de línea, retorno de carro) y la barra se pierde: `\frac` llega como «rac{3}{4}» precedido de un carácter invisible.
- `\sqrt`, `\alpha`, `\cdot`, `\pm`, `\sin`, `\infty`, `\left`, `\(` y `\upsilon` no son escapes JSON válidos. `json.loads` falla con «Invalid \escape», y el error se reportaba como «salida incompleta».

Ambos casos son problemas de forma, no de contenido: la fórmula era correcta en la intención del modelo.

## Dos capas

1. **Parseo tolerante, solo como reintento** (`_parse_model_json`, en `_gemini_request`). Si `json.loads` falla, se reintenta sobre el texto crudo duplicando únicamente las barras que no forman un escape JSON válido. Las barras ya escapadas (`\\frac`) se consumen en pares y no se duplican. Si el reintento también falla, se devuelve el error original, así que una salida truncada sigue siendo «salida incompleta».
2. **Reparo por objeto** (`repair_latex_escapes`, aplicado en `gemini()` sobre el resultado final). Cubre a Gemini y a Anthropic, y a `judge_gemini` y `audit_gemini` porque pasan por `gemini()`. Es recursivo en `dict` y `list`, actúa solo sobre valores `str` y nunca sobre claves.
   - `\x0c` pasa a `\f` y `\x08` pasa a `\b`, siempre. Un carácter de avance o de retroceso no tiene uso legítimo en el contenido.
   - `\t`, `\n` y `\r` pasan a `\t`, `\n` y `\r` literales (barra más letra) solo si el carácter de control seguido de **toda** la racha de letras `[A-Za-z]*` forma el nombre de un comando soportado. Así `\n` + `eq` vuelve a `\neq`, pero `\nequipo` y `\nel resultado` no se tocan. Los nombres de una sola letra no cuentan.

El reparo es idempotente: después de la primera pasada no quedan caracteres de control que restaurar.

## De dónde sale la lista de comandos

`LATEX_COMMAND_NAMES` (en `app_legacy.py`) reproduce los comandos que `app.js` interpreta: las tablas `TEX_GREEK`, `TEX_SYMBOLS`, `TEX_BIGOPS`, `TEX_FUNCS`, `TEX_TEXTCMDS`, `TEX_FRAC` y `TEX_SPACES`, más `sqrt`, `left` y `right`, que el parser de `app.js` trata aparte. `tests/latex_escapes.test.py` extrae esos nombres de `app.js` y exige que sean idénticos a la lista de Python. Si alguien añade un comando a `app.js` sin añadirlo aquí, la prueba falla.

No se usa la regla «dentro de `$…$`»: duplicaría la lógica de `richParts` y podría divergir de ella.

## Lo que NO cambia

- `compact`, `compact_rich`, `clip_rich`, `.strip()`, `texToMathML` y la lógica de render de `app.js` no se tocan. `compact()` sigue igual que en `main`. Por eso `sync_embedded_js` no es necesario.
- Los módulos `*_service.py` siguen desconectados.
- No se reescriben datos guardados.

## Límites

- **Residual aceptado.** Un salto de línea real seguido exactamente de una palabra-comando (por ejemplo, `\n` + `u` en «…\nu…», que forma `\nu`, o `\n` + `e`, que forma `\ne`) se convierte en comando. Es raro en prosa y queda documentado.
- **Lecciones ya guardadas no se recuperan.** Un texto guardado con caracteres de control (`\x0c` o un `\t` que se comió la barra) no se repara al leerlo. Hay que regenerar la lección. Regenerarla es una decisión del usuario, no de este cambio.
- **Gemini real no validado.** Las pruebas usan respuestas controladas. No sabemos con qué frecuencia el modelo real escribe una sola barra, ni si el reintento se activa en la práctica.

## Compatibilidad y reversión

Sin migración ni campos nuevos. Revertir el commit devuelve el comportamiento anterior: los textos ya generados con la barra escrita de forma válida no cambian; las salidas que hoy fallan con «salida incompleta» volverían a fallar.
