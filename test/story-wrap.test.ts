import test from 'node:test';
import assert from 'node:assert/strict';
import {wrapStoryText} from '../src/publishing/wda-story-driver.js';

test('Story text wraps into short centred lines (Oct 17 clipped call to action)',()=>{
    const w=wrapStoryText('Comment COMMUNITY on the reel');
    assert.ok(w.split('\n').every(l=>l.length<=20));
    assert.equal(w.replace(/\n/g,' '),'Comment COMMUNITY on the reel');
});
