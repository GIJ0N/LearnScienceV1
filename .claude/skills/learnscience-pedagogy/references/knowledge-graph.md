# Mapa de conocimiento: proposiciones y cadenas

El conocimiento es estructura: proposiciones como nodos, conexiones como aristas. Las
conexiones y los pasos de razonamiento también son hechos que se pueden enunciar y sostener.
Una proposición conectada se mantiene sola; una suelta se pudre.

El "clic" —el momento de comprensión más fuerte— ocurre cuando hechos sueltos ("así es")
colapsan en una estructura generada por pocas bases: saber por qué en vez de saber que.

## Dos tipos de dato que no se deben mezclar

- **Grafo de dominio:** qué proposiciones y cadenas (premisas que *conjuntamente* implican
  una conclusión) se encontraron en la enseñanza o en notas importadas, con procedencia
  (sesión, mensaje). Es un mapa del material, **no** una evaluación del aprendiz. Que una
  proposición esté no prueba que la entendió; que falte no prueba que la ignora.
- **Evidencia del aprendiz:** los eventos de intento. Solo esto informa dominio.

El repo ya sigue esta separación con `goal_relation_v1` (conectar no transfiere dominio).
Extenderla:

1. Extraer, tras cada sesión, proposiciones y cadenas del contenido enseñado (llamada
   aparte al modelo, salida validada), con procedencia al nodo y a la lección.
2. Reutilizar en sesiones futuras: el diagnóstico de una meta nueva puede leer el grafo para
   no reacotar hebras ya sólidas *según la evidencia* (no según el grafo).
3. Alimentar la práctica: las cadenas son material natural para composición; las
   proposiciones confundibles (mismo grupo, distinto rasgo) para discriminación.
4. Conexiones entre metas: proponerlas automáticamente es útil, pero mantener el estado
   `proposed` hasta que el aprendiz las confirme (como hoy).

Identidad: deduplicar proposiciones por enunciado normalizado y alias, nunca fusionar por
nombre entre metas sin confirmación (el repo ya exige `(goal_id, node_id)`).
