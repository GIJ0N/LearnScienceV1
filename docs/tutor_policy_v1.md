# Revisión de consistencia de Tutor Policy v1

## Documento corregido

He revisado Tutor Policy v1 manteniendo **las mismas once reglas P0/P1**, sin introducir nuevas técnicas de aprendizaje y sin reconstruir la política desde cero. La revisión conserva como fuente pedagógica principal el informe de Deep Research de LearnAnything. fileciteturn0file0

El documento completo corregido está aquí:

**[Descargar `docs/tutor_policy_v1.md`](sandbox:/mnt/data/docs/tutor_policy_v1.md)**

La revisión mantiene la lógica pedagógica central del informe: distinguir rendimiento inmediato de aprendizaje durable, usar scaffolding de forma dependiente del expertise, tratar el repaso temporalmente y separar selección de tarea de ayuda dentro de la tarea. Esa separación outer-loop/inner-loop también es consistente con la literatura de Intelligent Tutoring Systems. citeturn0search0turn0search18 La parametrización del repaso evita fijar intervalos universales, coherente con los resultados de Cepeda et al., donde el intervalo útil depende del horizonte de retención. citeturn0search1

## Cambios técnicos principales

La corrección más importante es que Tutor Policy ya no puede interpretar `StudentModel` como historial ni el historial como estado actual. La arquitectura queda explícitamente separada en tres capas:

```text
┌─────────────────────────────────────────────┐
│             HISTORICAL EVENTS               │
│                                             │
│ EvidenceEvent                               │
│ append-only / immutable                     │
│                                             │
│ "qué ocurrió realmente"                     │
└────────────────────┬────────────────────────┘
                     │ projection
                     ▼
┌─────────────────────────────────────────────┐
│             DERIVED STUDENT STATE           │
│                                             │
│ conceptual                                  │
│ procedure                                   │
│ method_selection                            │
│ application                                 │
│ independence                                │
│ transfer                                    │
│ retention                                   │
│                                             │
│ recalculable                                │
└────────────────────┬────────────────────────┘
                     │ input
                     ▼
┌─────────────────────────────────────────────┐
│                TUTOR POLICY                 │
│                                             │
│ evidence + config + session context         │
│               ↓                             │
│        next intervention                    │
│                                             │
│ "qué debería hacer ahora"                   │
└─────────────────────────────────────────────┘
```

Esto elimina la ambigüedad de la versión anterior, donde existía un ledger pero también una cadena resumida que podía acabar funcionando como un mastery state global. La nueva versión hace que el estado sea una **proyección reproducible del ledger**, de modo que cambiar la política de dominio no obliga a alterar evidencia histórica.

Cada evento incorpora ahora explícitamente:

```json
{
  "schema_version": "1.1",
  "policy_version": "tutor_policy_v1.1",
  "evidence_id": "ev_...",
  "session_id": "sess_...",
  "source_activity_id": "activity_...",
  "parent_evidence_id": null
}
```

Además, el documento distingue un `EvidenceEvent` de un `TutorDecisionEvent`. El primero dice qué hizo el alumno; el segundo explica por qué el tutor seleccionó determinada intervención. **Una decisión del tutor nunca cuenta como evidencia de aprendizaje.**

El segundo cambio estructural es la eliminación de la secuencia global:

```text
UNKNOWN
→ INTRODUCED
→ LEARNING
→ PRACTICED
→ INDEPENDENT
→ TRANSFERRED
→ RETAINED
```

En su lugar:

```text
conceptual        = PROVISIONAL
procedure         = STABLE
method_selection  = LEARNING
application       = PROVISIONAL
independence      = PROVISIONAL
transfer          = NO_EVIDENCE
retention         = PENDING
```

Esto representa mucho mejor los casos que LearnAnything realmente encontrará. Un alumno puede saber ejecutar un algoritmo sin saber seleccionarlo; puede aplicarlo independientemente en problemas familiares sin transferirlo; o puede haber demostrado transferencia pero necesitar todavía una recuperación diferida para establecer retención. Esta separación es consistente con la distinción central del informe entre ejecución, selección, transferencia y retención. fileciteturn0file0

El tercer cambio convierte todos los números de suficiencia en **configuración versionada**:

```text
threshold_profile =
    f(
      knowledge_type,
      difficulty_band,
      domain_risk,
      learning_goal
    )
```

Por ejemplo:

```json
{
  "threshold_profile_id":
    "procedural.medium.low_risk.problem_solving.v1",

  "knowledge_type": "procedural",
  "difficulty_band": "medium",
  "domain_risk": "low",
  "learning_goal": "problem_solving",

  "thresholds": {
    "independent_successes_for_provisional": 2,
    "distinct_variants_for_provisional": 2,
    "transfer_tasks_for_provisional": 1,
    "delayed_retrievals_for_stable_retention": 2
  }
}
```

Así, “dos éxitos independientes” continúa siendo un default razonable para ciertos perfiles de bajo riesgo, pero deja de aparecer como una ley psicológica. Esta cautela es importante: incluso para spacing, uno de los efectos más robustos de la literatura, el intervalo óptimo cambia con el periodo de retención objetivo. citeturn0search1turn0search12

También se corrigió la universalización implícita de worked examples. La evidencia apoya guidance y fading particularmente para novatos ante tareas complejas, y existe evidencia experimental de mejores resultados de transferencia con fading adaptativo en Cognitive Tutor; eso no implica que toda materia deba representarse mediante una “solución paso a paso”. citeturn0search9turn0search16 Rule 2 ahora permite:

```text
procedimental:
demostración → parcial → guiado → independiente

conceptual:
representación/contraste → predicción → aplicación independiente

idioma:
modelo → apoyo parcial → producción independiente

técnico:
demostración/checklist → checklist reducido → ejecución

factual simple:
exposición → recuperación
```

## Contradicciones eliminadas

La contradicción más importante era **diagnóstico vs enseñar antes de evaluar**. LearnAnything ya tenía diagnóstico inicial, mientras Rule 1 podía interpretarse como “jamás preguntar algo que la app no haya enseñado”. La versión revisada distingue:

```text
evidence_role = diagnostic
```

de:

```text
evidence_role = learning
```

Por tanto, el tutor puede preguntar algo que nunca enseñó cuando está intentando descubrir conocimiento previo. Un error en ese contexto se registra así:

```json
{
  "evidence_role": "diagnostic",
  "result": "incorrect",
  "counts_as_learning_failure": false
}
```

No incrementa automáticamente `failure_streak`, no confirma una misconception y no abre por sí mismo una microtutoría. Esto preserva el valor de un diagnóstico eficiente sin tratar desconocimiento previo como fracaso posterior a enseñanza.

También quedó eliminada la contradicción entre **“una dimensión está dominada” y “el concepto está dominado”**. Ahora son inválidas inferencias como:

```text
procedure=STABLE
→ transfer=STABLE
```

o:

```text
independence=STABLE
→ retention=STABLE
```

Las invariantes lo hacen explícito:

```text
procedure=STABLE
DOES NOT IMPLY method_selection>=PROVISIONAL

procedure=STABLE
DOES NOT IMPLY application>=PROVISIONAL

independence=STABLE
DOES NOT IMPLY transfer>=PROVISIONAL

transfer=STABLE
DOES NOT IMPLY retention=STABLE

retention=STABLE
DOES NOT IMPLY conceptual=STABLE

conceptual=STABLE
DOES NOT IMPLY procedure>=PROVISIONAL
```

La contradicción entre **defaults pedagógicos y constantes hard-coded** también desaparece. Microprobes, número de variantes, número de retrievals, profundidad de microtutoría y nivel de ayuda incompatible con independencia pasan por policy config.

Asimismo, la nueva política elimina el supuesto implícito de que **“representación alternativa” significa gráfica o diagrama**. Puede significar contraste ejemplo/no-ejemplo, caso, demostración, simulación, código ejecutable, modelo lingüístico o analogía, según el conocimiento.

La evidencia sobre ajuste de guidance al expertise respalda precisamente no mantener una modalidad de soporte universal: guidance que ayuda al novato puede volverse redundante conforme aumenta el conocimiento. citeturn0search9

Por último, el documento ahora distingue claramente **retención inmediata de retención temporal**:

```text
same_session_success
    ≠
retention=STABLE
```

La literatura de práctica distribuida y retrieval justifica que el tiempo sea parte de la evidencia de retención; además, schedules eficientes pueden detener práctica cuando se alcanza criterio y volver posteriormente, en vez de acumular ensayos redundantes durante la misma ocasión. citeturn0search1turn0search10

## Decisiones que permanecen configurables

Tutor Policy v1 deliberadamente **no fija** los siguientes parámetros como universales:

| Parámetro | Por qué queda configurable |
|---|---|
| Evidencias mínimas por dimensión | Cambia por objetivo y coste del falso positivo |
| Variantes independientes requeridas | Dos puede ser razonable en bajo riesgo; insuficiente en otros dominios |
| Pruebas de transferencia | No todos los objetivos requieren transferencia |
| Intervalo mínimo de retención | Depende del horizonte de uso |
| Recuperaciones para `STABLE` | Depende de riesgo y duración esperada |
| Nivel de ayuda que invalida independencia | Una pista conceptual y una ayuda de UI no son equivalentes |
| Número de microprobes | Debe balancear diagnóstico con tiempo |
| Profundidad de microtutoría | Depende de dificultad y objetivo padre |
| `difficulty_band` | Tiene semántica diferente entre dominios |
| `domain_risk` | Debe definirse explícitamente por producto |
| Dimensiones obligatorias | Las determina `learning_goal` |
| Novedad mínima de transferencia | Depende del tipo de competencia |
| Tamaño de contrast sets | Depende de confusabilidad y expertise |
| Frecuencia de confianza | Debe justificar la fricción añadida |
| Threshold de fatiga/impasse | Debe calibrarse con datos reales |
| Decay de dimensiones | No debe copiarse de memoria factual a todas las habilidades |
| Diferencia mínima entre representaciones | Es específica del dominio |
| Necesidad de tarea auténtica | Depende del resultado real de desempeño |
| Validación humana obligatoria | Necesaria en algunos dominios de alto riesgo |
| Migración de evidencia legacy | No debe inventar datos ausentes |

El documento añade además dos métricas de consistencia útiles para esta arquitectura: `Diagnostic False-Failure Rate`, que detecta diagnósticos incorrectamente tratados como fracasos de aprendizaje, y `Projection Reproducibility`, que exige que **el mismo ledger + la misma policy version + el mismo threshold profile produzcan exactamente el mismo estado derivado**.

La revisión conserva once reglas, mantiene P0/P1 como alcance operativo y deja knowledge tracing avanzado, bandits, auto-descubrimiento del KCM y otras extensiones en backlog. Esa decisión mantiene la política auditable y coherente con la separación clásica entre student model y pedagogical decision layer en tutoring systems. citeturn0search0turn0search18

**[Descargar la versión completa corregida de `docs/tutor_policy_v1.md`](sandbox:/mnt/data/docs/tutor_policy_v1.md)**