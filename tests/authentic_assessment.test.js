const assert=require('node:assert/strict');
const fixtures=require('./fixtures/authentic_tasks.json');
const clone=x=>JSON.parse(JSON.stringify(x));
function element(type='div'){return {type,textContent:'',value:'',children:[],style:{},append(...xs){this.children.push(...xs)},appendChild(x){this.children.push(x);return x},replaceChildren(...xs){this.children=xs}}}
const roots={app:element(),status:element()};global.document={getElementById:id=>roots[id],createElement:element};global.localStorage={getItem:()=>null};global.confirm=()=>true;
const p=require('../app.js');let sequence=0,taskKey='engineering',statuses={},saved=null,failProvider=false,failedSave=false,calls=[],evaluations=0;
function find(label,root=roots.app){if(root?.textContent===label)return root;for(const child of root?.children||[]){const r=find(label,child);if(r)return r}return null}
function all(type,root=roots.app){return [...(root?.type===type?[root]:[]),...(root?.children||[]).flatMap(c=>all(type,c))]}
async function settle(){for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));await p.flushSave()}
function goal(){return {id:'g',profile_id:'profile-a',goal:'Convertir unidades',nodes:[{id:'n1',name:'Unidades',prerequisites:[],level:0,probe:{prompt:'Diagnóstico',reference:'r',kind:'units'}}],coverage:[{id:'n1',dimensions:['method_selection','direct_application','units','interpretation'].map(id=>({id,required:true,evidence:[]}))}],events:[],lessons:{},learner:{},reviews:[],contextStack:[],repairEpisodes:[],authentic_tasks:[],authentic_attempts:[],session:{mode:'DIAGNOSTIC',node:null,stack:[],hints:0}}}
function attach(g,profile='profile-a'){p.setStoreForTests({active:g.id,goals:[g]});p.setProfileForTests({profile_id:profile,name:profile},1);return g}
function result(task,pending,extra={}){return {version:'rubric_evaluation_v1',task_id:task.task_id,task_version:task.version,attempt_id:pending.attempt_id,valid:true,reason:'Evaluación por criterios observables.',criteria:task.rubric.map(c=>({criterion_id:c.id,status:statuses[c.id]||'MET',quote:pending.submission.answer,reason:'El paso citado satisface el requisito concreto.',certainty:'supported',validator:'semantic_rubric',error:''})),transfer_eligible:false,...extra}}
const plan={suspected_gaps:[{gap_id:'gap',concept:'Coherencia dimensional',reason:'Unidad incorrecta'}],diagnostic_checks:[{gap_id:'gap',question:{prompt:'Explica qué significa una unidad de longitud',reference:'Criterio',kind:'explanation'}}],repair_activities:{CHECK:{prompt:'Distingue longitud y área',reference:'Criterio',kind:'explanation'},GUIDED:{prompt:'Convierte con apoyo una longitud',reference:'Criterio',kind:'application'},INDEPENDENT:{prompt:'Selecciona un factor para otra longitud',reference:'Criterio',kind:'application'}},parent_retest:{prompt:'Vuelve a comprobar las unidades del pedido',reference:'Criterio',kind:'application'},transfer_check:{prompt:'Compara magnitudes en una situación nueva',reference:'Criterio',kind:'transfer'},transfer_novelty_status:'INDETERMINATE'};
global.fetch=async(route,options)=>{const body=JSON.parse(options.body);calls.push({route,body});
 if(route==='/api/profile/save'){if(failedSave)return {ok:false,json:async()=>({error:'Disco lleno'})};saved=clone(body.store);return {ok:true,json:async()=>({revision:++sequence})}}
 if(route==='/api/assessment/task'){
  const task=clone(fixtures[taskKey]);task.task_id='task-generated-'+(++sequence);task.source_task_id=body.source_task_id||null;task.purpose=body.purpose;
  return {ok:true,json:async()=>({task})}
 }
 if(route==='/api/assessment/evaluate'){evaluations++;if(failProvider)throw Error('Proveedor temporalmente no disponible');
  const g=saved.goals[0],task=g.authentic_tasks.find(t=>t.task_id===body.task_id),source=g.authentic_attempts.find(a=>a.task_id===task.source_task_id&&p.authenticPassed(a));
  return {ok:true,json:async()=>({evaluation:result(task,{attempt_id:body.attempt_id,submission:body.submission},{transfer_eligible:taskKey==='transfer',source_attempt_id:source?.attempt_id||null})})}
 }
 if(route==='/api/context/create')return {ok:true,json:async()=>clone(plan)};
 throw Error('Unexpected route '+route)
};
async function submit(answer='Selecciono el factor, calculo y compruebo la longitud pedida.'){
 const field=all('textarea')[0];field.value=answer;const inputs=all('input').filter(x=>x.type==='input');
 for(const x of inputs){if(x.placeholder==='Resultado numérico final')x.value='700';if(x.placeholder==='Unidad final')x.value='cm'}
 const button=find('Evaluar con rúbrica')||find('Reintentar evaluación pendiente');assert.ok(button);await button.onclick();await settle()
}
async function start(g,key='engineering',options={}){taskKey=key;p.startAuthentic(g,'n1',options);await settle();return g.authentic_tasks.at(-1)}
(async()=>{
 // Whole UI path: task generation, explicit rubric, independent assessment and evidence.
 let g=attach(goal()),task=await start(g);assert.ok(find('Demostrar una competencia'));assert.ok(find('method: '+task.rubric[0].requirement));await submit();
 assert.equal(g.authentic_attempts.length,1);assert.equal(p.authenticProgress(g,'n1').application,true);assert.equal(p.verified(g,'n1'),false,'one task does not meet two-independent-success threshold');assert.ok(find('Aplicación independiente demostrada en esta tarea.'));
 const first=g.authentic_attempts[0],firstCount=g.events.length;assert.equal(first.evaluation.task_id,task.task_id);
 // Duplicate submission cannot duplicate evidence; malformed IDs reject before any mutation.
 const duplicate={attempt_id:first.attempt_id,submission:first.submission,assisted_criteria:[]};g.session.authentic.pending_attempt=duplicate;
 assert.equal(p.commitAuthenticResult(g,task,duplicate,first.evaluation),false);assert.equal(g.events.length,firstCount);g.session.authentic.pending_attempt=null;
 const invalid={...duplicate,attempt_id:'invalid'};g.session.authentic.pending_attempt=invalid;
 assert.throws(()=>p.commitAuthenticResult(g,task,invalid,{...first.evaluation,attempt_id:'wrong'}));assert.equal(g.events.length,firstCount);g.session.authentic.pending_attempt=null;
 // A registered local pair, independent source and all criteria are jointly required for transfer.
 const sourceTask=task,transfer=await start(g,'transfer',{source_task_id:task.task_id,purpose:'transfer'});await submit();const transferAttempt=g.authentic_attempts.at(-1);
 assert.equal(transferAttempt.transfer_demonstrated,true);assert.equal(p.authenticProgress(g,'n1').transfer,true);assert.equal(p.sufficient(g.coverage[0].dimensions.find(d=>d.id==='transfer')),false);
 const superficial=await start(g,'superficial',{source_task_id:transfer.task_id,purpose:'transfer'});await submit();assert.equal(g.authentic_attempts.at(-1).transfer_demonstrated,false);
 // Correcting the source revokes dependent transfer, without manufacturing positive manual evidence.
 assert.equal(p.disputeAuthentic(g,sourceTask,first,'El método fue interpretado incorrectamente.'),true);await settle();assert.equal(p.authenticProgress(g,'n1').transfer,false);
 assert.equal(p.sufficient(g.coverage[0].dimensions.find(d=>d.id==='transfer')),false);assert.ok(g.events.some(e=>e.type==='ASSESSMENT_CORRECTION'));
 // Assisted criterion never credits independence for that dimension or whole-task application.
 const assisted=attach(goal());const aidedTask=await start(assisted);assisted.session.authentic.assisted_criteria=['units'];await submit();
 assert.equal(assisted.authentic_attempts[0].independent,false);assert.equal(p.authenticProgress(assisted,'n1').application,false);
 assert.equal(assisted.coverage[0].dimensions.find(d=>d.id==='units').evidence[0].is_independent,false);
 assert.equal(assisted.coverage[0].dimensions.find(d=>d.id==='method_selection').evidence[0].is_independent,true,'help is scoped to declared affected criteria');
 // Partial result directs the existing repair engine at exactly the failed criterion.
 const repairing=attach(goal());statuses={units:'NOT_DEMONSTRATED'};const parentTask=await start(repairing);await submit();assert.ok(find('Practicar criterio: units'));
 const parentAttempt=repairing.authentic_attempts[0];assert.equal(p.selectTutorAction(repairing,Date.now(),{focus:'n1',reselect:true}).action,'RUBRIC_REPAIR');
 await find('Practicar criterio: units').onclick();await settle();const episode=repairing.repairEpisodes[0];assert.equal(episode.authentic_task_id,parentTask.task_id);assert.equal(episode.focus_criterion_id,'units');assert.equal(repairing.session.mode,'CONTEXT');
 const snapshot=clone({active:repairing.id,goals:[repairing]});
 for(let i=0;i<4;i++){const current=p.episodeActivity(episode);assert.ok(current);p.applyResult(repairing,'n1',current.activity.stage,'Respuesta',{status:i===0?'PARTIAL':'CORRECT',_activity:current.activity,_attempt_id:'child-'+i,_episode_id:episode.episode_id,_repair_stage:current.phase,_help_used:0});await settle()}
 assert.equal(repairing.session.mode,'AUTHENTIC');assert.equal(parentAttempt.evaluation.criteria.find(r=>r.criterion_id==='units').status,'NOT_DEMONSTRATED');assert.equal(p.authenticProgress(repairing,'n1').application,false);
 statuses={};await find('Reintentar tarea completa').onclick();await settle();assert.equal(repairing.authentic_tasks.at(-1).source_task_id,parentTask.task_id);await submit();assert.equal(p.authenticProgress(repairing,'n1').application,true);
 // Three different families are usable through the same active UI and expose distinct criteria.
 for(const key of ['diagnosis','history']){const other=attach(goal());await start(other,key);await submit('Distingo hechos de inferencias y justifico una alternativa con el material disponible.');assert.equal(other.authentic_attempts.length,1);assert.equal(other.authentic_tasks[0].family,fixtures[key].family);assert.ok(find('Resultados por criterio'))}
 // An explicitly uncertain evaluation records UNKNOWN, without contradiction or positive evidence.
 const uncertain=attach(goal()),uncertainTask=await start(uncertain);const pending={attempt_id:'uncertain',submission:{answer:'Una respuesta ambigua'},assisted_criteria:[]};uncertain.session.authentic.pending_attempt=pending;
 const unknown=result(uncertainTask,pending,{valid:false});unknown.criteria.forEach(r=>r.status='UNCERTAIN');p.commitAuthenticResult(uncertain,uncertainTask,pending,unknown);await settle();
 assert.ok(uncertain.events.filter(e=>e.type==='EVIDENCE').every(e=>e.result==='UNKNOWN'&&!e.is_independent&&!e.counts_as_learning_failure));
 // Provider failure preserves the exact submitted attempt and survives reload; retry is idempotent.
 const failure=attach(goal());await start(failure);failProvider=true;const oldError=console.error;console.error=()=>{};await submit();console.error=oldError;assert.equal(failure.authentic_attempts.length,0);const attemptId=failure.session.authentic.pending_attempt.attempt_id;
 const reloaded=p.normalizeGoal(clone(saved.goals[0]));attach(reloaded);await p.session();await settle();assert.ok(find('Reintentar evaluación pendiente'));assert.equal(reloaded.session.authentic.pending_attempt.attempt_id,attemptId);failProvider=false;await submit();assert.equal(reloaded.authentic_attempts.length,1);
 // Save failure prevents evaluation; accessibility tools alone do not alter help state.
 const blocked=attach(goal());await start(blocked);failedSave=true;const evaluationsBefore=evaluations;console.error=()=>{};await submit();console.error=oldError;assert.equal(evaluations,evaluationsBefore);assert.equal(blocked.authentic_attempts.length,0);failedSave=false;await p.save();await settle();
 // Generation response arriving after profile switch must not populate either new profile or old active task.
 const originalFetch=global.fetch;const late=attach(goal());let resolve;
 global.fetch=async(route,options)=>route==='/api/assessment/task'?new Promise(r=>resolve=r):originalFetch(route,options);p.startAuthentic(late,'n1');await settle();
 const untouched=attach(goal(),'profile-b'),before=JSON.stringify(untouched);resolve({ok:true,json:async()=>({task:clone(fixtures.engineering)})});await settle();assert.equal(JSON.stringify(untouched),before);assert.equal(late.authentic_tasks.length,0);global.fetch=originalFetch;
 if(process.argv.includes('--snapshot'))process.stdout.write(JSON.stringify(snapshot));else console.log('OK: authentic task UI, criterion evidence, repair/parent return, transfer restrictions, corrections, failures and profile isolation');
})().catch(error=>{console.error(error);process.exitCode=1});
