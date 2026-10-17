# Corrección del evaluador de PR #11

## Causa comprobada y límite de reproducción

El normalizador v1 rechazaba citas menores de tres caracteres (`cm`, `m`),
invalidaba los cuatro criterios por un único campo o juicio incierto y retornaba
antes de comprobar número y unidad. El esquema usaba cadenas libres para enums
e identidades; todos los rechazos mostraban la misma explicación genérica.
Los tests originales reproducían ese comportamiento global en vez de detectar
la pérdida de resultados independientes.

Se reprodujeron estos fallos con salidas sintéticas con formato Gemini. No se
dispone de la respuesta cruda del incidente ni de GEMINI_API_KEY en el entorno
de desarrollo; no se atribuye retrospectivamente el incidente a una condición
exacta sin esos datos. La comprobación con Gemini real queda BLOCKED aquí.

## Contrato y precedencia

Los nuevos resultados usan `rubric_evaluation_v1.1`, `rubric_prompt_v1.1` y
`rubric_response_v1.1`. Se siguen leyendo los resultados v1 sin reescribirlos.

- `evaluation_state`: COMPLETE, PARTIAL o UNAVAILABLE, según cuántos criterios
  tienen un juicio verificable. No es una puntuación del alumno.
- `valid`: sigue significando evaluación completa, no respuesta correcta.
- Cada criterio conserva `status`, cita literal, razón, certeza, validador,
  comprobaciones independientes (`checks`) y códigos de diagnóstico.
- Un error de identidad invalida todos los juicios semánticos. Los campos finales
  se pueden comprobar contra la tarea local de identidad conocida.
- Una fila ausente, repetida, sin cita, con cita inventada, razón vacía o certeza
  desconocida queda incierta sin contaminar las demás.
- Se toleran mayúsculas en enums, envolturas de cita y diferencias de espacios.
  Se guarda el fragmento exacto recuperado de la respuesta. No se toleran
  paráfrasis ni equivalencias matemáticas inventadas como citas.
- El número/unidad incorrectos vetan el criterio correspondiente incluso ante
  incertidumbre semántica o caída del proveedor. Una coincidencia objetiva solo
  comprueba el campo final: no rescata un razonamiento incorrecto o incierto.
- UNCERTAIN produce UNKNOWN: sin acierto, independencia ni fallo de aprendizaje.
  Aplicación y transferencia exigen todos los criterios MET y los requisitos
  previos de independencia y novedad. No cambian los umbrales de evidencia v2.1.

## Diagnóstico seguro y recuperación

`assessment_validation` registra solo versión, estado global y códigos locales
por criterio: por ejemplo MISSING_QUOTE, QUOTE_NOT_IN_ANSWER,
INSUFFICIENT_REASON, INVALID_CERTAINTY, SEMANTIC_UNCERTAINTY,
CONTRADICTORY_JUDGMENT y PROVIDER_UNAVAILABLE. No registra claves, identidad del
perfil, respuestas, texto crudo de Gemini ni texto de excepciones del proveedor.
Los códigos también se guardan con el intento y se muestran en la interfaz.

Una evaluación mixta permite reparar únicamente criterios negativos
fundamentados. El episodio existente vuelve a la tarea padre sin acreditarla.
«Reevaluar criterios pendientes» crea otro intento enlazado por `reevaluation_of`
con la misma respuesta y tarea. Conserva el intento anterior, no duplica
evidencia independiente para suficiencia y consume el límite de tres
evaluaciones por visita. No reevalúa silenciosamente históricos ni realiza
reintentos automáticos del proveedor.

SQLite no cambia de tablas ni necesita migración. Se preservan exportación,
restauración e idempotencia. Una versión anterior no entiende v1.1: guardar un
respaldo antes de retroceder; no intentar guardar el nuevo estado con código viejo.

## Prueba real en Windows

Con respaldo guardado y servidor detenido, dentro del repositorio:

```powershell
git fetch origin
git switch feat/authentic-assessment
git pull --ff-only origin feat/authentic-assessment
py -3 app_legacy.py --self-test
py -3 tools/evaluate_assessments.py --live --reproduce
py -3 app_legacy.py
```

Usa GEMINI_API_KEY configurada en esa terminal. El comando de reproducción hace
cuatro llamadas con casos sintéticos de 8 m, sin abrir perfiles ni escribir la
base de progreso. Devuelve 0 si los criterios esperados coinciden, 1 ante
desviaciones y 2 si quedan criterios esperados sin resolver; no mide precisión
global. Revisa las razones y citas, además del código de salida.

En localhost:8765, abre la tarea que quedó incierta y pulsa «Reevaluar criterios
pendientes», luego «Reintentar evaluación pendiente». Usa los valores del caso
guardado. El historial anterior debe permanecer. Una fórmula sola puede demostrar
método y cálculo, pero no debe inventarse la interpretación que no se escribió.
En una tarea nueva, escribe la unidad final `m` cuando se solicita `cm`: units
debe quedar pendiente con `requested_unit_v1`, aun si interpretación es incierta.
Abre «Practicar criterio: units», completa la reparación y reintenta la tarea
completa. Reinicia el servidor y comprueba que los resultados y pendientes siguen.
