# Contenido confiable v1 (`content_trust_v1`)

Origen: la prueba QA real con Gemini mostró un tutor que enseñó física incorrecta
("aceite más denso que el agua", un cubo que "flota" porque el empuje "gana"), pistas que
repetían el error habitual y retroalimentación que ignoraba el razonamiento escrito.
Una explicación pedagógicamente buena pero falsa es peor que una simple.

## Qué decide el modelo y qué decide el código

- El modelo **propone** lecciones, pasos y preguntas, y una **segunda llamada** los audita.
- El código local decide qué se descarta. Una auditoría nunca concede dominio ni evidencia.
- La auditoría **falla abierta**: si el proveedor no responde o devuelve algo ilegible, el
  contenido se entrega con `content_check.checked=false` (no se bloquea al aprendiz por un
  límite de cuota). Lo no verificado se marca; no se presenta como revisado.

## Verificador (`audit_content`)

- Revisa solo errores objetivos: hechos falsos, números o unidades inconsistentes entre texto
  y ejemplo, ejemplos imposibles o que no demuestran lo que afirman, respuesta clave
  incorrecta, más de una respuesta defendible, opciones descartables sin saber nada.
- No juzga estilo. Devuelve `issues` vacío si no hay errores claros.
- Lección (`/api/lesson`): una regeneración con los errores detectados como corrección; si la
  segunda versión también falla, se descarta con error (el cliente ofrece reintentar).
- Lección por pasos (`/api/lesson/steps`): si falla la auditoría se descarta y se usa la
  explicación completa (ya auditada).
- Diagnóstico (`/api/placement/items`): una sola auditoría del lote; las preguntas señaladas se
  descartan, y si no queda ninguna se devuelve error sin guardar nada.
- Se apaga con `CONTENT_VERIFY=0` (pruebas, banco de prompts).
- Costo: +1 llamada por lección, por lote de pasos y por lote de diagnóstico.

## «Esto está mal» (`/api/content/report`)

- El aprendiz marca una lección o pregunta con una nota opcional.
- Se guarda en `content_reports` (perfil, meta, tema, tipo, extracto, nota, fecha) para
  alimentar el banco de pruebas; se borra en cascada con el perfil.
- La lección marcada se descarta y se regenera pidiendo evitar ese error (`reported`).
- Marcar contenido **no** crea evidencia ni la quita.
- Límite conocido: las preguntas del diagnóstico se reportan al servidor pero todavía no se
  excluyen automáticamente.

## Pistas (`/api/hint`)

- La pista de la práctica guiada se genera para esa pregunta, en tres niveles: 1 orienta qué
  mirar; 2 nombra el principio; 3 modela un paso análogo con otros datos. Nunca revela la
  respuesta ni repite pistas anteriores ni el «error habitual».
- Sigue contando como ayuda (`help_used`), con nivel registrado `MODEL_UNVERIFIED`.
- Si el servicio falla, la pista de respaldo es genérica y no copia texto de la lección.

## Razonamiento escrito

- Si el aprendiz escribe su razonamiento, la retroalimentación debe comentar una idea concreta
  de ese razonamiento (acierto o fallo). El estado sigue dependiendo de la respuesta, no de la
  elocuencia.

## Qué no cubre

- Un modelo auditándose a sí mismo no ve todos sus errores. Red de seguridad: el botón
  «Esto está mal» y el uso real.
- No sustituye una revisión humana de una muestra de preguntas.

Si la revisión descarta todas las preguntas del diagnóstico, se regenera una vez con el motivo; un descarte parcial no reintenta (ronda QA 7).
