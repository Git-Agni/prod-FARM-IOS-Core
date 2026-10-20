import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankPhotos,topicIntent,frameIntent,photoFit,newSeen,markSeen,type PhotoTag} from '../src/publishing/story-photo-match.js';
const tag=(activity:PhotoTag['activity'],screen=false):PhotoTag=>({activity,setting:'home',screen,lookingAtCamera:false,note:'',model:'m'});
const tags={l:tag('laptop',true),p:tag('phone',true),w:tag('walking'),b:tag('relaxing')};
const pool=['b','w','p','l'].map(s=>({sha256:s}));
test('a tool frame gets the laptop, the ask gets the phone, the turn gets the walk',()=>{
    assert.equal(rankPhotos(pool,'tool',tags,new Map())[0]!.sha256,'l');
    assert.equal(rankPhotos(pool,'ask',tags,new Map())[0]!.sha256,'p');
    assert.equal(rankPhotos(pool,'reflect',tags,new Map())[0]!.sha256,'w');
});
test('least recently used breaks a tie; untagged photos score 0',()=>{
    const t={a:tag('laptop'),c:tag('laptop')};
    assert.equal(rankPhotos([{sha256:'a'},{sha256:'c'}],'tool',t,new Map([['a',9]]))[0]!.sha256,'c');
    assert.equal(photoFit('tool',undefined),0);
});
test('topic and stage set the intent',()=>{
    assert.equal(topicIntent('Your leads go cold while they wait for a reply.'),'sales');
    assert.equal(topicIntent('Show it a video you love.'),'content');
    assert.equal(topicIntent('A free GitHub project adds 12 skills to Claude Code.'),'tool');
    assert.equal(frameIntent('reply','tool'),'ask');
    assert.equal(frameIntent('proof','sales'),'results');
    assert.equal(frameIntent('point','tool',true),'reflect');
    assert.equal(frameIntent('hook','sales'),'sales');
});
test('a sequence never reuses a scene and spreads activities',()=>{
    const t={l1:tag('laptop'),l2:tag('laptop'),d:tag('desk_headphones')};
    const seen=newSeen(); markSeen(seen,{file:'/v.mp4',sha256:'l1'},t);
    const ranked=rankPhotos([{sha256:'l2',file:'/v.mp4'},{sha256:'d',file:'/d.jpg'},{sha256:'l3',file:'/x.jpg'}],'tool',{...t,l3:tag('laptop')},new Map(),seen);
    assert.ok(!ranked.some(p=>p.file==='/v.mp4'));
    assert.equal(ranked[0]!.sha256,'d');
});
test('two shots from one shoot are one scene',()=>{
    const t={a:{...tag('laptop'),takenAt:'2026-01-11T13:36:00Z'},b:{...tag('laptop'),takenAt:'2026-01-11T14:20:00Z'},c:{...tag('laptop'),takenAt:'2026-01-12T09:00:00Z'}};
    const seen=newSeen(); markSeen(seen,{file:'/a.jpg',sha256:'a'},t);
    assert.deepEqual(rankPhotos([{sha256:'b',file:'/b.jpg'},{sha256:'c',file:'/c.jpg'},{sha256:'x',file:'/a.mp4'}],'tool',t,new Map(),seen).map(p=>p.sha256),['c']);
});
