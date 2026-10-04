# AGENTS.md — LearnAnything

## 1. Propósito

LearnAnything es un tutor personal adaptativo para uso propio y familiar.

Su objetivo es transformar una meta amplia en una ruta de aprendizaje personalizada, medible y adaptativa:

```text
objetivo verificable
→ mapa de habilidades y prerrequisitos
→ diagnóstico de conocimiento previo
→ enseñanza necesaria
→ práctica deliberada
→ feedback
→ reparación dirigida por error
→ aplicación
→ transferencia
→ retención
→ independencia
```

Optimizar para:

```text
comprensión + independencia + transferencia + retención
------------------------------------------------------
                 esfuerzo razonable
```

No optimizar prioritariamente para:

- crecimiento;
- viralidad;
- monetización;
- arquitectura de startup;
- costo mínimo por usuario;
- métricas de actividad sin relación con aprendizaje.

La calidad pedagógica tiene prioridad sobre ahorrar pequeñas cantidades de costo o latencia.

Aun así:

- no hacer llamadas redundantes;
- no enviar contexto innecesario;
- no usar IA cuando una regla local sea suficiente.

---

# 2. Prioridades

En este orden:

1. Mantener un tutor funcional de extremo a extremo.
2. Conseguir aprendizaje demostrable.
3. Basar progreso en evidencia de desempeño.
4. Preservar progreso y datos existentes.
5. Mantener decisiones pedagógicas explicables.
6. Funcionar en dominios muy distintos.
7. Mantener código modular, comprobable y extensible.
8. Mantener costo y latencia razonables sin sacrificar aprendizaje real.

Ante un conflicto:

```text
seguridad y datos reales
→ política pedagógica
→ preservación del progreso
→ funcionalidad end-to-end
→ corrección
→ UX
→ optimización
→ refactor estético
```

---

# 3. Fuentes de verdad

Antes de modificar una parte del sistema, leer la documentación correspondiente.

## Siempre relevante

1. `AGENTS.md`
2. README, launcher o archivo de inicio de la versión activa.
3. Tests relacionados.
4. Código que realmente se ejecuta.

## Según el área

### Pedagogía y selección de actividades

Leer:

```text
docs/tutor_policy_v1.md
docs/learning_science.md
```

La política pedagógica define qué debe hacer el tutor.

---

### Evidencia, estado del estudiante y persistencia

Leer:

```text
docs/data_model.md
```

---

### Prompts, evaluación semántica y uso de modelos

Leer:

```text
docs/llm_policy.md
```

---

### Arquitectura

Leer:

```text
docs/architecture.md
```

---

### Visión de producto

Leer:

```text
docs/product_vision.md
```

---

### Trabajo futuro

Leer:

```text
BACKLOG.md
```

El backlog no define comportamiento actual.

---

# 4. Regla fundamental de diseño

Preferir:

```text
modelo → comprensión/generación/evaluación semántica
código local → reglas/estado/invariantes/transiciones
```

El modelo puede proponer.

La aplicación decide.

Nunca permitir que una salida del LLM tenga autoridad directa para:

- borrar progreso;
- saltarse invariantes;
- declarar dominio sin evidencia;
- modificar arbitrariamente estado persistido;
- decidir transiciones críticas sin validación local.

---

# 5. Modelo de evidencia

No usar una única puntuación de mastery como fuente primaria de verdad.

Mantener separadas:

```text
EvidenceEvent
    qué ocurrió

DerivedStudentState
    qué podemos inferir de la evidencia acumulada

TutorDecisionEvent
    qué decidió hacer el tutor y por qué
```

Una decisión del tutor nunca es evidencia de aprendizaje.

No modificar el historial para producir un estado deseado.

Agregar eventos y recalcular estado derivado.

---

# 6. Dimensiones importantes

El aprendizaje puede tener dimensiones independientes.

Entre otras:

```text
conceptual
procedure
method_selection
application
independence
transfer
retention
memory
self_explanation
```

No todas las actividades observan todas las dimensiones.

No todas las metas requieren todas las dimensiones.

Actualizar únicamente aquello que una actividad realmente permite observar.

---

# 7. Distinciones que nunca deben colapsarse

Mantener siempre separadas estas ideas:

```text
exposición ≠ aprendizaje demostrado

ayuda ≠ independencia

éxito guiado ≠ éxito independiente

éxito inmediato ≠ retención

variante ≠ transferencia

dificultad ≠ transferencia

error diagnóstico ≠ fallo de aprendizaje

error aislado ≠ debilidad estable

decisión del tutor ≠ evidencia

confianza del evaluador ≠ certeza
```

---

# 8. Invariantes no negociables

Estas reglas deben implementarse localmente.

El modelo no tiene autoridad para romperlas.

```text
IF exposure_only
THEN independence_evidence += 0
```

```text
IF critical_hint_used
THEN independence_evidence += 0
```

```text
IF same_session_success
THEN retention != STABLE
```

```text
IF activity_does_not_observe_dimension
THEN do_not_update_dimension
```

```text
IF transfer_activity_has_no_meaningful_novelty
THEN transfer_evidence += 0
```

```text
IF diagnostic_activity AND result == incorrect
THEN counts_as_learning_failure = false
```

```text
IF deterministic_validator_available
THEN do_not_call_llm_for_evaluation
```

```text
IF existing_evaluation_for_same_response
THEN reuse_structured_evaluation
```

```text
IF microtutoring_closed
THEN parent_problem_retry_must_exist
```

```text
IF isolated_slip
THEN do_not_create_persistent_error_profile
```

```text
IF policy_branch_for_correct == policy_branch_for_incorrect
THEN skip_redundant_assessment
```

Antes de añadir una regla nueva al prompt, preguntar:

> ¿Puede convertirse en una regla determinista local?

Si la respuesta es sí, preferir código.

---

# 9. Flujo pedagógico mínimo

La implementación detallada vive en `docs/tutor_policy_v1.md`.

A nivel arquitectónico debe mantenerse:

```text
meta
→ mapa/prerrequisitos
→ diagnóstico cuando sea útil
→ enseñanza o actividad apropiada
→ evidencia
→ decisión
→ práctica/adaptación
→ transferencia y retención cuando correspondan
```

## Primera exposición

No convertir falta de conocimiento previo en exámenes repetidos.

Cuando el usuario necesita aprender algo nuevo:

```text
enseñanza suficiente
→ ejemplo / representación / demostración
→ comprobación útil
→ práctica
```

---

# 10. Error y microtutoría

Un error no autoriza automáticamente a descender por el grafo.

Antes de bajar a un prerrequisito:

1. Identificar un posible prerequisito concreto.
2. Revisar evidencia reciente.
3. Usar una comprobación breve si sigue existiendo ambigüedad.
4. Descender solo si existe evidencia suficiente.

Un typo o slip aislado no debe producir una microtutoría extensa.

Una microtutoría válida sigue conceptualmente:

```text
error relevante
→ hipótesis conservadora
→ intervención mínima
→ comprobación
→ práctica necesaria
→ intento independiente
→ retorno al problema padre
```

Toda microtutoría debe poder regresar al problema que la originó.

---

# 11. Transferencia

No llamar transferencia a:

- cambiar números;
- cambiar nombres;
- repetir la misma estructura superficial;
- resolver una variante prácticamente idéntica.

La transferencia requiere novedad significativa respecto de la práctica anterior.

Solo registrar evidencia de transferencia cuando la actividad fue diseñada para observarla.

---

# 12. Retención

No inferir retención durable de desempeño inmediato.

Conceptualmente:

```text
éxito inmediato
→ conocimiento disponible ahora

recuperación diferida independiente
→ evidencia de retención
```

Los intervalos de revisión no son universales.

Pueden depender de:

- tipo de conocimiento;
- importancia;
- uso esperado;
- evidencia previa;
- dificultad;
- riesgo de olvido.

---

# 13. Uso de modelos de IA

Usar modelos potentes cuando aporten valor real a:

- razonamiento;
- evaluación semántica;
- explicación;
- generación compleja;
- descomposición de metas;
- feedback abierto;
- tareas auténticas;
- transferencia;
- síntesis de información.

No usar un modelo potente por defecto para operaciones mecánicas.

## Orden de decisión

Antes de llamar a un LLM:

```text
1. ¿Puede resolverse determinísticamente?
   → hacerlo localmente.

2. ¿Existe contenido reusable válido?
   → reutilizarlo.

3. ¿Ya existe una evaluación válida?
   → reutilizarla.

4. ¿La policy y el estado permiten decidir?
   → decidir localmente.

5. ¿Hace falta comprender o generar semánticamente?
   → llamar al modelo.
```

---

# 14. Separación de responsabilidades del LLM

Mantener desacoplados:

```text
provider
model
prompt_version
schema_version
policy_version
```

Cambiar de proveedor o modelo no debe requerir cambiar la política pedagógica.

Las llamadas que puedan afectar estado deben producir datos estructurados y validables.

La salida del modelo es una señal.

La política local tiene prioridad.

---

# 15. Contexto enviado al modelo

Enviar solo el contexto necesario para la tarea actual.

No enviar automáticamente:

- historial completo;
- todos los nodos del grafo;
- todas las respuestas anteriores;
- progreso no relacionado;
- datos personales innecesarios;
- información técnica confidencial;
- secretos;
- API keys.

Preferir un contexto pequeño y explícito compuesto por:

```text
objetivo relevante
+ concepto actual
+ evidencia relevante
+ actividad actual
+ restricciones necesarias
```

---

# 16. Seguridad

Nunca:

- exponer API keys al navegador;
- escribir secretos en código;
- incluir secretos en commits;
- incluir secretos en logs;
- inventar datos de una instalación técnica;
- enviar información privada innecesaria a proveedores externos.

Usar variables de entorno u otro mecanismo seguro para credenciales.

---

# 17. Persistencia

El progreso del usuario es un activo crítico.

Nunca eliminarlo accidentalmente.

Reglas:

- no cambiar claves persistentes sin migración;
- toda migración debe ser idempotente;
- conservar compatibilidad con datos legacy cuando sea razonable;
- mantener `schema_version`;
- respaldar antes de transformaciones destructivas;
- nunca inventar evidencia histórica;
- nunca convertir ausencia de datos en evidencia positiva o negativa.

Campos nuevos deben poder leerse de forma segura cuando estén ausentes.

---

# 18. Compatibilidad

No reescribir toda la aplicación para introducir una mejora local.

Preferir:

```text
cambio pequeño
→ compatible
→ probado
→ reversible
```

antes que:

```text
reescritura grande
→ arquitectura nueva
→ migración innecesaria
→ riesgo desconocido
```

No sustituir una versión funcional sin justificar:

- beneficio;
- compatibilidad;
- pruebas;
- migración;
- reversión.

---

# 19. Estado actual del proyecto

El estado concreto del código cambia con frecuencia.

No mantener aquí una descripción exhaustiva de archivos, versiones o limitaciones temporales.

Confirmar siempre la versión activa mediante:

- README;
- launcher;
- comando usado;
- imports;
- tests;
- entrada real del programa.

No asumir que el archivo con mayor número de versión es el que se ejecuta.

La arquitectura actual y sus limitaciones deben documentarse en:

```text
docs/architecture.md
```

---

# 20. Procedimiento antes de modificar código

Antes de editar:

1. Identificar qué código se ejecuta realmente.
2. Leer código afectado.
3. Leer tests relacionados.
4. Leer documentación especializada relevante.
5. Identificar invariantes involucrados.
6. Identificar compatibilidad requerida.
7. Formular el cambio mínimo necesario.

Cuando sea útil, distinguir:

```text
hechos confirmados
supuestos
riesgos
cambio propuesto
```

No afirmar que algo existe, funciona o fue probado sin verificarlo.

---

# 21. Procedimiento después de modificar código

Después de editar:

1. Ejecutar pruebas relevantes.
2. Añadir pruebas para comportamiento nuevo.
3. Validar un flujo mínimo end-to-end cuando corresponda.
4. Verificar que no se perdió progreso.
5. Verificar que no aparecieron llamadas LLM redundantes.
6. Verificar restauración correcta de estado.
7. Documentar cambios de esquema.
8. Documentar migraciones.
9. Actualizar documentación si cambió una decisión estable.

Explicar claramente:

- qué cambió;
- por qué;
- qué se probó;
- qué no se probó;
- riesgos restantes.

---

# 22. Testing del motor pedagógico

Toda regla pedagógica importante debe ser testeable de manera determinista siempre que sea posible.

Como mínimo deben existir pruebas para estas propiedades:

```text
“No sé” sin exposición
→ enseñanza, no castigo

diagnóstico incorrecto
→ no learning_failure

respuesta con ayuda crítica
→ no independence gain

respuesta independiente
→ solo actualiza dimensiones observadas

éxito inmediato
→ no retention stable

recuperación diferida
→ puede aportar retención

slip aislado
→ no perfil persistente

prerequisite probe correcto
→ no descenso innecesario

microtutoría resuelta
→ parent retry

actividad sin novedad relevante
→ no transferencia

validador determinista disponible
→ cero evaluación LLM

evaluación existente de la misma respuesta
→ no segunda evaluación

migración legacy
→ no pérdida ni invención de progreso
```

---

# 23. Anti-patrones

No hacer sin una razón explícita y documentada:

- reescribir toda la app para adoptar un framework;
- sustituir una arquitectura funcional por una nueva;
- eliminar progreso;
- regenerar mapas completos innecesariamente;
- enviar todo el historial al modelo;
- evaluar dos veces la misma respuesta;
- marcar dominio por un acierto guiado;
- marcar retención por un acierto inmediato;
- llamar transferencia a cambios superficiales;
- crear perfiles psicológicos;
- implementar estilos de aprendizaje fijos;
- abrir microtutorías ilimitadas;
- usar IA para lógica determinista;
- añadir modos de UX como sistemas pedagógicos paralelos;
- inventar características no observadas del usuario;
- declarar mejoras de aprendizaje sin medición;
- declarar reducción de costo sin medición;
- declarar compatibilidad sin pruebas.

---

# 24. Modelo del estudiante

El sistema puede recordar:

- objetivos;
- conceptos estudiados;
- evidencia de desempeño;
- errores observados;
- ayudas utilizadas;
- recuperaciones;
- preferencias explícitas;
- patrones respaldados por evidencia suficiente.

No convertir observaciones temporales en rasgos permanentes.

Permitido:

```text
“El usuario ha tenido dificultades repetidas al seleccionar método
en tres actividades recientes.”
```

No permitido:

```text
“El usuario es malo en matemáticas.”
“El usuario es visual.”
“El usuario no tiene capacidad para este tema.”
```

Los patrones derivados deben ser:

```text
basados en evidencia
+ fechados
+ revisables
+ debilitables con nueva evidencia
```

---

# 25. Conexiones entre dominios

LearnAnything puede relacionar conocimientos entre diferentes objetivos.

Pero distinguir:

```text
prerequisite
analogy
shared_principle
user_confirmed
inferred_candidate
```

Una analogía o conexión inferida no debe convertirse automáticamente en una relación curricular verdadera.

---

# 26. Modos de aprendizaje

Los modos de UX deben modificar parámetros de una política pedagógica común.

No crear motores pedagógicos paralelos para:

- modo rápido;
- modo reto;
- modo socrático;
- comprensión profunda;
- modo proyecto.

La definición detallada de estos modos vive en:

```text
docs/tutor_policy_v1.md
```

---

# 27. Explicabilidad

Una decisión pedagógica importante debería poder responder:

```text
¿Qué evidencia usamos?

¿Qué falta por demostrar?

¿Por qué se eligió esta actividad?

¿Qué resultado cambiaría la siguiente decisión?
```

Registrar razones estructuradas cuando sea útil.

No generar explicaciones post-hoc incompatibles con la decisión real.

---

# 28. Métricas

No confundir:

```text
uso
actividad
engagement
número de respuestas
tiempo en la app
```

con aprendizaje.

Las métricas de aprendizaje deben estar ligadas a evidencia observable.

No afirmar mejoras causales sin un diseño de medición apropiado.

---

# 29. Optimización de llamadas LLM

Optimizar primero eliminando trabajo innecesario.

Preferir:

```text
menos llamadas útiles
```

antes que:

```text
muchas llamadas baratas
```

Antes de optimizar modelos por costo, revisar:

- llamadas duplicadas;
- prompts redundantes;
- contexto excesivo;
- resultados reutilizables;
- validadores locales;
- contenido generado anticipadamente que nunca se usa.

---

# 30. Documentación

Este archivo contiene únicamente reglas que un agente de desarrollo necesita conocer con alta frecuencia.

No añadir aquí:

- investigaciones extensas;
- papers;
- backlog detallado;
- esquemas completos;
- ejemplos pedagógicos exhaustivos;
- descripción histórica del proyecto;
- decisiones temporales;
- implementación específica de una versión.

Ubicarlas en el documento especializado correspondiente.

Si una regla aparece repetida en varios documentos, debe existir una fuente canónica.

---

# 31. Cuándo actualizar AGENTS.md

Modificar este archivo solamente cuando cambie una regla transversal y estable, por ejemplo:

- prioridad global;
- invariante;
- política de seguridad;
- procedimiento obligatorio;
- fuente de verdad;
- regla de compatibilidad;
- responsabilidad entre código y LLM.

No modificarlo por:

- una feature concreta;
- un bug temporal;
- una versión nueva;
- un cambio de nombre de archivo;
- una idea del backlog.

---

# 32. Criterios de aceptación globales

Una modificación está lista únicamente si, cuando corresponda:

1. No elimina progreso existente.
2. Respeta los invariantes.
3. Mantiene el flujo end-to-end.
4. Usa evidencia apropiada para modificar estado.
5. No confunde ayuda con independencia.
6. No confunde éxito inmediato con retención.
7. No confunde variante con transferencia.
8. Evita llamadas LLM innecesarias.
9. Mantiene compatibilidad o incluye migración segura.
10. Tiene pruebas para las reglas críticas.
11. No inventa características del usuario.
12. No inventa evidencia histórica.
13. Puede explicar por qué tomó decisiones importantes.
14. Puede revertirse razonablemente.
15. El usuario entiende qué hacer después.

---

# 33. Regla final

Cuando exista duda entre:

```text
hacer el sistema más sofisticado
```

y:

```text
hacer que el aprendizaje y su evidencia sean más correctos
```

elegir lo segundo.

Cuando exista duda entre:

```text
pedirle al LLM que recuerde una regla
```

y:

```text
hacer imposible violar la regla mediante código
```

elegir lo segundo.