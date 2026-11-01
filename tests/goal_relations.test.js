'use strict';
const assert=require('assert');

global.document={head:{append(){}},getElementById(){return true},getElementById(){return {replaceChildren(){},append(){},setAttribute(){}}},createElement(){return {append(){},setAttribute(){},style:{}}}};
global.localStorage={getItem(){return null},setItem(){}};

const {
  normalizeGoalRelation,normalizeGoalRelations,createGoalRelation,setGoalRelationStatus,
  removeGoalRelationsForGoal,goalRelationsForNode,goalRelationCreatesCycle,
}=require('../app.js');

const profile='profile-relations';
const goals=[
  {id:'goal-a',goal:'Álgebra',nodes:[{id:'shared-local-id',name:'Modelo'},{id:'equations',name:'Ecuaciones'}],events:[]},
  {id:'goal-b',goal:'Circuitos',nodes:[{id:'shared-local-id',name:'Modelo'},{id:'circuits',name:'Circuitos'}],events:[]},
  {id:'goal-c',goal:'Física',nodes:[{id:'energy',name:'Energía'}],events:[]},
];
const input=(overrides={})=>({
  relation_id:'relation-1',profile_id:profile,
  source:{goal_id:'goal-a',node_id:'shared-local-id'},
  target:{goal_id:'goal-b',node_id:'shared-local-id'},
  type:'shared_principle',explanation:'Comparten una representación, sin afirmar identidad.',
  provenance:{source:'manual'},created_at:1,status:'proposed',...overrides,
});

{
  const relation=normalizeGoalRelation({schema_version:'goal_relation_v1',...input()},goals,profile);
  assert.equal(relation.endpoint_status,'available');
  assert.notDeepEqual(relation.source,relation.target,'el mismo ID local no colisiona entre metas');
  assert.throws(()=>normalizeGoalRelation({schema_version:'goal_relation_v1',...input({profile_id:'other-profile'})},goals,profile),/otro perfil|identidad/i);
}
{
  const relations=[];
  const evidenceBefore=JSON.stringify(goals.map(goal=>goal.events));
  const relation=createGoalRelation(input(),profile,goals,relations);
  assert.equal(relation.status,'proposed');
  assert.equal(goalRelationsForNode('goal-a','shared-local-id',relations).length,1);
  assert.equal(JSON.stringify(goals.map(goal=>goal.events)),evidenceBefore,'crear o explorar relaciones no genera evidencia');
  setGoalRelationStatus(relation.relation_id,'confirmed',relations);
  assert.equal(relation.status,'confirmed');
  setGoalRelationStatus(relation.relation_id,'rejected',relations);
  assert.equal(relation.status,'rejected');
  assert.equal(removeGoalRelationsForGoal('goal-a',relations).length,0);
}
{
  const relations=[];
  createGoalRelation(input({relation_id:'a-b',type:'prerequisite',source:{goal_id:'goal-a',node_id:'equations'},target:{goal_id:'goal-b',node_id:'circuits'}}),profile,goals,relations);
  createGoalRelation(input({relation_id:'b-c',type:'prerequisite',source:{goal_id:'goal-b',node_id:'circuits'},target:{goal_id:'goal-c',node_id:'energy'}}),profile,goals,relations);
  const cycle=input({relation_id:'c-a',type:'prerequisite',source:{goal_id:'goal-c',node_id:'energy'},target:{goal_id:'goal-a',node_id:'equations'}});
  assert(goalRelationCreatesCycle(relations,{schema_version:'goal_relation_v1',...cycle,endpoint_status:'available'}));
  assert.throws(()=>createGoalRelation(cycle,profile,goals,relations),/ciclo/i);
}
{
  const missing=normalizeGoalRelations([{schema_version:'goal_relation_v1',...input({target:{goal_id:'missing-goal',node_id:'missing-node'}})}],goals,profile);
  assert.equal(missing[0].endpoint_status,'missing','una referencia ausente se conserva señalada');
  assert.equal(normalizeGoalRelations([],goals,profile).length,0,'legacy sin relaciones sigue vacío');
  assert.equal(normalizeGoalRelations(undefined,goals,profile).length,0);
}

console.log('goal_relations.test.js PASS');
