const assert = require('node:assert/strict');
function element(type='div') { return {type,textContent:'',value:'',children:[],style:{},append(...xs){this.children.push(...xs)},appendChild(x){this.children.push(x);return x},replaceChildren(...xs){this.children=xs}} }
const roots={app:element(),status:element()};
global.document={getElementById:id=>roots[id],createElement:element};
global.localStorage={getItem:()=>null};global.confirm=()=>true;
const p=require('../app.js'),DAY=86400000;
let serial=0,calls=[],failGeneration=false,invalidGeneration=false;
const q=(prompt='Convierte unidades',dimension='units')=>({prompt,reference:'Criterio',kind:p.CONFIRMATION_KINDS[dimension],observable_dimensions:[dimension]});
function lesson(){return {target_dimension:'units',explanation:'Una unidad expresa una medida',example:'Ejemplo resuelto',common_error:'No mezclar unidades',check:q('Explica','conceptual'),guided:q('Con apoyo'),independent:q('Sin apoyo'),integration:{prompt:'Interpreta',reference:'r',kind:'context_case'}}}
function goal(){return {id:'g',goal:'Aprender medidas',nodes:['a','b'].map((id,i)=>({id,name:id,level:i,prerequisites:i?['a']:[],outcome:'Resolver',probe:q('Diagnóstico '+id)})),coverage:['a','b'].map(id=>({id,dimensions:[{id:'units',required:true,evidence:[]}]})),events:[],learner:{},lessons:{a:lesson(),b:lesson()},reviews:[],contextStack:[],repairEpisodes:[],session:{mode:'DIAGNOSTIC',node:null,stack:[],hints:0}}}
function attach(g){p.setProfileForTests({profile_id:'profile-test',name:'Perfil sintético',preferences:{}},1);p.setStoreForTests({goals:[g],active:g.id});return g}
function find(label,root=roots.app){if(root?.textContent===label)return root;for(const c of root?.children||[]){const f=find(label,c);if(f)return f}return null}
const settle=()=>new Promise(r=>setImmediate(r));
async function waitFor(label,predicate,limit=40){for(let i=0;i<limit;i++){if(predicate())return;await settle()}throw new Error(`Timeout esperando ${label}`)}
function record(g,status='CORRECT',help=0,dimension='units',id='a'){
 const question=q('Pregunta registrada '+(++serial),dimension),activity=p.activityContract(question,id,'evidence_confirmation');
 return p.record(g,id,'CONFIRMATION','Respuesta',{status,error_type:status==='MISCONCEPTION'?'units':'none'},help,activity,'attempt-'+serial)
}
global.fetch=async(route,options)=>{const body=JSON.parse(options.body);calls.push({route,body});
 if(route==='/api/confirmation'||route==='/api/review'){
  if(failGeneration)throw Error('Proveedor indisponible');
  return {ok:true,json:async()=>({question:invalidGeneration?{}:q('Pregunta nueva '+(++serial),body.target_dimension||'units')})};
 }
 if(route==='/api/profile/save'){assert.equal(body.profile_id,'profile-test');assert.ok(body.store?.active);assert.ok(body.store.goals.some(g=>g.id===body.store.active));return {ok:true,json:async()=>({revision:1})}}
 if(route==='/api/lesson')return {ok:true,json:async()=>lesson()};
 if(route==='/api/evaluate')return {ok:true,json:async()=>({status:'CORRECT',feedback:'Correcto'})};
 if(route==='/api/context/create')throw Error('Reparación simulada no disponible');
 throw Error('Ruta inesperada '+route)
};
async function submit(g,answer='Respuesta'){const phase=g.session.mode,question=phase==='REVIEW'?g.reviews.find(r=>r.id===g.session.node).question:g.session.confirmation.question,box=element(),ui=p.renderQuestion(box,question,g.session.node,phase,phase==='REVIEW'?'spaced_review':'evidence_confirmation');ui.answer.value=answer;await ui.submit.onclick();find('Continuar',ui.feedback).onclick();await settle()}
(async()=>{
 // Novice: diagnostic choice, no exposure -> explanation/example -> supported practice.
 let g=attach(goal());p.chooseNext(g);assert.equal(g.session.tutor_decision.action,'INTRODUCE');
 find('No sé; enséñamelo').onclick();await settle();assert.equal(g.session.mode,'TEACH');assert.ok(find('Ejemplo resuelto'));
 assert.equal(g.events.find(e=>e.type==='EVIDENCE').counts_as_learning_failure,false);
 assert.ok(g.events.some(e=>e.type==='TEACHING_EXPOSURE'));assert.equal(p.verified(g,'a'),false);
 // One prior independent success bypasses teaching, uses a fresh targeted check and visible rationale.
 g=attach(goal());record(g);calls=[];const before=JSON.stringify(g);
 const decision=p.selectTutorAction(g,123456,{reselect:true});assert.deepEqual(decision,p.selectTutorAction(g,123456,{reselect:true}));assert.equal(JSON.stringify(g),before,'selector is read-only');
 assert.equal(decision.action,'CONFIRM');p.chooseNext(g);await settle();assert.equal(g.session.mode,'CONFIRMATION');assert.ok(find('Por qué: '+decision.reason));
 assert.equal(calls.filter(c=>c.route==='/api/lesson').length,0);assert.equal(p.verified(g,'a'),false);assert.equal(g.session.confirmation.target_dimension,'units');
 await submit(g);assert.equal(p.verified(g,'a'),true);p.finishPractice(g,'a');await settle();assert.equal(g.session.node,'b');assert.equal(g.session.tutor_decision.action,'INTRODUCE');
 // Help never becomes independent success; support is removed only via practice.
 const assisted=attach(goal());record(assisted,'CORRECT',1);assert.equal(p.learningState(assisted,'a',Date.now()).dimensions[0].state,'ASSISTED_PERFORMANCE');
 p.chooseNext(assisted);await settle();assert.equal(assisted.session.mode,'GUIDED');assert.equal(p.verified(assisted,'a'),false);
 // Recent contradictions select corrective teaching, and real prerequisite relations are used.
 const error=attach(goal());record(error,'MISCONCEPTION');assert.equal(p.selectTutorAction(error,Date.now(),{reselect:true}).action,'REPAIR');
 assert.equal(p.selectTutorAction(error,Date.now(),{focus:'b',reselect:true}).action,'PREREQUISITE');
 p.chooseNext(error);await settle();assert.equal(error.session.mode,'TEACH');assert.ok(calls.some(c=>c.route==='/api/lesson'));
 error.events.push({type:'CURRICULUM_CONTINUED',node_id:'a'});assert.equal(p.selectTutorAction(error,Date.now(),{reselect:true}).node_id,'b');
 // A paused active repair always has priority, without creating or completing any evidence.
 error.contextStack=[{context_id:'ctx'}];assert.equal(p.selectTutorAction(error,Date.now(),{reselect:true}).action,'RESUME_REPAIR');error.contextStack=[];
 // A failed confirmation opens the same repair engine; child successes never repair the parent by themselves.
 const repairing=attach(goal());record(repairing);p.chooseNext(repairing);await waitFor('comprobación padre',()=>Boolean(repairing.session.confirmation?.question));
 const parent=repairing.session.confirmation.question,normalFetch=global.fetch;
 global.fetch=async(route,options)=>{if(route!=='/api/context/create')return normalFetch(route,options);
  const body=JSON.parse(options.body);assert.equal(body.question.prompt,parent.prompt);
  return {ok:true,json:async()=>({suspected_gaps:[{gap_id:'gap',concept:'Escala',reason:'Conversión incorrecta'}],diagnostic_checks:[{gap_id:'gap',question:q('Identifica la escala','conceptual')}],repair_activities:{CHECK:q('Explica la escala','conceptual'),GUIDED:q('Convierte con apoyo','direct_application'),INDEPENDENT:q('Convierte sin ayuda','direct_application')},parent_retest:q('Retoma la conversión original'),transfer_check:{prompt:'Aplica a otro contexto',reference:'Criterio',kind:'transfer'},transfer_novelty_status:'UNCONFIRMED'})};
 };
 p.applyResult(repairing,'a','CONFIRMATION','Confundo unidades',{status:'MISCONCEPTION',error_type:'units',feedback:'Revisa la escala',_activity:p.activityContract(parent,'a','evidence_confirmation'),_attempt_id:'failed-confirmation'});await waitFor('contexto de reparación',()=>repairing.session.mode==='CONTEXT'&&repairing.repairEpisodes.length===1&&repairing.pending_repair_diagnosis===null);
 assert.equal(repairing.session.mode,'CONTEXT');const episode=repairing.repairEpisodes[0];assert.equal(episode.parent_attempt_id,'failed-confirmation');assert.equal(episode.parent_response,'Confundo unidades');assert.equal(episode.parent_evaluation.status,'MISCONCEPTION');
 assert.equal(repairing.events.filter(e=>e.type==='EVIDENCE'&&e.attempt_id==='failed-confirmation').length,1);
 assert.equal(repairing.contextStack.length,1);assert.equal(repairing.contextStack[0].episode_id,episode.episode_id);
 assert.equal(repairing.coverage[0].dimensions[0].evidence.length,2);
 for(let i=0;i<4&&episode.stage!=='PARENT_RETEST';i++){const current=p.episodeActivity(episode);p.applyResult(repairing,'a',current.activity.stage,'Respuesta',{status:i===0?'PARTIAL':'CORRECT',_activity:current.activity,_attempt_id:'child-'+i,_episode_id:episode.episode_id,_repair_stage:current.phase,_help_used:0})}
 assert.equal(episode.stage,'PARENT_RETEST');assert.equal(p.verified(repairing,'a'),false);assert.equal(repairing.coverage[0].dimensions[0].evidence.filter(e=>e.evidence_scope==='repair_episode').length,0);
 const paused=p.normalizeGoal(JSON.parse(JSON.stringify(repairing)));assert.equal(p.selectTutorAction(paused,Date.now()).action,'RESUME_REPAIR');assert.equal(p.episodeActivity(paused.repairEpisodes[0]).phase,'PARENT_RETEST');global.fetch=normalFetch;
 // Sufficient evidence permits a harder task; it cannot grant transfer permission.
 const advanced=attach(goal());record(advanced);record(advanced);p.chooseNext(advanced,{focus:'a',reselect:true});await waitFor('desafío',()=>Boolean(advanced.session.confirmation?.question));
 assert.equal(advanced.session.confirmation.purpose,'challenge');assert.equal(calls.some(c=>c.route==='/api/confirmation'&&c.body.difficulty==='challenge'),true);assert.equal(p.activityContract(advanced.session.confirmation.question,'a','evidence_confirmation').supports_transfer,false);
 await submit(advanced);assert.ok(find('Desafío terminado. Puedes continuar; este intento no certifica transferencia ni expertise.'));
 // Revisitable pending evidence and a persistent six-attempt cap, not an automatic reset on reload.
 const pending=attach(goal());record(pending);pending.session.adaptive={node_id:'a',attempts:6,reviews:0};
 assert.equal(p.selectTutorAction(pending,Date.now(),{reselect:true}).action,'CONTINUE');p.chooseNext(pending,{reselect:true});await settle();assert.ok(p.readyToAdvance(pending,'a'));assert.equal(p.verified(pending,'a'),false);
 const restored=p.normalizeGoal(JSON.parse(JSON.stringify(pending)));attach(restored);p.chooseNext(restored,{focus:'a',newVisit:true,reselect:true});await settle();assert.equal(restored.session.mode,'CONFIRMATION');assert.equal(restored.session.adaptive.attempts,0);assert.ok(restored.events.some(e=>e.type==='CURRICULUM_CONTINUED'));
 // Delayed review, one per curriculum turn, then new learning. Immediate exposure blocks auto-review.
 const returning=attach(goal());const prior=record(returning);const old=Date.now()-2*DAY;
 returning.events.forEach(e=>{e.timestamp=old;e.at=old});returning.coverage[0].dimensions[0].evidence.forEach(e=>{e.timestamp=old;e.at=old});
 returning.reviews=[{id:'a',due:old,step:0,history:[],question:null},{id:'b',due:old,step:0,history:[],question:null}];
 p.chooseNext(returning);await settle();assert.equal(returning.session.mode,'REVIEW');await submit(returning);
 assert.notEqual(returning.session.mode,'REVIEW','one automatic review cannot starve curriculum');
 const review=returning.events.find(e=>e.type==='EVIDENCE'&&e.phase==='REVIEW');assert.equal(review.retention_eligible,true);
 const dueBefore=returning.reviews[1].due;assert.equal(dueBefore,old,'unselected historic schedule untouched');
 // A recent explanation or feedback prevents retention even when an old success exists.
 const immediate=attach(goal());record(immediate);immediate.events[0].timestamp=old;immediate.events[0].at=old;
 immediate.events.push({type:'TEACHING_EXPOSURE',node_id:'a',at:Date.now()});immediate.reviews=[{id:'a',due:old,step:0,history:[],question:q('Repaso inmediato')}];
 assert.notEqual(p.selectTutorAction(immediate,Date.now(),{reselect:true}).action,'REVIEW');
 const event=p.record(immediate,'a','REVIEW','Respuesta',{status:'CORRECT'},0,p.activityContract(q('Otra recuperación'),'a','spaced_review'),'immediate-review');assert.equal(event.retention_eligible,false);
 // Effective recent observation, not oldest success, defines the memory gap.
 const memory={id:'memory',evidence:[]};for(const [i,phase,time] of [[1,'CONFIRMATION',old],[2,'CONFIRMATION',Date.now()-1000],[3,'REVIEW',Date.now()]])memory.evidence.push({...p.activityEvidence(p.activityContract(q('Recuerda '+i,'memory'),'a','spaced_review'),{status:'CORRECT'},0,{attempt_id:'m'+i,timestamp:time}),phase});
 assert.equal(p.sufficient(memory),false);
 // Provider errors and invalid contracts leave evidence unchanged and retain a valid exit.
 for(const invalid of [false,true]){const broken=attach(goal());record(broken);const original=broken.events.filter(e=>e.type==='EVIDENCE').length;failGeneration=!invalid;invalidGeneration=invalid;
 const oldError=console.error;console.error=()=>{};p.chooseNext(broken);await settle();console.error=oldError;
 assert.equal(broken.events.filter(e=>e.type==='EVIDENCE').length,original);assert.ok(find('Reintentar comprobación'));assert.ok(find('Continuar la ruta con pendientes visibles'));}
 failGeneration=false;invalidGeneration=false;
 // A pending async generation cannot mutate another selected profile's goal.
 const first=attach(goal());record(first);let resolve;let delayed=true;const fetchBeforeDelayed=global.fetch;global.fetch=(route,options)=>{if(delayed&&route==='/api/confirmation')return new Promise(r=>resolve=r);if(route==='/api/profile/save')return Promise.resolve({ok:true,json:async()=>({revision:1})});return fetchBeforeDelayed(route,options)};p.chooseNext(first);await settle();
 const second=attach(goal()),secondBefore=JSON.stringify(second);delayed=false;resolve({ok:true,json:async()=>({question:q('Tardía')})});await waitFor('respuesta tardía descartada',()=>first.session.confirmation.question===null);assert.equal(JSON.stringify(second),secondBefore);global.fetch=fetchBeforeDelayed;
 // The entire decision and pending activity are JSON-compatible and survive normalizing.
 const persisted=p.normalizeGoal(JSON.parse(JSON.stringify(restored)));assert.deepEqual(persisted.session.tutor_decision,restored.session.tutor_decision);assert.deepEqual(persisted.events,restored.events);assert.deepEqual(persisted.session.confirmation,restored.session.confirmation);
 if(process.argv.includes('--snapshot'))process.stdout.write(JSON.stringify({goals:[persisted],active:persisted.id}));else console.log('OK: adaptive student states, visible routing, independent checks, fading, bounded review, failure and restore scenarios');
})().catch(e=>{console.error(e);process.exitCode=1});
