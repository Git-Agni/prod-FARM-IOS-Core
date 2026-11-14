import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseLongForm,pickerRowMatches,longFormById,longFormCatalog} from '../src/publishing/youtube-longform.js';

const short=(title:string,caption='',tags:string[]=[])=>({caption,youtube:{title,publishing:{tags}}});

test('every catalog video is on the posting channel and has titles and topics',()=>{
    assert.ok(longFormById(longFormCatalog.defaultId));
    const ids=new Set<string>();
    for(const v of longFormCatalog.videos){assert.match(v.id,/^[A-Za-z0-9_-]{11}$/);assert.ok(!ids.has(v.id));ids.add(v.id);assert.ok(v.titles.length&&v.topics.length);}
});
test('a Short links the long-form video that matches its topic',()=>{
    assert.equal(chooseLongForm(short('This free Claude skill designs your logo','#claudecode #github')).video.id,'EJ3jguKfNB8');
    assert.equal(chooseLongForm(short('Stop Buying Leads: This Free Claude Agent Finds Them','cold emails and leads')).video.id,'o0kJVSPdWBo');
    assert.equal(chooseLongForm(short('ChatGPT keeps notes on you. Here is how to wipe them','memory')).video.id,'qcTdOLn3syo');
    assert.equal(chooseLongForm(short('Google just released Gemini 4 Argon')).video.id,'DWREa1sv_Ho');
});
test('a weak or missing match keeps the default video',()=>{
    const pick=chooseLongForm(short('Character.ai Filed for Bankruptcy','Disney bid'));
    assert.equal(pick.video.id,longFormCatalog.defaultId);assert.deepEqual(pick.topics,[]);
    assert.equal(chooseLongForm(short('A trip','a single mention of crm')).video.id,longFormCatalog.defaultId,'one description hit is not enough');
});
test('topics match whole words only',()=>{
    assert.notEqual(chooseLongForm(short('Skillet recipes for repos-itory fans')).video.id,'EJ3jguKfNB8');
});
test('the picker row must match a known title and the owning channel',()=>{
    const v=longFormById('oT6alCHNwKA')!,owner=longFormCatalog.owner;
    assert.equal(pickerRowMatches('Your AI Sales System Is Creating More Work - 6 minutes, 36 seconds - Go to channel - '+owner,v),true);
    assert.equal(pickerRowMatches('How to Build a Sales Team AI Can\'t Replace - 6 minutes, 36 seconds - Go to channel - '+owner,v),true);
    assert.equal(pickerRowMatches('How to Build a Sales Team AI Can\'t Replace - 6 minutes, 36 seconds - Go to channel - Someone Else',v),false);
    assert.equal(pickerRowMatches('How to Build a Sales Team AI Can\'t Replace Fast - 51 seconds - Go to channel - '+owner,v),false);
    assert.equal(pickerRowMatches(undefined,v),false);
});
