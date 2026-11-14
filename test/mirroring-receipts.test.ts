import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeCaptionWindowsMatch,MirroringReceiptReader} from '../src/publishing/mirroring-receipts.js';
import {MirrorScreen,type MirrorSnapshot} from '../src/devices/mirroring/screen.js';
test('scrolled native receipts require all words and the ordered hashtags with overlapping context',()=>{
    const caption="Comment CHATCUT and I'll send you the guide. Give ChatCut your raw footage and a prompt for the first edit. Save your editing style for the next video. #chatcut #chatgpt #videoediting";
    const words=caption.split(' ');
    const views=[words.slice(0,25).join(' '),words.slice(15).join(' ')];
    assert.equal(nativeCaptionWindowsMatch(views,caption),true);
    assert.equal(nativeCaptionWindowsMatch([words.slice(0,25).join(' ')],caption),false);
    assert.equal(nativeCaptionWindowsMatch(views.map(x=>x.replace('raw footage','footage')),caption),false);
    assert.equal(nativeCaptionWindowsMatch(views.map(x=>x.replace('#chatcut #chatgpt','#chatgpt #chatcut')),caption),false);
    assert.equal(nativeCaptionWindowsMatch(views.map(x=>x.replace('#videoediting','')),caption),false);
    assert.equal(nativeCaptionWindowsMatch(['A native caption can wrap B- roll onto a second line. #videoediting'],'A native caption can wrap B-roll onto a second line. #videoediting'),true);
    assert.equal(nativeCaptionWindowsMatch(["Comment CHATCUT and I'Il send you the setup guide"],"Comment CHATCUT and I'll send you the setup guide"),true);
});

function snapshot(text:string[]):MirrorSnapshot{return {width:696,height:1532,text,lines:text.map((value,index)=>({text:value,confidence:1,x:0.1,y:0.2+index*0.1,width:0.7,height:0.03})),png:''};}
test('a collapsed owned profile is valid without the dashboard row',async()=>{
    const s=snapshot(['antoniorevenue','Edit profile','Drafts and trial reels']);
    const screen=new MirrorScreen(new AbortController().signal);let taps=0;
    screen.openApp=async()=>s;screen.snapshot=async()=>s;screen.tap=async()=>{taps++;};
    const reader=new MirroringReceiptReader(screen,async(_name,view)=>view??s);
    assert.equal(await reader.instagramProfile(),s);
    assert.equal(taps,0);
});
test('a resumed Trial Reel returns through its grid instead of tapping insights',async()=>{
    const states=[snapshot(['antoniorevenue','Trial insights','Trial reels']),snapshot(['Trial reels','Create trial reel']),snapshot(['antoniorevenue','Edit profile','Share profile'])];
    const screen=new MirrorScreen(new AbortController().signal);let index=0;const taps:any[]=[];
    screen.openApp=async()=>states[0]!;screen.snapshot=async()=>states[index]!;
    screen.tap=async(x,y,context)=>{taps.push({x,y,context});index++;};
    const reader=new MirroringReceiptReader(screen,async(_name,view)=>view??states[index]!);
    assert.equal(await reader.instagramProfile(),states[2]);
    assert.equal(taps.length,2);
    assert.ok(taps.every(t=>t.y<0.2));
    assert.ok(taps.every(t=>!t.context.includes('Share')));
});
test('caption navigation uses its stable keyword while the receipt check remains exact',async()=>{
    const s=snapshot(['antoniorevenue',"Comment CHATCUT and l'Il send you the setup ...."]);
    s.lines[1]!.y=0.85;
    const expanded=snapshot(['antoniorevenue','Add a comment']);
    const screen=new MirrorScreen(new AbortController().signal);const contexts:string[][]=[];
    screen.waitFor=async expected=>expected.includes('Add a comment')?expanded:s;
    screen.tap=async(_x,_y,context)=>{contexts.push(context);};
    const reader=new MirroringReceiptReader(screen,async(_name,view)=>view??s);
    assert.equal(await reader.openIGCaption(),expanded);
    assert.deepEqual(contexts,[['antoniorevenue','Comment CHATCUT']]);
    assert.equal(nativeCaptionWindowsMatch(["Comment CHATCUT and l'Il send you the setup guide"],"Comment CHATCUT and I'll send you the setup guide"),false);
});
test('a linked owned Reel returns through its back control before opening a composer',async()=>{
    const states=[snapshot(['antoniorevenue','Insights on Edits','Claude YouTube']),snapshot(['antoniorevenue','Edit profile'])];
    const screen=new MirrorScreen(new AbortController().signal);let index=0;const taps:any[]=[];
    screen.openApp=async()=>states[0]!;screen.snapshot=async()=>states[index]!;
    screen.tap=async(x,y,context)=>{taps.push({x,y,context});index++;};
    const reader=new MirroringReceiptReader(screen,async(_name,view)=>view??states[index]!);
    assert.equal(await reader.instagramProfile(),states[1]);
    assert.deepEqual(taps,[{x:0.107,y:0.133,context:['antoniorevenue','Insights on Edits']}]);
});
test('a changed source cannot produce an Instagram receipt or any phone input',async()=>{
    const screen=new MirrorScreen(new AbortController().signal);let touched=false;
    screen.openApp=async()=>{touched=true;throw new Error('Unexpected phone input');};
    const reader=new MirroringReceiptReader(screen,async()=>snapshot([]));
    await assert.rejects(reader.verifyInstagram({} as any,{path:import.meta.filename,name:'source.mp4',mimeType:'video/mp4',sha256:'0'.repeat(64)}),/unchanged source/);
    assert.equal(touched,false);
});
