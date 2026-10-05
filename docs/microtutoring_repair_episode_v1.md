# Microtutoring Repair Episode v1

## Propósito

Un `RepairEpisode` convierte un fallo de aprendizaje del problema padre en una reparación acotada y auditable. La reparación no sustituye el problema padre, no reescribe su evidencia y no concede dominio por completar una actividad hija.

La política se identifica como `microtutoring_repair_episode_v1` y respeta `docs/evidence_policy_v1.md`.

## Modelo persistido

Cada meta puede contener `repairEpisodes`. Los datos legacy sin ese campo se cargan con una lista vacía; la importación no inventa episodios históricos ni modifica el respaldo original.

Un episodio conserva, como mínimo:

- `episode_id`;
- `parent_activity_id`, `parent_attempt_id` y `parent_node_id`;
- `parent_question`, `parent_response`, `parent_evaluation` y `parent_help_used`;
- `parent_context_snapshot`;
- `suspected_gaps`, `diagnostic_checks` y `selected_gap`;
- `repair_activities` y `repair_evidence`;
- `parent_retest` y `transfer_check`;
- `status`, `stage`, `created_at`, `closed_at` y `close_reason`;
- `context_history`, `limits` y `policy_version`.

La respuesta y evaluación originales del padre permanecen inmutables dentro del episodio. El reintento usa otra actividad y cada envío usa un `attempt_id` nuevo. Un episodio creado por `createRepairEpisode()` recibe `created_at` en ese momento; `normalizeRepairEpisode()` conserva una fecha numérica válida y deja `created_at=null` cuando el dato legacy no la tenía. La importación no genera `created_at`, `legacy_imported_at`, identificadores ni evidencia histórica: un episodio incompleto permanece conservador y no puede aparecer como completo.

Cada hipótesis diagnóstica contiene `gap_id`, concepto, razón, evidencia motivadora, confianza y uno de estos estados:

- `SUSPECTED`: explicación posible que todavía conserva incertidumbre;
- `CONFIRMED`: una comprobación corta aportó evidencia compatible con la laguna;
- `REJECTED`: la comprobación no apoyó esa hipótesis.

Solo una hipótesis se copia a `selected_gap`. Las demás permanecen en el historial con su estado; no se convierten automáticamente en déficits.

## Máquina de estados

```text
fallo padre
    ↓
DIAGNOSING
    ↓ selección de una laguna
REPAIRING: CHECK → GUIDED → INDEPENDENT
    ↓ evidencia independiente sin ayuda
PARENT_RETEST
    ↓ padre correcto
TRANSFER_CHECK
    ↓ variante novedosa correcta
COMPLETED
```

Los cierres alternativos son:

- `PARTIAL`: existe progreso, pero falta evidencia, se alcanzó un límite, falló el padre o falló la transferencia;
- `FAILED`: reservado para una reparación que termina sin evidencia útil;
- `ABANDONED`: el usuario abandona explícitamente el episodio o la recuperación detecta una sesión `CONTEXT` sin su contexto activo;
- transferencia `INDETERMINATE`: se representa en `transfer_check.novelty_status` y cierra el episodio como `PARTIAL` con una razón explícita.

Las transiciones son locales. La salida del modelo propone hipótesis y actividades, pero no decide dominio ni cambia el estado del estudiante.

## Diagnóstico acotado

El servidor recibe únicamente el problema padre, su respuesta, la evaluación y los prerrequisitos cercanos declarados en el mapa. Puede proponer entre una y tres hipótesis y entre una y tres comprobaciones.

Un resultado incorrecto en una comprobación diagnóstica no cuenta como fallo normal de aprendizaje. `CORRECT` rechaza la hipótesis asociada, `PARTIAL` o `MISCONCEPTION` puede confirmarla, y `UNKNOWN` mantiene la incertidumbre.

Cuando no hay una hipótesis confirmada, el episodio selecciona como prioridad una hipótesis todavía sospechada. Esa selección conserva su estado `SUSPECTED`; no falsifica confirmación.

## Reparación y evidencia

CHECK, GUIDED e INDEPENDENT deben tener preguntas distintas entre sí y distintas del padre. El reintento padre también debe ser distinto del padre, de los diagnósticos y de las tres actividades de reparación. `repairActivityRelation()` devuelve `EQUIVALENT`, `DISTINCT` o `INDETERMINATE`: un `activity_id` compartido o una pregunta normalizada compartida siempre significan repetición, aunque cambien `kind`, `episode_id`, `context_id` o `parent_activity_id`; un cambio aislado en cualquiera de esos campos nunca demuestra novedad. `equivalentRepairActivity()` es verdadero únicamente para `EQUIVALENT`; `prepareRepairPlan()` rechaza tanto `EQUIVALENT` como `INDETERMINATE` cuando necesita demostrar que dos actividades son distintas. Si falta una pregunta o un `kind` utilizable, la relación queda `INDETERMINATE` y la transferencia queda conservadora. Una pregunta textual distinta puede ser `DISTINCT`, pero solo una transferencia con `transfer_novelty_status=CONFIRMED`, fundamento no vacío y todas las relaciones `DISTINCT` puede llegar a ejecutarse como variante novedosa.

Todas las respuestas pasan por:

```text
applyResult()
→ prepareRecord()
→ validateTransition()
→ commitRecord()
→ transición del RepairEpisode
```

No existe una ruta alternativa de dominio para microtutoría.

La aplicación valida antes de escribir y ejecuta el registro de evidencia y la transición dentro de una transacción local. Si una escritura síncrona falla, restaura la meta anterior, vuelve a persistir ese estado y no reserva el `attempt_id`; el mismo intento puede reintentarse sin dejar evidencia, cobertura o eventos parciales.

Las actividades diagnósticas y de reparación usan `evidence_scope=repair_episode`. Se conservan en el ledger global y en el episodio, pero no actualizan la cobertura del nodo padre. `episodeActivity()` deriva el contrato efectivo de la etapa y no permite que un `activity_contract` persistido cambie `evidence_scope`, independencia, episodio o permiso de transferencia. GUIDED nunca permite independencia. Una pista está disponible en CHECK, GUIDED e INDEPENDENT. Incrementa `help_used`, se conserva en `hint_history` y bloquea independencia incluso en INDEPENDENT. Si el evaluador devuelve una pista después de un intento fallido y la etapa no cambia, esa ayuda se arrastra al siguiente intento de la misma etapa; no se atribuye retroactivamente a la respuesta ya enviada.

La reparación solo avanza a `PARENT_RETEST` después de un INDEPENDENT correcto, autorizado por el contrato y sin ayuda.

## Padre, dominio y transferencia

Estos resultados son distintos:

1. **Reparación de la laguna:** existe evidencia independiente en la actividad hija.
2. **Resolución del padre:** existe un evento separado del reintento padre, con nuevos `activity_id` y `attempt_id`.
3. **Transferencia:** existe una variante independiente con novedad significativa declarada y justificada.

El éxito del hijo no actualiza la cobertura del padre. El reintento y la transferencia sí son actividades del nodo padre y pasan por la política central de evidencia. Para avanzar, el reintento padre debe ser correcto e independiente.

La transferencia no se concede por el nombre de la etapa. Requiere:

- pregunta distinta de todas las actividades anteriores;
- `transfer_novelty_status=CONFIRMED`;
- `transfer_novelty_basis` no vacío;
- contrato que observe transferencia;
- respuesta correcta, independiente y sin ayuda.

Si esas condiciones de novedad no pueden demostrarse, `transfer_check` queda `INDETERMINATE`; no se ejecuta como prueba de transferencia y el episodio termina `PARTIAL` con la razón registrada. Una pregunta con el mismo texto normalizado se considera copia aunque cambien `activity_id`, `kind`, `episode_id`, `parent_activity_id`, mayúsculas, espacios o puntuación. Cambiar solo el contexto de reparación o el tipo de actividad no concede novedad. La importación vuelve a comparar la transferencia con el padre, los diagnósticos, CHECK, GUIDED, INDEPENDENT y el reintento padre; una declaración `CONFIRMED` heredada no sobrevive si alguna relación no es `DISTINCT`.

## Límites

Los límites locales son:

| Límite | Valor |
|---|---:|
| Profundidad de contextos | 4 |
| Actividades de reparación | 6 |
| Comprobaciones diagnósticas | 3 |
| Reintentos del padre | 2 |
| Pruebas de transferencia | 1 |

Al alcanzar un límite durante un episodio, este cierra como `PARTIAL` y conserva el motivo; `ABANDONED` se reserva para el abandono explícito o la recuperación de un contexto inválido. Un plan inicial que ya excede tres hipótesis o comprobaciones se rechaza antes de crear el episodio. No se marca dominio automáticamente.

No se abre dos veces el mismo `gap_id` dentro del episodio. No se usa un detector semántico: la política compara identificador de actividad y pregunta normalizada; `kind`, episodio, contexto y `parent_activity_id` solo aportan contexto y nunca convierten por sí solos una actividad en novedosa. Si falta una pregunta o un `kind` utilizable para una comparación textual distinta, la relación es `INDETERMINATE`.

## Cierre, abandono y persistencia

La carga de `localStorage` se normaliza después de inicializar la política y sus límites, por lo que un respaldo persistido con episodios puede reconciliarse durante el arranque. La reconciliación de la meta exige además que el `parent_attempt_id`, `parent_activity_id` y `parent_node_id` correspondan a un fallo de aprendizaje registrado en el ledger global; un episodio importado sin ese origen no puede conservar un estado activo ni `COMPLETED` y queda `PARTIAL` sin inventar evidencia o fecha. `popContext()` retira únicamente el contexto activo de la pila. Antes de hacerlo, copia el contexto cerrado a `RepairEpisode.context_history` y registra `REPAIR_CONTEXT_CLOSED`. Si se retira directamente el contexto raíz de un episodio todavía activo, también cierra el episodio con un resultado conservador y registra `REPAIR_EPISODE_CLOSED`. Si una importación deja un contexto activo apuntando a un episodio ya cerrado, `contextScreen()` retira ese contexto de forma auditable en vez de reabrir el episodio o volver a renderizarlo indefinidamente. Si la sesión indica `CONTEXT` pero ya no existe ningún contexto, cierra como `ABANDONED` los episodios que aún estuvieran abiertos y registra sus identificadores en `CONTEXT_RECOVERY`. El episodio permanece en `goal.repairEpisodes`, por lo que el respaldo, la recarga y una auditoría posterior conservan todo el detalle.

Al abandonar, el episodio guarda `status=ABANDONED`, `closed_at` y `close_reason`. El estado de sesión vuelve al snapshot del padre sin convertir la actividad hija en éxito del padre.

Un episodio `COMPLETED` requiere:

- evidencia independiente de reparación;
- resultado correcto e independiente del reintento padre;
- resultado correcto de una variante independiente con novedad confirmada.

Al importar y también al ejecutar `closeRepairEpisode(..., 'COMPLETED')`, la misma regla se vuelve a comprobar. Un `COMPLETED` sin las tres evidencias se degrada a `PARTIAL`; un estado activo que salte diagnóstico, reparación independiente o reintento padre se devuelve a la primera etapa obligatoria ausente. Esta reconciliación no crea evidencia ni fechas de creación: un episodio legacy sin `created_at` conserva `created_at=null`.

Si la variante no puede construirse con novedad demostrable, el episodio conserva una razón explícita y termina `PARTIAL`, no `COMPLETED`.

## Ejemplos

### Completo

```text
padre PARTIAL
→ hipótesis de operación inversa CONFIRMED
→ CHECK correcto
→ GUIDED correcto con ayuda
→ INDEPENDENT correcto sin ayuda
→ parent_retest correcto
→ transfer_check novedoso correcto
→ COMPLETED
```

El acierto guiado se conserva, pero no aporta independencia. La evidencia independiente procede de otra actividad.

### Parcial

```text
padre PARTIAL
→ reparación independiente correcta
→ parent_retest correcto
→ novedad de transferencia INDETERMINATE
→ PARTIAL
```

El episodio registra progreso y el éxito del padre, pero no afirma transferencia ni cierre completo.

### Fallido o limitado

```text
padre MISCONCEPTION
→ diagnóstico acotado
→ seis intentos de reparación sin evidencia independiente
→ PARTIAL (MAX_REPAIR_ACTIVITIES)
```

El historial permanece disponible y no se abre un bucle ilimitado.

## Compatibilidad y deuda pendiente

- Los datos legacy cargan con `repairEpisodes=[]` y conservan sus demás campos.
- Los eventos anteriores no se reinterpretan ni se convierten en episodios.
- `level` continúa como dato de compatibilidad y no decide dominio.
- La generación usa Gemini cuando está configurado, pero las pruebas de política usan planes y evaluaciones simulados.
- No se detectan paráfrasis semánticamente equivalentes. Dos preguntas con texto normalizado distinto y `kind` utilizable se clasifican como `DISTINCT`; la transferencia todavía exige declaración `CONFIRMED` y fundamento no vacío. Detectar paráfrasis equivalentes requiere una capacidad posterior.
- No se validan en estas pruebas respuestas reales de Gemini.
- La extracción modular sigue fuera de la ruta ejecutable principal.
