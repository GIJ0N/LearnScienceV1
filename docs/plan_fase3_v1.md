# Plan de ejecución Fase 3 (`plan_fase3_v1`)

Autor del plan: Claude Opus 5.5 (planeador). Ejecutor previsto: Claude Sonnet 5.5.
Base: `main` en `eea9b0c` (QA ronda 4). Todas las anclas de este documento se verificaron
contra ese commit.

Cuatro entregas, **una rama y un PR por tarea**, en este orden:

| # | Tarea | Rama | Tamaño | Por qué en este orden |
|---|---|---|---|---|
| T1 | Informe de uso | `feat/usage-report` | M | Es lo que se necesita para leer las 4 semanas de uso real |
| T2 | Excluir preguntas reportadas del diagnóstico | `feat/reported-items` | S | Pequeña; hoy el diagnóstico ni siquiera tiene «Esto está mal» |
| T3 | Confirmación local de lo provisional | `feat/local-confirmation` | M | Toca la política de evidencia; necesita T1 para verse en el informe |
| T4 | Fotos en los retos | `feat/challenge-photos` | L | La más grande y con implicaciones de privacidad |

No empieces una tarea hasta que la anterior esté **fusionada en `main`** (el usuario hace el
squash and merge). Si el usuario pide otro orden, respétalo.

---

## 0. Protocolo de trabajo (aplica a todas las tareas)

### 0.1 Antes de tocar código

```bash
cd /root/LearnScienceV1
git fetch -q origin && git checkout -q main && git reset -q --hard origin/main
git checkout -q -b <rama-de-la-tarea>
python3 .claude/skills/learnscience-dev/scripts/run_ci.py --repo .   # debe salir N/N OK
```

Carga la skill `learnscience-dev` (y `learnscience-pedagogy` en T3). Anota el número N de
comandos de la CI: al final debe ser N + (pruebas nuevas registradas).

### 0.2 Orden dentro de cada tarea (no lo cambies)

1. Escribe el documento de diseño `docs/<nombre>_v1.md` copiando el bloque «Doc de diseño»
   de la tarea (puedes ajustar la redacción, no las reglas).
2. Servidor (`app_legacy.py`, `memory_store.py`).
3. Cliente (`app.js`).
4. Pruebas nuevas (archivos exactos indicados en cada tarea).
5. Registra cada prueba nueva en **dos** sitios:
   - `.github/workflows/ci.yml`: añade las líneas justo después de
     `          python tests/qa_round4_backend.test.py` (o de la última prueba que exista).
   - `docs/validation.md`: igual, en la lista de comandos, y añade al final una sección
     `## <Nombre> (`<rama>`)` con 3–6 líneas de qué cubre.
6. `python3 .claude/skills/learnscience-dev/scripts/sync_embedded_js.py --repo .`
   (obligatorio cada vez que cambies `app.js`: copia el JS dentro de `app_legacy.py`).
7. `python3 .claude/skills/learnscience-dev/scripts/run_ci.py --repo .` hasta que todo pase.
   Si falla `git diff --check`, casi siempre es una línea en blanco al final de un `.md`.
8. Commit, push, parche y verificación en clon limpio (0.4).
9. Informe al usuario en español (0.5).

### 0.3 Reglas que no se negocian

- **Evidencia:** el modelo propone, el código local decide. Lo que califica el modelo con
  rúbrica es *provisional*: nunca `EVIDENCE`, `expertOutcome` lo ignora, solo puede adelantar
  un repaso (`lapseReview`), nunca concederlo. Ayuda ≠ independencia. `UNKNOWN` nunca es
  positivo. Solo T3 cambia esto, y exactamente como se describe ahí.
- **Claves:** nunca leas, imprimas, guardes ni pidas `GEMINI_API_KEY` ni `ANTHROPIC_API_KEY`.
- **Red:** el sandbox no llega a Gemini. No intentes evitar el bloqueo. Las pruebas usan mocks.
- **No pidas permisos de carpetas** del equipo del usuario ni intentes saltarte una negativa.
- **No uses `pkill -f app_legacy.py`** (mata la propia shell). Para el servidor de E2E usa el
  archivo `stop` como en `/tmp/e2e/server.py` si existe; si no existe, omite la E2E y dilo.
- Si un ancla de este plan **no aparece** con `grep`, busca el nombre de la función; si
  cambió de forma, adapta la inserción manteniendo la intención. Si lo que cambió es una regla
  de evidencia, **para y pregunta** al usuario; no improvises política.
- No añadas dependencias. Python estándar y JS sin librerías.
- Toda la interfaz en español. Ningún código interno visible (usa `humanLabel`; añade
  entradas a `HUMAN_LABELS` si hace falta).

### 0.4 Cierre de cada tarea

```bash
git add -A
git commit -q -F - <<'EOF'
<mensaje indicado en la tarea>

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: <la URL de sesión que indique el recordatorio de atribución vigente>
EOF
git push -q -u origin <rama>
mkdir -p /home/claude/dist && git format-patch -1 --stdout > /home/claude/dist/<rama-sin-barras>.patch
rm -rf /tmp/vclone && git clone -q https://github.com/GIJ0N/LearnScienceV1 /tmp/vclone
cd /tmp/vclone && git am /home/claude/dist/<rama-sin-barras>.patch && \
  python3 .claude/skills/learnscience-dev/scripts/run_ci.py --repo . | tail -1
```

Usa siempre las líneas de atribución que indique el recordatorio de sistema vigente (pueden
cambiar de modelo); las de arriba son un ejemplo.

### 0.5 Informe al usuario (plantilla)

- Una frase: qué quedó hecho y en qué rama, con el enlace
  `https://github.com/GIJ0N/LearnScienceV1/pull/new/<rama>`.
- CI: `N/N`, también sobre clon limpio. Si hubo E2E en Chromium, dilo; recuerda que **no** se
  probó con Gemini real.
- Qué cuenta y qué no cuenta como evidencia (una o dos viñetas).
- Límites conocidos.
- Qué debe probar el usuario (3–5 viñetas concretas).
- Envía el parche con SendUserFile.

### 0.6 Al terminar las cuatro tareas

Actualiza el documento del proyecto `claude/roadmap-experto.md` (herramienta Projects:
`project_read` y luego `project_write` con el contenido completo) marcando T1–T4 hechas.

---

## T1. Informe de uso (`usage_report_v1`)

### Objetivo

Una pantalla «Informe» que resume, para la meta activa, si se está aprendiendo de verdad:
retención por intervalo, calibración, independencia, qué modalidades se usan y con qué
resultado, y repasos pendientes. Más un botón para descargar el informe en JSON (para
pegárselo a Claude y analizarlo). **Solo lectura**: no crea ni modifica evidencia.

### Doc de diseño → `docs/usage_report_v1.md`

```markdown
# Informe de uso v1 (`usage_report_v1`)

Objetivo: leer el uso real (Fase 3) sin revisar eventos a mano.

## Reglas
- Solo lectura. No crea, borra ni reinterpreta evidencia.
- Se calcula en el cliente a partir de `goal.events`, `goal.reviews` y `goal.flagged_content`.
- Lo provisional (Beto, retos, corrección escrita) se muestra aparte y marcado «provisional».
- Retención: solo repasos (`EVIDENCE` con `phase:'REVIEW'`) sin ayuda, agrupados por el
  tiempo transcurrido desde la última exposición.
- Calibración: reutiliza `calibrationSummary` (misma lógica que «Nivel experto»).
- La descarga JSON contiene solo los agregados, nunca respuestas escritas ni la meta completa
  de otros perfiles.

## Límites
- Sin tiempo de sesión (la app no lo mide).
- Con pocos datos los porcentajes no significan nada: se muestran solo con n ≥ 3.
```

### Cliente (`app.js`)

1. **Función pura** `usageReport(goal, now=Date.now())`. Insértala justo antes de
   `function expertView(){`. Debe devolver exactamente esta forma:

```js
{
  version:'usage_report_v1',
  generated_at: now,
  goal: String(goal.goal||''),
  period:{first:<ts|null>, last:<ts|null>, active_days:<int>, events_last_7_days:<int>},
  modalities:[ {id, label, n, correct, provisional:bool} ],   // ver tabla abajo, en ese orden; omite n===0
  retention:[ {id, label, n, correct, rate:<0..1|null>} ],     // 5 franjas, siempre las 5
  retention_with_help:<int>,                                    // repasos con help_used>0 (excluidos)
  calibration: calibrationSummary(goal),                        // tal cual
  independence:{learning:<int>, with_help:<int>, rate_with_help:<0..1|null>},
  expert:{ <label>: <número de temas> },                        // de expertPanel(goal).map(r=>r.label)
  reviews:{due:<int>, overdue_3d:<int>, total:<int>},
  content_flags:<int>
}
```

Detalles exactos:

- Marca temporal de un evento: `const ts=e=>Number(e?.timestamp??e?.at)||null`.
- `active_days`: número de fechas distintas `new Date(ts).toISOString().slice(0,10)`.
- `events_last_7_days`: eventos con `ts >= now-7*DAY` (`DAY` ya existe).
- `rate` = `correct/n` si `n>=3`, si no `null`.
- **Modalidades** (`id` → filtro → `correct` si…):

| id | label | filtro | correcto si | provisional |
|---|---|---|---|---|
| `learning` | Práctica de la ruta | `type==='EVIDENCE' && evidence_role==='learning' && phase!=='REVIEW'` | `resultStatus(e.result??e.status)==='CORRECT'` | no |
| `review` | Repasos | `type==='EVIDENCE' && phase==='REVIEW'` | igual | no |
| `step_check` | Lección por pasos | `type==='STEP_CHECK'` | `status==='CORRECT'` | no |
| `discrimination` | Distinguir ideas | `type==='DISCRIMINATION' && variant!=='error_hunt'` | `status==='CORRECT'` | no |
| `error_hunt` | Encuentra el error | `type==='DISCRIMINATION' && variant==='error_hunt'` | `status==='CORRECT'` | no |
| `composition` | Composición | `type==='COMPOSITION'` | `status==='CORRECT'` | no |
| `confirmation` | Confirmación local | `type==='CONFIRMATION'` (existirá tras T3; ponlo ya) | `status==='CORRECT'` | no |
| `error_fix` | Corrección escrita | `type==='ERROR_FIX'` | `status==='CORRECT'` | **sí** |
| `beto` | Enséñale a Beto | `type==='BETO_SESSION'` | `status==='CORRECT'` | **sí** |
| `challenge` | Retos del mundo real | `type==='CHALLENGE_REPORT'` | `status==='CORRECT'` | **sí** |

- **Retención** (solo `EVIDENCE` con `phase==='REVIEW'` y `(Number(e.help_used)||0)===0`;
  franja por `Number(e.delay_ms_from_last_exposure)||0`):

| id | label | rango |
|---|---|---|
| `lt1d` | Menos de 1 día | `< 1*DAY` |
| `d1_3` | 1 a 3 días | `>=1*DAY && <3*DAY` |
| `d3_7` | 3 a 7 días | `>=3*DAY && <7*DAY` |
| `d7_21` | 1 a 3 semanas | `>=7*DAY && <21*DAY` |
| `gt21d` | Más de 3 semanas | `>=21*DAY` |

- `independence.learning`: `EVIDENCE` con `evidence_role==='learning'`; `with_help`: de esos,
  `(Number(e.help_used)||0)>0`; `rate_with_help` con la misma regla n≥3.
- `reviews`: `goal.reviews||[]`; `due` = `r.due<=now`; `overdue_3d` = `r.due<=now-3*DAY`.
- `content_flags` = `(goal.flagged_content||[]).length`.
- Protege todo con `Array.isArray(...)?...:[]`; un objetivo vacío devuelve ceros, nunca lanza.

2. **Vista** `function reportView(){...}` justo después de `usageReport`. Estructura:
   - Si `!g()`: `page='home';render();return` (igual que `expertView`).
   - `app.replaceChildren();nav();`
   - `block('Informe de uso · '+goal.goal)` con una frase: «Resumen de lo registrado en esta
     meta. Solo lectura: no cambia tu progreso.»
   - Bloque «Actividad»: días activos, eventos en los últimos 7 días, primera y última fecha
     (`new Date(ts).toLocaleDateString('es-MX')`).
   - Bloque «Retención: ¿recuerdas con el tiempo?»: una línea por franja
     `«1 a 3 días: 4 de 5 (80 %)»`; si `n<3` → `«1 a 3 días: 2 respuestas (aún pocas)»`; si
     `n===0` → `«1 a 3 días: sin repasos todavía»`. Debajo: `«Repasos con ayuda (no cuentan): N»`.
   - Bloque «Calibración»: reutiliza el mismo texto que `expertView` usa con `cal`
     (`Coincidió en X de Y respuestas decisivas (Z %)` o el mensaje de «aún no hay»).
   - Bloque «Independencia»: `«Respuestas con ayuda: X de Y»`.
   - Bloque «Modalidades»: una línea por modalidad con `n>0`:
     `«Encuentra el error: 3 de 4 correctas»`; si `provisional` añade
     `« · provisional, no cuenta como dominio»`.
   - Bloque «Nivel por tema»: `«Competente: 2 temas · Base: 3 temas»` (usa las etiquetas tal cual).
   - Bloque «Pendiente»: repasos vencidos y vencidos hace más de 3 días; contenidos reportados.
   - Botones: `B('Descargar informe (JSON)',()=>downloadReport(goal))` y
     `B('Copiar resumen',()=>copyReport(goal),true)`.
3. **Descarga** `function downloadReport(goal)`:
   `let blob=new Blob([JSON.stringify(usageReport(goal),null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='informe-'+(goal.id||'meta')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)`
   envuelto en `try{...}catch(e){note('No pude descargar el informe en este navegador.',true)}`.
4. **Copiar** `async function copyReport(goal)`: texto plano de 10–15 líneas con lo mismo que
   la vista; `await navigator.clipboard.writeText(text)` dentro de try/catch; si falla,
   `note('No pude copiar; usa «Descargar informe».',true)`; si funciona `note('Resumen copiado.')`.
5. **Navegación**: en `function nav()`, justo después del `add('Nivel experto','expert',...)`,
   añade `add('Informe','report',()=>{page='report';render()})` (dentro del mismo `if(g())`).
6. **Ruteo**: en `function render()`, después de `else if(page==='expert')expertView();` añade
   `else if(page==='report')reportView();`.
7. **Recarga**: añade `'report'` a `const RESTORABLE_PAGES=new Set([...])`.
8. **Exporta** para pruebas: al inicio de `module.exports={` añade `usageReport,`.

### Pruebas

`tests/usage_report.test.js` (mismo arranque que `tests/qa_round4.test.js`: mocks de
`document`, `localStorage`, `require('../app.js')`). Casos:

1. Meta vacía (`{id:'g',goal:'M',nodes:[],events:[],reviews:[]}`) → `period.active_days===0`,
   todas las franjas con `n===0` y `rate===null`, `modalities` vacío, no lanza.
2. Fixture con `DAY=86400000`, `now=Date.UTC(2026,10,10)`:
   - 4 `EVIDENCE` REVIEW sin ayuda con delays 2d, 2d, 2d, 10d: 3 correctas en 2d, la de 10d
     `MISCONCEPTION` → franja `d1_3` `{n:3,correct:3,rate:1}`, `d7_21` `{n:1,rate:null}`.
   - 1 REVIEW con `help_used:1` → `retention_with_help===1` y no aparece en franjas.
   - 2 `DISCRIMINATION` (una con `variant:'error_hunt'`), 1 `BETO_SESSION` CORRECT,
     1 `CHALLENGE_REPORT` PARTIAL → modalidades `discrimination`, `error_hunt`, `beto`
     (`provisional:true`, `correct:1`), `challenge` (`correct:0`).
   - Eventos en 3 fechas distintas → `active_days===3`; `events_last_7_days` correcto.
   - `reviews`: uno vencido hace 5 días y otro futuro → `due===1`, `overdue_3d===1`.
   - `flagged_content` con 2 → `content_flags===2`.
3. `usageReport` **no muta** la meta: `JSON.stringify(goal)` antes y después es igual.
4. El JSON no contiene respuestas: con un evento que tenga `answer:'SECRETO'`,
   `JSON.stringify(usageReport(goal)).includes('SECRETO')===false`.
5. Fuente: `RESTORABLE_PAGES.has('report')`, el código contiene
   `else if(page==='report')reportView();` y `add('Informe','report'`.

Registra `node tests/usage_report.test.js`.

### Aceptación

- CI verde; «Informe» aparece en la barra con una meta abierta y sobrevive a la recarga.
- E2E opcional: abre «Informe» tras la práctica del harness y comprueba que aparece
  «Retención» sin errores de consola.

Commit: `Agrega informe de uso: retención, calibración, independencia y modalidades`

---

## T2. Excluir preguntas reportadas del diagnóstico (`reported_items_v1`)

### Situación actual (verificada)

- `renderPlacementItem(b,goal,item)` se llama **sin opciones** en el diagnóstico; su ruta por
  defecto es `'/api/placement/answer'`. **No tiene botón «Esto está mal».**
- `report_content` (`/api/content/report`) acepta `kind` en `REPORT_KINDS`, que ya incluye
  `'placement'`, y solo guarda el reporte.
- `_answer_choice_item(data,version)` califica sin mirar reportes.
- `make_placement_items` ya acepta `avoid_prompts` del cliente.

### Doc de diseño → `docs/reported_items_v1.md`

```markdown
# Preguntas reportadas v1 (`reported_items_v1`)

- En el diagnóstico, «Esto está mal» marca la pregunta como excluida en el servidor.
- Una pregunta excluida no se puede responder (`ITEM_EXCLUDED`), salvo repetir exactamente un
  intento ya registrado antes del reporte (idempotencia).
- La pregunta reportada no crea evidencia ni la quita; el diagnóstico pide otra pregunta para
  ese tema.
- El texto reportado se añade a las preguntas que el generador debe evitar.
- Solo se excluyen preguntas del propio perfil y meta, y solo de diagnóstico (`placement-`).
```

### Servidor

1. `memory_store.py`
   - En el esquema, justo después del `CREATE TABLE IF NOT EXISTS content_reports(...)`
     (línea ~493), crea con el mismo estilo:
     ```sql
     CREATE TABLE IF NOT EXISTS excluded_items(
       profile_id TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
       item_id TEXT NOT NULL,
       reason TEXT NOT NULL DEFAULT '',
       created_at INTEGER NOT NULL,
       PRIMARY KEY(profile_id,item_id)
     );
     ```
   - Métodos en `DurableMemory`, junto a `save_content_report`:
     - `exclude_item(self, profile_id, item_id, reason='')` → `INSERT OR IGNORE`, devuelve `True`.
     - `is_item_excluded(self, profile_id, item_id)` → `bool`.
   - Si existe una lista de tablas para exportar/borrar perfil, añade `excluded_items` igual que
     `content_reports` (búscala con `grep -n content_reports memory_store.py`).
2. `app_legacy.py`
   - `report_content`: lee `item_id=compact(data.get('item_id'),100)`. Si `kind=='placement'` y
     `item_id.startswith('placement-')`: `stored=memory().load_placement_item(profile_id,item_id)`;
     si `stored and stored['goal_id']==goal_id` → `memory().exclude_item(profile_id,item_id,
     compact(data.get('note'),400))` y `excluded=True`. Devuelve `{'saved':True,'excluded':excluded}`.
   - `_answer_choice_item`: justo **después** de validar `stored` (la línea que lanza «La pregunta
     no existe para esta meta…») añade:
     ```python
     if memory().is_item_excluded(profile_id,item_id) and not memory().load_choice_answer(profile_id,goal_id,item_id,attempt_id):
         raise ValueError('ITEM_EXCLUDED: esta pregunta fue reportada y ya no cuenta.')
     ```
   - `make_placement_items`: después de construir `avoid=[...]` añade los extractos reportados:
     `avoid+=[compact(r['excerpt'],200) for r in memory().load_content_reports(profile_id,goal_id) if r['kind']=='placement' and r['excerpt']][-10:]`
     (usa las variables de perfil y meta que ya existan en esa función; si no existe
     `profile_id` ahí, omite este punto y anótalo en el informe).

### Cliente

1. `reportButton(box,goal,nodeId,kind,excerpt,onSent)`: añade un 7.º parámetro `itemId=''` y
   en el cuerpo de `api('/api/content/report',{...})` añade `item_id:itemId`.
2. `renderPlacementItem(box,goal,item,opts={})`: si `!opts.route` (es el diagnóstico), añade al
   final del cuadro:
   ```js
   reportButton(box,goal,item.node_id,'placement',item.prompt,()=>{let p=goal.placement,it=p?.items?.[item.item_id];if(it){it.used=true;it.reported=true}save();render()},item.item_id)
   ```
   Al regenerar, el diagnóstico busca otra pregunta sin usar para ese tema o pide una nueva (ya
   lo hace `pick()`/`fetchPlacementItems`).
3. Si la respuesta de `/api/placement/answer` trae el error `ITEM_EXCLUDED`, marca la pregunta
   `used=true,reported=true`, `note('Esa pregunta fue reportada; te muestro otra.')` y `render()`.
   Busca dónde `renderPlacementItem` maneja errores del `api(...)` y añade esa rama.
4. `placementSummary`: no cuentes preguntas con `reported:true` como respondidas (búscala con
   `grep -o "function placementSummary.\{0,600\}" app.js`; si no las cuenta ya, no cambies nada).

### Pruebas

`tests/reported_items_backend.test.py` (estructura de `tests/qa_round4_backend.test.py`, con
`DurableMemory` temporal, `patch.object(app,'memory',...)`, `CONTENT_VERIFY=False`):

1. Crear una pregunta de diagnóstico con `make_placement_items` (mock de `gemini` con un ítem
   válido; copia el ítem de `tests/placement_backend.test.py`).
2. Reportarla con `report_content({... 'kind':'placement','item_id':id ...})` →
   `{'saved':True,'excluded':True}`.
3. Responder con un `attempt_id` nuevo → `ValueError` con `ITEM_EXCLUDED`.
4. Un intento registrado **antes** del reporte se puede repetir igual (idempotencia).
5. Reportar un `item_id` de otra meta → `excluded:False` y la pregunta sigue respondiendo.
6. Reportar con `kind:'lesson'` + `item_id` → no excluye nada.
7. La siguiente llamada a `make_placement_items` incluye el extracto reportado en el prompt
   (`self.assertIn(extracto, g.call_args[0][0])`).
8. Borrar el perfil elimina las exclusiones (si hay método de borrado de perfil).

`tests/reported_items.test.js`: fuente contiene `'placement',item.prompt` y `item_id:itemId`;
`HUMAN_LABELS` no se toca. Registra ambas pruebas.

Commit: `Excluye del diagnóstico las preguntas reportadas`

---

## T3. Confirmación local de lo provisional (`local_confirmation_v1`)

### Idea

Beto, los retos y la corrección escrita los valora el modelo, así que son provisionales. Una
**confirmación** es una pregunta nueva de opción múltiple **con clave privada** (como
Distinguir ideas), en una situación distinta, que se ofrece después de un resultado
provisional positivo. Si se acierta sin ayuda, cuenta como evidencia firme en una capa
concreta del panel experto. Así lo provisional nunca cuenta solo, pero puede abrir la puerta a
evidencia firme.

### Doc de diseño → `docs/local_confirmation_v1.md`

```markdown
# Confirmación local v1 (`local_confirmation_v1`)

## Cuándo se ofrece
- Tras un resultado provisional positivo: `BETO_SESSION` CORRECT, `CHALLENGE_REPORT` CORRECT o
  PARTIAL, `ERROR_FIX` CORRECT.
- Una confirmación por cada intento provisional (`confirms_attempt_id` único).

## Qué es
- Una pregunta de opción múltiple con clave privada para el mismo tema, en una situación
  nueva, generada por el modelo y auditada (`audit_content`, falla abierta).
- Calificación local (`_answer_choice_item`), idempotente, sin proveedor.

## Qué cuenta
- Evento `CONFIRMATION` con `confirms_type` y `confirms_attempt_id`. `expertOutcome` lo cuenta
  (CORRECT → acierto, MISCONCEPTION → fallo), así entra en la calibración.
- Capa del panel:
  - `confirms_type==='CHALLENGE_REPORT'` → **transferencia**: met si hay una confirmación
    CORRECT cuyo reto de origen fue CORRECT; partial si la confirmación es CORRECT y el reto
    fue PARTIAL.
  - `BETO_SESSION` o `ERROR_FIX` → **comprensión**: una confirmación CORRECT cuenta como una
    comprobación de comprensión correcta.
- MISCONCEPTION → `lapseReview` del tema. UNKNOWN («No lo sé») no cuenta.
- Nunca se crea un `EVIDENCE` nuevo; el provisional sigue siendo provisional.
```

### Servidor (`app_legacy.py`)

1. Constante `CONF_VERSION='local_confirmation_v1'` junto a `BETO_VERSION`.
2. Prefijo: en `_build_choice_item`, en el diccionario
   `{PLACEMENT_VERSION:'placement-',STEP_VERSION:'step-',DISC_VERSION:'disc-',COMP_VERSION:'comp-',ERR_VERSION:'err-'}`
   añade `CONF_VERSION:'conf-'`.
3. `CONF_SOURCES={'BETO_SESSION','CHALLENGE_REPORT','ERROR_FIX'}`.
4. `def make_confirmation_item(data):` copia la estructura de `make_discrimination_items`
   (búscala con `grep -n "def make_discrimination_items" -A60 app_legacy.py`) con estas
   diferencias:
   - Entrada: `profile_id, goal_id, goal, node{id,name,outcome}, source_type∈CONF_SOURCES`.
     Falta algo → `ValueError('Falta perfil, meta, tema u origen de la confirmación.')`.
   - Un solo ítem. Prompt: «Crea UNA pregunta de opción múltiple que confirme que la persona
     domina «{name}» en una situación NUEVA y distinta de la práctica anterior (otro contexto,
     otros números). Debe exigir aplicar la idea, no recordar una definición.» + las mismas reglas
     de calidad (`CHOICE_QUALITY_RULES`) y esquema que usa discriminación.
   - Valida con `_build_choice_item(item,{node_id},CONF_VERSION)`; audita con `audit_content`
     como discriminación; si se descarta, **un reintento** con el motivo (patrón de
     `challenge_start`). Si falla dos veces: `ValueError(motivo+'; no se guardó nada. Reintenta.')`.
   - Guarda con `memory().save_placement_items(profile_id,goal_id,[(public,private)])` y añade
     `public['source_type']=source_type` antes de guardar.
   - Devuelve `{'items':[public],'content_check':{...}}` (misma forma que discriminación).
5. `def answer_confirmation_item(data):return _answer_choice_item(data,CONF_VERSION)`.
6. Rutas en `ROUTES`: `'/api/practice/confirm':make_confirmation_item,
   '/api/practice/confirm/answer':answer_confirmation_item,`.

### Cliente (`app.js`)

1. **Arranque** `startMixed(goal,kind)`: añade una rama `kind==='confirm'` que recibe un
   tercer argumento `src={node_id,source_type,source_attempt_id}`:
   ```js
   if(kind==='confirm'){if(!src||!src.node_id||!src.source_attempt_id)throw policyError('MIXED_UNAVAILABLE','Falta el origen de la confirmación.');if((goal.events||[]).some(e=>e&&e.type==='CONFIRMATION'&&e.confirms_attempt_id===src.source_attempt_id))throw policyError('ALREADY_CONFIRMED','Esa práctica ya tiene confirmación.');goal.mixed={version:MIXED_VERSION,kind,id:newId('mixed'),node_ids:[src.node_id],items:null,index:0,results:[],status:'active',source_type:src.source_type,source_attempt_id:src.source_attempt_id};save();return goal.mixed}
   ```
   La firma queda `function startMixed(goal,kind='discrimination',src=null)`.
2. **Generación** en `fetchMixedItems`: añade `conf=m.kind==='confirm'`; ruta
   `conf?'/api/practice/confirm'`; cuerpo para conf:
   `{profile_id:…,goal_id:goal.id,goal:goal.goal,node:nodes[0],source_type:m.source_type}`;
   mínimo de ítems 1 (como `comp||hunt`).
3. **Ruta de respuesta** en la llamada de `mixedSession` a `renderPlacementItem`:
   `m.kind==='confirm'?'/api/practice/confirm/answer'` antes del último caso.
4. **Aplicación** en `applyDiscrimination`: `evType` = `'CONFIRMATION'` si `m.kind==='confirm'`;
   incluye `'CONFIRMATION'` en la comprobación de duplicados por `attempt_id`; añade al evento
   `confirms_type:m.source_type,confirms_attempt_id:m.source_attempt_id` cuando sea confirmación;
   si `status==='MISCONCEPTION'` llama `lapseReview(goal,item.node_id,at)` (si ya lo hace para
   todos los casos, no lo dupliques).
5. **Política**:
   - `expertOutcome`: cambia `['STEP_CHECK','DISCRIMINATION','COMPOSITION']` por
     `['STEP_CHECK','DISCRIMINATION','COMPOSITION','CONFIRMATION']`.
   - `expertLayers`:
     - comprensión: `comp` pasa a incluir también
       `ev.filter(e=>e.type==='CONFIRMATION'&&['BETO_SESSION','ERROR_FIX'].includes(e.confirms_type)&&e.status!=='UNKNOWN')`
       tratando `status==='CORRECT'` como acierto.
     - transferencia: además de `novel`, calcula
       `conf=ev.filter(e=>e.type==='CONFIRMATION'&&e.confirms_type==='CHALLENGE_REPORT'&&e.status==='CORRECT')` y
       `src=id2=>ev.find(e=>e.type==='CHALLENGE_REPORT'&&e.attempt_id===id2)`;
       met si alguna `conf` tiene `src(c.confirms_attempt_id)?.status==='CORRECT'`; partial si
       alguna tiene origen `PARTIAL`. Combínalo con la regla actual por OR
       (`met = metActual || metConf`, `partial = partialActual || partialConf`).
6. **Botón en las pantallas de cierre** (solo si el resultado es positivo y no existe ya
   confirmación para ese intento):
   - Beto (`betoSession`, pantalla final con estado CORRECTED): `B('Confirmar con una pregunta
     nueva',()=>{let at=<attempt_id del BETO_SESSION recién creado>;endBeto(goal);startMixed(goal,'confirm',{node_id,source_type:'BETO_SESSION',source_attempt_id:at});page='session';render()})`.
     Obtén el `attempt_id` buscando en `goal.events` el último `BETO_SESSION` de ese `node_id`.
   - Reto (`challengeSession`, pantalla `done` con `sm.status` SUPPORTED o PARTIAL): igual con
     `source_type:'CHALLENGE_REPORT'` y el `attempt_id` del último `CHALLENGE_REPORT`. Usa
     `endChallenge`… pero OJO: `endChallenge` llama `render()`; en su lugar haz
     `goal.challenge=null;startMixed(...);page='session';save();render()`.
   - Corrección escrita (`errorFixPanel`, cuando la valoración es CORRECT): botón que, al
     terminar la práctica de Encuentra el error, arranca la confirmación con
     `source_type:'ERROR_FIX'`. Si `goal.mixed` sigue activo, muestra el botón solo en la
     pantalla «Práctica terminada» y usa el último `ERROR_FIX` CORRECT sin confirmar.
   - Texto bajo el botón: «Es una pregunta con respuesta comprobada localmente: si aciertas sin
     ayuda, cuenta para tu nivel.»
7. `HUMAN_LABELS`: `CONFIRMATION:'Confirmación local'`.
8. Exporta `startMixed` si no está exportado.

### Pruebas

`tests/local_confirmation_backend.test.py`:
1. Genera con mock (ítem válido) → `item_id` empieza por `conf-`, `source_type` guardado.
2. `source_type` inválido o sin nodo → `ValueError`.
3. Primer intento inválido (por ejemplo sin `correct_option_id`) y segundo válido → 2 llamadas,
   la segunda contiene «Corrección».
4. Respuesta correcta/incorrecta/`None` → CORRECT/MISCONCEPTION/UNKNOWN; idempotente; una
   pregunta `disc-` no se puede responder por la ruta de confirmación (versión distinta).
5. Rutas registradas.

`tests/local_confirmation.test.js` (con `setStoreForTests`, como `tests/teach_beto.test.js`):
1. `startMixed(goal,'confirm',src)` crea `goal.mixed.kind==='confirm'`; sin `src` lanza; con
   confirmación ya existente lanza `ALREADY_CONFIRMED`.
2. `applyDiscrimination` con resultado CORRECT crea `CONFIRMATION` con `confirms_type` y
   `confirms_attempt_id`, nunca `EVIDENCE`.
3. `expertOutcome({type:'CONFIRMATION',status:'CORRECT'})===true`; MISCONCEPTION → `false`;
   UNKNOWN → `null`.
4. `expertLayers`: reto CORRECT + confirmación CORRECT → `transfer==='met'`; reto PARTIAL +
   confirmación CORRECT → `partial`; confirmación sin reto de origen → no `met`; solo reto
   CORRECT sin confirmación → la capa de transferencia **no cambia** respecto a antes.
5. Beto CORRECT + confirmación CORRECT → `comprehension==='met'`.
6. MISCONCEPTION adelanta el repaso (`reviews[0].due` baja).

Actualiza `docs/teach_beto_v1.md`, `docs/real_world_challenges_v1.md` y `docs/error_hunt_v1.md`
con una línea: «Un resultado positivo puede confirmarse con una pregunta local
(`local_confirmation_v1`).»

Commit: `Agrega confirmación local: lo provisional puede volverse evidencia con una pregunta de clave privada`

---

## T4. Fotos en los retos (`challenge_photos_v1`)

### Decisiones tomadas

- Hasta **2 fotos** por informe, opcionales.
- Se redimensionan en el navegador (lado mayor 1024 px, JPEG calidad 0.8) y se envían en el
  cuerpo de `/api/challenge/report` en base64.
- **No se guardan**: ni en SQLite, ni en `localStorage`, ni en el estado de la meta. Solo se
  guarda su huella `sha256` y el número de fotos en el resultado.
- Se envían al modelo en la misma llamada de valoración (no hay llamada extra).
- Una foto **no verifica** nada: la valoración sigue siendo provisional.
- Aviso visible: «Las fotos se envían a Gemini (Google) solo para valorar este informe y no se
  guardan. No incluyas personas ni datos personales.»

### Doc de diseño

Añade a `docs/real_world_challenges_v1.md` una sección `## Fotos (challenge_photos_v1)` con
las decisiones de arriba y estos límites: máximo 2 fotos, ≤ 1 000 000 bytes cada una ya
decodificada, tipos `image/jpeg`, `image/png`, `image/webp`; la foto entra en la huella del
informe (cambiar la foto con el mismo `attempt_id` es conflicto).

### Servidor (`app_legacy.py`)

1. `gemini(prompt, schema, max_tokens=2000, images=None)`: pasa `images` a
   `_gemini_call` y `_anthropic_call`.
2. `_gemini_call(prompt, schema, max_tokens=2000, images=None)`: en `payload['contents']`,
   `parts=[{'inline_data':{'mime_type':m,'data':d}} for m,d in (images or [])]+[{'text':prompt}]`.
3. `_anthropic_call(prompt, schema, max_tokens=2000, images=None)`: si hay imágenes,
   `content=[{'type':'image','source':{'type':'base64','media_type':m,'data':d}} for m,d in images]+[{'type':'text','text':prompt}]`;
   si no, deja `content=prompt` como hoy.
4. Constantes: `CHAL_MAX_PHOTOS=2`, `CHAL_PHOTO_MAX_BYTES=1_000_000`,
   `CHAL_PHOTO_TYPES=('image/jpeg','image/png','image/webp')`.
5. `def _challenge_photos(raw):` valida y devuelve `[(mime,b64,sha256hex)]`:
   - `raw` ausente o `[]` → `[]`. No lista o más de 2 → `ValueError('Puedes adjuntar hasta 2 fotos.')`.
   - Cada una: dict con `mime` en tipos y `data` str; `base64.b64decode(data,validate=True)`
     (importa `base64` si no está); tamaño decodificado ≤ máximo; si no →
     `ValueError('Una foto no es válida o pesa demasiado (máximo 1 MB).')`.
   - Comprueba la firma del archivo: JPEG empieza por `b'\xff\xd8'`, PNG por
     `b'\x89PNG'`, WebP contiene `b'WEBP'` en los bytes 8–12. Si no coincide → mismo error.
6. `challenge_report`:
   - `photos=_challenge_photos(data.get('photos'))` **antes** de las puertas de texto.
   - En el `json.dumps` de la huella añade `'photos':[h for _,_,h in photos]`.
   - En el prompt, si hay fotos, añade: «Hay {n} foto(s) adjunta(s) de lo que hizo la persona.
     Úsalas solo para comprobar si son coherentes con los datos informados; si los contradicen,
     dilo en feedback. No describas personas ni datos personales que aparezcan.»
   - Llama `gemini(prompt,CHAL_REPORT_SCHEMA,900,images=[(m,d) for m,d,_ in photos] or None)`.
   - En `result` añade `'photo_count':len(photos),'photo_sha256':[h for _,_,h in photos]`.
   - **Nunca** guardes `data` de las fotos ni las imprimas en logs.
7. El límite de cuerpo de 5 MB de `do_POST` ya alcanza (2 × ~1,3 MB en base64); no lo cambies.

### Cliente (`app.js`)

1. En `challengeSession`, etapa `doing`, antes del botón «Enviar mi informe»:
   - `let photoInput=E('input');photoInput.type='file';photoInput.accept='image/*';photoInput.multiple=true;`
   - El aviso de privacidad (texto exacto de arriba) como `E('small',...)`.
   - Un `E('p')` de estado: «Sin fotos» / «2 fotos listas».
   - `let photos=[]` (variable local de la función, **no** en `goal`).
   - `photoInput.onchange=async()=>{try{photos=await preparePhotos(photoInput.files);estado.textContent=photos.length?photos.length+' foto(s) lista(s)':'Sin fotos'}catch(e){photos=[];note(e.message,true)}}`.
   - En el cuerpo de `/api/challenge/report` añade `photos`.
2. `async function preparePhotos(files)` (fuera de `challengeSession`):
   - Más de 2 → `throw Error('Puedes adjuntar hasta 2 fotos.')`.
   - Por archivo: `createImageBitmap(file)` → `canvas` con escala `Math.min(1,1024/Math.max(w,h))`
     → `canvas.toDataURL('image/jpeg',0.8)` → quita el prefijo `data:image/jpeg;base64,`.
   - Llama `validatePhotoPayload(list)` y devuelve la lista `[{mime:'image/jpeg',data}]`.
3. `function validatePhotoPayload(list)` (pura, exportada): lanza si más de 2, si `mime` no es
   de la lista, o si `Math.floor(data.length*3/4) > 1000000`. Devuelve la lista.
4. Tras un informe aceptado o `INSUFFICIENT`, vacía `photos=[]` y `photoInput.value=''`.
5. Exporta `validatePhotoPayload`.

### Pruebas

`tests/challenge_photos_backend.test.py`:
1. Sin fotos → igual que hoy (la llamada a `gemini` recibe `images=None`).
2. 1 JPEG válido mínimo (`b'\xff\xd8\xff\xe0'+b'0'*100` en base64) → `gemini` recibe
   `images=[('image/jpeg',...)]`, el resultado trae `photo_count==1` y un sha256 de 64 hex, y
   **el base64 no aparece** en `json.dumps(resultado)` ni en la base (busca la cadena en las
   filas de `placement_answers`).
3. 3 fotos, tipo `image/gif`, base64 inválido, firma incorrecta, > 1 MB → `ValueError`, y
   `gemini` **no** se llama.
4. Mismo `attempt_id` con foto distinta → conflicto.
5. `_gemini_call` construye `inline_data` antes del texto: parchea `urllib.request.urlopen`
   para capturar el `Request` y comprueba el JSON enviado (sin red). Igual para
   `_anthropic_call` (bloque `image` antes de `text`). Usa una clave falsa con
   `patch.dict(os.environ,{'GEMINI_API_KEY':'x'})` y no imprimas la clave.

`tests/challenge_photos.test.js`: `validatePhotoPayload` acepta 0–2 JPEG pequeños, rechaza 3,
rechaza `image/gif`, rechaza uno de ~1,1 MB; la fuente contiene el aviso de privacidad exacto
y **no** contiene `goal.challenge.photos` ni `localStorage` junto a `photos`.

E2E (si existe `/tmp/e2e`): `page.setInputFiles` con un PNG pequeño generado en la prueba;
el fake `gemini` del harness debe aceptar `**kw`.

Commit: `Agrega fotos opcionales a los retos: se envían para valorar y no se guardan`

---

## Prompt de arranque para Sonnet

Pega esto en una sesión nueva (o en esta, tras cambiar de modelo):

```text
Eres el ejecutor. Lee docs/plan_fase3_v1.md en el repo GIJ0N/LearnScienceV1 (/root/LearnScienceV1, rama main actualizada) y ejecuta SOLO la tarea <T1|T2|T3|T4> siguiendo al pie de la letra la sección 0 (protocolo) y la sección de esa tarea. Carga la skill learnscience-dev antes de empezar. No cambies reglas de evidencia fuera de lo que dice el plan; si un ancla no aparece y la duda afecta a la política, detente y pregúntame. Al terminar, haz commit, push, parche verificado en clon limpio y dame el informe en español con la plantilla 0.5.
```
