# Enséñale a Beto v1 (`teach_beto_v1`)

Aprender enseñando: el aprendiz le explica un tema a **Beto**, un compañero ficticio que tiene
una idea equivocada concreta y verosímil. No se trata de contestar, sino de **construir una
explicación** que desarme esa idea. Es la forma más directa de medir y ejercitar la capa de
**comprensión** (explicar por qué, no solo qué).

## Flujo

1. `/api/beto/start`: el modelo propone la creencia falsa de Beto, la idea correcta y la
   primera intervención de Beto («creo que… ¿me ayudas?»). La creencia y la idea correcta son
   **privadas** (se guardan en el servidor); el cliente solo recibe la apertura.
2. El aprendiz escribe su explicación (hasta `BETO_MAX_TURNS`=4 intercambios).
3. `/api/beto/turn`: Beto reacciona **solo a lo que le explicaron**. Si la explicación es vaga
   o repite una fórmula, pide un ejemplo o plantea una duda ingenua; si hay un error, no lo
   corrige él: pregunta algo que lo expone. Nunca dice la idea correcta.
4. Termina cuando Beto cambia de opinión (`CORRECTED`) o se agotan los turnos. Entonces el
   servidor entrega la idea correcta, los fallos concretos de la explicación y un resumen.

## Contrato local

- Estados válidos del turno: `PERSISTS`, `PARTIAL`, `CORRECTED`. Cualquier otro se rechaza.
- `CORRECTED` exige que la persona haya explicado la idea y por qué la creencia de Beto falla,
  con sus palabras; «tienes razón» o «estás mal» no bastan (regla del prompt).
- Si la respuesta de Beto contiene la idea correcta tal cual, se descarta (Beto no la sabe).
- Auditoría de contenido (`content_trust_v1`) al crear la actividad: la creencia debe ser
  realmente falsa y la idea correcta realmente verdadera. Si falla, no se crea nada.
- Turnos y mensajes acotados; el texto del aprendiz se trata como dato, no como instrucciones.
- Idempotente por `attempt_id` (misma explicación → mismo resultado sin otra llamada; otro texto
  con el mismo id → conflicto). Aislada por versión y por meta.

## Qué cuenta como evidencia

- **Provisional.** Una calificación del modelo con rúbrica nunca es evidencia firme. Al terminar
  se registra un evento `BETO_SESSION` con `provisional: true` (estado CORRECT / PARTIAL /
  MISCONCEPTION, turnos, tema). **No** es `EVIDENCE`, **no** concede dominio y `expertOutcome`
  lo ignora: no entra al panel de nivel experto.
- Solo actúa en una dirección conservadora: si Beto no quedó convencido, se **adelanta el
  repaso** del tema (`lapseReview`), igual que un fallo en la práctica intercalada. Nunca lo
  retrasa.
- Abandonar la sesión no registra nada.
- Ayuda: Beto no da pistas; no hay `help_used`.

## Disponibilidad y estado

- Hay un botón «Enséñale a Beto» en el mapa si existe al menos un tema ya expuesto con repaso o
  verificación y no hay otra práctica activa.
- El estado vive en `goal.beto` (persistente): recargar devuelve a la misma conversación.
- Rutas: `/api/beto/start` y `/api/beto/turn`; versión `teach_beto_v1`.

## Qué no cubre todavía

- Sin confirmación local: que Beto «se convenza» no se convierte en evidencia firme hasta que
  exista una actividad calificada localmente que la respalde.
- Una sola creencia errónea por sesión.
- La calidad de la creencia de Beto depende del verificador y del reporte «Esto está mal».

Un resultado positivo puede confirmarse con una pregunta local (`local_confirmation_v1`).
