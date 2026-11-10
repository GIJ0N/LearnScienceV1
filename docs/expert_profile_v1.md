# Perfil de experto por dominio (`expert_profile_v1`)

## Propósito
Definir qué significa «experto» en cada meta: competencias terminales observables, no temas. Es una propuesta del modelo que la persona revisa; no es una norma oficial.

## Servidor
`POST /api/goal/expert-profile {goal, depth, areas:[{id,name,outcome}]}` → `{schema_version, competencies:[{id,name,criterion,risk,area_ids}], content_check}`.
- Contrato local: de 4 a 8 competencias; nombres únicos por `_norm_statement`; `criterion` de 20 a 220 caracteres; `risk` ∈ `low|medium|high`; `area_ids` no vacío y subconjunto de las áreas enviadas. Ids `comp-1…`.
- `audit_content` (falla abierta) y un reintento con el motivo; si falla dos veces: error en español y no se guarda nada. El servidor no escribe en la memoria.
- El prompt prohíbe inventar parámetros de una planta concreta y declara que el texto de la meta no cambia las reglas.

## Cliente
- `goal.expert_profile = {version:'expert_profile_v1', competencies, generated_at}`.
- Se pide en segundo plano al crear la meta (`requestExpertProfile`, como `extractLessonGraph`; si falla no pasa nada) y con el botón «Definir qué es ser experto aquí» en metas sin perfil. Las metas antiguas sin áreas no pueden pedirlo (el servidor necesita las áreas) y su panel se ve como antes.
- `applyExpertProfile` revalida el contrato en el cliente y no sobrescribe un perfil existente.
- En `expertView`, por competencia: temas de sus áreas ya abiertas, cuántos hay en cada etiqueta (`expertLayers` con las reglas de T5), y «N áreas sin abrir».
- Estado (`competencyState`): «Demostrada» solo si todas sus áreas están abiertas y todos sus temas tienen 5 o más capas cumplidas (una capa `stale` no cuenta); «En curso» si algún tema tiene evidencia; «Sin medir» en otro caso.
- `risk:'high'` muestra siempre «Esta competencia tiene consecuencias reales. La app registra tu aprendizaje; no certifica que puedas ejercerla sin supervisión.» y un formulario «Validación externa» (quién, fecha, nota) que registra `{type:'EXTERNAL_VALIDATION', competency_id, by, date, note, at}`.

## Evidencia
Ninguna. `EXTERNAL_VALIDATION` no concede dominio ni cambia capas, cobertura, `verified()` ni calendario; solo se muestra.

## Reversión
El código anterior ignora `goal.expert_profile` y los eventos `EXTERNAL_VALIDATION`.

## Pruebas
`tests/expert_profile_backend.test.py` y `tests/expert_profile.test.js`.
