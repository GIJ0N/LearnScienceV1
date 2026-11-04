const assert = require('node:assert/strict');

function element(tag='div') { return { tag, children: [], style: {}, attributes: {}, textContent: '',
  append(...items){ this.children.push(...items); }, appendChild(item){ this.children.push(item); return item; },
  replaceChildren(...items){ this.children=items; }, setAttribute(key,value){ this.attributes[key]=value; },
  getAttribute(key){ return this.attributes[key]; }, querySelectorAll(){ return []; } }; }
global.document={getElementById:()=>element(),createElement:element,createElementNS:(_ns,tag)=>element(tag)};
global.localStorage={getItem:()=>null,setItem:()=>{}};
global.fetch=async()=>({ok:true,json:async()=>({ok:true,revision:2})});
const policy=require('../app.js');

const profile={profile_id:'profile-foundations',name:'Sintético',preferences:{}};
const revision={revision:1,statement:'La unidad determina el valor de una fracción.',conditions:['Comparar requiere una unidad común'],
  provenance:{source:'manual',verification_status:'user_authored'},status:'accepted',created_at:1,reviewed_at:1};
const foundation={schema_version:policy.FOUNDATION_VERSION,foundation_id:'foundation-1',profile_id:profile.profile_id,
  goal_id:'goal-1',node_id:'n1',status:'accepted',current_revision:1,created_at:1,updated_at:1,revisions:[revision]};
const raw={id:'goal-1',profile_id:profile.profile_id,goal:'Fracciones',nodes:[{id:'n1',name:'Unidad',outcome:'Explicar la unidad',prerequisites:[]}],
  coverage:[{id:'n1',dimensions:[{id:'conceptual',required:true,evidence:[]}]}],learner:{},lessons:{},foundations:[foundation],reviews:[],events:[],
  session:{profile_id:profile.profile_id,mode:'TEACH',node:'n1',stack:[],stage:'teach',tries:0}};
policy.setProfileForTests(profile); policy.setStoreForTests({profile_id:profile.profile_id,active:'goal-1',goals:[raw]});
const goal=policy.normalizeGoal(raw), before=JSON.stringify(goal.coverage), node=goal.nodes[0];
assert.equal(policy.foundationsForNode(goal,'n1').length,1);
assert.equal(policy.foundationRevision(goal.foundations[0]).statement,revision.statement);
assert.equal(policy.recordFoundationExposures(goal,'n1',{foundation_sources:[{foundation_id:'foundation-1',revision:1,node_id:'n1'}]}),true);
assert.equal(policy.recordFoundationExposures(goal,'n1',{foundation_sources:[{foundation_id:'foundation-1',revision:1,node_id:'n1'}]}),false,'render/reload must not duplicate exposure');
assert.equal(goal.events.filter(x=>x.type==='FOUNDATION_EXPOSURE').length,1);
assert.equal(goal.events[0].evidence,false); assert.equal(JSON.stringify(goal.coverage),before,'reading must not grant evidence');
assert.equal(policy.lastExposure(goal,'n1'),0,'foundation exposure must not silently alter delayed review timing');

const panel=element(); policy.renderSkillFoundations(panel,goal,node);
const flatten=root=>[root,...root.children.filter(x=>x&&typeof x==='object').flatMap(flatten)];
const words=flatten(panel).map(x=>x.textContent||'').join(' ');
assert.match(words,/Fundamentos de esta habilidad/); assert.match(words,/no demuestra aprendizaje/i);

assert.equal(policy.normalizeGoal({...raw,foundations:[]}).foundations.length,0,'legacy goal gets an honest empty state');
for(const bad of [
  {...foundation,profile_id:'other'}, {...foundation,goal_id:'other'}, {...foundation,node_id:'missing'},
]) assert.throws(()=>policy.normalizeGoal({...raw,foundations:[bad]}));
assert.throws(()=>policy.normalizeGoal({...raw,foundations:[foundation,{...foundation}]}),/repite un ID/);

console.log('skill foundations frontend: PASS');
