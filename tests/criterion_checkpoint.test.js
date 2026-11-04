const assert=require('node:assert/strict');
function descendants(e){return [e,...e.children.flatMap(descendants)]}
function element(tag){return {tag,children:[],value:'',textContent:'',style:{},append(...xs){this.children.push(...xs)},prepend(...xs){this.children.unshift(...xs)},replaceChildren(...xs){this.children=xs},setAttribute(){},querySelectorAll(tag){return descendants(this).filter(e=>e.tag===tag)}}}
const root=element('main'),status=element('div');
global.document={getElementById:id=>id==='app'?root:status,createElement:element};global.localStorage={getItem:()=>null,setItem(){}};
const p=require('../app.js');
const activity={schema_version:'criterion_assessment_v1',activity_id:'activity',type:'multiple_choice_explanation',phase:'INDEPENDENT',prompt:'Elige',options:[{id:'a',text:'A'},{id:'b',text:'B'}],criteria:[{criterion_id:'option_choice',observable_dimension:'recognition',required:true,description:'Elegir'},{criterion_id:'explanation',observable_dimension:'conceptual',required:true,description:'Explicar'}],help:{enabled:true,critical:true},variant:'v1'};
const goal={id:'g',goal:'Sintético',nodes:[{id:'n',name:'Habilidad'}],coverage:[],events:[],session:{node:'n'},criterion_draft:{schema_version:'criterion_assessment_v1',profile_id:'p',goal_id:'g',node_id:'n',activity_id:'activity',activity,selected_option_id:'a',explanation:'Texto conservado',status:'DRAFT'}};
p.setProfileForTests({profile_id:'p',name:'Test'},1);p.setStoreForTests({active:'g',goals:[goal]});
const saves=[];let submitted,failSave=true;
global.fetch=async(route,options)=>{let body=JSON.parse(options.body);if(route==='/api/profile/save'){if(failSave)return {ok:false,json:async()=>({error:'controlled save failure'})};saves.push(body);return {ok:true,json:async()=>({profile_id:'p',revision:saves.length+1})}}if(route==='/api/criteria/evaluate'){submitted=body;assert.equal(saves.at(-1).store.goals[0].criterion_draft.attempt_id,body.attempt_id);throw new TypeError('lost response')}throw Error('Unexpected endpoint '+route)};
(async()=>{
 const original=console.error;console.error=()=>{};
 try{
  goal.criterion_draft.status='EVALUATING';
  p.criterionView();assert.equal(goal.criterion_draft.status,'EVALUATION_PENDING','reload does not claim that the old request is still evaluating');
  let submit=descendants(root).find(e=>e.textContent==='Evaluar respuesta');await submit.onclick();
  assert.equal(submitted,undefined,'failed persistence prevents starting evaluation');
  assert.match(status.textContent,/no está confirmado/);assert.equal(goal.criterion_draft.explanation,'Texto conservado');
  failSave=false;await submit.onclick();
  assert.ok(submitted.attempt_id);assert.equal(goal.criterion_draft.attempt_id,submitted.attempt_id);
  assert.equal(goal.criterion_draft.status,'EVALUATION_PENDING');assert.equal(goal.criterion_draft.explanation,'Texto conservado');assert.equal(goal.events.length,0);
  const pendingId=submitted.attempt_id;
  let release;const response=new Promise(resolve=>release=resolve);let entered;const started=new Promise(resolve=>entered=resolve);
  let requests=0;
  global.fetch=async(route,options)=>{const body=JSON.parse(options.body);if(route==='/api/profile/save')return {ok:true,json:async()=>({profile_id:body.profile_id,revision:10})};requests++;submitted=body;entered();return response};
  const operation=submit.onclick();await submit.onclick();await started;assert.equal(requests,1);assert.equal(submitted.attempt_id,pendingId);
  p.setProfileForTests({profile_id:'other',name:'Other'},1);p.setStoreForTests({active:'g',goals:[{id:'g',events:[]}]});
  release({ok:true,json:async()=>({schema_version:'criterion_assessment_v1',activity_id:'activity',attempt_id:pendingId,overall:'CORRECT',criteria:[]})});await operation;
  assert.equal(goal.events.length,0,'late response must not update abandoned context');
  console.log('criterion_checkpoint.test.js PASS');
 }finally{console.error=original;await p.flushSave()}
})().catch(e=>{console.error(e);process.exitCode=1});
