import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRevisableRelease} from '../src/publishing/queue-revision.js';
test('slot changes reject stale versions, submitted releases and every pilot attempt',()=>{
    const item={status:'held',version:3},release={state:'armed',item_version:3,share_claimed_at:null};
    assert.doesNotThrow(()=>assertRevisableRelease(item,release,3,false));
    assert.doesNotThrow(()=>assertRevisableRelease(item,undefined,3,false));
    assert.throws(()=>assertRevisableRelease(item,release,2,false));
    assert.throws(()=>assertRevisableRelease(item,release,3,true));
    assert.throws(()=>assertRevisableRelease(item,{...release,share_claimed_at:new Date()},3,false));
    for(const state of ['running','published','needs_review','cancelled'])assert.throws(()=>assertRevisableRelease(item,{...release,state},3,false));
    for(const status of ['publishing','published','needs_review','cancelled'])assert.throws(()=>assertRevisableRelease({...item,status},release,3,false));
    assert.throws(()=>assertRevisableRelease(item,{...release,item_version:2},3,false));
});
