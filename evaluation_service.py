from .schemas import *
from .gemini_client import gemini
from .common import compact
def evaluate(data):
    answer=compact(data.get('answer'),1800)
    q=data.get('question',{})
    if not isinstance(q,dict) or not compact(q.get('prompt')):raise ValueError('Pregunta inválida.')
    if not answer:raise ValueError('Escribe tu idea o usa «No sé».')
    if answer.lower().strip(' .!') in ('no sé','no se','no lo sé','no lo se','ni idea'):
        return {'status':'UNKNOWN','feedback':'Está bien no saberlo aún. Vamos a construirlo.','error_type':'lack_of_exposure','hint':''}
    raw=gemini('Pregunta: '+compact(q.get('prompt'),600)+'; criterios: '+compact(q.get('reference'),700)+
      '; intento: '+answer+'; fase: '+compact(data.get('phase'),30)+
      '. Valora razonamiento y soluciones alternativas justificadas. '
      'status debe ser CORRECT, PARTIAL o MISCONCEPTION; nunca marques correcto un mero eco del enunciado. '
      'Da feedback breve y una pista mínima sin revelar toda la solución. '
      'error_type: conceptual, prerequisite, formula_selection, variable_identification, units, algebra, arithmetic, procedure, interpretation, memory, application, transfer, attention o none.',EVAL_SCHEMA,500)
    status=raw.get('status') if isinstance(raw,dict) else None
    if status not in ('CORRECT','PARTIAL','MISCONCEPTION'):raise ValueError('Evaluación incompleta.')
    return {k:compact(raw.get(k),650) for k in ('status','feedback','error_type','hint')}

