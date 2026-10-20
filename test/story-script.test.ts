import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storyScript,hookScore,ctaParts} from '../src/publishing/story-script.js';

const mimic=`Comment MIMIC and I'll send you the setup guide.

ReelMimic is a free, open-source tool. Show it a video you love and it makes a new one in the same style.

It studies the shots, cuts, colors and camera moves. Then up to six AI agents build it on your own Claude Code, and a different agent reviews every shot.

Style is the new edge.

Follow @antoniorevenue. I post every day.

#claudecode #aitools`;

test('the CTA names what arrives, from the caption',()=>{
    assert.deepEqual(ctaParts(mimic),{keyword:'MIMIC',reward:'the setup guide'});
    assert.deepEqual(ctaParts('Comment "TEARDOWN" to get this tool.'),{keyword:'TEARDOWN',reward:'this tool'});
    assert.deepEqual(ctaParts('No call here.'),{});
});
test('the kit arc: hook, points in caption order, the turn, a CTA with the reward',()=>{
    const s=storyScript(mimic)!;
    assert.equal(s.turn,'Style is the new edge.');
    assert.equal(s.cta,"Comment MIMIC on the reel\nand I'll send you the setup guide");
    assert.ok(!s.points.includes(s.hook)&&!s.points.includes(s.turn!));
    assert.ok(s.points.length>=2);
});
test('hook tests favour a named thing, the viewer and a number, and reject a bare question',()=>{
    assert.ok(hookScore('Your leads go cold while they wait for a reply.')>hookScore('It studies the shots.'));
    assert.ok(hookScore('Harvard Business Review studied this and found 7 times more leads.')>=6);
    assert.equal(hookScore('Ever wondered why?'),0);
});
test('too little caption gives no script',()=>{
    assert.equal(storyScript('Comment X. Short.'),null);
});

test('the caption opening stays as the hook when it passes; lead-ins join their sentence',()=>{
    const s=storyScript(`Your leads go cold while they wait for a reply.

Harvard Business Review studied this. Companies that answered within an hour were nearly seven times as likely to qualify the lead.

The fix is speed to lead.

Comment RESPOND and I'll send you the setup.`)!;
    assert.equal(s.hook,'Your leads go cold while they wait for a reply.');
    assert.equal(s.points[0],'Harvard Business Review studied this. Companies that answered within an hour were nearly seven times as likely to qualify the lead.');
    assert.equal(s.turn,'The fix is speed to lead.');
});
