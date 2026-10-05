# Evidence Policy v1

## Propósito

Esta política define cómo la aplicación convierte una respuesta en evidencia y cómo deriva el progreso. Se aplica a eventos nuevos. No reescribe ni completa datos históricos.

La fuente primaria es el evento de evidencia. `level` conserva su función de compatibilidad y navegación por etapas, pero no declara dominio. `coverage.status`, el dashboard, `verified()` y `nextNode()` se derivan de la misma regla de suficiencia.

## Evento de evidencia

Cada intento nuevo registra, como mínimo:

- `evidence_id` y `attempt_id`;
- `activity_id`, `node_id`, fase y tipo de actividad;
- resultado y tipo de error;
- ayuda utilizada;
- si fue independiente;
- si fue una variante novedosa;
- dimensiones observadas;
- si cuenta como fallo de aprendizaje;
- versión del evaluador, timestamp y versión de política.

La identidad de un intento combina `attempt_id`, `activity_id` y `node_id`. Repetir exactamente la misma identidad se rechaza como duplicado y no vuelve a ejecutar la transición. Reutilizar un `attempt_id` con otro nodo o actividad se rechaza como colisión explícita. Los eventos legacy sin todos los identificadores se tratan conservadoramente como duplicados cuando no existe una contradicción conocida.

Una corrección manual recibe su propio `attempt_id` y enlaza el evento original mediante `correction_of` y `original_attempt_id`. Conserva `original_result`, añade `corrected_result`, `actor`, `source` y la decisión aplicada. La corrección no reescribe el evento original ni repite una transición que ya ocurrió.

## Independencia

Una respuesta es independiente solamente cuando se cumplen todas estas condiciones:

1. el resultado es `CORRECT`;
2. el contrato de la actividad declara `supports_independence=true`;
3. no se utilizó ninguna ayuda;
4. la evaluación no fue convertida posteriormente mediante “Corregir evaluación”.

El nombre de la fase no basta. Las actividades guiadas y de comprobación no producen independencia. Una corrección del usuario puede corregir el resultado semántico, pero no convierte el intento original en ejecución independiente.

## Diagnóstico y fallos de aprendizaje

Los resultados diagnósticos se conservan con `evidence_role=diagnostic`. `CORRECT`, `UNKNOWN`, `PARTIAL` y `MISCONCEPTION` durante diagnóstico tienen `counts_as_learning_failure=false` y no se añaden al historial de errores de práctica.

Fuera del diagnóstico, únicamente `PARTIAL` y `MISCONCEPTION` cuentan como fallos de aprendizaje. Un estado ausente, `null`, `UNKNOWN` o no reconocido se normaliza a evidencia indeterminada: puede conservarse, pero no incrementa `errors`, no abre una contradicción temporal y no se usa como evidencia positiva.

La evidencia diagnóstica todavía puede contradecir una inferencia de dominio cuando contiene un fallo reconocido, porque describe el desempeño actual; esa contradicción no se trata como penalización ni como racha de fallos.

## Dimensiones observables

La actividad acredita únicamente las dimensiones de `observable_dimensions`. El tipo de error no añade dimensiones automáticamente. Las dimensiones finales son la intersección entre las permitidas por el rol, las observables por el `kind` y, cuando existe, la lista explícita del contrato. Una lista explícita puede restringir esa intersección, pero no ampliarla.

Los contratos actuales son conservadores:

| Actividad | Dimensiones base | Independencia | Transferencia |
|---|---|---:|---:|
| Diagnóstico | intersección segura con la dimensión indicada por `kind` | sí, si no hubo ayuda | no |
| Comprobación de comprensión | intersección segura con `conceptual`, `recognition` o `self_explanation` | no | no |
| Práctica guiada | intersección segura con dimensiones de aplicación o procedimiento | no | no |
| Práctica independiente | intersección segura con dimensiones de aplicación o procedimiento | sí | no |
| Integración | intersección segura con aplicación contextual, interpretación o transferencia | sí | solo con permiso del rol y novedad declarada |
| Repaso | intersección segura con la dimensión indicada por `kind` | sí | no |
| Microtutoría guiada | aplicación directa | no | no |
| Microtutoría independiente | aplicación directa | sí | no |

El rol fija los permisos máximos. Un contrato puede desactivar independencia o transferencia, pero nunca activarlas cuando el rol las prohíbe. La novedad declarada tampoco supera esa capacidad. Un contrato desconocido utiliza un fallback conservador: no observa dimensiones ni acredita independencia o transferencia. Reconocimiento no acredita procedimiento y una integración de reconocimiento no acredita automáticamente aplicación contextual o interpretación.

## Contradicciones temporales

La evidencia es append-only. No se borra un acierto cuando aparece un fallo.

Para cada dimensión, el fallo relevante más reciente abre una nueva ventana de evidencia. La dimensión vuelve a ser suficiente solamente cuando, después de ese fallo, aparece evidencia positiva que satisface sus requisitos:

- dimensión conceptual u otra dimensión simple: un resultado correcto observado;
- procedimiento o aplicación directa: un resultado correcto independiente;
- transferencia: un resultado correcto, independiente y con novedad declarada;
- memoria: un resultado correcto e independiente durante repaso.

Una respuesta correcta asistida después de un fallo puede mostrar progreso, pero no restablece una dimensión que requiere independencia.

## Dominio y progreso

Una dimensión es `MASTERED` cuando su evidencia es suficiente. Un nodo está dominado cuando todas sus dimensiones requeridas están dominadas. La misma derivación alimenta:

- `verified()`;
- `nextNode()`;
- el número de habilidades demostradas en el dashboard;
- el estado de cobertura mostrado al usuario.

`level` continúa almacenándose para compatibilidad con sesiones existentes y como resumen histórico. No decide por sí mismo la siguiente transición. La evidencia derivada elige si hace falta enseñanza, comprobación o práctica. Las discrepancias entre `level` y la cobertura producen un evento `PROGRESS_DISCREPANCY` diagnosticable y nunca inventan evidencia.

## Compatibilidad con datos legacy

Los campos anteriores se conservan y los eventos existentes no se reescriben. La importación construye copias con defaults seguros para `coverage`, `reviews`, `events`, sesiones y arrays anidados; no modifica los objetos del respaldo. Las preguntas nulas se tratan como actividades no disponibles y construir un contrato nunca añade `activity_id` al objeto original.

Cuando falta un contrato, la política no infiere retrospectivamente independencia, transferencia o novedad a partir del nombre de la fase. En particular, los campos legacy `independent` y `varied`, que se calculaban automáticamente, no bastan para dominar aplicación, procedimiento o transferencia.

Esta decisión puede reducir el dominio mostrado en algunos datos antiguos. Es deliberadamente conservadora: ausencia de evidencia estructurada no se convierte en evidencia positiva. Las nuevas respuestas pueden completar las dimensiones pendientes sin perder el historial anterior.

## Alcance pendiente

Esta versión agrega contratos para futuras evidencias de microtutoría y prueba que el retorno al flujo padre se conserva, pero no cambia la ruta de dominio separada, su secuencia, profundidad ni generación. Esa ruta permanece como deuda explícita fuera del alcance. También quedan fuera de alcance la persistencia en servidor, evaluadores deterministas por dominio y una migración modular completa.
