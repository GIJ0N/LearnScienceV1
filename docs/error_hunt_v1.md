# Encuentra el error v1 (`error_hunt_v1`)

Primera modalidad que no es «responder una pregunta»: el aprendiz **revisa una solución ajena**
con un error escondido y diagnostica dónde está y por qué. Es más cercana a lo que hace un
experto (revisar, depurar, criticar) y alimenta la capa de **discriminación** del panel.

## Forma del ítem

- Un enunciado con un problema resuelto en 3 a 6 pasos numerados («Paso 1: …»). **Exactamente
  un paso contiene un error** conceptual o de procedimiento típico del tema.
- 3 a 5 opciones; cada una es un **diagnóstico completo** («El error está en el paso 3: …
  porque …»). Una es correcta; cada incorrecta nombra la confusión concreta que la produce
  (`misconception`), igual que el resto de preguntas de clave privada.
- Se usa la misma maquinaria que el diagnóstico, los pasos y la práctica intercalada:
  `_build_choice_item` (clave privada, barajado, filtro de calidad) y `_answer_choice_item`
  (corrección local sin proveedor, idempotente por `attempt_id`, aislamiento por versión).

## Contrato local (además del genérico)

- El enunciado debe contener entre 3 y 6 líneas «Paso N:» consecutivas desde 1.
- Cada opción debe citar un paso existente («paso N» con N dentro del rango).
- Las demás reglas de calidad (sin «todas/ninguna», sin clave más larga, sin repetidas) siguen
  vigentes.
- Auditoría de contenido (`content_trust_v1`): una llamada numerada por lote; se descartan los
  ítems señalados. Aquí importa más que en ningún otro lugar: un error mal puesto enseña mal.

## Qué cuenta como evidencia

- Es un evento `DISCRIMINATION` con `variant: 'error_hunt'`: **no** es evidencia de dominio ni
  de independencia. Alimenta la capa de discriminación del panel experto y el repaso espaciado
  (un fallo adelanta el repaso del tema), igual que la práctica intercalada.
- Con ayuda, no aplica: no hay pistas en esta actividad.
- La confianza declarada se registra y alimenta la calibración como en las demás.

## Disponibilidad y flujo

- Disponible cuando hay al menos 1 tema ya expuesto y con repaso o verificación; hasta 3 temas
  por sesión (`MIXED_MAX` aparte). Se ofrece como botón «Encuentra el error» junto a las demás
  prácticas.
- Rutas: `/api/practice/error` y `/api/practice/error/answer`; versión `error_hunt_v1`.

## Qué no cubre todavía

- No hay variante «ningún paso tiene error»: el aprendiz sabe que siempre hay uno.
- No pide **corregir** el paso, solo diagnosticarlo.
- La calidad semántica del error escondido depende del verificador y del reporte «Esto está mal».
