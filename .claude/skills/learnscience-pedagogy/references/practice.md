# Práctica: de "lo entiendo" a "me viene solo"

Saber una proposición y que venga a la mente en la situación correcta son estados
distintos. Tras una lección, la idea viene a la mente casi solo en la situación de la
lección. La práctica cierra esa brecha y es lo que separa al que aprobó la lección del
experto.

**Condición que define la práctica:** la idea que se ejercita está *inactiva* cuando llega
la situación, y solo los rasgos de la situación pueden activarla. Una comprobación de
enseñanza pregunta por algo recién nombrado (activo); la práctica exige producirlo desde
inactivo. El repaso diferido (`/api/review`) y la transferencia ya apuntan aquí; esto los
completa.

## El bucle y su costo

Resolver es: percibir la situación → elegir qué tipo de movimiento aplica → discriminar
qué idea es → ejecutarla → comprobar → siguiente situación. Las operaciones entrenadas son
**recuperar, ejecutar, comprobar**.

- El rendimiento de recuperación de un problema son sus **puntos de decisión** (momentos
  donde hay que seleccionar una idea aún no activa), no sus pasos. Una cadena lineal tiene uno.
- Reintentar justo después del feedback es práctica débil: sigue semiactivo. Los reintentos
  van en una superficie nueva.
- Intercalar objetivos es el defecto, no un extra. Bloques del mismo objetivo son
  repetición, no recuperación.
- Maximiza puntos de decisión por minuto: problemas densos, pocos pasos desperdiciados; no
  problemas largos de búsqueda.
- Banda productiva ≈85 % de éxito **por evento de recuperación** (un problema de 8 pasos al
  85 % por paso sale bien una de cada cuatro veces).

## Tres modos, en orden de prerrequisito

| Modo | Qué entrena | Forma |
|---|---|---|
| Recuerdo | La idea se despliega con señales débiles o variadas | 1–2 puntos de decisión, situación nueva, corto |
| Discriminación | La idea correcta gana frente a una confundible viva | Situaciones casi gemelas; el rasgo que separa lleva toda la señal |
| Composición | La cadena corre como un todo bajo carga | Longitud según la cadena; distractores presentes |

Recuerdo antes que discriminación antes que composición. Si falla una capa superior, a
menudo la inferior era más débil de lo que parecía: vuelve a probarla.

Plantillas que modifican cualquier modo: **inverso** (dar la conclusión, pedir los
fundamentos), **sondear premisas** (debilitar una premisa: ¿qué se rompe?).

## Plantear una demanda

1. Objetivo: el más débil, el que más alimenta otras cadenas, el menos reciente.
2. Modo: la capa más barata aún no demostrada.
3. Dificultad: acierto limpio → sube un nivel; acierto con pistas → mantén; fallo → baja y
   considera bajar de modo. Dos fallos seguidos en el mismo objetivo → cambia de objetivo.
4. Situación: una clase de señal no usada aún para ese objetivo.
5. **Comprometer la solución antes de mostrar nada** (guárdala en servidor, como ya hace
   `criterion_assessment_v1` con la clave privada). Mantiene veredictos honestos y pistas
   coherentes.
6. Resolver y buscar atajos: si se puede resolver saltándose el objetivo, entrena el atajo;
   corrígelo o descártalo. Nada más allá del material.

El enunciado nunca anuncia su objetivo.

## Escalera de pistas — una por petición

Lo revelado no se puede desrevelar, y el aprendiz siempre puede pensar más. Desde su
razonamiento, encuentra la **primera** pregunta del bucle que no puede responder (o
responde mal) y responde solo eso, con el grano más grueso que desbloquee:

- **P0** redirigir atención ("relee el segundo dato")
- **P1** redescribir el patrón ("lo que ves es una suma de muchas cosas pequeñas")
- **P2** clase candidata ("algo de este grupo aplica")
- **P3** nombrar la idea (se entrega la recuperación)
- **P4** esbozar el movimiento (se entrega la ejecución)
- **P5** paso resuelto

Reglas: el atasco no siempre está donde el aprendiz mira (si ejecuta la idea equivocada,
el fallo fue antes: "revisa la suposición detrás de lo que haces"). Aclarar el enunciado es
gratis; información de la solución se dosifica. El peldaño que necesitó es una lectura de
dificultad: P0–P1 bien calibrado, P3+ pasado del borde.

**Encaje con la evidencia:** registra el peldaño máximo usado en el evento (`help_used`
puede ser un número de 0–5 en vez de booleano). Cualquier peldaño >0 impide independencia;
P3+ debería contar como fallo de recuperación para la programación del repaso.

## Respuestas y fallos

- Correcto: confirma y nombra los movimientos que lo hicieron funcionar. Una línea.
- Incorrecto: veredicto claro, localiza la primera ruptura sin dar la corrección, empujón
  mínimo, espera. Un intento fallido no es razón para revelar ni concluir.
- Clasifica cada fallo: **no vino nada** (señal), **ganó la equivocada** (discriminación),
  **desliz de ejecución**, **descuido**, **estructural** (la idea recuperada es errónea:
  error conceptual). Esto es más útil para decidir que `error_type` actual; pueden convivir
  (mapear `memory`→señal, `formula_selection`→discriminación, `algebra/arithmetic`→ejecución,
  `attention`→descuido, `conceptual`→estructural).

## Arco de una sesión de práctica

- Arranque cálido: 1–3 recuerdos fáciles de los objetivos débiles adyacentes (reactiva y calibra).
- Cuerpo intercalado: objetivos que cambian, modos según la regla, dificultad en la banda.
- Cierre con reprueba: todo fallo, todo ítem con muchas pistas, en superficie nueva. Nada
  que falló termina la sesión sin reprobarse.
- Problemas que trae el aprendiz (de un examen, de su trabajo): resuélvelos, mapea qué ideas
  exige cualquier solución correcta y pásalos por la misma maquinaria.

## Espaciado

Distribuir supera a concentrar, y el intervalo óptimo crece con el horizonte de retención
deseado. Una programación simple y defendible: tras cada recuperación independiente
exitosa, multiplica el intervalo (p. ej., 1 → 3 → 7 → 16 → 35 días); tras un fallo o P3+,
vuelve al intervalo corto. Programa por proposición/habilidad, no por lección, e intercala
los repasos vencidos de distintas metas en la misma sesión.
