# Repaso adaptativo y práctica intercalada v1 (`spaced_practice_v1`)

## Propósito

Entender un tema no lo deja disponible: hay que recuperarlo tras intervalos crecientes y saber distinguirlo de ideas parecidas. Hoy el repaso es una escalera fija (1, 3, 7, 14, 30, 60, 90 días) que sube un peldaño con cada acierto y vuelve a 0 con cada fallo, sin mirar ayuda ni confianza, y siempre pregunta por un solo tema a la vez. Esta versión (a) hace el calendario sensible a la calidad del acierto y (b) añade una sesión intercalada que mezcla temas ya sostenidos y exige **discriminar** entre ellos.

## A. Calendario por habilidad (`nextReviewStep`)

Función pura que decide el nuevo peldaño a partir del resultado de un repaso. Mantiene la escalera y el contrato temporal existentes (`delayed_review_v1`); solo cambia cuánto se mueve el peldaño:

| Resultado del repaso | Peldaño nuevo | Motivo |
|---|---|---|
| Acierto sin ayuda, confianza ≥ 50 o no indicada | +1 | Recuperación sólida |
| Acierto con cualquier ayuda (`help_used > 0`) | igual | Con ayuda no prueba retención |
| Acierto sin ayuda con confianza < 50 | igual | Acierto frágil: repetir al mismo intervalo |
| Fallo con confianza < 70 o sin indicar | ⌊peldaño / 2⌋ | Olvido normal: retroceso parcial |
| Fallo con confianza ≥ 70 (`committed_misconception`) | 0 | Creencia firme errónea: volver a empezar |
| `UNKNOWN` | sin cambio | Ya existente: evaluación incierta no mueve el calendario |

El fallo sigue llevando a re-enseñar (`startTeach`) como hoy.

## B. Práctica intercalada

Una sesión corta (2 a 4 preguntas) que mezcla **temas distintos** que la persona ya sostiene, para que elija la idea correcta en lugar de aplicar la última que vio.

- **Selección** (determinista, sin LLM): candidatos = temas con evidencia verificada o con repaso programado; primero los de repaso vencido, luego los de exposición más antigua; nunca un tema sin enseñanza. Se necesitan al menos 2 candidatos; si no, la opción no se ofrece.
- **Generación**: una sola llamada (`/api/practice/discriminate`) crea una pregunta por tema. Cada una describe una situación que requiere reconocer cuál de las ideas aplica; las opciones incorrectas son usos plausibles de las ideas hermanas y cada una nombra el error de confusión. El servidor valida, baraja y guarda la clave (como en el diagnóstico).
- **Corrección**: inmediata y sin proveedor (`/api/practice/discriminate/answer`), idempotente por `attempt_id`, solo para preguntas de esta versión.

### Qué cuenta como evidencia

Opción múltiple con corrección inmediata no es independiente ni demuestra recuperación libre, así que **no crea `EVIDENCE` ni suma dominio**. Se registra `DISCRIMINATION` (tema, intento, resultado, confianza, señal de calibración, idea de confusión) y solo tiene dos efectos acotados:

1. Un fallo en un tema con repaso programado aplica un **retroceso parcial** (⌊peldaño / 2⌋) y adelanta su vencimiento si ya estaba más lejos; nunca lo atrasa.
2. El fallo queda disponible como dato (`relevant_memory` / panel futuro) para decidir qué reforzar.

Un acierto no sube el peldaño: discriminar no es recuperar.

## Contratos

`POST /api/practice/discriminate` → `{profile_id, goal_id, goal, nodes:[{id,name,outcome}]}` (2–4) → `{items:[{item_id,node_id,prompt,options:[{id,text}]}]}`.
`POST /api/practice/discriminate/answer` → igual que el diagnóstico (`status`, `correct_option_id`, `explanation`, `selected_misconception`, `node_id`).

## Compatibilidad y rollback

Reutiliza `placement_items`/`placement_answers`; sin tablas nuevas. `goal.mixed` es opcional. Revertir deja eventos `DISCRIMINATION` que nada más lee y el calendario vuelve a la escalera fija.

## Fuera de alcance

Preguntas de **composición** (encadenar varias ideas en un problema largo): requieren el grafo de proposiciones y cadenas del paso 6. Intervalos personalizados por rendimiento histórico (tipo FSRS) y recordatorios fuera de la app.
