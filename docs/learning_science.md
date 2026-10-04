# LearnAnything: arquitectura de un tutor adaptativo con IA basada en ciencias del aprendizaje

## Resumen ejecutivo y principios de diseño del tutor

**Resumen ejecutivo.** La arquitectura con mayor apoyo empírico para LearnAnything no es “explicar → preguntar → repetir hasta acertar”, sino un ciclo adaptativo que cambia de intervención según el tipo de conocimiento, el nivel previo, la clase de error, la cantidad de ayuda y la edad de la evidencia. La recuperación activa mejora la retención más que volver a estudiar en muchos contextos; distribuir la práctica supera al estudio masivo y el intervalo adecuado depende de cuánto tiempo se quiera retener; los ejemplos trabajados son especialmente útiles para novatos; el soporte debe retirarse conforme aparece competencia; y el feedback funciona mejor cuando aporta información accionable sobre la tarea o el proceso que cuando simplemente señala éxito o fracaso. citeturn1search9turn1search16turn13search11turn13search16turn16search13

La conclusión de producto más importante es ésta:

> **LearnAnything debe optimizar la siguiente intervención, no la siguiente pregunta.**

El tutor debería intentar maximizar:

\[
\text{valor}(a)=
\frac{
E[\Delta aprendizaje]
+ \alpha E[\Delta retención]
+ \beta E[\Delta transferencia]
+ \gamma E[\Delta independencia]
+ \eta\,\text{valor diagnóstico}
}{
\text{tiempo}
+\lambda\,\text{carga cognitiva}
+\mu\,\text{fricción}
+\nu\,\text{costo IA}
}
\]

donde \(a\) es una intervención candidata. Ésta es una **función de decisión de producto propuesta**, no una fórmula establecida por la literatura. La literatura sí respalda sus componentes: efectos robustos de recuperación y espaciado, beneficios condicionales del interleaving, ventaja de ejemplos trabajados para novatos y adaptación del apoyo al conocimiento previo. citeturn1search9turn19search2turn13search0turn7search5turn13search11

El tutor debe mantener una distinción estricta entre cuatro cosas que muchas aplicaciones mezclan:

**rendimiento presente ≠ aprendizaje ≠ retención ≠ transferencia.**

Una respuesta correcta inmediatamente después de ver el procedimiento puede reflejar memoria de trabajo, imitación o reconocimiento. Una respuesta correcta con una pista demuestra que la pista ayudó, no que el usuario puede actuar independientemente. Una respuesta correcta independiente y diferida aporta evidencia de retención; una respuesta correcta en un problema nuevo aporta evidencia adicional de transferencia. La investigación sobre testing/retrieval muestra precisamente por qué el rendimiento durante la adquisición puede resultar engañoso respecto de la retención posterior. citeturn1search30turn1search9

**Principios de diseño del tutor.**

Primero, **la adaptación debe depender del conocimiento previo**. Los métodos que reducen carga para un novato pueden convertirse en redundantes para una persona experta; éste es el *expertise reversal effect*. Por tanto, el mismo nodo no debe tener una secuencia pedagógica fija. citeturn7search5turn7search33turn8search2

Segundo, **el tutor debe dar la mínima ayuda que permita volver a pensar**, no la máxima explicación disponible. La evidencia sobre ejemplos trabajados y desvanecimiento sugiere una trayectoria útil: ejemplo completo → pasos omitidos → problema con pistas bajo demanda → ejecución independiente. Estudios con tutores de geometría encontraron que incorporar ejemplos desvanecidos podía lograr resultados iguales o mejores usando menos tiempo de aprendizaje, y que el fading adaptado a la calidad de la autoexplicación podía mejorar transferencia. citeturn13search11turn13search16

Tercero, **cada intervención debe producir una clase identificable de evidencia**. Una pregunta factual no debería actualizar “transferencia”; explicar una idea no debería actualizar “procedimiento”; completar un ejercicio con cinco pistas no debería actualizar “independencia”.

Cuarto, **evaluar también debe enseñar**. Retrieval practice no es sólo medición: recuperar información modifica el aprendizaje. Meta-análisis y experimentos muestran ventajas posteriores de recuperar frente a volver a estudiar, especialmente cuando la recuperación requiere producir una respuesta y cuando existe feedback. citeturn1search9turn1search7turn1search30

Quinto, **no todo debe convertirse en retrieval practice**. Cuando el alumno todavía no posee el esquema necesario, hacerle fallar repetidamente sólo aumenta carga y tiempo. Con bajo conocimiento previo y tareas de alta interacción entre elementos, una representación breve y un ejemplo trabajado suelen ser mejores puntos de partida. citeturn13search11turn8search2

Sexto, **la transferencia debe enseñarse y medirse explícitamente**. Resolver diez ejercicios superficialmente idénticos puede producir fluidez local sin enseñar a reconocer qué método utilizar. Mezclar problemas una vez que los procedimientos básicos existen obliga a discriminar entre estrategias; estudios de matemáticas han encontrado ventajas retardadas importantes de práctica mezclada/intercalada frente a bloques homogéneos. citeturn13search0turn13search6

Séptimo, **“difícil” no equivale a “mejor”**. Las llamadas *desirable difficulties* sólo son deseables cuando desencadenan recuperación, discriminación, elaboración o reconstrucción productiva sin exceder los recursos del estudiante. El concepto debe implementarse mediante mecanismos específicos —espaciado, recuperación, ciertas formas de interleaving— y no como licencia para hacer ejercicios arbitrariamente frustrantes. citeturn1search16turn1search9turn13search0

Octavo, **el tutor debe tener dos bucles**: un bucle de tarea que decide qué actividad presentar y otro de pasos que decide cómo responder dentro de una actividad. Esa separación coincide con arquitecturas clásicas de sistemas de tutoría inteligente y resulta particularmente útil para evitar que una equivocación local reconstruya toda la ruta de aprendizaje. citeturn5search12

Noveno, **“práctica deliberada” no debe usarse como explicación universal del expertise**. El meta-análisis de Macnamara, Hambrick y Oswald encontró que la práctica deliberada explicaba una fracción variable del rendimiento dependiendo del campo y mucho menos en educación y profesiones que en algunos dominios como juegos. Para el producto, lo útil del concepto es localizar subhabilidades débiles, trabajar con objetivos precisos, feedback y repetición correctiva, no prometer que una cantidad fija de horas crea expertise. citeturn10search0

Décimo, **la IA generativa no debe estar en el camino crítico de todo evento pedagógico**. Los ITS tienen una extensa literatura favorable, pero eso no implica que cada decisión necesite un modelo generativo: selección de tarea, scheduling, evaluación numérica, tests de código, comprobación de unidades y transiciones de estado son frecuentemente deterministas. Una meta-revisión de ITS de Kulik y Fletcher encontró beneficios generales del tutoring inteligente en numerosos estudios, mientras la arquitectura clásica de tutoring separa explícitamente selección de tareas y ayuda paso a paso. citeturn6search22turn5search12

## Técnicas priorizadas y actividades por tipo de conocimiento

**Tabla de técnicas de aprendizaje priorizadas.**

En esta tabla, **Alta** significa evidencia relativamente robusta y replicada para los efectos centrales, no que funcione universalmente; **Media** indica una intervención útil pero muy dependiente de condiciones; **Contextual** indica que el constructo es amplio, heterogéneo o que la evidencia relevante para una aplicación universal es indirecta.

| Técnica | Prioridad / confianza | Problema que resuelve y evidencia | Cuándo usar | No usar / riesgo principal |
|---|---|---|---|---|
| Recuperación activa | P0 / Alta | Combate olvido y familiaridad ilusoria; meta-análisis favorecen recuperar sobre reestudiar para retención. citeturn1search9turn1search7 | Algo ya fue codificado y puede intentarse recuperar | No convertir conocimiento aún no enseñado en una sucesión de fallos |
| Práctica distribuida | P0 / Alta | Reduce olvido; el intervalo útil depende del horizonte de retención. citeturn1search16turn19search2 | Después de evidencia inicial de aprendizaje | No usar intervalos fijos iguales para todos los conocimientos |
| Interleaving | P1 / Media-alta | Entrena discriminación y selección de método; fuerte evidencia en varios aprendizajes categoriales y matemáticos, pero efectos condicionales. citeturn13search0turn0search7 | Métodos individuales ya son ejecutables | Introducir cinco procedimientos nuevos simultáneamente |
| Práctica deliberada | P1 / Media | Localiza debilidades concretas y promueve corrección iterativa; su contribución al expertise varía mucho por dominio. citeturn10search0 | Habilidad con desempeño y criterio de calidad observables | Como receta universal basada sólo en horas |
| Ejemplos trabajados | P0 / Alta para novatos | Reduce búsqueda innecesaria y carga; puede ahorrar tiempo y favorecer comprensión conceptual. citeturn13search11 | Baja experiencia, procedimiento complejo | Mantener ejemplos completos cuando el usuario ya puede resolver |
| Example fading | P0 / Alta-media | Transición de observación a producción; fading adaptativo ha mostrado ventajas de transferencia. citeturn13search16 | Tras comprender al menos parcialmente un ejemplo | Retirar demasiados pasos de golpe |
| Scaffolding | P0 / Alta como principio condicional | Ajusta apoyo a competencia; debe retirarse con aprendizaje, consistente con expertise reversal. citeturn7search5turn7search33 | Impasse reparable, tarea ligeramente fuera de alcance | Ayuda permanente que produce dependencia |
| Autoexplicación | P1 / Alta-media | Fuerza conectar pasos, principios y conocimiento previo; meta-análisis encuentra beneficios de prompts de autoexplicación. citeturn4search1turn4search22 | Ejemplos, razonamiento causal, pasos matemáticos | Pedir “explica por qué” después de cada microacción |
| Teach-back / Feynman | P1 / Media-indirecta | Útil como combinación de recuperación y autoexplicación; “método Feynman” no tiene una base experimental independiente comparable a retrieval practice. citeturn4search1turn1search9 | Conceptos conectados que deberían explicarse sin material | No marcar dominio sólo porque una explicación suene fluida |
| Feedback correctivo | P0 / Alta | Feedback mejora aprendizaje en promedio, pero el efecto depende fuertemente de su contenido. citeturn16search0turn16search13 | Error con corrección accionable | “Incorrecto, intenta otra vez” repetido sin información |
| Diagnóstico de errores | P0 / Media-alta | Permite escoger reparación en vez de repetir práctica; aprender de ejemplos erróneos mejora cuando hay explicación del error/autoexplicación. citeturn13search5turn13search8 | Patrón de error interpretable | Inventar una causa psicológica a partir de un solo fallo |
| Práctica de transferencia | P0 / Media-alta | Distingue procedimiento memorizado de uso flexible; preparación para aprendizaje futuro muestra que actividades previas pueden cambiar cómo se aprende de explicaciones posteriores. citeturn11search18 | Tras competencia básica | “Transferencia” basada sólo en cambiar números |
| Variación de contexto/representación | P1 / Media | Reduce dependencia de claves superficiales y puede enriquecer representaciones | Tras esquema inicial | Variar simultáneamente todas las dimensiones para novatos |
| Deseable difficulties | P2 / Media como principio | Resume condiciones que dificultan rendimiento inmediato pero pueden favorecer retención | Prerrequisitos suficientes | Usarlo como justificación de confusión o sobrecarga. citeturn1search9turn19search2 |
| Cognitive Load Theory | P0 / Alta como marco | Explica por qué búsqueda, redundancia y demasiados elementos interactuando perjudican a novatos. citeturn8search2turn7search5 | Diseño de explicaciones, ejemplos, UI, progresión | Convertir “carga cognitiva” en un número pseudopreciso por usuario |
| Mastery learning | P0 / Alta-media | Avanzar tras alcanzar criterios y reparar carencias; meta-análisis de 108 evaluaciones halló efectos positivos, variables por procedimiento y contenido. citeturn14search1 | Competencias con prerequisitos | Umbral binario basado en porcentaje de respuestas |
| Knowledge tracing / student model | P0 / Alta como necesidad; método concreto variable | Mantiene estimación longitudinal del estado; KT es un problema consolidado, y modelos profundos mejoran predicción en algunos datasets pero aumentan complejidad. citeturn14search3 | Siempre, como capa silenciosa | Confundir predicción de “siguiente respuesta correcta” con dominio real |
| Metacognición/calibración | P1 / Media-alta | Identifica discrepancias entre sensación y desempeño; estudiantes pueden predecir mal su retención. citeturn1search30 | Decisiones de avance y errores de alta confianza | Preguntar confianza después de cada clic |
| Problemas auténticos/PBL | P2 / Media | PBL tiende a favorecer aplicación/habilidades y retención a largo plazo, aunque enfoques tradicionales pueden rendir mejor en ciertas medidas de conocimiento inmediato. citeturn20search9turn20search23 | Cuando ya existen componentes suficientes | Proyecto abierto como primera exposición a un dominio complejo |
| Habilidades procedimentales | P1 / Media-alta | Requieren ejecución, secuencia, selección, recuperación de fallos y velocidad, no sólo explicación | Simulación y whole-task con soporte gradual | Certificar competencia física/profesional sólo con diálogo |
| Matemáticas/cuanti | P0 / Alta para ejemplos + mezcla | Worked examples/fading y posterior práctica intercalada tienen evidencia directa en matemáticas. citeturn13search11turn13search0 | Según etapa de expertise | Dar nombre del método en todos los problemas |
| Programación/debugging | P1 / Media | Representaciones enlazadas pueden ayudar a novatos; evidencia reciente sobre instrucción contextual en debugging es prometedora pero todavía limitada. citeturn17academia36turn17academia37 | Trace → completar → escribir → depurar → diseñar | Convertir “generar código con IA” en evidencia de programación |
| Idiomas | P1 / Alta para memoria; contextual para fluidez global | Spacing/retrieval son directamente relevantes a vocabulario; estudios L2 también encuentran efectos de espaciado en vocabulario. citeturn19search26turn1search9 | Vocabulario, formas, estructuras + uso contextual posterior | Equiparar reconocimiento de traducción con producción lingüística |
| Procedimientos profesionales/técnicos | P1 / Media | PBL y tareas contextualizadas favorecen habilidades/aplicación en diversos contextos. citeturn20search9turn20search23 | Simulación segura, fallos y excepciones | Declarar competencia operacional de alto riesgo sin observación real |

**Cómo llevar las veinticuatro técnicas a actividades concretas.**

No existe en la evidencia un número mágico universal de “tres preguntas = dominio”. Los siguientes mínimos son, por tanto, **defaults de ingeniería conservadores**, no constantes psicológicas. Se justifican por la necesidad de obtener evidencia en más de un ítem, separar práctica inmediata de retención y no inferir transferencia de práctica repetitiva. citeturn1search9turn19search2turn13search0

Definiría cinco requisitos reutilizables:

- **C — comprensión provisional:** dos señales independientes y diferentes, una de ellas explicación, predicción, contraste o ejemplo/no-ejemplo.
- **P — ejecución provisional:** dos ejecuciones independientes correctas en variantes distintas, sin pistas críticas.
- **S — selección de método:** al menos dos decisiones correctas dentro de un conjunto mezclado de alternativas plausibles.
- **T — transferencia:** al menos una tarea genuinamente nueva independiente; para un estado `TRANSFERRED` robusto, preferiblemente dos cambios distintos de contexto/representación.
- **R — retención:** al menos una recuperación correcta después de un intervalo significativo; dos éxitos diferidos separados producen evidencia considerablemente más fuerte.

Estos mínimos deben subir con las consecuencias del error. Aprender capitales, practicar una función de Python y operar un equipo clínico no deben compartir el mismo estándar de dominio.

| Técnica | Actividad concreta | Datos a persistir | Evidencia antes de actualizar estado | Mínimo razonable / cómo evitar sobre-evaluar | Uso de IA |
|---|---|---|---|---|---|
| Retrieval | “Sin mirar: explica X / resuelve Y” | latencia, exactitud, ayuda, edad de evidencia | recuperación producida, no reconocimiento | 1 intento por ocasión; R exige ocasión diferida | No para respuestas cerradas; sí para semántica |
| Spacing | microproblema antiguo dentro de sesión nueva | última evidencia, intervalo, estabilidad | éxito independiente después del intervalo | una comprobación informativa, no bloque entero | No |
| Interleaving | “¿Qué método usarías y por qué?” mezclando métodos | método elegido, distractor, ejecución posterior | selección correcta + ejecución | 2–4 categorías confusables, no todo el curso | Normalmente no |
| Deliberate practice | ejercicio del subpaso que limita desempeño | error recurrente, tiempo, objetivo | mejora observable del subcomponente | detener cuando deja de ser cuello de botella | Sólo diagnóstico ambiguo |
| Worked example | ejemplo paso a paso con “por qué” en pasos críticos | pasos vistos, self-explanation | no otorga independencia | uno o dos ejemplos suelen bastar antes de comprobar | Generación reusable, cacheable |
| Fading | completar pasos faltantes | pasos ocultos, errores, pistas | éxito con menos soporte | una o dos etapas antes de intentar solo | No |
| Scaffolding | pista conceptual → pista estratégica → paso parcial | nivel máximo de pista | ayuda informa `learning`, no `independent` | nunca pedir preguntas extra sólo por haber dado pista | No |
| Self-explanation | “¿Por qué este paso es válido?” | proposiciones/errores de explicación | explicación causal/principio correcto | una explicación de alto valor por episodio | IA sólo si respuesta abierta |
| Teach-back | “Explícalo a alguien que conoce A pero no B” | omisiones y errores conceptuales | C; no transferencia por sí misma | usar en límites conceptuales, no cada nodo | Sí para evaluación semántica |
| Feedback | marcar error + regla/contraste + siguiente acción | feedback mostrado, revisión posterior | corrección posterior | feedback una vez; luego nueva acción | Plantillas primero |
| Error diagnosis | elegir/producir causa del error | error_tag, diagnóstico_confidence | repetición o microprobe confirmatorio | no diagnosticar profundamente cada slip | IA sólo para ambigüedad |
| Transfer | escenario sin etiqueta de método | novedades de contexto/representación | T independiente | 1–2 pruebas costosas son mejores que 10 clones | IA para variantes nuevas |
| Context variation | misma estructura en gráfica, texto, tabla, caso | representación y superficie | éxito cruzado | cambiar una o dos dimensiones por vez | Contenido cacheado |
| Desirable difficulty | retraso, recuerdo sin clave, discriminación | éxito, esfuerzo, latencia | aprendizaje posterior | retirar si se convierte en impasse | No |
| Cognitive-load adaptation | segmentar, ocultar detalles, mostrar esquema | complejidad, experiencia, abandono | mejora en desempeño con menos apoyo | no medirla mediante cuestionarios constantes | No |
| Mastery learning | prueba breve + reparación específica | dimensiones de evidencia | requisitos de estado, no % bruto | sólo medir dimensiones aún inciertas | No |
| Student model | silencioso; no actividad propia | evidence ledger completo | N/A | actualizar desde actividades existentes | No |
| Confidence | “¿Qué tan seguro estás?” ocasional | probabilidad/confianza + corrección | calibración, no conocimiento en sí | muestrear en decisiones informativas | No |
| Authentic task | caso/proyecto completo con restricciones | decisiones, artefacto, autonomía | ejecución integral | un whole-task + una perturbación | IA posible para rúbrica |
| Procedural | ejecutar pasos sin checklist progresivamente | orden, omisiones, recuperación | P + excepción | no volver a examinar pasos estables en cada sesión | Simulador/reglas primero |
| Math | seleccionar método y resolver | ecuaciones, pasos, unidades, método | P/S/T según tarea | corrector simbólico/numérico antes de IA | Sólo razonamiento abierto |
| Programming | trace → code → test → debug | tests, edits, errores, consultas | tests + explicación/diagnóstico | tests deterministas consolidan muchos checks | IA para diseño/diagnóstico |
| Language | producir palabra/frase en contexto | modalidad, dirección, fluidez, errores | producción + uso contextual + R | agrupar evidencias por construcción | IA para conversación/semántica |
| Técnico/profesional | simulación de caso + anomalía | pasos, seguridad, desviaciones | whole-task independiente | mayor umbral según riesgo | IA no debe ser único certificador |

**Actividades por tipo de conocimiento.**

Para **conocimiento conceptual**, la secuencia preferida sería: exposición mínima → predicción → ejemplo/no-ejemplo → comparación → recuperación → autoexplicación → aplicación contextual → transferencia. Autoexplicación tiene una base meta-analítica útil, pero no hay razón para solicitarla en cada paso; es más eficiente en puntos donde el razonamiento causal o una distinción conceptual son precisamente la evidencia faltante. citeturn4search1turn4search22

Ejemplo de interfaz:

> **Predice primero**  
> Dos objetos de masas distintas caen en vacío desde la misma altura.  
> ¿Cuál toca el suelo antes?  
>
> [A] el más pesado [B] el más ligero [C] prácticamente al mismo tiempo [No sé]  
>
> **Después de responder:** “Explica en una frase qué variable determina tu elección.”

La selección rápida detecta la concepción y la explicación sólo aparece cuando añade información diagnóstica.

Para **matemáticas y problemas cuantitativos**, un novato debería recibir uno o dos ejemplos trabajados bien elegidos antes de resolver muchos ejercicios similares. Después se ocultan pasos, luego se pide resolución independiente y finalmente se eliminan etiquetas de método y se intercalan problemas que exigen decidir *qué* procedimiento corresponde. Los efectos de worked examples/fading y de práctica mezclada en matemáticas hacen de esta progresión una de las partes mejor respaldadas de la arquitectura. citeturn13search11turn13search16turn13search0turn13search6

Cada problema cuantitativo debería generar evidencia separada de:

`representación → selección_de_método → procedimiento → cálculo → unidades → interpretación`.

Un resultado numérico correcto con ecuación incorrecta y cancelación accidental no merece el mismo update que una solución válida. A la inversa, un error aritmético al final de una estrategia correcta no debería provocar una microlección sobre el concepto principal.

Para **habilidades procedimentales**, la progresión debe ser:

`demostración → ejecución con checklist → checklist reducido → ejecución independiente → fallo/exception handling → tarea completa`.

Las tareas auténticas y PBL pueden favorecer habilidades y aplicación a largo plazo, pero la literatura también muestra que no son automáticamente superiores para adquisición inmediata de conocimiento. Esto favorece una arquitectura híbrida: instrucción explícita y práctica de componentes para adquirir esquemas; whole-tasks para integración y transferencia. citeturn20search9turn20search23

Para **programación**, propondría cinco capas:

`trace código → completar/ordenar → escribir función → depurar código defectuoso → diseñar solución bajo restricciones`.

La app debe usar ejecución real como fuente primaria: parser, compilador, type checker y tests antes que un LLM. Investigaciones sobre entornos de programación para novatos muestran que conectar representaciones del código con su comportamiento puede mejorar desempeño y aprendizaje; evidencia longitudinal reciente sobre debugging contextual también apunta a ventajas de enseñar estrategias usando errores situados, aunque esta última evidencia todavía debe considerarse emergente. citeturn17academia36turn17academia37

Un error en código debería clasificarse, por ejemplo, como:

`SYNTAX`, `STATE_MODEL`, `CONTROL_FLOW`, `DATA_STRUCTURE`, `API`, `ALGORITHM`, `EDGE_CASE`, `DEBUGGING_STRATEGY`, `SPEC_MISREAD`.

Nunca se debería llamar a un LLM para decidir si un programa pasa pruebas deterministas.

Para **idiomas**, el modelo del alumno debe separar al menos:

`recognition`, `receptive_comprehension`, `productive_recall`, `grammar_in_production`, `listening`, `pronunciation`, `interactional_fluency`.

Reconocer *chien → dog* no demuestra que el estudiante pueda producir *chien* espontáneamente en una conversación. Espaciado y recuperación son especialmente pertinentes para vocabulario y formas lingüísticas; trabajos específicos de adquisición de vocabulario L2 también observan beneficios del espaciado. citeturn19search26turn1search9turn19search2

La unidad de práctica debe progresar desde producción controlada hacia uso contextual:

> “Recuerda la palabra” → “completa una frase” → “produce tu propia frase” → “responde en conversación” → “usa la construcción en una situación inesperada”.

No conviene aplicar la misma política de scheduling a pronunciación, vocabulario y fluidez conversacional: son habilidades observables distintas.

Para **conocimiento profesional/técnico**, el producto debe representar no sólo “qué hacer” sino condiciones, señales de peligro, excepciones y recuperación de fallos:

`cue → decisión → acción → comprobación → excepción → recuperación`.

Una actividad de nivel avanzado debería ser:

> “El procedimiento estándar indica A → B → C. En el paso B aparece la anomalía X. Decide si continuar, detener, retroceder o escalar, y justifica con el criterio de seguridad relevante.”

Para dominios de alto riesgo —medicina, aviación, mantenimiento crítico, maquinaria— una app puede producir evidencia de conocimiento o desempeño en simulación, pero **no debería equiparar esa evidencia a certificación operacional real**.

## Motor de decisión y modelo del alumno

**Motor de decisión propuesto.**

La arquitectura debería separar tres operaciones:

```text
OBSERVAR
evento del usuario
    ↓
actualizar evidence ledger

DIAGNOSTICAR
¿qué dimensión sigue incierta o falló?
    ↓
generar hipótesis de causa

ACTUAR
elegir la intervención de mayor valor esperado
    ↓
mostrar actividad mínima necesaria
```

La decisión básica puede ejecutarse localmente:

```text
candidates = allowed_interventions(student_state, concept, session)

for action in candidates:
    score[action] =
        expected_learning_gain(action)
        + w1 * expected_retention_gain(action)
        + w2 * expected_transfer_gain(action)
        + w3 * diagnostic_information_gain(action)
        + w4 * independence_gain(action)
        - w5 * expected_seconds(action)
        - w6 * cognitive_load(action)
        - w7 * friction(action)
        - w8 * ai_cost(action)

return argmax(score)
```

No recomiendo aprender estos pesos con reinforcement learning al principio. Primero deben ser reglas observables y auditables; más adelante, con experimentos aleatorios y suficiente volumen, un contextual bandit puede aprender cuál de dos intervenciones razonables funciona mejor para perfiles concretos. Pasar directamente a una política opaca maximizada sobre clicks o respuestas correctas corre el riesgo de aprender a sobreayudar.

**Matriz de selección de intervención.**

| Señal dominante | Siguiente intervención | Interfaz | Resultado esperado | Persistir |
|---|---|---|---|---|
| Sin exposición | explicación breve | 3–6 unidades visuales/textuales + ejemplo | schema inicial | `INTRODUCED` |
| Novato + alta complejidad | ejemplo trabajado | solución explicada paso a paso | reducir búsqueda | ejemplo visto, pasos |
| Comprende ejemplo | ejemplo parcial | completar 1–3 pasos | transición a generación | pasos generados |
| Está cerca pero bloqueado | pista | pista conceptual, luego estratégica | reactivar proceso | hint_level |
| Confusión conceptual | analogía/representación | contraste visual/verbal | modelo mental alternativo | representation_used |
| Evidencia inmediata buena | retrieval | respuesta sin fuente visible | consolidación | retrieval result |
| Necesita justificar | self-explanation | “¿por qué?” sobre paso crítico | conexión causal | explanation score |
| Confunde categorías | comparación/clasificación | pares o conjunto contrastivo | discriminación | confusion pair |
| Puede ejecutar pero elige mal | interleaved method selection | conjunto mezclado | selección estratégica | chosen_method |
| Aún necesita pasos | práctica guiada | workspace + pistas bajo demanda | procedimiento emergente | hints/steps |
| Ejecuta con poca ayuda | práctica independiente | sin scaffold inicial | independencia | independent flag |
| Sólo funciona en formato conocido | variación contextual | misma estructura, nueva superficie | robustez | novelty dimensions |
| Ejecución estable | transferencia | situación novedosa sin etiqueta | generalización | transfer evidence |
| Evidencia envejecida | revisión espaciada | recall breve integrado | retención | interval/stability |
| Error local persistente | microtutoría | reparación enfocada | cerrar laguna | error + repair |
| Falla un prerequisito | prerequisite probe | micro-item de prerequisito | localizar causa | dependency evidence |
| Componentes estables | tarea auténtica | caso end-to-end | integración | whole-task evidence |
| Competencia integrada | mini-proyecto | artefacto con restricciones | planificación/adaptación | artifact + decisions |
| Fatiga alta / bajo valor marginal | pausa/cambio | “guardemos esto; pasemos a…” | evitar práctica degradada | session fatigue |

La arquitectura de “outer loop / inner loop” de sistemas de tutoría ofrece un precedente útil: el tutor necesita decidir tanto *qué problema viene después* como *qué ayuda dar dentro del problema actual*. citeturn5search12

**Política transversal de respuesta.**

Una **respuesta correcta e independiente** actualiza positivamente la dimensión realmente medida. Si además es una variante o recuperación diferida, el peso de evidencia aumenta.

Una **respuesta parcialmente correcta** conserva las partes válidas y ataca sólo el punto incorrecto. No se debe reiniciar toda la explicación.

Una **concepción errónea** —especialmente si aparece con alta confianza— dispara contraste, ejemplo erróneo o microtutoría. La literatura sobre aprender de ejemplos erróneos indica que explicar el error o inducir autoexplicación es una condición importante; simplemente enseñar soluciones incorrectas puede ser contraproducente. citeturn13search5turn13search8

Si el usuario **usa demasiadas pistas**, la conclusión no es necesariamente “no sabe”. La app debe registrar que la ejecución fue asistida, reducir dificultad o mostrar un ejemplo si sigue bloqueado y pedir posteriormente una nueva ejecución independiente.

Si dice **“No sé”**, no debería recibir tres preguntas reformuladas. “No sé” es una señal eficiente. Con evidencia previa fuerte y antigua: dar una clave mínima/retrieval cue. Sin evidencia previa: enseñar. Con evidencia conflictiva: microprobe diagnóstico.

Si **tarda demasiado**, la app necesita distinguir esfuerzo productivo de impasse. Tiempo largo + pasos correctos = dejar trabajar. Tiempo largo + ausencia de progreso + repetición = pista. El tiempo por sí solo nunca debería marcar desconocimiento.

Si responde **correctamente con baja confianza**, no volver a enseñar todo. Programar una variante independiente cercana y registrar posible subconfianza.

Si responde **incorrectamente con alta confianza**, incrementar prioridad diagnóstica porque la combinación es consistente con una posible concepción errónea; confirmar con un contraste o microprobe antes de etiquetarla permanentemente.

**Modelo del alumno.**

No recomiendo un `mastery = 0.82`. Knowledge tracing es valioso para predecir desempeño longitudinal, y redes recurrentes como DKT han mostrado mejoras predictivas en datasets educativos; pero para un producto inicialmente pequeño, interdisciplinario y explicable, un vector de evidencias es más mantenible que un gran modelo opaco. citeturn14search3

Una representación práctica:

```json
{
  "concept_id": "newton.second_law",
  "state": "INDEPENDENT",
  "dimensions": {
    "recognition": "stable",
    "recall": "provisional",
    "conceptual": "stable",
    "procedure": "stable",
    "method_selection": "provisional",
    "direct_application": "stable",
    "contextual_application": "provisional",
    "interpretation": "provisional",
    "transfer": "unknown",
    "self_explanation": "stable",
    "retention": "pending",
    "independence": "stable"
  },
  "last_evidence_at": "...",
  "stability_bucket": "medium",
  "confidence_calibration": "underconfident",
  "error_tags": ["SIGN_CONVENTION"],
  "recent_hint_level": 0
}
```

Detrás del estado resumido debe existir un **evidence ledger inmutable**:

```text
evidence_id
concept_id
dimension
activity_id
timestamp
result
independent
hint_level
latency
difficulty
context_id
representation_id
novelty_flags
confidence
error_tags
evaluator
evaluator_confidence
source_problem_id
```

La ventaja es que los estados derivados pueden cambiar sin borrar la historia.

**Dimensiones del modelo del alumno.**

| Dimensión | Cómo observar / actividad | No permite inferir | Mínimo provisional | Revisión |
|---|---|---|---|---|
| Exposición | contenido abierto/completado | comprensión | nunca “dominio” | no requiere test |
| Reconocimiento | MCQ, matching | recuerdo libre | 2 variantes si importa | baja prioridad |
| Recuerdo | producir sin claves | aplicación | 2 recalls; uno diferido para estabilidad | spacing |
| Comprensión conceptual | explicar, predecir, contrastar | procedimiento | C | tras errores conceptuales |
| Procedimiento | ejecutar secuencia | saber cuándo usarla | P | espaciada |
| Selección de método | elegir entre alternativas plausibles | ejecución | S | interleaved |
| Aplicación directa | problema cercano | transferencia | P | tras intervalo |
| Aplicación contextual | caso con superficie nueva | transferencia lejana | 1–2 contextos | ante cambio de contexto |
| Interpretación | explicar resultado/gráfica/salida | cálculo | 2 evidencias distintas | si aparecen errores de significado |
| Transferencia | nueva estructura superficial/contextual | retención larga | T | periódica, costosa |
| Autoexplicación | justificar por qué | ejecución | explicación completa en punto crítico | sólo si vuelve a ser relevante |
| Memoria/retención | recall diferido | transferencia | R | por decay/fecha objetivo |
| Independencia | éxito sin ayudas | retención | 2 éxitos sin ayuda | si aumenta hint use |
| Confianza | escala probabilística/categórica | conocimiento | varias parejas confianza-resultado | muestreo ocasional |
| Ayudas | telemetry de hints | incompetencia por sí sola | N/A | siempre registrar |
| Tipo de error | reglas + evaluación semántica | causa psicológica definitiva | repetición o confirmación | decae si desaparece |
| Última evidencia | timestamp | estabilidad por sí sola | N/A | siempre |
| Estabilidad | historial de recuperaciones/intervalos | dominio en otra dimensión | éxito diferido | cuando vence intervalo |
| Método de representación | cambio texto/gráfica/código/etc. | generalización total | éxito en ≥2 relevantes | según dominio |

**Qué no debe inferirse.** Dos resultados son particularmente peligrosos:

`correct_answer → understands`

y

`wrong_answer → lacks_prerequisite`.

Ambas inferencias son demasiado fuertes. Correcto puede resultar de reconocimiento, ayuda, imitación o azar; incorrecto puede resultar de cálculo, lectura, atención, notación o selección de método. De ahí que el modelo guarde *condiciones de producción* de la evidencia.

## Evidencia, dominio, microtutorías y transferencia

**Política de evidencia y dominio.**

Propongo conservar los estados planteados por el usuario, pero hacerlos **derivados**, no manuales:

| Estado | Significado práctico | Qué NO significa |
|---|---|---|
| `UNKNOWN` | sin evidencia útil | incapaz |
| `INTRODUCED` | ha recibido representación inicial | comprende |
| `LEARNING` | hay intentos/feedback activos | progreso garantizado |
| `PARTIALLY_UNDERSTOOD` | algunas dimensiones positivas, otras inciertas | 50 % de “mastery” |
| `PRACTICED` | ejecutó práctica relevante | independiente |
| `INDEPENDENT` | éxito reproducible sin ayuda | transferencia/retención |
| `TRANSFERRED` | aplicó en contexto genuinamente nuevo | retención larga |
| `RETENTION_PENDING` | aprendizaje presente, aún sin prueba diferida | olvidado |
| `RETAINED` | recuperación diferida exitosa | dominio eterno |
| `NEEDS_REVIEW` | evidencia decayó o apareció contradicción | regresar desde cero |

No todos los conceptos necesitan todos estos estados. Un dato factual puede pasar de `INTRODUCED → PRACTICED → RETENTION_PENDING → RETAINED`; una habilidad profesional puede requerir `INDEPENDENT → TRANSFERRED → RETAINED`.

El orden de fuerza aproximado de la evidencia debería ser:

```text
correcto con ayuda
    <
correcto en ejercicio recién modelado
    <
correcto independiente
    <
correcto independiente en variante
    <
correcto con selección de método entre distractores plausibles
    <
correcto en contexto nuevo
    <
correcto diferido
    <
correcto diferido en contexto nuevo
    <
desempeño auténtico independiente
```

Esto es una política de producto derivada de la distinción entre práctica guiada, testing, espaciado, discriminación y transferencia; no una escala psicométrica universal. citeturn1search30turn19search2turn13search0

**Reglas de transición.**

Una respuesta **correcta con ayuda** puede mover `UNKNOWN/INTRODUCED → LEARNING`, pero nunca por sí sola a `INDEPENDENT`.

Una respuesta **correcta sobre el mismo patrón del ejemplo** puede marcar `PRACTICED`.

Dos ejecuciones **independientes** suficientemente distintas pueden marcar `INDEPENDENT` de forma provisional.

Una tarea **novedosa** puede marcar `TRANSFERRED`, pero sólo si la novedad exige reconstruir o seleccionar el conocimiento, no si sólo cambian números o nombres.

Un **recuerdo diferido** puede resolver `RETENTION_PENDING → RETAINED`.

Una **autoexplicación correcta** refuerza comprensión, pero no sustituye la ejecución cuando el objetivo final es procedimental.

Una **tarea auténtica** puede aportar evidencia de integración, selección, planificación, interpretación y adaptación; no debe sobreescribir un error crítico oculto en una subhabilidad.

**Cómo evitar sobre-evaluar.**

La regla central debería ser:

> **No hagas una pregunta si la respuesta no puede cambiar la decisión pedagógica.**

Antes de generar una actividad, el motor pregunta:

```text
¿Qué decisión tomaré si acierta?
¿Qué decisión tomaré si falla?
```

Si ambas respuestas llevan a la misma siguiente actividad, la evaluación tiene poco valor y debe omitirse.

Otras políticas:

`evidence reuse`: una solución matemática ya puede medir procedimiento, método, unidades e interpretación; no formular cuatro preguntas separadas si esos aspectos son observables.

`uncertainty targeting`: sólo evaluar dimensiones capaces de cambiar el estado.

`bundled retrieval`: una actividad integrada puede recuperar varios conceptos relacionados.

`stop-on-information`: una vez que el tutor sabe qué intervención necesita, deja de diagnosticar y enseña.

`delayed evidence`: no intentar demostrar retención cinco minutos después de enseñar; programar la medición cuando sea informativa, consistente con la dependencia temporal del spacing effect. citeturn19search2turn1search16

**Arquitectura de microtutorías.**

La microtutoría debe verse así:

```text
ERROR EN PROBLEMA PADRE
       ↓
hipótesis de causa
       ↓
¿puede distinguirse con evidencia existente?
       ├── sí → intervención
       └── no → UN microprobe
                       ↓
          intervención mínima
                       ↓
       explicación/representación sólo si hace falta
                       ↓
              ejemplo si hace falta
                       ↓
               comprobación
                       ↓
       práctica guiada sólo si hace falta
                       ↓
           intento independiente
                       ↓
        volver al problema padre
                       ↓
      transferencia, sólo cuando aporta valor
```

La microtutoría **entra** cuando el error probablemente refleja una laguna que bloquea el problema padre: error conceptual consistente, repetición de un patrón, impasse prolongado, demanda repetida de ayuda o incapacidad para ejecutar un paso crítico.

**No entra** por un único typo, error aritmético obvio, lapsus autocorregido o equivocación que el propio usuario identifica inmediatamente.

**Cuándo bajar a un prerrequisito.** Hay tres señales especialmente valiosas:

1. el error actual mapea a un prerequisito específico;
2. la evidencia reciente de ese prerequisito es débil o contradictoria;
3. un microprobe muestra que la persona tampoco puede ejecutar/explicar el prerequisito fuera del problema actual.

Si el prerequisito tiene evidencia independiente reciente y el alumno lo supera en un microprobe, el problema suele estar en **aplicación, representación o selección**, no en ausencia de conocimiento base.

Por ejemplo:

```text
problema: calcular aceleración con F = ma
error: divide incorrectamente

probe: "Si 12 = 3x, despeja x."
    correcto → no bajar a álgebra básica;
               trabajar mapeo físico/algebraico
    incorrecto → prerequisito de despeje plausible
```

**Cuándo cambiar de representación.** Si la persona repite una concepción errónea después de una corrección verbal, no debe recibir una paráfrasis más larga del mismo texto. Pruebe diagrama, tabla, línea numérica, simulación, gráfica, ejemplo concreto o código ejecutable. Cognitive Load Theory y el expertise reversal effect sugieren que soportes externos pueden ayudar particularmente cuando el alumno aún no dispone de esquemas automatizados, aunque el soporte redundante debe retirarse cuando deja de aportar. citeturn8search2turn7search5

**Cuándo detener.** Una microtutoría debe terminar en cuanto exista suficiente evidencia para reintentar el problema padre. Un guardrail de producto razonable sería un máximo normal de aproximadamente **tres a cinco intercambios pedagógicos** y **uno o dos niveles de descenso**, no porque esos números sean resultados experimentales universales, sino porque una cadena más profunda suele indicar que el usuario necesita una lección separada, no otra rama recursiva.

**Regresar al problema padre es obligatorio.** Reparar el prerrequisito pero nunca volver al contexto que reveló la carencia mide el prerequisito, no la reparación de la aplicación.

**Cuándo agregar una dependencia al Knowledge Coverage Map.** No modificar el grafo estructural por cada error individual. Crear primero una relación tentativa:

```text
edge:
  source = prerequisite_candidate
  target = parent_skill
  status = inferred
  evidence_count = ...
  confidence = ...
```

Promoverla a dependencia estable cuando la relación tenga apoyo del diseño del dominio, aparezca repetidamente y prediga/repare errores. Esto evita que un diagnóstico incorrecto de un LLM deforme el currículo global.

**Error de aplicación frente a falta de base.**

| Observación | Hipótesis más probable |
|---|---|
| Falla padre y falla prerequisito aislado | laguna base |
| Falla padre pero supera prerequisito aislado | aplicación/selección/representación |
| Sabe explicar, no ejecutar | proceduralización insuficiente |
| Ejecuta al decirle método, falla sin etiqueta | selección de método |
| Ejecuta con pista, falla independiente | scaffold dependence |
| Resuelve formato A, falla formato B | representación/contexto |
| Correcto inmediato, falla días después | retención |
| Correcto con baja confianza reiterada | calibración/subconfianza |
| Incorrecto con alta confianza y patrón estable | posible misconception |

**Estrategia de transferencia.**

La transferencia debe aumentar novedad gradualmente:

```text
mismo principio / misma representación
→ mismo principio / valores distintos
→ mismo principio / superficie distinta
→ representación distinta
→ contexto distinto
→ método no etiquetado
→ problema que mezcla conocimientos
→ anomalía o excepción
→ tarea auténtica
```

Schwartz y Bransford mostraron que ciertas actividades preparatorias pueden hacer que explicaciones posteriores sean mucho más productivas, una base importante para pensar la transferencia no sólo como “examen final” sino como preparación para aprender en una situación nueva. citeturn11search18

La app debería etiquetar explícitamente las dimensiones de novedad del ítem:

```json
{
  "new_surface": true,
  "new_representation": false,
  "new_context": true,
  "method_label_removed": true,
  "multiple_concepts": true,
  "exception_present": false
}
```

Esto permite distinguir una variante superficial de una prueba fuerte de transferencia.

El estado `TRANSFERRED` debería requerir éxito sin pista y sin nombre del método. Cuando el dominio lo permita, una segunda variante con un tipo distinto de novedad reduce el riesgo de falso positivo.

## Repaso espaciado, interleaving, metacognición y autenticidad

**Estrategia de repaso espaciado.**

La conclusión más útil para producto no es “repasar cada X días”, sino que el intervalo óptimo depende del intervalo de retención deseado. Cepeda y colegas encontraron este patrón tanto en su gran revisión de práctica distribuida como en experimentos posteriores que mapearon una “ridgeline” temporal entre gap y retención. citeturn1search16turn19search2

Por tanto, cada skill debería almacenar:

```text
last_retrieval_at
last_independent_success_at
current_interval
target_retention_horizon
stability_bucket
difficulty_bucket
retrieval_latency
recent_failures
hint_dependency
next_due_at
```

No hace falta construir inicialmente un modelo neurocognitivo sofisticado. Un scheduler explicable puede usar:

```text
si éxito independiente, rápido y sin ayuda:
    ampliar intervalo claramente

si éxito independiente pero lento/inseguro:
    ampliar moderadamente

si éxito con pista:
    no considerar retrieval plenamente exitoso;
    intervalo corto/moderado

si fallo:
    reparar;
    volver a comprobar pronto;
    reducir estimación de estabilidad

si dos o más éxitos diferidos:
    ampliar con mayor agresividad
```

Un default de ingeniería para prototipo podría usar una escalera como:

```text
1 día → 3 días → 7 días → 14–21 días → 45–60 días → 90+ días
```

pero **estos números no deben presentarse como una secuencia óptima universal**. Deben adaptarse al horizonte del usuario, al historial y al tipo de conocimiento. La evidencia establece el beneficio de la distribución y la relación entre gap y intervalo de retención, no una agenda única para cada aplicación. citeturn1search16turn19search2

Un concepto procedimental avanzado tampoco debe repasarse siempre mediante una tarjeta. La unidad de review debe corresponder a la habilidad:

- hecho → recall corto;
- concepto → predicción/explicación;
- fórmula → problema breve;
- selección de método → problema intercalado;
- código → trace/debug;
- procedimiento → mini-simulación;
- idioma → producción contextual;
- competencia profesional → escenario breve.

El tutor puede reducir preguntas agrupando varios nodos antiguos dentro de **un problema integrador**, obteniendo evidencia de múltiples conceptos.

**Estrategia de interleaving.**

Interleaving debe comenzar **después de adquirir una representación básica de los métodos individuales**. El objetivo principal de producto no es aleatorizar preguntas: es hacer que el estudiante practique la **discriminación**.

Rohrer y Taylor encontraron que mezclar distintos tipos de problemas matemáticos produjo un desempeño mucho mejor en pruebas posteriores que practicar cada tipo en bloques, aun cuando la práctica bloqueada podía sentirse más fácil. La literatura posterior también advierte que los beneficios dependen de la estructura del material y de qué diferencias debe aprenderse a discriminar. citeturn13search0turn13search6turn0search7

Construiría **contrast sets**:

```text
linear_equation
quadratic_equation
system_of_equations

→ misma sesión
→ en orden semialeatorio
→ sin decir qué método toca
```

El error se divide entonces en:

```text
selection_error
execution_error
```

Esto es extremadamente importante. Un usuario que ejecuta perfectamente la fórmula cuadrática cuando se le indica, pero no reconoce cuándo utilizarla, no tiene la misma laguna que alguien que selecciona correctamente y luego manipula mal la expresión.

Un default inicial razonable es intercalar **dos a cuatro habilidades confundibles**, no veinte temas heterogéneos. La proporción exacta debe experimentarse, no asumirse como ley.

**Estrategia de confianza y metacognición.**

La confianza debe registrarse **antes de mostrar feedback**, pero sólo cuando la información pueda cambiar una acción. Los experimentos de Karpicke y Roediger son una advertencia útil: las predicciones subjetivas de los estudiantes sobre su rendimiento futuro podían desvincularse del desempeño real, por lo que “siento que ya lo sé” no es evidencia suficiente. citeturn1search30

Una interfaz mínima:

> ¿Qué tan seguro estás de tu respuesta?  
> `25 %` `50 %` `75 %` `95 %`

No preguntar siempre. Muestrear, por ejemplo, en:

- primer intento independiente;
- pruebas de transferencia;
- recuperaciones diferidas;
- respuestas susceptibles de misconception;
- antes de decisiones de dominio.

La matriz de acción:

| Desempeño | Confianza | Acción |
|---|---|---|
| Correcto | Alta | avanzar/fade/schedule |
| Correcto | Baja | una variante breve; no reenseñar |
| Incorrecto | Baja | ayuda mínima o enseñanza |
| Incorrecto | Alta | confirmar misconception y contrastar |

La métrica no debe ser “confianza media”, sino **calibración**. Puede medirse con Brier score si la confianza se expresa probabilísticamente:

\[
Brier=\frac{1}{N}\sum_i(p_i-y_i)^2
\]

donde \(p_i\) es confianza y \(y_i\in\{0,1\}\) es exactitud. El usuario no necesita ver la fórmula; sirve para detectar sobreconfianza y subconfianza longitudinalmente.

**Problemas auténticos y proyectos.**

Problem-based learning no justifica reemplazar toda instrucción con proyectos. Meta-análisis y meta-síntesis han encontrado un patrón importante: PBL puede resultar fuerte para aplicación, habilidades y retención prolongada mientras métodos tradicionales pueden tener ventajas en ciertas medidas de adquisición inmediata de conocimientos. citeturn20search9turn20search23

Por tanto:

```text
component skills
      ↓
guided integration
      ↓
mini authentic task
      ↓
whole task
      ↓
novel constraint
      ↓
small project
```

Un proyecto sólo debería aparecer cuando el Knowledge Coverage Map indica suficientes prerrequisitos como para que el trabajo no se transforme en búsqueda indiscriminada, copiar contenido o delegar el artefacto al LLM.

Además, **calidad del artefacto ≠ aprendizaje** en una aplicación con IA. Un usuario puede entregar excelente código, un excelente reporte o una excelente presentación gracias a un asistente. El tutor necesita checkpoints internos:

```text
planificación independiente
decisión de método
explicación de decisiones
ejecución de un componente crítico
debug/revisión
respuesta a una perturbación
```

Ésa es la evidencia que debe alimentar el student model.

## Arquitectura de IA, prioridades y evaluación del producto

**Reglas para reducir llamadas y tokens.**

La arquitectura recomendada es:

```text
                 ┌─────────────────────────┐
                 │ Knowledge Coverage Map  │
                 │ versionado por objetivo │
                 └────────────┬────────────┘
                              │
          ┌───────────────────▼──────────────────┐
          │ Local pedagogical policy engine      │
          │ estado + reglas + scheduler          │
          └───────────┬───────────────┬──────────┘
                      │               │
             determinista         necesita IA
                      │               │
          ┌───────────▼───┐    ┌──────▼──────────┐
          │ evaluadores   │    │ LLM gateway     │
          │ locales       │    │ generate/eval   │
          └───────────────┘    └──────┬──────────┘
                                      │
                               structured result
                                      │
                              Evidence Ledger
```

**Knowledge Coverage Map una sola vez.** Generar el mapa cuando se crea o modifica materialmente el objetivo. Guardar:

```text
goal_version
concept nodes
prerequisite edges
evidence dimensions needed
terminal competencies
assessment templates
domain validators
```

Una microtutoría añade evidencia o como máximo una dependencia tentativa. **No reconstruye el objetivo.**

**Reutilización de contenido.** Separar dos categorías:

```text
REUSABLE
explanations
worked examples
analogies
rubrics
question templates
validated distractors
transfer templates
error explanations

RESPONSE-DEPENDENT
semantic grading
diagnosis
personalized hint
evaluation of free reasoning
repair recommendation
```

Contenido reusable debería cachearse por:

```text
concept_id
activity_type
difficulty
representation
language
curriculum_version
content_version
```

**Evaluar una respuesta una sola vez.** Para una respuesta abierta, una llamada debería devolver un objeto estructurado:

```json
{
  "correctness": "partial",
  "dimensions_observed": {
    "conceptual": "positive",
    "procedure": "negative"
  },
  "error_tags": ["SIGN_CONVENTION"],
  "misconception_candidate": null,
  "diagnostic_confidence": 0.86,
  "feedback_code": "SIGN_CHECK",
  "recommended_intervention": "MINIMAL_HINT"
}
```

Feedback, student-model update y próxima acción consumen **ese mismo resultado**. No volver a llamar al LLM para “decidir qué hacer con la evaluación que el LLM acaba de hacer”.

Una segunda evaluación sólo se justifica cuando:

- confianza del evaluador es baja;
- consecuencias son elevadas;
- evaluación determinista contradice al LLM;
- la respuesta es excepcionalmente ambigua.

**Reglas locales primero.**

No usar LLM para:

```text
multiple choice
exact matching
numeric tolerance
dimensional/unit checks
symbolic equivalence cuando haya CAS
compiler result
unit tests
schedule calculations
hint counters
state transitions
interval scheduling
fatigue/session thresholds
known error templates
```

Usar LLM para:

```text
evaluar explicación abierta
diagnóstico semántico ambiguo
crear analogía nueva
crear variante que satisfaga restricciones complejas
evaluar razonamiento cualitativo
feedback sobre proyecto
conversación lingüística
```

La literatura de ITS apoya el valor de tutoría adaptativa, pero no exige que esas adaptaciones provengan de modelos generativos; separar selección de tareas y tutoring paso a paso es coherente con arquitecturas de tutoring estudiadas durante décadas. citeturn6search22turn5search12

**No mandar el chat completo.** El contexto pedagógico de una llamada debería ser una vista compacta:

```json
{
  "goal": "...",
  "concept": "...",
  "task": "...",
  "expected_solution": "...",
  "student_answer": "...",
  "relevant_state": {
    "conceptual": "provisional",
    "procedure": "stable",
    "error_tags": ["..."]
  }
}
```

El evidence ledger permanece en backend. Esto reduce tokens, exposición de datos y contaminación del modelo por conversaciones irrelevantes.

**Registrar cada llamada.**

```text
call_id
session_id
learner_id pseudonymized
concept_id
activity_type
call_reason
model
prompt_version
input_tokens
output_tokens
cached_tokens
latency_ms
cost
cache_hit
evaluation_confidence
action_selected
state_change
delayed_outcome
```

El indicador económico importante no es `cost/message`.

Debe medirse, por ejemplo:

\[
\text{Cost per Retained Evidence Unit}
=
\frac{\text{gasto IA}}
{\text{transiciones validadas que sobreviven un test diferido}}
\]

y

\[
\text{Useful Learning per Minute}
=
\frac{\text{nueva evidencia independiente/transferible/retenida}}
{\text{minutos activos}}
\]

Son métricas propuestas de producto, no escalas académicas estandarizadas.

**Prioridades de implementación.**

**P0 — construir antes de añadir más contenido generado.**

| Entrega | Razón |
|---|---|
| Evidence ledger por dimensión | evita scalar mastery |
| Registro de independencia/hints | distingue asistencia de capacidad |
| Policy engine determinista | reduce IA y hace auditable la adaptación |
| Worked example → fading → independent | alto valor para habilidades complejas de novatos. citeturn13search11turn13search16 |
| Retrieval + scheduling básico | fuerte evidencia para retención. citeturn1search9turn1search16 |
| Estados de dominio derivados | evita falso mastery |
| Evaluador LLM único y estructurado | elimina llamadas redundantes |
| Validators deterministas | baja costo y mejora consistencia |
| Parent-problem return | garantiza reparación funcional |

**P1 — convertir práctica en adaptación real.**

Implementar taxonomía de errores, microtutorías con caps, interleaving por conjuntos confundibles, selección de método, confianza ocasional, transferencia progresiva, scheduler que use edad/independencia/latencia y control de representaciones. Interleaving y autoexplicación tienen buena evidencia, pero necesitan aplicarse selectivamente y no como ritual universal. citeturn13search0turn4search1

**P2 — integración y autenticidad.**

Añadir mini whole-tasks, proyectos, excepciones, debugging avanzado, conversación de idiomas, multimodalidad, tareas profesionales y representación múltiple. La evidencia sobre PBL favorece precisamente no sustituir prematuramente la adquisición explícita de componentes, sino usar problemas complejos donde su valor para integración y aplicación sea mayor. citeturn20search9turn20search23

**P3 — optimización basada en datos.**

Sólo después de disponer de mucho tráfico experimental: parámetros aprendidos de estabilidad, modelos predictivos de knowledge tracing, contextual bandits para escoger entre intervenciones aceptables, descubrimiento de relaciones en el Knowledge Coverage Map y personalización de secuencias. DKT demuestra que modelos secuenciales pueden aumentar capacidad predictiva, pero mejor predicción de respuestas no garantiza por sí misma una mejor política pedagógica; por eso no lo pondría en P0. citeturn14search3

**Experimentos y métricas de evaluación del producto.**

La métrica primaria debería ser **aprendizaje retardado independiente**, no porcentaje correcto dentro de la sesión.

Un dashboard de producto debería incluir:

| Métrica | Definición | Qué detecta |
|---|---|---|
| Delayed Retrieval Success | % de recalls correctos tras intervalo | retención |
| Transfer Success | éxito en ítems novedosos | generalización |
| Time to Independent | minutos hasta ejecución sin ayuda | eficiencia |
| Useful Learning / Minute | nuevas evidencias fuertes por minuto | productividad |
| Hint Dependency | ayudas por éxito | dependencia |
| False Mastery Rate | nodos “dominados” que fallan prueba fresca/diferida | sobreestimación |
| Parent Repair Rate | tras microtutoría, % que resuelve problema padre | utilidad real de reparación |
| Calibration Error | discrepancia confianza–exactitud | metacognición |
| Method Selection Accuracy | elección correcta en mixed practice | discriminación |
| Retention Regression | caída de evidencia tras intervalos | olvido |
| LLM Calls / Evidence Gain | llamadas por update útil | eficiencia IA |
| Tokens / Retained Skill | tokens hasta evidencia retenida | coste pedagógico |
| Over-assessment Ratio | actividades de evaluación que no cambian política | preguntas innecesarias |

Los experimentos iniciales más valiosos serían:

| Experimento | A | B | Resultado primario |
|---|---|---|---|
| Novato complejo | practice-first | worked example + fading | aprendizaje/minuto + test diferido |
| Scheduling | intervalo fijo | estabilidad adaptativa | delayed retrieval |
| Method choice | blocked | interleaving posterior | selección/transferencia |
| Microtutor | cadena recursiva | diagnóstico + reparación mínima + parent return | parent repair/time |
| Confidence | nunca | muestreo informativo | calibración + fricción |
| Mastery | acierto inmediato | evidencia multidimensional | false mastery |
| Evaluación IA | LLM-everything | deterministic-first | calidad, costo, latencia |
| Transfer gating | sin prueba | variante/contexto requerido | desempeño futuro novel |

Para retention se necesitan medidas posteriores: por ejemplo, un punto temprano y otro más distante como siete y treinta días cuando el producto y el dominio lo permitan. Esos intervalos son **diseños experimentales razonables**, no intervalos universales de memoria. La necesidad de medir retardadamente sí está firmemente motivada por la literatura de testing y spacing. citeturn1search30turn19search2

Los test items utilizados como outcomes deberían ser nuevos o equated; reutilizar el mismo ejercicio que entrenó el alumno infla artificialmente el rendimiento.

## Riesgos, límites de la evidencia, referencias y reglas implementables

**Riesgos, incertidumbres y límites de la evidencia.**

El primer límite es la **generalización de laboratorio a producto**. Retrieval, spacing, worked examples y otros efectos tienen bases experimentales robustas, pero su magnitud cambia según material, población, duración y test final. La existencia de un efecto promedio no autoriza un scheduler idéntico ni un número fijo de ejercicios para matemáticas, cirugía y japonés. citeturn1search9turn1search16turn13search11

El segundo es la **transferencia lejana**. Obtener desempeño mejor en variantes relacionadas es mucho más sencillo que demostrar que una estrategia generaliza a situaciones radicalmente distintas. LearnAnything debería registrar exactamente qué dimensión de contexto cambió y evitar la etiqueta `TRANSFERRED` para simples sustituciones superficiales.

El tercero es el **expertise reversal**. Una app que siempre “explica muy bien” puede degradarse precisamente cuando el alumno se vuelve experto: explicaciones, ayudas y ejemplos que inicialmente reducían carga pueden convertirse en redundancia. citeturn7search5turn7search33

El cuarto es confundir **Feynman/teach-back** con una técnica experimental independiente. Su valor razonable proviene de componentes que sí tienen literatura —generación, recuperación y autoexplicación—; el nombre de la técnica no debe recibir un estatus causal propio. citeturn4search1turn1search9

El quinto es confundir **dificultad con aprendizaje**. Interleaving, retrieval y spacing pueden reducir rendimiento inmediato mientras mejoran aprendizaje posterior, pero añadir confusión, textos difíciles o frustración sin un mecanismo relevante no constituye una “desirable difficulty”. citeturn13search0turn19search2

El sexto es la **fiabilidad del evaluador IA**. Un LLM puede producir feedback plausible pero incorrecto, inferir misconceptions inexistentes o ser demasiado indulgente. Por eso las decisiones objetivamente verificables deben delegarse a tests, CAS, compiladores, esquemas y reglas; el LLM debería devolver además confianza diagnóstica y ser escalado cuando exista contradicción.

El séptimo es el **sesgo de la métrica**. Optimizar “% correcto” recompensa pistas, ítems fáciles y repetición; optimizar “engagement” recompensa sesiones largas. La función objetivo debe incorporar evidencia diferida, independencia y transferencia.

El octavo es **proyecto ≠ conocimiento interno**. Con IA generativa, un artefacto profesional puede ser excelente aunque el alumno no pueda reproducir sus decisiones. Los proyectos deben contener checkpoints independientes.

El noveno es la **privacidad del modelo del alumno**. Error tags y confidence profiles pueden volverse inferencias sensibles. El producto debería guardar evidencias pedagógicas concretas y evitar etiquetas psicológicas amplias como “perezoso”, “mala memoria” o “baja capacidad”.

El décimo es la **seguridad profesional**. Para conocimiento médico, industrial, eléctrico, aeronáutico u otro de alta consecuencia, las pruebas digitales son evidencia de aprendizaje, no autorización para actuar independientemente en el mundo real.

**Referencias académicas y enlaces.** El nivel de confianza de esta tabla es una valoración de síntesis para decisiones de producto, no una calificación GRADE formal.

| Autores / año | Evidencia | Aporte | Confianza |
|---|---|---|---|
| Rowland, 2014 | Meta-análisis | testing/retrieval frente a restudy; recuperación de recuerdo especialmente útil. citeturn1search9 | Alta |
| Adesope, Trevisan & Sundararajan, 2017 | Meta-análisis | testing como estrategia de aprendizaje. citeturn1search7 | Alta |
| Karpicke & Roediger, 2008 | Experimentos, *Science* | repeated retrieval favorece retención; restudy repetido no produce el mismo efecto. citeturn1search30 | Alta |
| Cepeda et al., 2006 | Revisión cuantitativa / meta-análisis, 317 experimentos | práctica distribuida y relación entre lag y retención. citeturn1search16 | Alta |
| Cepeda et al., 2008 | Experimentos | intervalo óptimo depende del horizonte de retención. DOI 10.1111/j.1467-9280.2008.02209.x. citeturn19search2turn19search10 | Alta |
| Rohrer & Taylor, 2007 | Experimentos matemáticos | spacing/interleaving mejoran desempeño retardado. citeturn13search0turn13search6 | Alta-media |
| Bisra et al., 2018 | Meta-análisis | efectos de inducir autoexplicación. citeturn4search1 | Alta-media |
| Larsen et al., 2013 | Estudio experimental en educación médica | autoexplicación puede beneficiar retención/aplicación, con variación por tema. citeturn4search22 | Media |
| Schwonke et al., 2009 | Experimentos con Cognitive Tutor | ejemplos trabajados desvanecidos pueden ahorrar tiempo y apoyar comprensión conceptual. citeturn13search11 | Alta-media |
| Salden, Aleven, Renkl & Schwonke, 2009 | Estudios adaptativos | fading adaptado a self-explanation y transferencia. citeturn13search16 | Media-alta |
| Kalyuga et al., 2003 | Revisión | expertise reversal effect. citeturn7search5 | Alta |
| Rey, 2011 | Síntesis experimental | evidencia adicional sobre expertise reversal. citeturn7search33 | Alta-media |
| Sweller, 2019/2020 | Revisión teórica | Cognitive Load Theory y diseño tecnológico. citeturn8search2 | Alta como marco, efectos específicos dependen del diseño |
| Hattie & Timperley, 2007 | Revisión | modelo de feedback y niveles de feedback. DOI 10.3102/003465430298487. citeturn16search0 | Alta-media |
| Wisniewski, Zierer & Hattie, 2020 | Meta-análisis | gran heterogeneidad de efectos del feedback; contenido importa. DOI 10.3389/fpsyg.2019.03087. citeturn16search1turn16search13 | Alta |
| Kulik, Kulik & Bangert-Drowns, 1990 | Meta-análisis de 108 evaluaciones | mastery learning positivo en promedio, dependiente del diseño y contexto. DOI 10.3102/00346543060002265. citeturn14search1turn14search5 | Alta-media |
| Kulik & Fletcher, 2016 | Meta-análisis de ITS | eficacia general de sistemas de tutoría inteligente. citeturn6search22 | Alta-media |
| VanLehn, 2006 | Síntesis/arquitectura ITS | separación de bucles de task selection y step tutoring. citeturn5search12 | Alta como referencia arquitectónica |
| Piech et al., 2015 | Estudio de knowledge tracing | DKT mediante redes recurrentes y predicción secuencial. citeturn14search3turn14search7 | Alta para el resultado predictivo original; no prueba mejor pedagogía |
| Macnamara, Hambrick & Oswald, 2014 | Meta-análisis | deliberate practice explica porciones muy distintas de rendimiento por dominio. citeturn10search0 | Alta |
| Schwartz & Bransford, 1998 | Experimentos | preparación para aprendizaje futuro / “A Time for Telling”. citeturn11search18turn11search28 | Alta-media |
| Meta-análisis de erroneous examples, 2025 | Meta-análisis | conocimiento previo y explicación del error moderan aprendizaje de errores. citeturn13search5turn13search8 | Media-alta |
| Strobel & van Barneveld, 2009 | Meta-síntesis de meta-análisis | PBL mejor para algunos resultados de skills/retención; instrucción tradicional para algunos resultados inmediatos. DOI 10.7771/1541-5015.1046. citeturn20search9turn20search16 | Media-alta |
| Dochy et al., 2003 | Meta-análisis de PBL | efectos positivos en skills/application y resultados más mixtos para conocimiento. citeturn20search23 | Media-alta |
| Witte et al., 2022 | Estudio experimental en programación | linking/highlighting entre código y representación puede apoyar novatos. citeturn17academia36 | Media |
| Zhang, Roy & Arnaoudova, 2025 | Estudio longitudinal, preprint | instrucción contextual de debugging mostró resultados prometedores. citeturn17academia37 | Baja-media hasta mayor replicación |
| Lotfolahi & Salehi, 2017 | Estudio L2 | efectos de spacing en aprendizaje de vocabulario EFL. citeturn19search26 | Media |

La síntesis general de la literatura conduce a una arquitectura menos espectacular que “un agente IA que sabe enseñar cualquier cosa”, pero mucho más defendible: **un policy engine pequeño, un modelo de evidencias explícito, herramientas deterministas, contenido reutilizable y un LLM reservado para los puntos donde realmente aporta comprensión semántica o generación nueva**. La ventaja competitiva de LearnAnything no debería ser generar infinitamente contenido; debería ser saber **cuándo explicar, cuándo callar, cuándo dejar intentar, cuándo ayudar, cuándo volver y cuándo ya hay suficiente evidencia para avanzar**.

**Las 10 reglas implementables de mayor impacto para LearnAnything**

| Regla | Condición | Intervención | Evidencia requerida | Datos a persistir | ¿IA? | Riesgo de mala implementación | Prueba automatizable |
|---|---|---|---|---|---|---|---|
| **No declarar dominio por un acierto** | primer éxito de un nodo | continuar con variante, independencia o scheduling | ≥2 evidencias independientes cuando la habilidad lo exige; transferencia/retención aparte | item, variant, hints, timestamp, independence | No | inflación de mastery | test unitario: un único correct nunca produce `INDEPENDENT/RETAINED` |
| **Ejemplo antes de búsqueda para novatos** | baja evidencia previa + tarea compleja | ejemplo trabajado → fading | comprensión del ejemplo y posterior generación | prior evidence, steps viewed, fading level | Sólo generación reusable | sobreexplicar a expertos | policy test: novice/high-load selecciona worked example; expert no |
| **La ayuda cancela evidencia de independencia** | respuesta correcta después de hint crítico | guardar como aprendizaje asistido; nueva variante posterior | éxito sin ayuda | hint_level, hint_type, correctness | No | tratar respuesta asistida como mastery | invariant: `hint_level > threshold` no incrementa independence |
| **Recuperar antes de volver a explicar cuando hay evidencia previa** | skill aprendido pero envejecido | retrieval corto | intento producido sin material visible | age, latency, correctness | Normalmente no | hacer retrieval cuando nunca se enseñó | policy test con `INTRODUCED` vs `RETAINED/old` |
| **Intercalar para enseñar selección, no para aleatorizar** | ≥2 métodos ejecutables individualmente | mixed method-selection problem | método correcto sin etiqueta + ejecución | candidate methods, choice, execution | No salvo generación | interleaving prematuro | test: skills no adquiridos bloquean mixed practice |
| **Error de alta confianza merece diagnóstico; error aislado no merece teoría** | incorrecto + confianza alta o patrón repetido | contraste/microprobe → reparación mínima | confirmación de misconception | answer, confidence, error_tag, repeat count | Sólo si ambiguo | LLM inventa misconception | test: un typo único nunca crea permanent misconception tag |
| **Toda microtutoría vuelve al problema padre** | laguna reparada | reanudar exactamente el contexto original | resolución/revisión del paso que falló | parent_problem_id, repair evidence, return result | No para routing | reparar subskill pero no aplicación | workflow test exige terminal `RETURN_TO_PARENT` |
| **Retención sólo se actualiza con evidencia temporal** | éxito inmediato | marcar `RETENTION_PENDING`, programar revisión | recall correcto tras intervalo | interval, due date, delayed result, stability | No | confundir práctica inmediata con memoria | state test: same-session success no produce `RETAINED` |
| **Determinismo antes que LLM** | respuesta comprobable por reglas, CAS, compilador o tests | evaluator local | resultado verificable | evaluator_type, result, diagnostics | **No** | gastar más y obtener evaluación menos estable | integration test: numeric/code/MCQ path realiza cero llamadas LLM |
| **No preguntar cuando la respuesta no cambia la política** | ambas ramas posible correcto/incorrecto llevan a la misma acción | omitir evaluación y ejecutar directamente la intervención útil | ninguna adicional | skipped_assessment_reason, expected information gain | No | subevaluar casos realmente inciertos | policy test: actividad con `expected_information_gain ≈ 0` es eliminada |