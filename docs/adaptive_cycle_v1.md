# Ciclo adaptativo v1

Ruta activa: `app_legacy.py` → JavaScript incrustado, idéntico a `app.js`.
No introduce otra base de datos, servicio ni dependencia de ejecución.

## Regla ejecutable

`learningState` deriva dimensiones de la evidencia efectiva (excluye evaluaciones
supersedidas y episodios hijos). Expone suficiencia, aciertos independientes,
desempeño asistido, dificultad reciente y recuperación diferida pendiente.
No produce una probabilidad de conocimiento. `selectTutorAction(goal, now, options)`
es determinista y no modifica sus entradas; `chooseNext` aplica y registra su decisión.

Prioridades: reparación abierta; reanudar actividad sin descartar ayuda; límite de
visita; un repaso vencido sin exposición registrada durante 24 h; dificultad de un
prerrequisito del grafo; dificultad actual; comprobar acierto independiente;
desafío de habilidad suficiente; práctica con apoyo; diferir retención/transferencia;
enseñar o introducir habilidad. El orden curricular usa el grafo existente; los
repasos se desempatan por fecha y después ID. Seleccionar expresamente una habilidad
permite revisitar pendientes, y se conserva la evidencia anterior.

El bucle interno conserva comprensión → práctica guiada → intento independiente →
integración y los episodios de reparación. La entrada ya puede saltar explicación
y práctica elemental cuando existe evidencia independiente. Una confirmación fallida
puede abrir el episodio existente sobre su pregunta concreta, sin acreditar el padre
por reparar al hijo. La generación fallida deja disponibles reintento y continuación.

Límites de ingeniería, no umbrales científicos universales:
- Seis intentos por visita de habilidad; tres comprobaciones por visita de confirmación.
- Un repaso automático antes de volver al currículo; otro intento de aprendizaje permite
  considerar el siguiente repaso. El botón explícito de repaso sigue disponible.
- Un desafío por habilidad durante el recorrido guardado. Pide una restricción o
  justificación adicional, conservando el contrato de dimensión; no acredita transferencia.
- Continuar con pendientes cambia el recorrido, nunca la evidencia de suficiencia.

## Persistencia y temporalidad

Campos aditivos: `session.adaptive`, `session.tutor_decision`, propósito opcional de
confirmación y eventos `TUTOR_DECISION`, `TEACHING_EXPOSURE`, `FEEDBACK_EXPOSURE`.
Las decisiones incluyen `adaptive_tutor_v1`, reloj de selección, estado derivado,
referencias de evidencia y límites usados. Se conservan en el JSON durable y respaldos
SQLite existentes; no hay migración destructiva ni nuevas tablas. Los datos legacy sin
estos campos usan valores conservadores; no se sintetizan exposiciones históricas.

`evidence_policy_v2.1` conserva el mínimo de dos aciertos independientes distintos.
Para memoria, el intervalo se mide desde la observación previa más reciente, no desde
cualquier acierto antiguo. Nuevos eventos REVIEW incluyen `retrieval_gap_v1`, exposición
previa y elegibilidad temporal, considerando también explicación y feedback registrados.
La evaluación del propio intento no contamina su intervalo; sí el del siguiente intento.
UNKNOWN no cambia el calendario. La política no declara retención permanente ni expertise.

Las fechas e intervalos históricos se conservan; únicamente un resultado de repaso
válido actualiza su entrada de calendario. No se añade FSRS.

## Comprobación

```
node tests/adaptive_cycle.test.js
python tests/adaptive_cycle.test.py
```

La suite JS recorre UI simulada y proveedores simulados; la suite Python persiste el
estado producido por esa ejecución, reabre SQLite, restaura en otro perfil y reproduce
la decisión. CI también ejecuta todas las regresiones anteriores y paridad JS.
Las pruebas técnicas no demuestran aprendizaje humano ni precisión de Gemini.

Para revertir, salir de una comprobación con «Continuar la ruta con pendientes visibles»,
guardar/exportar y volver a la versión previa. Los campos adicionales son compatibles
con el almacenamiento anterior. La versión previa calculará suficiencia con su política
anterior; los eventos originales permanecen.

## Límites

La diversidad semántica y dificultad real de las preguntas todavía dependen del generador;
las verificaciones locales exigen contrato, dimensión y ausencia de repetición textual.
Las exposiciones fuera de la app son desconocidas. Las relaciones curriculares conservan
la calidad del mapa existente. Los contadores limitan insistencia, no estiman fatiga.
La persistencia sigue teniendo los límites de la aplicación local existente: no constituye
autenticación pública ni un ledger inmutable protegido contra edición deliberada.
