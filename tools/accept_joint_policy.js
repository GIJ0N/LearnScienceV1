/* Function-level acceptance bridge to the unchanged production policy. No browser claims. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
function el(){return {children:[],style:{},textContent:'',append(...x){this.children.push(...x)},appendChild(x){this.children.push(x)},replaceChildren(...x){this.children=x},setAttribute(){},querySelectorAll(){return []}}}
global.document={getElementById:el,createElement:el,createElementNS:el};
global.localStorage={getItem:()=>null,setItem:()=>{throw Error('Acceptance must persist through Python/SQLite')}};
global.fetch=()=>{throw Error('Unexpected policy network request')};
const p=require('../app.js');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const store=input.store;
p.setStoreForTests(store);
const goal=store.goals.find(g=>g.id===store.active);
const episode=goal.repairEpisodes?.[0];
let result=null;
if(input.action==='parent'){
 const activity=p.activityContract(goal.lessons.n1.independent,'n1','independent_practice');
 result=p.record(goal,'n1','INDEPENDENT',input.answer,input.evaluation,0,activity,'joint-parent');
}else if(input.action==='criterion'){
 result=p.recordCriterionAssessment(goal,'n1',input.answer,input.assessment);
}else if(input.action==='diagnosis'){
 const event=goal.events.find(e=>e.attempt_id==='joint-parent');
 result=p.createRepairEpisode(goal,{activity_id:event.activity_id,attempt_id:event.attempt_id,node_id:'n1',question:goal.lessons.n1.independent,response:event.answer,evaluation:input.evaluation,help_used:0,context_snapshot:goal.session},input.plan);
 p.pushContext(goal,{context_id:'joint-context',episode_id:result.episode_id,status:'ACTIVE',history:[]});
}else if(input.action==='teach'){
 p.attachRepairTeachingPackage(episode,input.package);
 // Actual policy exposure events, never positive evidence.
 p.recordRepairExposure(goal,episode,'explanation',episode.teaching_package.package_id+':explanation');
 p.recordRepairExposure(goal,episode,'worked_example',episode.teaching_package.package_id+':example');
 episode.teaching_progress.content_opened=true;
 p.beginRepairCheck(goal,episode,false);
}else if(input.action==='checkpoint'){
 const current=p.episodeActivity(episode);
 if(input.help){assert.equal(current.phase,'GUIDED');assert.ok(p.registerRepairHint(episode,current.phase,'requested'))}
 result=p.beginRepairCheckpoint(episode,current,input.answer);
}else if(input.action==='apply'){
 const checkpoint=episode.attempt_checkpoint;
 p.storeRepairCheckpointEvaluation(episode,checkpoint.attempt_id,input.evaluation);
 p.applyRepairCheckpoint(goal,episode);
 const once=JSON.stringify(goal.events);
 p.applyRepairCheckpoint(goal,episode);
 assert.equal(JSON.stringify(goal.events),once,'Applying same checkpoint must be idempotent');
 result=goal.events.find(e=>e.attempt_id===checkpoint.attempt_id);
}else if(input.action!=='snapshot'){throw Error('Unknown action')}
const before=JSON.stringify(store);
const map=p.evidenceMapSnapshot(goal);
p.evidenceNetworkLayout(map);
p.renderEvidenceMap(el(),goal);
assert.equal(JSON.stringify(store),before,'Map exploration must not mutate state');
const ids=goal.events.filter(e=>e.type==='EVIDENCE').map(e=>e.attempt_id);
assert.equal(new Set(ids).size,ids.length,'No duplicate attempt identity');
console.log(JSON.stringify({store,result,current:p.episodeActivity(goal.repairEpisodes?.[0]),map}));
