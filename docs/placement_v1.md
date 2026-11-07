# Diagnóstico inicial por acotamiento v1 (`placement_v1`)

## Propósito

Hoy una meta nueva recorre el mapa desde la raíz, una sonda por nodo, y la primera lección se genera «desde nivel cero». Este diagnóstico encuentra dónde termina lo que la persona ya sostiene para empezar a enseñar justo en ese borde, sin conceder dominio a nada.

## Decisiones del dueño (2026-11-04)

- **Corrección inmediata** tras cada pregunta: veredicto, explicación y, si falló, qué idea errónea suele llevar a la opción elegida.
- **Tantas preguntas como hagan falta.** El diagnóstico termina cuando cada tema está resuelto (respondido o deducido). El límite es solo de seguridad: `max(40, 4 × nodos)`. La persona puede terminar cuando quiera.
- **Metas antiguas**: el botón «Diagnosticar lo que ya sé» se ofrece en metas existentes y solo pregunta por temas sin evidencia previa.

## Flujo

1. Al crear una meta, `goal.placement.status='offered'`. La sesión ofrece «Hacer el diagnóstico (recomendado)» o «Empezar desde el principio».
2. Durante el diagnóstico (`active`), el cliente elige el siguiente tema con `nextPlacementNode` (determinista, sin LLM). Si no hay una pregunta guardada para ese tema, pide un lote a `/api/placement/items`: **una sola llamada a Gemini genera preguntas para hasta 8 temas**, empezando por los prioritarios. Así un diagnóstico largo no agota `DAILY_CALL_LIMIT`.
3. La persona elige una opción o «No sé», indica su confianza y, opcionalmente, su razonamiento. `/api/placement/answer` corrige **en el servidor y sin Gemini**: la clave correcta nunca llega al cliente antes de responder.
4. Se muestra la corrección inmediata y se registra un evento `EVIDENCE` de diagnóstico.
5. Al terminar, los temas sostenidos se marcan con `PLACEMENT_SKIP` y la ruta continúa en el primer tema no sostenido.

## Selección de preguntas

Estado de cada tema, derivado de las respuestas (nunca guardado como dominio):

| Estado | Regla |
|---|---|
| `held` | Acierto con confianza ≥ 70 %, o dos aciertos |
| `fragile` | Un acierto con confianza < 70 % o sin indicar, o aciertos y fallos mezclados |
| `misconception` | Fallo con confianza ≥ 70 % |
| `gap` | Fallo con menos confianza, o «No sé» |
| `inferred_held` | Prerrequisito (transitivo) de un tema `held` |
| `inferred_gap` | Dependiente (transitivo) de un tema `gap` o `misconception` |
| `conflict` | Deducido a la vez como sostenido y como laguna: debe preguntarse |
| `evidenced` | Ya tenía evidencia antes del diagnóstico: no se pregunta |
| `unprobed` | Sin datos |

- **Primera pregunta: el tema más avanzado** (el último en el orden de prerrequisitos). Un adulto que busca algo avanzado suele sostener lo básico; un fallo hace bajar.
- Después, el tema sin resolver que **mejor divide** lo pendiente: maximiza `min(ancestros sin resolver, dependientes sin resolver)`; en empate, el más avanzado.
- Un `fragile` se repregunta con una pregunta distinta cuando ya no queda otro tema pendiente.
- Un acierto con poca confianza **no** propaga a los prerrequisitos: en opción múltiple puede ser suerte.

## Qué cuenta como evidencia

- Cada respuesta se registra como `EVIDENCE` con `stage='DIAGNOSTIC'`, `role='placement_probe'`, `supports_independence=false`, `help_used=0`. Queda en el historial auditable y en `relevant_memory`, así la primera lección se adapta a ella (un fallo lleva a `lesson_adaptation='repair'`).
- **No suma suficiencia**: no es independiente (opción múltiple con corrección inmediata). Un fallo de diagnóstico no cuenta como fallo de aprendizaje.
- `PLACEMENT_SKIP` es una decisión de ruta, igual que `CURRICULUM_CONTINUED`: `readyToAdvance` deja pasar el tema, pero `verified()`, cobertura y el contador de habilidades con evidencia no cambian. Lleva `basis: 'probed' | 'inferred'`.
- **Revocación** (derivada, sin escrituras): un salto deja de valer si después hay un fallo de aprendizaje en ese tema, o un fallo con `error_type='prerequisite'` en un tema que lo tiene como prerrequisito. Entonces vuelve a la ruta.

## Contratos

`POST /api/placement/items` → `{profile_id, goal_id, goal, nodes:[{id,name,outcome,prerequisites}], node_ids:[≤8], avoid_prompts?}` → `{items:[{item_id,node_id,prompt,options:[{id,text}]}]}`. El servidor valida que cada pregunta pertenezca a un tema pedido, tenga de 3 a 5 opciones con IDs únicos, la clave esté entre ellas y cada opción incorrecta nombre una idea errónea. La parte privada se guarda en `placement_items` (SQLite). El servidor **baraja y vuelve a etiquetar** las opciones (a, b, c…) antes de guardarlas: en la primera prueba con Gemini real (2026-11-04) la clave quedó en «a» en todas las preguntas, y la posición no debe delatar la respuesta.

`POST /api/placement/answer` → `{profile_id, goal_id, item_id, attempt_id, selected_option_id | null, learner_confidence?, reasoning?}` → `{status: CORRECT | MISCONCEPTION | UNKNOWN, correct_option_id, explanation, selected_misconception, node_id}`. Idempotente por `attempt_id`: repetir la misma respuesta devuelve la misma corrección; el mismo `attempt_id` con otra respuesta se rechaza.

## Compatibilidad y rollback

Tablas nuevas `placement_items` y `placement_answers` con `CREATE TABLE IF NOT EXISTS`; nada cambia en las existentes. `goal.placement` es un campo opcional: metas sin él se comportan como antes. Revertir deja eventos `PLACEMENT_SKIP` que la versión anterior ignora (sus temas volverían a la ruta normal) y eventos de diagnóstico que siguen siendo auditables.

## Fuera de alcance

Preguntas abiertas en el diagnóstico, uso de las relaciones entre metas para deducir, y repaso programado de los temas saltados.

Si la revisión descarta todas las preguntas del diagnóstico, se regenera una vez con el motivo; un descarte parcial no reintenta (ronda QA 7).
