# Grafo de proposiciones y cadenas v1 (`knowledge_graph_v1`)

## Propósito

El mapa actual guarda temas, no las ideas concretas que se enseñaron ni cómo se encadenan. Sin eso no se puede practicar **composición** (usar varias ideas juntas en un problema) ni, más adelante, reutilizar lo aprendido entre metas. Esta versión extrae, tras enseñar un tema, las **proposiciones** (afirmaciones concretas) y las **cadenas** (premisas que conjuntamente implican una conclusión), con procedencia, y las usa para generar práctica de composición.

## Dos tipos de dato que no se mezclan

- **Grafo de dominio** (esto): qué proposiciones y cadenas aparecieron en el material enseñado, con su origen. Es un mapa del *material*, no una evaluación de la persona. Que una proposición exista no prueba que la entendió; que falte no prueba que la ignora.
- **Evidencia del aprendiz**: solo los eventos de intento informan dominio. El grafo nunca concede ni quita dominio.

## Extracción

Al completar la lección de un tema (pasos terminados o explicación completa leída), el cliente pide `/api/graph/extract` **sin bloquear** la sesión; si falla, no pasa nada y se reintenta en la siguiente lección.

El modelo propone; el servidor decide:

| Regla | Detalle |
|---|---|
| Proposiciones | 2 a 8 por extracción; enunciado de 8 a 220 caracteres; se descartan vacías y duplicadas |
| Identidad | Se deduplica por enunciado normalizado (minúsculas, sin acentos ni signos) **dentro de la meta**; nunca entre metas |
| Cadenas | Hasta 4; 2 o 3 premisas distintas, conclusión distinta de las premisas, todas referidas a proposiciones válidas de esa extracción |
| Procedencia | Cada proposición y cadena guarda `{node_id, kind:'lesson', lesson_ref}`; una proposición repetida acumula procedencias |
| Seguridad | El texto de la lección es dato, no instrucciones |

## Práctica de composición

`/api/practice/compose` recibe **solo identificadores de cadena** (1 a 3). El servidor carga las premisas y la conclusión guardadas (el cliente no puede inventarlas ni usar cadenas de otra meta o perfil) y genera, en una llamada, un problema por cadena que exige usar todas las premisas para llegar a la conclusión. Las opciones incorrectas son resultados de saltarse una premisa y cada una nombra cuál. Se valida, baraja y guarda la clave como en el diagnóstico; la corrección es inmediata y sin proveedor.

### Qué cuenta como evidencia

Igual que la discriminación: opción múltiple con corrección inmediata, **no crea `EVIDENCE` ni suma dominio**. Se registra `COMPOSITION` (tema, cadena, intento, resultado, confianza, señal de calibración, premisa omitida). Un fallo adelanta el repaso del tema (retroceso parcial, nunca atrasa); un acierto no sube el calendario.

## Contratos

`POST /api/graph/extract` → `{profile_id, goal_id, node_id, goal, name, material, lesson_ref?}` → `{propositions:[{prop_id,statement}], chains:[{chain_id,node_id,premises:[prop_id],conclusion}]}`.
`POST /api/graph/get` → `{profile_id, goal_id}` → mismo formato con todo el grafo de la meta.
`POST /api/practice/compose` → `{profile_id, goal_id, goal, chain_ids}` → `{items:[{item_id,node_id,chain_id,prompt,options}]}`.
`POST /api/practice/compose/answer` → igual que el diagnóstico.

## Compatibilidad y rollback

Tablas nuevas `knowledge_props` y `knowledge_chains` (`CREATE TABLE IF NOT EXISTS`, borrado en cascada con el perfil). Preguntas de composición en `placement_items`. Revertir deja tablas y eventos `COMPOSITION` que nada más lee.

## Fuera de alcance

Que el diagnóstico de una meta nueva lea el grafo, conexiones entre metas propuestas automáticamente, extracción desde notas importadas y proposiciones confundibles para discriminación.
