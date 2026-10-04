from .schemas import *
from .gemini_client import gemini
from .common import compact
def make_lesson(data):
    goal=compact(data.get('goal'),160); name=compact(data.get('name'),90)
    parent=compact(data.get('parent'),100)
    if not goal or not name:raise ValueError('Falta meta o concepto.')
    raw=gemini(f'Meta: {goal}; aprender ahora: {name}; concepto al que regresaremos: {parent or goal}. '
      'Microlección desde nivel cero: 1 explicación intuitiva de máximo 70 palabras, '
      '2 ejemplo resuelto en pasos, 3 error común, 4 pregunta de comprensión simple, '
      '5 ejercicio guiado, 6 caso independiente diferente, 7 pregunta de integración con la meta. '
      'Cada pregunta debe tener criterios de respuesta. Adapta el método si es fórmula, idioma o procedimiento. '
      'No inventes detalles técnicos locales.',STAGE_SCHEMA,1900)
    if not isinstance(raw,dict):raise ValueError('Microlección inválida.')
    out={k:compact(raw.get(k),1100) for k in ('explanation','example','common_error')}
    for k in ('check','guided','independent','integration'):
        q=raw.get(k,{})
        if not isinstance(q,dict):raise ValueError('Microlección incompleta.')
        out[k]={'prompt':compact(q.get('prompt'),600),'reference':compact(q.get('reference'),700),
                'kind':compact(q.get('kind'),40)}
    if not all(out.values()) or not all(q['prompt'] and q['reference'] for q in (out[k] for k in ('check','guided','independent','integration'))):
        raise ValueError('Microlección incompleta; no se guardó.')
    return out

