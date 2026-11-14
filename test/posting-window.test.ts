import test from 'node:test';
import assert from 'node:assert/strict';
import {insidePostingWindow} from '../src/publishing/timed-release.js';
test('same-slot work can wait for the phone but missed slots remain blocked',()=>{
 const minute=60_000;
 assert.equal(insidePostingWindow(0,minute,15*minute),true);
 assert.equal(insidePostingWindow(0,11*minute,11*minute),true);
 assert.equal(insidePostingWindow(0,46*minute,46*minute),false);
 assert.equal(insidePostingWindow(0,minute,31*minute),true);
 assert.equal(insidePostingWindow(0,minute,56*minute),false);
});
