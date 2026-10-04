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

Un `attempt_id` solo puede aplicarse una vez. Repetir el mismo resultado no duplica evidencia ni vuelve a ejecutar la transición de progreso. Otro intento recibe otro identificador y sí puede añadir evidencia.

## Independencia

Una respuesta es independiente solamente cuando se cumplen todas estas condiciones:

1. el resultado es `CORRECT`;
2. el contrato de la actividad declara `supports_independence=true`;
3. no se utilizó ninguna ayuda;
4. la evaluación no fue convertida posteriormente mediante “Corregir evaluación”.

El nombre de la fase no basta. Las actividades guiadas y de comprobación no producen independencia. Una corrección del usuario puede corregir el resultado semántico, pero no convierte el intento original en ejecución independiente.

## Diagnóstico y fallos de aprendizaje

Los resultados diagnósticos se conservan con `evidence_role=diagnostic`. `CORRECT`, `UNKNOWN`, `PARTIAL` y `MISCONCEPTION` durante diagnóstico tienen `counts_as_learning_failure=false` y no se añaden al historial de errores de práctica.

Una respuesta no correcta cuenta como fallo de aprendizaje únicamente fuera del diagnóstico. La evidencia diagnóstica todavía puede contradecir una inferencia de dominio porque describe el desempeño actual; esa contradicción no se trata como penalización ni como racha de fallos.

## Dimensiones observables

La actividad acredita únicamente las dimensiones de `observable_dimensions`. El tipo de error no añade dimensiones automáticamente.

Los contratos actuales son conservadores:

| Actividad | Dimensiones base | Independencia | Transferencia |
|---|---|---:|---:|
| Diagnóstico | conceptual o dimensión indicada por `kind` | sí, si no hubo ayuda | no |
| Comprobación de comprensión | conceptual o dimensión indicada por `kind` | no | no |
| Práctica guiada | aplicación directa y dimensiones indicadas por `kind` | no | no |
| Práctica independiente | aplicación directa y dimensiones indicadas por `kind` | sí | no |
| Integración | aplicación contextual e interpretación | sí | solo con novedad declarada |
| Repaso | memoria y dimensiones indicadas por `kind` | sí | no |
| Microtutoría guiada | aplicación directa | no | no |
| Microtutoría independiente | aplicación directa | sí | no |

Un contrato desconocido utiliza un fallback conservador: no acredita independencia, transferencia ni selección de método. Reconocimiento no acredita procedimiento. La integración tampoco acredita transferencia si no existe un indicador explícito de novedad.

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

`level` continúa almacenándose para compatibilidad con sesiones existentes y para saber qué etapa de interfaz estaba activa. No es una prueba de dominio.

## Compatibilidad con datos legacy

Los campos anteriores se conservan y los eventos existentes no se reescriben. Cuando falta un contrato, la política no infiere retrospectivamente independencia, transferencia o novedad a partir del nombre de la fase. En particular, los campos legacy `independent` y `varied`, que se calculaban automáticamente, no bastan para dominar aplicación, procedimiento o transferencia.

Esta decisión puede reducir el dominio mostrado en algunos datos antiguos. Es deliberadamente conservadora: ausencia de evidencia estructurada no se convierte en evidencia positiva. Las nuevas respuestas pueden completar las dimensiones pendientes sin perder el historial anterior.

## Alcance pendiente

Esta versión agrega contratos para futuras evidencias de microtutoría, pero no cambia su secuencia, profundidad ni generación. También quedan fuera de alcance la persistencia en servidor, evaluadores deterministas por dominio y una migración modular completa.

