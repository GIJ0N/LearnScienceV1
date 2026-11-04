const assert = require('node:assert/strict');
function element(type='div'){return {type,tag:type,textContent:'',value:'',children:[],style:{},attributes:{},append(...items){this.children.push(...items)},appendChild(item){this.children.push(item);return item},prepend(...items){this.children.unshift(...items)},replaceChildren(...items){this.children=items},setAttribute(key,value){this.attributes[key]=value},querySelectorAll(){return []}}}
const roots={app:element('main'),status:element('div')};
global.document={getElementById:id=>id==='app'?roots.app:roots.status,createElement:type=>element(type)};
global.localStorage={getItem:()=>null,setItem:()=>{}};global.confirm=()=>true;
const policy=require('../app.js');
const activity={schema_version:'criterion_assessment_v1',activity_id:'activity-1',type:'multiple_choice_explanation',phase:'INDEPENDENT',prompt:'Elige y explica',options:[{id:'a',text:'A'},{id:'b',text:'B'}],criteria:[{criterion_id:'option_choice',observable_dimension:'recognition',required:true,description:'elige'},{criterion_id:'explanation',observable_dimension:'conceptual',required:true,description:'explica'}],required_criteria:['option_choice','explanation'],help:{enabled:true,critical:true},variant:'v1',context:'synthetic'};
assert.equal(policy.normalizeCriterionActivity(activity).activity_id,'activity-1');
assert.throws(()=>policy.normalizeCriterionActivity({...activity,options:[{id:'a',text:'A'},{id:'a',text:'dup'}]}));
const goal={id:'goal',profile_id:'profile-a',nodes:[{id:'n1',name:'Habilidad'}],coverage:[{id:'n1',dimensions:[{id:'recognition',required:true,status:'UNKNOWN',evidence:[]},{id:'conceptual',required:true,status:'UNKNOWN',evidence:[]}]}],events:[],session:{node:'n1'}};
const draftGoal=policy.normalizeGoal({...goal,criterion_draft:{schema_version:'criterion_assessment_v1',profile_id:'profile-a',goal_id:'goal',node_id:'n1',activity_id:'activity-1',activity,selected_option_id:'a',explanation:'pendiente',help_used:1,status:'DRAFT'}});
assert.equal(draftGoal.criterion_draft.explanation,'pendiente');
const assessment={schema_version:'criterion_assessment_v1',attempt_id:'attempt-1',activity_id:'activity-1',overall:'PARTIAL',help_used:0,independent:true,criteria:[{criterion_id:'option_choice',observable_dimension:'recognition',status:'SATISFIED'},{criterion_id:'explanation',observable_dimension:'conceptual',status:'NOT_EVALUATED'}]};
assert.equal(policy.recordCriterionAssessment(goal,'n1',{selected_option_id:'a',explanation:'texto'},assessment),true);
assert.equal(policy.recordCriterionAssessment(goal,'n1',{selected_option_id:'a',explanation:'texto'},assessment),false);
assert.equal(goal.events.length,1);assert.deepEqual(goal.events[0].observed_dimensions,['recognition']);assert.equal(goal.coverage[0].dimensions[0].evidence.length,1);assert.equal(goal.coverage[0].dimensions[1].evidence.length,0);
const helped={...assessment,attempt_id:'attempt-2',help_used:1,independent:false,overall:'PARTIAL',criteria:assessment.criteria.map(x=>({...x,status:x.status==='SATISFIED'?'PARTIAL':x.status}))};
policy.recordCriterionAssessment(goal,'n1',{selected_option_id:'a',explanation:'texto'},helped);assert.equal(goal.events[1].is_independent,false);assert.deepEqual(goal.events[1].observed_dimensions,[]);
assert.equal(policy.recordCriterionAssessment(goal,'n1',{selected_option_id:'b',explanation:'respuesta distinta'},assessment),false);
function all(root){return [root,...root.children.filter(x=>x&&typeof x==='object').flatMap(all)]}
function text(root){return all(root).map(x=>x.textContent||'').join('\n')}
const visibleAssessment={...assessment,criteria:[
  {...assessment.criteria[0],observation:'Opción validada por clave privada.',evaluation_method:'deterministic_option_key'},
  {...assessment.criteria[1],observation:'Proveedor semántico no disponible.',evaluation_method:'not_evaluated'},
]};
const renderedGoal={...draftGoal,criterion_draft:{...draftGoal.criterion_draft,status:'EVALUATED',assessment:visibleAssessment},criterion_assessments:[visibleAssessment]};
policy.setProfileForTests({profile_id:'profile-a',name:'Perfil sintético'},2);
policy.setStoreForTests({active:'goal',goals:[renderedGoal]});
policy.criterionView();
assert.equal(all(roots.app).filter(x=>String(x.className||'').includes('criterion-card')).length,2);
assert.match(text(roots.app),/Opción validada por clave privada/);
assert.match(text(roots.app),/Proveedor semántico no disponible/);
assert.match(text(roots.app),/no produjo evidencia positiva/);
assert.match(text(roots.app),/Método: deterministic_option_key/);
assert.doesNotMatch(text(roots.app),/correct_option_id|PRIVATE_REFERENCE/);
const repairingGoal={...renderedGoal,contextStack:[{context_id:'context-1',episode_id:'episode-1',status:'ACTIVE'}]};
policy.setStoreForTests({active:'goal',goals:[repairingGoal]});
(async()=>{
  await assert.rejects(policy.requestCriterionActivity(repairingGoal),error=>error.code==='ACTIVE_REPAIR_CONTEXT');
  assert.equal(repairingGoal.criterion_assessments.length,1,'blocked navigation creates no new assessment or evidence');
  console.log('criterion_assessment_frontend.test.js PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
