# Evidence Policy v2 — suficiencia inicial y comprobación independiente

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

Cuatro dimensiones usan familias canónicas de actividad, sin aliases implícitos:

| Familia | `kind` canónico | Única dimensión observable | Roles autorizados |
|---|---|---|---|
| Identificación de variables | `variable_identification` | `variables` | diagnóstico, práctica guiada, práctica independiente, repaso, diagnóstico de reparación y reintento padre |
| Uso de unidades | `units` | `units` | los mismos seis roles |
| Manipulación de ecuaciones | `equation_manipulation` | `equation_manipulation` | los mismos seis roles |
| Selección de método | `method_selection` | `method_selection` | los mismos seis roles |

Cuando una de estas dimensiones requerida todavía no tiene evidencia suficiente, el frontend la envía como `target_dimension` al generador de la microlección. El backend exige que GUIDED e INDEPENDENT devuelvan el `kind` canónico y `observable_dimensions` con exactamente esa dimensión; una respuesta incompatible se rechaza y no se guarda. La interfaz conserva la dimensión y ofrece un reintento explícito; cada clic realiza una sola solicitud y un rechazo no crea actividad, intento ni evidencia. El contrato frontend vuelve a intersectar dimensión solicitada, familia y rol. Por ello, identificar una variable no acredita manipulación de ecuaciones, y seleccionar un método no acredita su ejecución.

Las preguntas anteriores que no contienen `observable_dimensions` conservan la inferencia por su `kind`; no reciben metadata ni evidencia retrospectiva durante la carga. Un `kind` desconocido, una familia incompatible o un rol sin permiso produce una lista observable vacía.

El rol fija los permisos máximos. Un contrato puede desactivar independencia o transferencia, pero nunca activarlas cuando el rol las prohíbe. La novedad declarada tampoco supera esa capacidad. Un contrato desconocido utiliza un fallback conservador: no observa dimensiones ni acredita independencia o transferencia. Reconocimiento no acredita procedimiento y una integración de reconocimiento no acredita automáticamente aplicación contextual o interpretación.

`required=true` exige suficiencia de esa dimensión para acreditar el nodo. La política v2 exige independencia en todas las dimensiones; continuar curricularmente con pendientes no satisface ese requisito.

## Suficiencia inicial v2

La política activa es `evidence_policy_v2`. `MASTERED` se conserva como valor interno
compatible; significa **evidencia inicial suficiente**, no expertise ni certificación.
El mínimo de dos es un default conservador de ingeniería, no un umbral científico universal.

Cada dimensión requiere **dos aciertos independientes en preguntas distintas** posteriores
a la última contradicción efectiva. Deben conservar `attempt_id`, pregunta,
`is_independent=true`, cero ayuda y la dimensión observada. No cuentan como segunda
señal el mismo intento, actividad o texto normalizado; cambiar IDs no acredita novedad.
La ayuda, las correcciones manuales positivas y la evidencia hija no acreditan independencia.
La corrección sustituye al juicio original en la derivación sin borrarlo del historial.

Transferencia exige además dos eventos con novedad autorizada por su contrato. El nuevo
endpoint de comprobación nunca concede transferencia. Memoria requiere además un repaso
independiente al menos 24 horas después de otra observación independiente válida.
Este mínimo temporal no acredita retención prolongada ni modela toda exposición intermedia.

## Comprobaciones y avance

Al completar INTEGRATE con evidencia pendiente se pasa a CONFIRMATION, en lugar de
repetir la misma microlección. `/api/confirmation` genera una sola pregunta para la
primera dimensión pendiente compatible. Backend y frontend validan familia y dimensión;
se rechazan preguntas repetidas, sin reintentos automáticos. El contrato fija independencia
y prohíbe transferencia. Las respuestas usan la evaluación y el registro de evidencia existentes.

Hay como máximo tres intentos por visita. Siempre se puede volver a enseñanza o
**continuar con pendientes visibles**. Esta decisión registra `CURRICULUM_CONTINUED`,
programa repaso y permite seguir la ruta y sus prerrequisitos; no crea evidencia positiva
ni modifica la cobertura. El dashboard ofrece volver a comprobar cada habilidad pendiente.
La continuación es una elección curricular explícita, no una declaración de competencia.
Los errores de comprobación se registran y ofrecen enseñanza; los episodios de reparación
existentes conservan su propia máquina de estados y no se interrumpen para abrir comprobaciones.

Memoria con una primera observación queda para el repaso diferido; transferencia pendiente
queda visible para su evaluación específica. Ninguna bloquea indefinidamente toda la ruta.

## Compatibilidad con datos legacy

Los campos anteriores se conservan y los eventos existentes no se reescriben. La importación construye copias con defaults seguros para `coverage`, `reviews`, `events`, sesiones y arrays anidados; no modifica los objetos del respaldo. Las preguntas nulas se tratan como actividades no disponibles y construir un contrato nunca añade `activity_id` al objeto original.

Cuando falta un contrato, la política no infiere retrospectivamente independencia, transferencia o novedad a partir del nombre de la fase. En particular, los campos legacy `independent` y `varied`, que se calculaban automáticamente, no bastan para dominar aplicación, procedimiento o transferencia.

Esta decisión puede reducir el dominio mostrado en algunos datos antiguos. Es deliberadamente conservadora: ausencia de evidencia estructurada no se convierte en evidencia positiva. Las nuevas respuestas pueden completar las dimensiones pendientes sin perder el historial anterior.

## Compatibilidad operativa y reversión

No cambia SQLite ni el esquema de respaldo. Los campos nuevos son JSON aditivos en
sesión y eventos. La carga no reescribe evidencia ni fabrica metadata ausente. Algunos
estados antes suficientes aparecen pendientes al recalcularse: sus intentos se conservan.
Para volver a una versión anterior, primero salir de CONFIRMATION mediante continuar,
guardar y exportar respaldo; el frontend anterior no reconoce esa fase nueva. Conservar
siempre la base actual antes de una restauración.

## Ancla local
Desde `evidence_hardening_v1` (que sustituye la regla de `open_answer_trust_v1`), solo una producción calificada localmente ancla un tema: cálculo (`numeric`) o procedimiento de al menos 4 pasos (`ordering`), con banda distinta de `base`. La confirmación de opción múltiple (`CONFIRMATION`, incluida la de `OPEN_ANSWER`) es formativa y no ancla. Los aciertos deterministas cuentan sin ancla; los calificados solo por el modelo cuentan únicamente si existe un marcador con `source='PRODUCTION'` y `anchor_policy_version='evidence_hardening_v1'` posterior a la última contradicción. Los marcadores anteriores se degradan al leer y no se borran. Ver `docs/evidence_hardening_v1.md` y `docs/open_answer_trust_v1.md`.

## Enseñanza directa
Desde `direct_teaching_v1`, un «No sé» declarado en la práctica principal abre una explicación corta. Leerla es exposición y su comprobación
(`DIRECT_CHECK`) es formativa: ninguna crea `EVIDENCE` ni toca cobertura, calendario o panel. La respuesta posterior a esa pregunta cuenta con
ayuda (`help_used>=1`, no independiente). Ver `docs/direct_teaching_v1.md`.

## Práctica con dificultad adaptativa
Desde `practice_difficulty_v1`, la banda de una práctica (`base`/`standard`/`challenge`) es dato de selección, nunca crédito. La política de suficiencia no cambia, con dos notas de versión:
una práctica `base` no suma como acierto independiente para `sufficient()`, y un **fallo en `challenge`** (solo con suficiencia previa comprobada al registrar; si no la había, se registra como `standard`) **no cuenta como contradicción ni como fallo de aprendizaje**: no reinicia `lastFailure` ni quita aciertos previos. Es una excepción acotada a «Fuera del diagnóstico, únicamente `PARTIAL` y `MISCONCEPTION` cuentan como fallos de aprendizaje». Los eventos sin banda se tratan como `standard`. Ver `docs/practice_difficulty_v1.md`.

## Revisión de prerrequisitos
Desde `prerequisite_review_v1`, ≥2 fallos de aprendizaje de X con `error_type='prerequisite'` (intentos distintos, posteriores al último acierto independiente de X, arista X→P ya existente) proponen revisar P con `PREREQUISITE_REVIEW` (sin `node_id`, `creates_evidence:false`). Es una decisión de ruta y calendario: no crea `EVIDENCE`, cobertura, dominio ni suficiencia, y no borra evidencia de P. Nota de versión: sustituye a la antigua regla de `placement_v1` por la que un solo fallo con `error_type='prerequisite'` anulaba el salto de P, y revierte, solo en este caso, la decisión de `adaptive_schedule_v1` de no adelantar P tras un fallo. La política de evidencia no se reinterpreta. Ver `docs/prerequisite_review_v1.md`.

## Alcance pendiente

No hay verificación semántica de paráfrasis, calibración científica del umbral de dos,
evaluadores deterministas especializados ni certificación de expertise. Se conserva la
persistencia SQLite y la arquitectura legacy. El comparador textual rechaza copias exactas
normalizadas, no demuestra diversidad cognitiva ni transferencia.


## Nota de versión L2a (`delayed_mastery_v1`)

- El dominio exige suficiencia y un acierto escrito local de otro día, al menos 8 h después de la última enseñanza. Ver `docs/delayed_mastery_v1.md`.
- Un acierto de opción múltiple, de colocación o calificado por el modelo no confirma lo diferido, aunque la suficiencia esté completa.
- `TEACHING_EXPOSURE` y `FORMATIVE_EXPOSURE` pasan a ser la referencia temporal de la confirmación. Releer no confirma por sí mismo.

## Nota de versión L2b (`transfer_probe_v1`)

- La transferencia se acredita solo con un sondeo escrito, determinista y emitido por el servidor (`transfer_probe_v1`). Ver `docs/transfer_probe_v1.md`.
- Esta nota **sustituye** la regla de este documento que decía «el nuevo endpoint de comprobación nunca concede transferencia» y la de «novedad autorizada por su contrato» como base de la transferencia: ya no basta la novedad declarada en INTEGRATE.
- Los eventos anteriores con novedad no se borran; se cuentan solo para medir el aviso L3 (`legacyTransfer`).
- `TRANSFER_PROBE_ISSUED`, `TRANSFER_UNAVAILABLE` y el enfriamiento tras un fallo de transferencia no son evidencia. Un fallo solo contradice la dimensión `transfer`.

## Nota de versión L3 (`topic_closure_v1`)

- La pantalla «Ideas clave» y la autoexplicación de tema no crean evidencia ni exposición. `TOPIC_CLOSURE_OPENED` y `TOPIC_SELF_EXPLANATION` llevan `creates_evidence:false` y no están en `EXPOSURE_TYPES`, `TEACHING_REF_TYPES` ni `isStudyAnswer`. Ver `docs/topic_closure_v1.md`.
- Un cierre solo se abre tras un acierto `CORRECT` en INTEGRATE, o tras «Continuar con pendientes» si la última evidencia fue correcta. Nunca tras fallo, `UNKNOWN` o `PARTIAL`.

## Nota de versión L4a (`worked_examples_v1`)

- La inversión por pericia (`TEACHING_SUPPORT`, `lean`/`full`) es presentación. No crea `EVIDENCE`, no entra en `EXPOSURE_TYPES`, `TEACHING_REF_TYPES` ni `isStudyAnswer`, y no cambia cobertura, calendario ni suficiencia. Un acierto independiente en la dimensión objetivo solo sirve para decidir el apoyo, no para acreditar dominio. Ver `docs/worked_examples_v1.md`.
