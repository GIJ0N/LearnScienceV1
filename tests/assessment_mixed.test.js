// Receives a result produced by the real Python evaluator, not a second JS mock of its policy.
const assert=require('node:assert/strict');
const input=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const clone=x=>JSON.parse(JSON.stringify(x));
function element(type='div'){return {type,textContent:'',value:'',children:[],style:{},append(...xs){this.children.push(...xs)},appendChild(x){this.children.push(x);return x},replaceChildren(...xs){this.children=xs}}}
const roots={app:element(),status:element()};global.document={getElementById:id=>roots[id],createElement:element};global.localStorage={getItem:()=>null};global.confirm=()=>true;
const p=require('../app.js');let saved,revision=0,evaluations=0;
function find(label,root=roots.app){if(root?.textContent===label)return root;for(const child of root?.children||[]){const r=find(label,child);if(r)return r}return null}
function strings(root=roots.app){return [root?.textContent||'',...(root?.children||[]).flatMap(c=>strings(c))].join(' ')}
async function settle(){for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));await p.flushSave()}
function goal(){return {id:'g',profile_id:'profile-a',goal:'Longitudes',nodes:[{id:'n1',name:'Longitudes',prerequisites:[],level:0,probe:{prompt:'Diagnóstico',reference:'r',kind:'units'}}],coverage:[{id:'n1',dimensions:['method_selection','direct_application','units','interpretation','contextual_application','transfer'].map(id=>({id,required:id!=='transfer',evidence:[]}))}],events:[],lessons:{},learner:{},reviews:[],contextStack:[],repairEpisodes:[],authentic_tasks:[clone(input.task)],authentic_attempts:[],session:{mode:'DIAGNOSTIC',node:null,stack:[],hints:0}}}
function attach(g){p.setStoreForTests({active:g.id,goals:[g]});p.setProfileForTests({profile_id:'profile-a',name:'Test'},1);return g}
const plan={suspected_gaps:[{gap_id:'gap',concept:'Coherencia dimensional',reason:'Unidad final incorrecta'}],diagnostic_checks:[{gap_id:'gap',question:{prompt:'Distingue unidades de longitud',reference:'Criterio',kind:'units'}}],repair_activities:{CHECK:{prompt:'Identifica centímetros',reference:'Criterio',kind:'units'},GUIDED:{prompt:'Convierte con apoyo',reference:'Criterio',kind:'application'},INDEPENDENT:{prompt:'Convierte otra longitud sin ayuda',reference:'Criterio',kind:'application'}},parent_retest:{prompt:'Comprueba el formulario completo',reference:'Criterio',kind:'application'},transfer_check:{prompt:'Otro contexto',reference:'Criterio',kind:'transfer'},transfer_novelty_status:'INDETERMINATE'};
global.fetch=async(route,options)=>{const body=JSON.parse(options.body);
 if(route==='/api/profile/save'){saved=clone(body.store);return {ok:true,json:async()=>({revision:++revision})}}
 if(route==='/api/context/create')return {ok:true,json:async()=>clone(plan)};
 if(route==='/api/assessment/evaluate'){evaluations++;assert.deepEqual(body.submission,input.submission);return {ok:true,json:async()=>({evaluation:{...clone(input.evaluation),attempt_id:body.attempt_id}})}}
 throw Error('Unexpected request '+route)
};
(async()=>{
 let g=attach(goal());p.startAuthentic(g,'n1',{task_id:input.task.task_id});await settle();
 const pending={attempt_id:input.evaluation.attempt_id,submission:clone(input.submission),assisted_criteria:[]};g.session.authentic.pending_attempt=pending;
 const bad={...clone(input.evaluation),valid:true,evaluation_state:'COMPLETE'},before=JSON.stringify(g);
 assert.throws(()=>p.commitAuthenticResult(g,input.task,pending,bad));assert.equal(JSON.stringify(g),before);
 p.commitAuthenticResult(g,input.task,pending,input.evaluation);await p.session();await settle();
 assert.ok(strings().includes('parcialmente verificable'));assert.ok(strings().includes('SEMANTIC_UNCERTAINTY'));assert.ok(strings().includes('requested_unit_v1'));
 assert.ok(find('Practicar criterio: units'));assert.ok(find('Reevaluar criterios pendientes'));
 assert.equal(find('Intentar una situación nueva'),null);assert.equal(p.authenticProgress(g,'n1').application,false);
 assert.equal(p.authenticProgress(g,'n1').transfer,false);assert.equal(p.verified(g,'n1'),false);
 const evidence=dim=>g.events.filter(e=>e.type==='EVIDENCE'&&e.observed_dimensions.includes(dim));
 assert.equal(evidence('method_selection')[0].result,'CORRECT');
 assert.equal(evidence('units')[0].result,'PARTIAL');
 assert.equal(evidence('interpretation')[0].result,'UNKNOWN');
 assert.equal(evidence('interpretation')[0].is_independent,false);assert.equal(evidence('interpretation')[0].counts_as_learning_failure,false);
 assert.equal(p.selectTutorAction(g,Date.now(),{focus:'n1',reselect:true}).action,'RUBRIC_REPAIR');
 // Reload keeps the mixed result, explanation and available repair. No silent re-evaluation.
 g=attach(p.normalizeGoal(clone(saved.goals[0])));await p.session();await settle();assert.ok(find('Practicar criterio: units'));assert.equal(evaluations,0);
 const original=JSON.stringify(g.authentic_attempts[0]);
 await find('Practicar criterio: units').onclick();await settle();const episode=g.repairEpisodes[0];
 assert.equal(episode.focus_criterion_id,'units');assert.equal(episode.authentic_task_id,input.task.task_id);
 for(let i=0;i<4;i++){const current=p.episodeActivity(episode);p.applyResult(g,'n1',current.activity.stage,'Respuesta',{status:i===0?'PARTIAL':'CORRECT',_activity:current.activity,_attempt_id:'mixed-child-'+i,_episode_id:episode.episode_id,_repair_stage:current.phase,_help_used:0});await settle()}
 assert.equal(g.session.mode,'AUTHENTIC');assert.equal(JSON.stringify(g.authentic_attempts[0]),original);
 assert.equal(p.authenticProgress(g,'n1').application,false);assert.ok(find('Reintentar tarea completa'));
 // Explicit retry retains the original audit trail and submission. It cannot count twice toward sufficiency.
 await find('Reevaluar criterios pendientes').onclick();await settle();const retryId=g.session.authentic.pending_attempt.attempt_id;
 assert.notEqual(retryId,input.evaluation.attempt_id);assert.deepEqual(g.session.authentic.pending_attempt.submission,input.submission);
 await find('Reintentar evaluación pendiente').onclick();await settle();
 assert.equal(g.authentic_attempts.length,2);assert.equal(g.authentic_attempts[1].reevaluation_of,input.evaluation.attempt_id);
 assert.equal(JSON.stringify(g.authentic_attempts[0]),original);
 assert.equal(p.independentSuccesses(g.coverage[0].dimensions.find(d=>d.id==='method_selection')).length,1);
 assert.equal(p.verified(g,'n1'),false);
 await find('Reevaluar criterios pendientes').onclick();await settle();await find('Reintentar evaluación pendiente').onclick();await settle();
 assert.equal(g.session.authentic.attempts,3);assert.equal(find('Reevaluar criterios pendientes'),null);assert.equal(find('Practicar criterio: units'),null);
 // An entirely uncertain judgment, even if the provider sounds confident, cannot open repair or penalize.
 const unknown=attach(goal());p.startAuthentic(unknown,'n1',{task_id:input.task.task_id});await settle();
 const uncertain={...clone(input.evaluation),evaluation_state:'UNAVAILABLE',valid:false,criteria:input.evaluation.criteria.map(r=>({...r,status:'UNCERTAIN',certainty:'uncertain'}))};
 unknown.session.authentic.pending_attempt=pending;p.commitAuthenticResult(unknown,input.task,pending,uncertain);await p.session();await settle();
 assert.equal(find('Practicar criterio: units'),null);assert.ok(find('Reevaluar criterios pendientes'));
 assert.ok(unknown.events.filter(e=>e.type==='EVIDENCE').every(e=>e.result==='UNKNOWN'&&!e.is_independent&&!e.counts_as_learning_failure));
 console.log('PASS: Python mixed result → UI → criterion evidence → repair → parent return → bounded audited reevaluation');
})().catch(error=>{console.error(error);process.exitCode=1});
