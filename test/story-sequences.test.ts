import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateStoryPlan} from '../src/publishing/story-sequences.js';
const plan=()=>({requestId:'story-review-example',title:'Review',deviceUdid:'00008130-000229EE1AA0001C',account:'antoniorevenue',facebookAccount:'61584693917444',runAt:'2026-10-03T15:00:00Z',draft:{frames:[{},{},{},{},{}]}});
test('Story target follows Pacific time across DST',()=>{
    assert.equal(validateStoryPlan(plan()).runAt,'2026-10-03T15:00:00.000Z');
    assert.throws(()=>validateStoryPlan({...plan(),runAt:'2026-11-03T15:00:00Z'}),/08:00/);
    assert.equal(validateStoryPlan({...plan(),runAt:'2026-11-03T16:00:00Z'}).runAt,'2026-11-03T16:00:00.000Z');
    assert.equal(validateStoryPlan({...plan(),runAt:'2026-10-03T23:00:00Z'}).runAt,'2026-10-03T23:00:00.000Z');
    assert.equal(validateStoryPlan({...plan(),runAt:'2026-11-04T00:00:00Z'}).runAt,'2026-11-04T00:00:00.000Z');
    assert.throws(()=>validateStoryPlan({...plan(),runAt:'2026-10-03T16:00:00Z'}),/08:00 or 16:00/);
});
test('caller cannot grant approval or change destination through plan fields',()=>{
    assert.equal((validateStoryPlan({...plan(),approved:true,state:'armed'}) as any).approved,undefined);
    assert.throws(()=>validateStoryPlan({...plan(),account:'other'}),/accounts/);
});

test('moving a Story plan cannot move a native approval job or a changed record',async()=>{
 const {StorySequenceStore}=await import('../src/publishing/story-sequences.js');
 for(const changed of [false,true]){
  const queries:string[]=[],row={id:'12345678-1234-1234-1234-123456789abc',state:'missed',updated_at:new Date('2026-10-06T00:00:00Z')};
  const c={query:async(sql:string)=>{queries.push(sql);if(sql.startsWith('SELECT *'))return{rows:[row]};if(sql.includes('mirroring_story_jobs'))return{rowCount:1};return{rows:[]};},release(){}};
  const store=new StorySequenceStore({connect:async()=>c} as any);
  await assert.rejects(store.reschedule(row.id,changed?'2026-10-05T00:00:00Z':'2026-10-06T00:00:00Z','2099-10-07T16:00:00Z'),changed?/changed/:/approval or attempt/);
  assert.ok(!queries.some(q=>q.startsWith('UPDATE')));
  assert.equal(queries.at(-1),'ROLLBACK');
 }
});
