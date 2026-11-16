# Desempeño auténtico v1 (`authentic_performance_v1`): casos largos y validación de un mentor

Rama `feat/authentic-performance`, apilada sobre `feat/rich-content`. Este documento se escribió antes del código y es lo que revisa el dueño.

## Problema

Lo que separa «sabe» de «ejerce» no existe en la app. Todas las modalidades ocurren sobre un tema aislado y con una pregunta cada vez; los retos del mundo real son autoinformados y nadie externo valida nada. Esta función añade (A) un **caso largo** de varias decisiones que integra varios temas ya trabajados y se califica contra una rúbrica privada, y (B) un **paquete para un mentor** (persona real) y el registro de lo que esa persona dictaminó.

## Cómo funcionaba antes (estado verificado en el código)

- **Retos del mundo real** (`real_world_challenges_v1`): `/api/challenge/start` guarda en `placement_items` la parte pública (título, escenario, predicción pedida) y la privada (materiales, pasos, campos, criterio de éxito). `/commit` bloquea la predicción; `/report` recibe lo observado por campo y una reflexión y el juez (`judge_gemini`) valora coherencia. El resultado es **provisional**: `CHALLENGE_REPORT` no es `EVIDENCE`, `expertOutcome` lo ignora; solo una confirmación local posterior (`CONFIRMATION` con `confirms_type: CHALLENGE_REPORT`) alimenta la capa de transferencia. El informe es autodeclarado y no hay nadie que lo valide.
- **Panel experto** (`expert_panel_v1`): 7 capas por tema (comprensión, independencia, retención, discriminación, composición, transferencia, calibración), derivadas en el cliente de los eventos del ledger; caducidad de 60 días (`stale`). El perfil de experto (`expert_profile_v1`) tiene competencias y, para las de riesgo alto, un formulario libre `EXTERNAL_VALIDATION` (quién, fecha, nota) que no se verifica ni se puede anular y solo se muestra.
- **Evidencia**: `activityEvidence` → `prepareRecord` → `commitRecord`; `independentSuccesses` exige 2 aciertos independientes en preguntas distintas y, para aciertos calificados solo por el modelo (`evaluator_trust: model_single`), un **ancla local** (`open_answer_trust_v1`).

## A. Caso largo

### Contenido (servidor, `make_case`, `POST /api/case`)

Patrón de generadores: esquema → validador local estricto → `audit_content` (rol auditor) → un reintento con el motivo → error en español sin guardar nada.

- Entrada: `profile_id`, `goal_id`, `goal`, `node_ids` (3 a 5 temas). El servidor **relee el almacén del perfil** y exige que la meta exista y que cada tema tenga evidencia propia: al menos un `EVIDENCE` de aprendizaje (`evidence_role: learning`) con resultado distinto de `UNKNOWN`. No se usan temas sin enseñar ni sin intento.
- El modelo propone: título, situación realista, datos (4 a 10 pares etiqueta/valor, de los cuales al menos uno es irrelevante y la situación contiene una ambigüedad), de 3 a 5 etapas y, por etapa, su rúbrica y su respuesta modelo comentada.
- Etapas: `kind` ∈ `diagnose` (diagnosticar la causa), `measure` (decidir qué medir), `act` (proponer la acción), `justify` (justificar con el principio), `side_effect` (prever un efecto secundario). Estrictamente en ese orden (sin repetir), empiezan en `diagnose` y la última nunca es `diagnose`; entre 3 y 5.
- Contrato local: el caso integra ≥ 3 temas distintos de los pedidos (los `node_id` de los criterios de todas las etapas); ningún criterio referencia un tema ajeno; cada etapa tiene 2 a 4 criterios con id único; ≥ 1 dato marcado irrelevante y existente; la ambigüedad no vacía; tamaños acotados (situación ≤ 1200, enunciado de etapa 20–500, descripción de criterio 15–260, respuesta modelo 20–700, comentario ≤ 500, JSON total ≤ 24 000); el enunciado de una etapa no contiene la respuesta modelo (ni al revés).
- Fuentes propias: si hay fuentes cargadas que cubren los temas, el caso puede apoyarse en ellas con el mecanismo existente (`find_source_chunks`, `_sources_prompt`, `_validated_citations`); solo se conservan citas literales verificadas.
- Límites: **un caso activo por meta** (índice único parcial en SQLite); tope diario de generación por perfil `CASE_DAILY_LIMIT` (3 por defecto, como `/api/explore` con `EXPLORE_DAILY_LIMIT`; cada solicitud incluidos sus reintentos cuenta una vez); si ya hay un caso activo no se llama al modelo ni se consume el tope.

### Dónde vive lo privado

La rúbrica privada (criterios con su descripción observable y errores típicos, datos irrelevantes, ambigüedad, enunciados de etapas futuras y respuestas modelo) se guarda **solo en el servidor**, en `placement_items.private_json` (el mismo patrón que las claves de las preguntas de opción múltiple y que los pasos de un reto). Nunca entra en: la respuesta de `/api/case*`, `/api/profile/load`, `/api/profile/save` de vuelta, `/api/profile/export`, el respaldo ni el almacén del cliente. Lo público es: título, situación, datos (todos, sin marcar cuáles son irrelevantes), temas, número de etapas y el enunciado de la etapa actual y de las ya calificadas. Por criterio, el cliente solo recibe, **después** de calificar la etapa, una etiqueta corta (`label`, escrita para el aprendiz y que no puede contener la respuesta) con el veredicto y la frase de evidencia; la descripción y los errores típicos no salen nunca.

### Responder (estado reanudable)

- El aprendiz responde cada etapa con texto libre, sin pistas, sin ver la etapa siguiente ni la rúbrica. Una etapa se califica **una sola vez** y queda cerrada.
- El estado vive en el servidor (tabla `cases`, `state_json`); el cliente solo conserva un índice público (`goal.cases`) y el borrador de la etapa en curso (`goal.case_draft`). Se puede salir y volver otro día: `/api/case/state` devuelve el caso activo, sus etapas ya calificadas y el enunciado de la actual.
- `POST /api/case/stage`: `profile_id`, `goal_id`, `case_id`, `stage` (debe ser la siguiente sin calificar), `attempt_id`, `answer` (≤ 1500), `external_help` (booleano declarado: «usé apuntes, otra persona u otra IA»; no hay pistas dentro de la app). Idempotente: mismo `attempt_id` y misma respuesta devuelven lo guardado; otra respuesta con el mismo `attempt_id`, o una segunda respuesta para una etapa ya calificada, se rechaza.
- «No sé» exacto se resuelve localmente: etapa cerrada, todos los criterios «no evaluable», sin modelo y sin evidencia.
- Un caso termina (`FINISHED`) al calificarse su última etapa. Se puede **abandonar** (`/api/case/abandon`) para liberar la meta.

### Calificación (rol juez)

`grade_case_stage` usa `judge_gemini` (modelo calificador, `judge_model_v1`) contra la rúbrica **del servidor**: el cliente no envía referencia. La respuesta del aprendiz entra siempre por `_as_data`. Esquema: por criterio `{id, verdict, quote, comment}` + `feedback`.

- Veredicto por criterio: `cumplido`, `parcial`, `no`, `no_evaluable`.
- Contrato local: el juez debe devolver **exactamente** los criterios de la etapa, sin repetidos ni ajenos, con veredicto válido. Un `cumplido` o `parcial` exige una `quote` literal (≥ 6 caracteres) que aparezca en la respuesta del aprendiz (comparación sin acentos ni mayúsculas); si no aparece, el criterio se degrada localmente a `no_evaluable` («sin cita verificable no hay acierto»). Si **todos** los criterios son `no_evaluable` no se guarda nada y se pide reescribir con más detalle (reintentable).
- Juez caído (`JudgeUnavailable`, 429, red, salida incompleta): sin veredicto, nada guardado, reintentable con el mismo `attempt_id`. No hay reintento silencioso con el modelo barato.
- Tras calificar: retroalimentación por criterio. Al terminar el caso, **respuesta modelo comentada** por etapa (`POST /api/case/model`). Pedirla en un caso `ACTIVE` exige `confirm_close: true` y **cierra el caso** (`CLOSED_MODEL_VIEWED`): no se pueden calificar más etapas ni se reabre; no se puede reintentar ese mismo caso para ganar evidencia. En un caso `FINISHED` solo marca que se vio. La evidencia ya registrada no se retira.

### Evidencia (decisión conservadora)

Una etapa de caso es **desempeño evaluable de aplicación contextual e interpretación** sobre los temas que integra, y **solo** si se cumplen todas:

1. la etapa se calificó con veredicto válido (no «no sé», no todo `no_evaluable`);
2. no se declaró ayuda externa (`help_used = 0`);
3. para ese tema, sus criterios son todos evaluables (cualquier `no_evaluable` deja ese tema en `UNKNOWN`: sin evento).

Por cada tema (`node_id`) que tiene criterios en la etapa se emite **un** `EVIDENCE` (en el cliente, con `record`/`prepareRecord`, es decir la misma máquina de siempre):

| Campo | Valor |
|---|---|
| Identidad | `attempt_id` = `{attempt de la etapa}#{node_id}`, `activity_id` = `case:{case_id}:stage-{k}`, `node_id`; la repetición exacta se rechaza como duplicado |
| Rol / fase | rol nuevo `case_stage`, fase `CASE`; soporta independencia, **no** soporta transferencia |
| Dimensiones | `diagnose` → `interpretation`; `measure` → `contextual_application`; `act` → `contextual_application`; `justify` → `interpretation`; `side_effect` → `interpretation`. Nunca `transfer` (la novedad del caso no está verificada: el modelo la inventa) ni otras |
| Resultado por tema | `CORRECT` si todos sus criterios son `cumplido`; `MISCONCEPTION` si ≥ la mitad son `no`; `PARTIAL` en otro caso evaluable |
| Independencia | `CORRECT`, sin ayuda y contrato que la soporta (`activityEvidence`, sin cambios) |
| Confianza | `evaluator_trust: model_single` (versión `case-judge-v1`): **respeta el ancla local** (`open_answer_trust_v1`); un caso por sí solo nunca basta para «suficiente» |
| Un caso = una observación | todos los eventos del caso llevan `case_id`; `independentSuccesses` y la capa de independencia del panel cuentan **como máximo un acierto por `case_id`**: varias etapas de la misma situación no son «preguntas distintas» |

`UNKNOWN`, no evaluable, ayuda declarada o juez caído nunca generan evidencia positiva; con ayuda declarada tampoco se registra fallo (se muestra retroalimentación y nada más). Un fallo evaluable sí es contradicción, como en las demás modalidades calificadas por el juez. Perfil ajeno: no puede ver, calificar ni abandonar el caso (todas las consultas van por `profile_id`).

Reconciliación: si el cliente cae entre «el servidor calificó» y «el cliente registró», `/api/case/state` devuelve los resultados guardados y el cliente registra los que falten; la identidad del intento garantiza que no se duplica.

## B. Validación de un mentor

### Paquete (sin servidor externo)

`POST /api/mentor/package` (`profile_id`, `goal_id`, `source: {kind: 'case'|'challenge', id, …}`) devuelve un archivo **HTML autocontenido** (sin scripts ni recursos externos, con todo texto escapado en el servidor con `html.escape`), la misma información como **texto copiable**, el código de verificación y los criterios. El cliente solo lo descarga como `Blob` o lo copia; no lo inserta con `innerHTML`.

- Fuente `case`: solo casos `FINISHED`. Contiene título, situación, datos, enunciado de cada etapa y la **respuesta del aprendiz** (con la marca «declaró ayuda externa» cuando corresponde).
- Fuente `challenge`: un reto del mundo real con informe ya valorado. Contiene escenario, materiales, pasos, predicción bloqueada, lo observado y la reflexión. El servidor no guarda lo observado (solo su huella), así que el cliente lo reenvía y el servidor **recalcula la huella** del informe y la compara con la guardada: si no coincide, no hay paquete.
- Hoja de validación con **4 a 6 criterios observables** y la escala `0 No lo hace · 1 Con ayuda · 2 Solo · 3 Lo enseña a otros`. Para un caso: un criterio por tipo de etapa (3 a 5) más «Distingue datos relevantes de irrelevantes y declara lo ambiguo» (4 a 6). Para un reto: 4 criterios fijos (predijo antes de actuar, siguió los pasos con seguridad, registró datos coherentes, interpretó lo observado frente a su predicción). Criterios deterministas y locales, sin llamada al modelo.
- **No incluye** la rúbrica privada, los veredictos ni la retroalimentación del juez (para no condicionar al mentor) ni la respuesta modelo. **Decisión: no hay «hoja del mentor» con la respuesta modelo en v1.** Lo conservador es no incluirla: darle al mentor la clave convierte su opinión en una comparación con el modelo en vez de una observación, y obligaría a mostrarla antes de cerrar el caso. Si el dueño la quiere más adelante, debe ser un documento aparte y explícito.

### Código de verificación

Código corto de 10 caracteres (`XXXXX-XXXXX`, base 32 sin ambiguos) = `HMAC-SHA256(secreto local, JSON canónico de {versión, profile_id, goal_id, tipo, id de la fuente, huella del contenido})`. El secreto (32 bytes aleatorios) se genera en la primera necesidad y vive en la tabla `metadata` de la SQLite local; **nunca** sale en ninguna respuesta, exportación ni respaldo. La huella del contenido cubre situación, datos, enunciados y respuestas (y marca de ayuda). Cambia el código si cambia cualquier respuesta, enunciado o la meta. Al registrar, el servidor recalcula el código desde lo guardado (caso) o desde la huella guardada del informe (reto) y lo compara en tiempo constante.

### Registro

`POST /api/mentor/register`: el aprendiz captura lo que el mentor dictaminó — nombre (2–80), rol (2–80), fecha (`AAAA-MM-DD`, no futura ni anterior a la fecha en que existían las respuestas), nivel 0–3 **por cada criterio de la hoja** (exactamente los de la fuente), comentario (≤ 400) y el código. Si el código no coincide se rechaza: evita registrar una validación sobre respuestas cambiadas. El servidor devuelve el registro canónico; el cliente lo guarda como evento `MENTOR_ATTESTATION` en el ledger de la meta (`validate_store` lo valida: forma, niveles, temas existentes, ids únicos).

**Honestidad: esto NO impide autovalidarse.** Quien tiene el paquete y el servidor local puede inventar un mentor y usar el código de su propio paquete. Es una **atestación declarada**, no una certificación. Por eso se muestra siempre como «Validado por [nombre], [rol], [fecha] (declarado por ti)». Lo que sí evita el código: registrar una validación sobre respuestas que ya no son las del paquete, o sobre otro caso/perfil.

### Evidencia: capa propia y separada

`MENTOR_ATTESTATION` no es `EVIDENCE`: no entra en `coverage`, `learner`, `verified()`, el calendario, `independentSuccesses`, la racha ni el selector. No concede dominio, independencia ni cobertura de ningún nodo y no modifica las 7 capas ni la etiqueta del tema.

Capa que alimenta: el panel experto tiene 7 capas; la más cercana a «ejercer en el mundo real» es la 6 (transferencia), pero esa capa exige evidencia calificada independiente en variante novedosa y mezclar ahí una declaración de un tercero la contaminaría. Por eso la atestación alimenta **únicamente** una línea propia, `Desempeño auténtico (ejercer)`, que se muestra por tema debajo de las 7 capas y **no cuenta** en `met`, ni en la etiqueta, ni en `competencyState`. Estados:

| Estado | Significado |
|---|---|
| Sin validar | No hay atestación vigente para el tema |
| Validado por mentor (declarado) | Hay atestación no anulada con todos los niveles ≥ 2 (hace «solo» o «lo enseña») y no ha vencido |
| Revisado con observaciones (declarado) | Hay atestación pero algún nivel < 2 |
| Vencido | La atestación más reciente tiene más de `EXPERT_STALE_DAYS` (60) días contados desde `min(fecha declarada, fecha de registro)`; una fecha declarada futura o inventada hacia atrás no alarga la vigencia |

Aplica a los `node_id` de la fuente (todos los temas del caso o el tema del reto).

### Editar y anular con rastro

Nunca se borra ni se sobrescribe. Editar o anular agrega eventos `MENTOR_ATTESTATION_REVISION` (`attestation_id`, `action: edit|void`, nuevos valores o motivo, `at`); el estado vigente se deriva aplicando las revisiones en orden y el historial completo queda visible. Una atestación anulada no cuenta como vigente y se muestra «Anulada» con su motivo.

## C. Límites, compatibilidad y fuera de alcance

- Tamaños: JSON del caso ≤ 24 000 caracteres, respuestas ≤ 1500 por etapa, comentario del mentor ≤ 400, paquete HTML ≤ 120 000 caracteres.
- Un caso activo por meta; `CASE_DAILY_LIMIT` por perfil y día (en memoria, igual que `EXPLORE_DAILY_LIMIT`); cada calificación consume además la cuota global de `gemini()`.
- Compatibilidad: tabla nueva `cases` (`CREATE TABLE IF NOT EXISTS`) y entrada en `metadata` para el secreto; el contenido del caso reutiliza `placement_items`. Los eventos nuevos (`EVIDENCE` con `case_id`, `MENTOR_ATTESTATION*`) son JSON aditivo; el código anterior los ignora (`expertOutcome` devuelve `null` para tipos desconocidos), salvo que verá evidencia `CASE` como una fase desconocida. No se reescribe ningún evento anterior ni se inventa evidencia legacy. `restore` borra los casos del perfil (el respaldo público no lleva privados), igual que hace con los contratos de criterio.
- Rollback: quitar la rama; las tablas y eventos quedan inertes. Una atestación o evidencia de caso ya escrita no se retira sola.
- **Fuera de alcance**: proyecto de varias semanas; subir fotos o archivos al caso o al paquete; mentor con cuenta propia, firma o canal de retorno (el mentor no interactúa con la app); verificar la identidad del mentor; hoja del mentor con respuesta modelo; atestaciones por competencia del perfil de experto; calibración científica de los umbrales; probar con un modelo real y con navegador (todo se prueba con proveedor controlado y con funciones en Node).

## Pruebas

`python tests/authentic_performance_backend.test.py` y `node tests/authentic_performance.test.js` (registradas en `.github/workflows/ci.yml` y `docs/validation.md`). La lista clasificada de `tests/judge_model.test.py` incluye `make_case` (generación) y `grade_case_stage` (juez).
