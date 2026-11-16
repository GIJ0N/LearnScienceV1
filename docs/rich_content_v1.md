# Contenido enriquecido (`rich_content_v1`): fórmulas legibles y «Explora la relación»

## Propósito

Hasta ahora todo el contenido era texto plano. En temas técnicos (espesores, temperaturas de curado, transferencia de carga…) una relación escrita como `m = k t / A` aumenta la carga cognitiva. Esta función añade, sin dependencias ni CDN:

1. un convertidor local de un subconjunto acotado de LaTeX a MathML (`$...$` en línea, `$$...$$` en bloque);
2. un bloque opcional de lección, «Explora la relación», con deslizadores, resultado en vivo y una gráfica SVG, siguiendo predecir → explorar → comprobar.

Es solo presentación y exposición. No cambia veredictos, cobertura, calendario ni ninguna regla de `docs/evidence_policy_v1.md`.

## A. Fórmulas

### Punto único de pintado

`X(tag, texto, clase)` en `app.js` es el único punto que interpreta fórmulas. Es igual que `E(tag, texto)` salvo que, si el texto contiene `$` y hay fórmulas válidas, construye nodos (texto + `<math>`). `richInto(elemento, texto)` hace lo mismo sobre un elemento existente (opciones en botón). Un texto sin `$` sale idéntico a `E()` (mismo `textContent`).

Superficies cubiertas (texto de CONTENIDO generado por el modelo):

- lección: explicación, ejemplo (ahora en `div.lesson-example` con `white-space:pre-wrap`; antes `pre`), error habitual;
- preguntas: enunciado en `renderQuestion` (diagnóstico, comprensión, guiada, independiente, integración, repaso, confirmación) y retroalimentación + pista (`verdictPanel`);
- opciones tipo tarjeta, enunciado y explicación de `renderPlacementItem` (diagnóstico, comprobaciones de pasos, huecos del ejemplo con huecos, comprobación de la enseñanza directa);
- lección por pasos: predicción, resolución, paso, otra forma;
- ejemplo con huecos: ejemplo resuelto, pasos, enunciado;
- enseñanza directa y escalera: pregunta original, necesidades, pasos, ejemplo análogo, respuesta comentada y sus porqués;
- reparación (microtutoría): explicación, ejemplo resuelto, pasos, conclusión, ampliación, pregunta de la etapa y retroalimentación del evaluador;
- práctica de cálculo (enunciado y desarrollo) y opciones/enunciado de la actividad por criterios.

No cubiertas (siguen en texto plano, ver «Fuera de alcance»): práctica intercalada y de composición, «Encuentra el error», «Enséñale a Beto», retos del mundo real, retroalimentación de `micro_step` y del paso corregido, informe y panel.

### Qué NO se interpreta nunca

El texto del APRENDIZ (respuestas, razonamiento, historial, «Respuesta pendiente», intentos guardados) se pinta con `E()`/`textContent`. Un test impide que `X(...)` reciba campos del aprendiz.

### Delimitadores

- Dentro de `pre` y de `` `backticks` `` no se interpreta nada (`X('pre', …)` usa `textContent`).
- `$...$` en línea: el contenido no empieza ni termina en espacio y no cruza línea; el `$` de apertura no va precedido de letra o dígito; el de cierre no va seguido de letra, dígito ni `/`; y el contenido necesita una señal matemática real: un comando `\`, `^`, `_`, `=`, `<`, `>`, llaves, un operador entre operandos (`a+b`) o una sola letra (`$x$`). Así `cuesta $5 y luego $6`, `echo $HOME/$USER`, `$x=$y;` y `grep ^a$|^b$` quedan literales.
- `$a$$b$` (dos fórmulas pegadas) se deja literal por decisión: es ambiguo con `$$`. Se escribe `$a$ $b$`.
- `$$...$$` en bloque (envuelto en `span.math-block`, con desplazamiento propio si se desborda).
- `\$` es un signo de dólar literal.
- Un `$` sin pareja se muestra tal cual. Si la pareja existe pero la expresión no se puede convertir, se muestra el texto original completo `$...$`.
- Límites: texto ≤ 8000 caracteres, fórmula ≤ 240, ≤ 24 fórmulas por texto (con más, TODO el texto queda literal), ≤ 400 tokens, ≤ 600 nodos, profundidad ≤ 8. Si se supera cualquiera, texto original.

### Subconjunto soportado

| Categoría | Soportado |
|---|---|
| Números y letras | `12`, `1,5`, `3.14`, letras latinas sueltas, cualquier letra Unicode (`µ`, `Ω`) |
| Operadores | `+ - = < > / * ( ) [ ] \| , ; : ! .` |
| Estructura | `\frac{a}{b}` (`\dfrac`, `\tfrac`), `x^{2}`, `x_{1}`, `x_{i}^{2}`, `\sqrt{x}`, `\sqrt[n]{x}`, `\left( … \right)` con `( ) [ ] \| \{ \} .` |
| Griegas | `\alpha … \omega`, `\Gamma \Delta \Theta \Lambda \Xi \Pi \Sigma \Phi \Psi \Omega` |
| Símbolos | `\cdot \times \pm \mp \le \leq \ge \geq \neq \ne \approx \infty \to \rightarrow \circ \partial \ldots \cdots \dots` |
| Grandes operadores | `\sum \int \prod` con límites `_` y `^` |
| Funciones | `\sin \cos \tan \ln \log \exp` |
| Texto y unidades | `\text{mm}`, `\mathrm{}`, `\textrm{}`, `\mathbf{}`, `\textbf{}` (sin llaves ni `\` dentro) |
| Espacios y escapes | `\,` `\;` `\:` `\!` `\ ` `\quad` `\qquad`, `\%`, `\{`, `\}`, `\$` |
| Grados | `^\circ` |

Un argumento sin llaves de `^`, `_`, `\frac` o `\sqrt` es UN solo token (un dígito o una letra): `\frac12x` es 1/2·x, `x^10` es x¹ seguido de 0 y `(x_1,2)` no mete la coma en el subíndice; para varios dígitos se usan llaves (`x^{10}`). Los caracteres de control y de formato Unicode (U+202E, espacios de ancho cero, U+00AD…) hacen que la fórmula se muestre original.

Todo lo demás (`\begin`, `\def`, `\href`, matrices, `\\`, `&`, `#`, `~`, comandos desconocidos, un doble `^` o `_`, llaves desbalanceadas, `\left` sin `\right`) hace que el texto se muestre original. Los paréntesis simples no se comprueban como pareja (un intervalo `[0,1)` es válido).

### Accesibilidad

Cada `<math>` lleva `alttext` con el LaTeX original; no lleva `aria-label` (un lector de pantalla leería el LaTeX crudo). Los nodos se crean con `document.createElementNS`; si el navegador no lo ofrece, nada se interpreta.

### Seguridad

Todo se construye con `createElementNS`/`createTextNode`/`textContent`. No se usa `eval`, `new Function`, `innerHTML`, `outerHTML` ni `insertAdjacentHTML` (un test lo comprueba sobre el bloque `rich_content`). No hay red, dependencia ni CDN. El nombre de cada comando se resuelve con `Map` (sin prototipos).

### Prompts

`RICH_NOTE` (app_legacy.py) se añade a: lección (`make_lesson`), lección por pasos y su reparación, confirmación, repaso, diagnóstico (`make_placement_items`), ejemplo con huecos, enseñanza directa y respuesta comentada, y paquete de reparación. Lista el subconjunto en pocas líneas y prohíbe `$` en `value`, `unit`, `expression` y nombres. Los esquemas JSON no cambian.

### Calificación local y recortes

- La práctica de cálculo compara el número y la unidad con la clave privada (`value`, `unit`). Los delimitadores en el enunciado o el desarrollo no la afectan (test). Una unidad con `$` o `\` se rechaza al generar (reintento), y un número escrito como `$60$` sigue sin ser un número válido; no se interpreta.
- `compact()` queda EXACTAMENTE como en main (`str(valor or '').strip()[:n]`) y se sigue usando para texto del aprendiz, claves, referencias, huellas, citas y JSON de memoria. El recorte con conocimiento de fórmulas es `compact_rich()` (servidor, `explore_expr.clip_rich`) y `richClip()` (cliente), SOLO para contenido generado que ve el aprendiz.
- Garantía real: `compact_rich` retrocede antes de una fórmula si el corte cae dentro de una fórmula abierta, solo si el `$` de apertura está a ≤ 240 caracteres del corte, cumple las mismas reglas de delimitador que `richParts` (apertura sin espacio, no pegada a una letra) y lo que sigue tiene señal matemática. En cualquier otro caso (precio `$500`, `$$` inicial sin cierre, fórmula lejana) corta plano y puede dejar un `$` suelto, que se muestra literal. Nunca devuelve vacío si el texto no lo era. No hay garantía de «sin `$` huérfano».
- Campos que usan `compact_rich` (todos contenido generado que se muestra): pregunta (`prompt`), texto de opciones y enunciado de la actividad por criterios; lección (`explanation`, `example`, `common_error`); `feedback` y `hint` del evaluador (no `status` ni `error_type`); reparación (`steps`, `explanation`, `worked_example.prompt`, `worked_example.conclusion`, `expansion`); microcontexto (`prompt`, `explanation`, `example`); diagnóstico (`prompt`, `explanation`, `text` de opciones); lección por pasos (`predict`, `resolution`, `body`) y su reparación (`body`); práctica de cálculo (`prompt`, `solution`, pasos de ordenar); ejemplo con huecos (`worked_prompt`, `faded_prompt`, pasos, `text` del hueco); enseñanza directa (`needs`, enunciado y pasos del ejemplo) y la respuesta comentada. Los textos de «Explora» (`title`, `prompt_before`, `takeaway`, etiquetas) usan `clip_rich`/`richClip`.
- Los validadores que rechazan por longitud siguen rechazando; no cortan.

## B. «Explora la relación»

### Bloque

`lesson.explore = { title, expression, variables:[{name,label,unit,min,max,step,value}], output:{label,unit}, prompt_before, takeaway, explore_id }`. Es opcional y se guarda en la lección del tema para no regenerarlo; regenerar la lección lo descarta. `lesson.explore_na = true` recuerda que el modelo respondió «no aplica» (no se vuelve a ofrecer).

### Gramática del evaluador

Sin `eval`: tokenizador + descenso recursivo, idéntico en `explore_expr.py` (servidor) y `app.js` (cliente).

```
expr   := term (('+'|'-') term)*
term   := unary (('*'|'/') unary)*
unary  := ('-'|'+') unary | power
power  := atom ('^' unary)?          asociativa a la derecha; -x^2 = -(x^2)
atom   := número | variable | función '(' expr (',' expr)* ')' | '(' expr ')'
```

Números `12`, `1.5`, `.5`, `1e-3`. Funciones en lista blanca: `sqrt exp ln log10 sin cos tan abs min max` (`min`/`max` con 2 a 4 argumentos). Sin multiplicación implícita (`2*x`), sin constantes, sin punto, corchetes, comillas ni `;`. Una variable debe estar declarada; los nombres `[A-Za-z][A-Za-z0-9_]{0,15}` no pueden ser funciones ni palabras reservadas (`constructor`, `prototype`, `window`, `this`, `eval`, …). Límites: 200 caracteres, 120 nodos, profundidad 24. El entorno es un `Map` (JS) o `dict` (Python): no hay acceso a globales. Resultado no finito (`1/0`, `ln(0)`, `sqrt(-1)`, desbordes) → «fuera de rango», nunca excepción visible. Un test ejecuta ambos evaluadores sobre los mismos casos.

### Validación local (servidor y cliente)

1 a 4 variables con nombre único y válido; `label` no vacío; `min`, `max`, `step`, `value` numéricos finitos con `min < value < max`, `|min|,|max| ≤ 1e9`, `0 < step ≤ max−min` y a lo sumo 1000 pasos; todas las variables usadas y ninguna no declarada; `step` que divide el rango y `value` sobre la malla (tolerancia 1e-6; se rechaza, no se normaliza); la salida finita en los valores iniciales y en una rejilla de 5 puntos por variable (producto completo, ≤ 625 evaluaciones); además, por variable, 61 muestras (el resto en su valor inicial) que deben ser finitas, variar y no tener un salto entre muestras contiguas mayor que el 60 % de la variación total (así `1/(x-1.3)` en [1,2] o `tan(x)` en [0,3] se rechazan; el cliente y el servidor usan las mismas muestras); que la salida varíe y que cada variable cambie la salida; números JSON gigantes (`10**400`) se rechazan como no finitos, nunca como error 500; título, pregunta previa, conclusión y etiqueta de salida no vacíos; textos recortados con el recorte seguro; tamaño guardado ≤ 4000 bytes UTF-8 del JSON compacto (la misma medida en servidor y cliente; `make_explore` la comprueba y los enteros se serializan sin `.0`).

### Generación

`make_explore` + `POST /api/explore` (`app_legacy.py`): esquema → `validate_explore` → `audit_content` → un reintento con el motivo → `ValueError` en español («…no se guardó nada. Reintenta.»). El modelo puede responder `applicable:false`: la ruta devuelve `{applicable:false, message}` sin reintento ni auditoría. Meta, tema, resultado y material de la lección llegan al modelo con `_as_data`. La ruta exige `profile_id` de un perfil existente y cuenta cada solicitud (con sus reintentos internos) contra un tope de 12 por perfil y día (`EXPLORE_DAILY_LIMIT`, en memoria, reinicia con el proceso); además cada llamada al modelo consume la cuota global de `gemini()`. La ruta no guarda nada: el cliente guarda el bloque (validado de nuevo con `exploreValidate`) en la lección. No llama a ningún proveedor fuera de `gemini()`.

### Cuándo se ofrece

El esquema de la lección no cambia, así que el modelo no declara de antemano que existe una relación cuantitativa. «Explorar con valores» se ofrece en la pantalla de enseñanza (TEACH) solo si la explicación o el ejemplo contienen una fórmula `$…=…$` o al menos dos magnitudes con unidad explícita (`25 mm`, `80 °C`; un número suelto no basta) y no hay `explore_na`. Un fallo (error de red o bloque inválido) se recuerda durante la sesión por meta y tema: el botón se sustituye por un aviso y no se reintenta solo. Es el modelo, al generar, quien declara si existe la relación (`applicable`); si no, la interfaz muestra «Este tema no tiene una relación numérica que explorar.», marca `explore_na` y no vuelve a ofrecerlo. Nada queda roto.

### Interfaz (predecir → explorar → comprobar)

1. Predecir: se muestra `prompt_before` y una pregunta cualitativa generada localmente («Si cambias X de a a b…, ¿qué pasa con la salida?») con tres opciones: «Sube», «Baja», «Queda casi igual». La respuesta correcta la calcula el cliente con el evaluador: se toma una variable con valor positivo y se duplica (o se avanza hacia el máximo dentro del rango); «Queda casi igual» significa un cambio menor al 3 % del rango de la salida sobre toda la malla. Si el segmento no es monótono, la salida cambia de signo, la variable es 0 o negativa o la salida no es finita, se prueba otra variable; si ninguna sirve no hay predicción: se dice y se pasa directo a explorar (sin evento `EXPLORE_PREDICTION`). La retroalimentación dice «Coincide» o «No coincide» y no es una calificación. «Explorar sin predecir» salta este paso.
2. Explorar: un `input type="range"` por variable (etiqueta, valor y unidad; `min-height:44px`; accesible con teclado; `aria-valuetext`), resultado en vivo con `role="status"` y una gráfica SVG de la salida frente a UNA variable (selector si hay más de una): curva y punto actual con tokens del tema claro/oscuro (`--info`, `--go`, `--muted`, `--line`), `viewBox` escalable sin desbordar 390 px (el margen izquierdo crece con la etiqueta más larga del eje Y, hasta 120 unidades; el trazo se corta en los puntos no finitos). No hay animaciones (respeta `prefers-reduced-motion`).
3. Comprobar: el botón «Comprobar» muestra `takeaway`.

El estado de la interfaz (predicción, valores, variable del eje) vive en memoria; no se guarda.

## Eventos y evidencia (decisión)

- Leer, predecir y explorar son EXPOSICIÓN. Nada crea `EVIDENCE`, independencia, cobertura, racha de evidencia, calendario de repaso ni panel experto.
- Se registran como máximo dos eventos formativos por bloque, cada uno una sola vez: `EXPLORE_VIEWED` (primera vez que se muestra) y `EXPLORE_PREDICTION` (`predicted`, `actual`, `matched`, `variable`), ambos con `node_id`, `explore_id`, `at`, `creates_evidence:false` y `policy_version:'rich_content_v1'`.
- Revisión de consumidores: `deriveCoverage`, `verified`, `independentSuccesses`, el panel experto y las modalidades/retención del informe solo leen `EVIDENCE`; el único efecto es que el «periodo» del informe (días activos y eventos de los últimos 7 días) cuenta cualquier evento fechado, igual que ya hace con `TEACHING_EXPOSURE`, sin tocar ninguna tasa; `lastExposure` y `seen` solo miran `EVIDENCE`/`TEACHING_EXPOSURE`/`FEEDBACK_EXPOSURE`; `validate_store` ignora tipos desconocidos. No hace falta cambiar ninguno.
- Meta diaria y racha: NO cuentan. `isStudyAnswer` solo cuenta `EVIDENCE` de aprendizaje y las comprobaciones con clave privada (`DIRECT_CHECK`, `FADED_STEP`). Una predicción no se califica contra una clave privada y se puede adivinar sin esfuerzo; contarla permitiría rellenar la meta diaria sin responder nada evaluable. Se decidió no contarla y un test lo fija.
- Una predicción que no coincide no es un fallo de aprendizaje y no abre reparación.

## Compatibilidad y reversión

- Datos: campos opcionales en la lección (`explore`, `explore_na`) y eventos nuevos. No hay migración. `validate_store` y `normalizeGoal` descartan lo malformado sin rechazar el almacén.
- Servidor nuevo, cliente antiguo: la ruta no se usa. Cliente nuevo, servidor antiguo: «Explorar con valores» falla con el error del servidor sin guardar nada.
- Rollback: revertir el commit. Un cliente anterior ignora `explore`/`explore_na` y los eventos `EXPLORE_*`; los textos con `$…$` se ven como texto plano.
- `explore_expr.py` es un módulo nuevo (sin dependencias) importado por `app_legacy.py` y `memory_store.py`.

## Fuera de alcance

Diagramas generados por el modelo, imágenes y gráficas arbitrarias; fórmulas en práctica intercalada y de composición, «Encuentra el error», Beto, retos, informe y panel; manipulables en la enseñanza directa o la lección por pasos; varias salidas o gráficas 3D; persistir el estado de los deslizadores; un campo de esquema que declare de antemano la relación cuantitativa; copiar una fórmula como LaTeX.

## Sin validar

Safari/iPhone reales (MathML Core, barra de direcciones dinámica, `range` táctil, VoiceOver con `aria-label` en `math`); Gemini real (la calidad de las fórmulas y de los bloques generados, y si respeta la nota del subconjunto); calidad pedagógica de las predicciones; lectores de pantalla.
