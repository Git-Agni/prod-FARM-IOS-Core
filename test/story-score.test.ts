import test from 'node:test';
import assert from 'node:assert/strict';
import {verdict,type FrameScore} from '../src/publishing/story-score.js';

const good=(frame:number):FrameScore=>({frame,readability:9,clipping:10,image:9,privacy:'ok',fit:9,note:''});
test('a clean five-frame Story passes',()=>{
    assert.equal(verdict([1,2,3,4,5].map(good),9,9).pass,true);
});
test('a clipped call to action or private data fails (Oct 17 review)',()=>{
    const frames=[1,2,3,4,5].map(good);frames[4]={...frames[4]!,clipping:4};frames[3]={...frames[3]!,privacy:'flag'};
    const v=verdict(frames,9,4);
    assert.equal(v.pass,false);
    assert.ok(v.reasons.some(r=>r.includes('frame 5: text clipped')));
    assert.ok(v.reasons.some(r=>r.includes('frame 4: private data')));
});
