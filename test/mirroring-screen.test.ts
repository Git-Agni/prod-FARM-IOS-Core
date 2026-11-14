import test from 'node:test';
import assert from 'node:assert/strict';
import { containsCaption, normalizeMirrorText, MirrorScreen,nativeHomeContext } from '../src/devices/mirroring/screen.js';
import {stageMirroringMedia} from '../src/publishing/mirroring-media.js';

test('Mirroring caption checks require the entire text and every hashtag',()=>{
    const caption="Comment CHATCUT and I'll send you the guide\n\nSave this. #chatcut #chatgpt";
    assert.equal(containsCaption(['antoniorevenue',"Comment CHATCUT and I’ll send you the guide",'Save this. #chatcut #chatgpt','1 minute ago'],caption),true);
    assert.equal(containsCaption(["Comment CHATCUT and I'll send you the guide"],caption),false);
    assert.equal(containsCaption(["Comment CHATCUT and I'll send you the guide",'Save this. #chatgpt #chatcut'],caption),false);
    assert.equal(containsCaption(['Comment CHATCUT guide send you', 'Save this. #chatcut #chatgpt'],caption),false);
    assert.equal(normalizeMirrorText('  I’ll\n send  “it”  '),`I'll send "it"`);
    assert.equal(containsCaption(["Comment CHATCUT and I'll send you the guide",'Save this. #chatcut #chatgpt'],caption.replace('guide','guide 👇')),true);
});

test('changed media is rejected before iCloud staging or phone input',async()=>{
    await assert.rejects(stageMirroringMedia({path:import.meta.filename,name:'test.mp4',mimeType:'video/mp4',sha256:'0'.repeat(64)}),/video changed/);
    await assert.rejects(stageMirroringMedia({path:import.meta.filename,name:'test.mp4',mimeType:'text/plain',sha256:'0'.repeat(64)}),/saved MP4/);
});

test('Mirroring types bounded Unicode chunks without splitting an emoji',async()=>{
    const screen=new MirrorScreen(new AbortController().signal);
    const parts:any[]=[];
    screen.input=async (command,context,fields)=>{parts.push({command,context,...fields});};
    const text='a'.repeat(39)+'👇'+'b'.repeat(41);
    await screen.type(text,['Caption']);
    assert.equal(parts.length,3);
    assert.equal(parts.map(x=>x.text).join(''),text);
    assert.ok(parts.every(x=>Array.from(x.text).length<=40));
    assert.deepEqual(parts[0].context,['Caption']);
});
test('Home uses a native control instead of a changing clock or subtitle',()=>{
    const screen={width:696,height:1532,text:['16:59','A changing video subtitle','Antonio Revenue','Add a comment'],lines:[],png:''};
    assert.deepEqual(nativeHomeContext(screen),['Add a comment']);
    assert.deepEqual(nativeHomeContext({...screen,text:['17:00','A different subtitle','Add a comment']}),['Add a comment']);
    assert.deepEqual(nativeHomeContext({...screen,text:['Files','A recent app card']}),['Files']);
    assert.throws(()=>nativeHomeContext({...screen,text:['17:01','A changing subtitle']}),/stable native control/);
});
