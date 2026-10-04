from .schemas import *
from .gemini_client import gemini
from .common import compact
def validated_map(raw):
    if not isinstance(raw,dict) or not isinstance(raw.get('nodes'),list):
        raise ValueError('Mapa de competencias inválido.')
    nodes=[]
    for item in raw['nodes'][:12]:
        if not isinstance(item,dict):continue
        index=len(nodes)+1
        q=item.get('probe',{})
        if not isinstance(q,dict) or not compact(q.get('prompt')) or not compact(q.get('reference')):continue
        try:level=max(0,min(7,int(item.get('level',index-1))))
        except (TypeError,ValueError):level=min(7,index-1)
        nodes.append({'id':f'n{index}','name':compact(item.get('name'),90),
          'outcome':compact(item.get('outcome'),160),'level':level,
          'kind':compact(item.get('kind'),30),
          'prerequisites':item.get('prerequisites',[]),
          'probe':{'prompt':compact(q['prompt'],500),'reference':compact(q['reference'],700),
                   'kind':compact(q.get('kind'),40)}})
    if len(nodes)<5 or any(not x['name'] for x in nodes):raise ValueError('Mapa incompleto; describe una meta más concreta.')
    ids={n['id'] for n in nodes}
    for n in nodes:
        raw_deps=n['prerequisites'] if isinstance(n['prerequisites'],list) else []
        n['prerequisites']=list(dict.fromkeys(d for d in raw_deps if d in ids and d!=n['id']))
    colors={}
    def visit(nid):
        if colors.get(nid)==1:raise ValueError('El mapa generó un ciclo de prerrequisitos.')
        if colors.get(nid)==2:return
        colors[nid]=1
        for dep in next(n for n in nodes if n['id']==nid)['prerequisites']:visit(dep)
        colors[nid]=2
    for n in nodes:visit(n['id'])
    return nodes

def make_coverage_map(data):
    goal=compact(data.get('goal'),160); context=compact(data.get('context'),350)
    if len(goal)<5:raise ValueError('Describe una meta concreta.')
    raw=gemini(f'Meta: {goal}. Contexto no confidencial: {context}. Construye UNA VEZ el grafo de aprendizaje y una cobertura persistente. Genera 6-8 nodos ids n1,n2 con prerrequisitos sin ciclos. Para cada nodo devuelve coverage con prioridad blocker, important, secondary u optional, contextos de aplicación y SOLO dimensiones relevantes: conceptual, recognition, variables, units, equation_manipulation, method_selection, direct_application, contextual_application, interpretation, transfer, procedure, memory o self_explanation. Distingue conocimiento base de contexto. No uses una checklist fija ni redescubras componentes ya cubiertos en futuras interacciones. Incluye matemática, ecuaciones o unidades solo si la meta lo requiere. No inventes parámetros técnicos locales.',MAP_SCHEMA,4200)
    nodes=validated_map(raw)
    return {'nodes':nodes,'coverage':validated_coverage(raw,nodes),'map_version':1}

def make_map(data):
    return make_coverage_map(data)

def map_update(data):
    component=compact(data.get('component_id'),40);reason=compact(data.get('reason'),400)
    if not component or not reason:raise ValueError('Falta componente o razón de MAP UPDATE.')
    return {'component_id':component,'reason':reason,'status':'RECORDED','at':time.time_ns()}

