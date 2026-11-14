import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStoryApproval,storyDraftRevision} from '../src/publishing/story-approval.js';
const valid={revision:'a'.repeat(64),requestId:'test-request-123',reviewedFrames:[1,2,3,4,5],confirmed:true};
test('Story approval requires every frame and explicit draft confirmation',()=>{
 assert.doesNotThrow(()=>validateStoryApproval(valid));
 for(const reviewedFrames of [[1,2,3,4],[1,1,2,3,4],[1,2,3,4,6]])assert.throws(()=>validateStoryApproval({...valid,reviewedFrames}));
 assert.throws(()=>validateStoryApproval({...valid,confirmed:false}));
 assert.throws(()=>validateStoryApproval({...valid,revision:'stale'}));
});
test('Draft revisions bind real assets and reject unknown draft IDs',async()=>{
 const a=await storyDraftRevision('roadmap'); const b=await storyDraftRevision('nora');
 assert.match(a.revision,/^[a-f0-9]{64}$/);assert.notEqual(a.revision,b.revision);
 assert.equal(a.revision,(await storyDraftRevision('roadmap')).revision);
 await assert.rejects(storyDraftRevision('../other'));
});
