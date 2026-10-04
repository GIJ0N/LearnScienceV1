from .schemas import *
from .gemini_client import gemini
from .common import compact
def micro_start(data):
    question=data.get('question',{})
    if not isinstance(question,dict):raise ValueError('Falta la pregunta original.')
    prompt=('Objetivo: '+compact(data.get('goal'),160)+'; problema original: '+compact(question.get('prompt'),500)+
      '; intento que falló: '+compact(data.get('answer'),700)+'; feedback: '+compact(data.get('feedback'),350)+
      '; tipo de error: '+compact(data.get('error_type'),40)+'. Aísla SOLO la pieza mínima que falta. '
      'Explica en máximo 55 palabras y crea TRES microinteracciones cortas y diferentes: '
      'reconocimiento, predicción y aplicación; después UNA transferencia al problema original. '
      'Cada una con criterios de respuesta. No repitas el problema original. Representación textual solo si ayuda. '
      'Nada de datos específicos de plantas desconocidas.')
    raw=gemini(prompt,MICRO_SCHEMA,1300)
    if not isinstance(raw,dict) or not isinstance(raw.get('steps'),list) or len(raw['steps'])<3:
        raise ValueError('La IA no creó la microtutoría completa.')
    def clean_q(q):
        if not isinstance(q,dict) or not q.get('prompt') or not q.get('reference'):raise ValueError('Interacción incompleta.')
        return {k:compact(q.get(k),500) for k in ('prompt','reference','kind')}
    return {'focus':compact(raw.get('focus'),100),'explanation':compact(raw.get('explanation'),500),
      'representation':compact(raw.get('representation'),280),
      'steps':[clean_q(q) for q in raw['steps'][:3]],'transfer':clean_q(raw.get('transfer',{}))}

def micro_repair(data):
    prompt=('Trabaja SOLO esta dificultad: '+compact(data.get('focus'),120)+'; microinteracción: '+
      compact(data.get('question'),400)+'; respuesta: '+compact(data.get('answer'),500)+'; error: '+
      compact(data.get('feedback'),350)+'. Da UNA pista muy breve y una NUEVA microinteracción '
      'que cambie el ejemplo o la representación, sin revelar toda la respuesta. Incluye criterio de respuesta.')
    raw=gemini(prompt,REPAIR_SCHEMA,450)
    q=raw.get('step',{}) if isinstance(raw,dict) else {}
    if not isinstance(q,dict) or not q.get('prompt') or not q.get('reference'):raise ValueError('No se pudo preparar otra interacción.')
    return {'explanation':compact(raw.get('explanation'),350),'step':{k:compact(q.get(k),500) for k in ('prompt','reference','kind')}}

def make_micro_context(data):
    q=data.get('question',{})
    if not isinstance(q,dict) or not compact(q.get('prompt')): raise ValueError('Falta la pregunta del contexto.')
    raw=gemini('Pregunta principal: '+compact(q.get('prompt'),600)+'; respuesta del usuario: '+compact(data.get('answer'),900)+'; feedback: '+compact(data.get('feedback'),400)+'. Aísla SOLO un subconcepto mínimo que impide resolver la pregunta. Devuelve contexto MICRO_TUTOR: explicación intuitiva de máximo 45 palabras, ejemplo, objetivo, concepto, pregunta pequeña, criterio y dificultad. Enseña ANTES de preguntar. No inventes parámetros locales.',CONTEXT_SCHEMA,850)
    if not isinstance(raw,dict) or not raw.get('objective') or not raw.get('concept') or not isinstance(raw.get('question'),dict): raise ValueError('Contexto micro incompleto.')
    return {'context_id':'micro-'+str(time.time_ns()),'parent_context_id':compact(data.get('parent_context_id'),80) or None,
      'objective':compact(raw.get('objective'),300),'concept':compact(raw.get('concept'),140),
      'question':{'prompt':compact(raw['question'].get('prompt'),600),'reference':compact(raw['question'].get('reference'),800),'kind':compact(raw['question'].get('kind'),40)},
      'expected_answer':compact(raw.get('expected_answer'),800),'mastery_criteria':compact(raw.get('mastery_criteria'),500),
      'explanation':compact(raw.get('explanation'),650),'example':compact(raw.get('example'),600),
            'difficulty':max(0,min(7,int(raw.get('difficulty',0)))),'status':'ACTIVE','attempts':0,'hints_used':0,'history':[]}

def micro_step(data):
    ctx=data.get('context',{});q=ctx.get('question',{})
    if not isinstance(ctx,dict) or ctx.get('status') not in ('ACTIVE','RETURNING'):raise ValueError('El contexto no está activo.')
    if not isinstance(q,dict) or not q.get('prompt'):raise ValueError('Contexto sin pregunta.')
    return evaluate({'question':q,'answer':data.get('answer'),'phase':'MICRO_TUTOR'})

def micro_zoom(data):
    ctx=data.get('context',{})
    if not isinstance(ctx,dict):raise ValueError('Contexto padre inválido.')
    q=ctx.get('question',{})
    if not isinstance(q,dict) or not compact(q.get('prompt')):raise ValueError('Contexto padre inválido.')
    raw=gemini('Concepto: '+compact(ctx.get('concept'),100)+'; pregunta: '+compact(q.get('prompt'),350)+
        '; respuesta: '+compact(data.get('answer'),450)+'; error: '+compact(data.get('feedback'),200)+
        '. Haz zoom a una pieza menor. Explica y da ejemplo ANTES de una pregunta nueva con criterio. No inventes parámetros locales.',CONTEXT_SCHEMA,750)
    if not isinstance(raw,dict) or not compact(raw.get('objective')) or not compact(raw.get('concept')):
        raise ValueError('El zoom no generó un contexto completo.')
    child_q=raw.get('question',{})
    if not isinstance(child_q,dict) or not compact(child_q.get('prompt')) or not compact(child_q.get('reference')):
        raise ValueError('El zoom no generó una pregunta completa.')
    try:difficulty=max(0,min(7,int(raw.get('difficulty',0))))
    except (TypeError,ValueError):difficulty=0
    return {'context_id':'micro-'+str(time.time_ns()),'parent_context_id':compact(ctx.get('context_id'),80) or None,
        'objective':compact(raw['objective'],300),'concept':compact(raw['concept'],140),
        'question':{'prompt':compact(child_q['prompt'],600),'reference':compact(child_q['reference'],800),
                    'kind':compact(child_q.get('kind'),40)},
        'explanation':compact(raw.get('explanation'),650),'example':compact(raw.get('example'),600),
        'expected_answer':compact(raw.get('expected_answer'),800),'mastery_criteria':compact(raw.get('mastery_criteria'),500),
        'difficulty':difficulty,'status':'ACTIVE','attempts':0,'hints_used':0,'history':[]}

def context_status(data):
    ctx=data.get('context',{});status=data.get('status')
    if status not in ('ACTIVE','PAUSED','MASTERED','FAILED','NEEDS_DECOMPOSITION','RETURNING','INTEGRATING'):raise ValueError('Estado de contexto inválido.')
    return {'context_id':ctx.get('context_id'),'status':status,'mastery':data.get('mastery',0),'parent_context_id':ctx.get('parent_context_id')}

