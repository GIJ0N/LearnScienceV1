from .schemas import *
from .gemini_client import gemini
from .common import compact
def review_question(data):
    goal=compact(data.get('goal'),160);concept=compact(data.get('concept'),90)
    if not goal or not concept:raise ValueError('Falta meta o concepto.')
    raw=gemini(f'Objetivo: {goal}; concepto: {concept}; nivel de repaso: {compact(data.get("level"),5)}. '
      'Crea UNA pregunta nueva de recuperación que aplique el mismo concepto a otro contexto. '
      'No repitas: '+compact(data.get('previous'),300)+'. Respuesta de referencia breve.',REVIEW_SCHEMA,550)
    q=raw.get('question',{}) if isinstance(raw,dict) else {}
    if not isinstance(q,dict) or not q.get('prompt') or not q.get('reference'):raise ValueError('Pregunta de repaso incompleta.')
    return {'question':{k:compact(q.get(k),700) for k in ('prompt','reference','kind')}}

