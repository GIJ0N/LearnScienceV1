# Encuentra el error v1 (`error_hunt_v1`)

Primera modalidad que no es «responder una pregunta»: el aprendiz **revisa una solución ajena**
con un error escondido y diagnostica dónde está y por qué. Es más cercana a lo que hace un
experto (revisar, depurar, criticar) y alimenta la capa de **discriminación** del panel.

## Forma del ítem

- Un enunciado con un problema resuelto en 3 a 6 pasos numerados («Paso 1: …»). **Puede tener
  exactamente un paso erróneo o estar completamente correcto.** El aprendiz no sabe cuál.
- 3 a 5 opciones; cada una es un **diagnóstico completo** («El error está en el paso 3: …
  porque …»). **Siempre** hay exactamente una opción «Ningún paso tiene error: la solución es
  correcta». En una solución limpia esa es la clave; en una con error es una opción incorrecta
  (cree que la solución es válida porque el resultado parece razonable). Como la opción está
  siempre, su presencia no delata nada.
- El **servidor decide** qué soluciones son limpias (`_choose_clean_nodes`: con 3 temas, una
  limpia; con menos, cada una con probabilidad `ERR_CLEAN_RATE`=0,3) y se lo pide al modelo.
  Una clave que no corresponde al tipo pedido descarta el ítem.
- Se usa la misma maquinaria que el diagnóstico, los pasos y la práctica intercalada:
  `_build_choice_item` (clave privada, barajado, filtro de calidad) y `_answer_choice_item`
  (corrección local sin proveedor, idempotente por `attempt_id`, aislamiento por versión).
- La parte privada guarda `has_error` y `fix_reference` (el paso ya corregido). Nada de eso
  sale al cliente antes de responder; después de responder el resultado trae `clean_solution`
  y `needs_fix`.

## Contrato local (además del genérico)

- 3 a 6 líneas «Paso N:» consecutivas desde 1.
- Cada opción cita un paso existente o es la opción «ningún paso»; exactamente una de estas
  últimas por ítem.
- La clave coincide con el tipo pedido; si hay error, `fix_reference` tiene contenido.
- Las demás reglas de calidad (sin «todas/ninguna de las anteriores», sin clave más larga, sin
  repetidas) siguen vigentes.
- Auditoría de contenido (`content_trust_v1`): una llamada numerada por lote; se descartan los
  ítems señalados. Aquí importa más que en ningún otro lugar: un error mal puesto, o una
  solución «limpia» con un error real, enseñan mal.

## Corregir el paso (`/api/practice/error/fix`)

- Solo se ofrece si el diagnóstico fue correcto y la solución tenía error (`needs_fix`). Se
  puede saltar.
- El aprendiz **escribe** cómo quedaría el paso corregido (producir, no reconocer).
- Califica el modelo con una rúbrica contra `fix_reference` (privada): CORRECT, PARTIAL o
  MISCONCEPTION, sin premiar elocuencia. El texto del aprendiz se trata como dato.
- El servidor exige que ese `attempt_id` de diagnóstico exista para esa actividad y haya sido
  CORRECT; es idempotente (misma corrección → mismo resultado sin otra llamada; otro texto con
  el mismo `attempt_id` → conflicto).
- Es evidencia **provisional**: evento `ERROR_FIX` con `provisional: true`. No es `EVIDENCE`, no
  mueve el repaso y `expertOutcome` lo ignora, de modo que no cuenta en el panel experto. Queda
  registrado para cuando haya una confirmación local que lo respalde.

## Qué cuenta como evidencia

- El diagnóstico es un evento `DISCRIMINATION` con `variant: 'error_hunt'`: **no** es evidencia
  de dominio ni de independencia. Alimenta la capa de discriminación del panel experto y el
  repaso espaciado (un fallo adelanta el repaso del tema), igual que la práctica intercalada.
  Decidir que una solución limpia está bien cuenta igual que encontrar un error.
- La corrección escrita es provisional (arriba).
- Sin pistas en esta actividad. La confianza declarada alimenta la calibración como en las
  demás.

## Disponibilidad y flujo

- Disponible cuando hay al menos 1 tema ya expuesto y con repaso o verificación; hasta 3 temas
  por sesión. Botón «Encuentra el error» junto a las demás prácticas.
- Rutas: `/api/practice/error`, `/api/practice/error/answer`, `/api/practice/error/fix`;
  versión `error_hunt_v1`.

## Qué no cubre todavía

- La corrección escrita depende de una rúbrica del modelo; no hay confirmación local que la
  convierta en evidencia firme.
- No hay variante con dos errores ni errores de otro tipo (solo un paso o ninguno).
- La calidad semántica del error escondido depende del verificador y del reporte «Esto está mal».

## Ajustes tras la primera prueba real

- Gemini devolvía los pasos en negritas o en una sola línea y el contrato local los rechazaba: ahora se normalizan antes de validar.
- La opción fija «ningún paso» es corta; ya no cuenta para decidir si la opción correcta «se delata por larga».
- Se reintenta una vez con los motivos; si falla, el error los muestra (y se imprimen en el servidor).
