import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pickPhotos,wrapLines,lifestyleTexts,topicMatch,captionLayout,KIT} from '../src/publishing/story-lifestyle.js';
const photos=['a','b','c','d','e','f'].map(s=>({file:`/x/${s}.jpg`,sha256:s.repeat(64)}));
test('photos rotate least recently used, never-used first',()=>{
    const used=new Map([['a'.repeat(64),5],['b'.repeat(64),1]]);
    assert.deepEqual(pickPhotos(photos,used).map(p=>p.file),['/x/c.jpg','/x/d.jpg','/x/e.jpg','/x/f.jpg']);
    assert.throws(()=>pickPhotos(photos.slice(0,3),new Map()),/3 photos/);
});
test('frame text is at most three lines and ends with the Reel keyword',()=>{
    const t=lifestyleTexts(['Short opener here.','If you use Claude Code to build real business systems, install these before your next session.','Second short line.','Third one.',"Comment CLAUDE on the reel and I'll send it to you."],['Fallback line.']);
    assert.deepEqual(t,['Short opener here.','Second short line.','Third one.','Comment CLAUDE on this reel']);
    assert.ok(t.every(x=>wrapLines(x).length<=3));
});
test('a proof card matches the Reel topic by a shared word',()=>{
    assert.ok(topicMatch('Every lead scored before the call','Your leads go cold while they wait for a reply.'));
    assert.ok(topicMatch('$114K cash collected in 15 days with AI SMS','Your setters, AI SMS and AI voice work every lead.'));
    assert.ok(!topicMatch('Refunds from 20% to under 10% in 90 days','ReelMimic is a free, open-source tool.'));
});
test('captions use the kit caption band: balanced lines, no lone last word, too long gives null',()=>{
    const l=captionLayout('ReelMimic is a free, open-source tool.')!;
    assert.ok(l.size<=KIT.sizeMax&&l.size>=KIT.sizeMin);
    assert.ok((l.lines.length-1)*l.lineHeight+l.size<=KIT.captionBottom-KIT.captionTop);
    assert.ok(l.lines.every(x=>x.split(' ').length>1));
    assert.equal(captionLayout('word '.repeat(80)),null);
});
