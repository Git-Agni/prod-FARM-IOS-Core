import test from 'node:test';
import assert from 'node:assert/strict';
import {InstagramRelease} from '../src/publishing/instagram-release.js';

class DraftGuardProbe extends InstagramRelease {
    constructor(private controls:Set<string>) { super('http://unused',new AbortController().signal); }
    inputRequests=0;
    protected override async visible(_using:string,name:string) { return this.controls.has(name)?name:null; }
    protected override async request(_route:string,_body?:unknown) { this.inputRequests++; throw Error('No native input is allowed'); }
    check() { return this.requireProfileForNewComposer(); }
    checkPrompt() { return this.requireNoDraftPrompt(); }
}

test('an existing Instagram composer or gallery is preserved even when the tab bar is visible',async()=>{
    for(const draft of ['caption-cell-text-view','camera-discard-draft','discard-reel-preview','gallery-close-button','Continue editing your draft?']) {
        const driver=new DraftGuardProbe(new Set(['profile-tab',draft]));
        await assert.rejects(driver.check(),/left unchanged/);
        assert.equal(driver.inputRequests,0);
    }
});
test('Instagram answers a restored-draft prompt with Start new video, which keeps the draft',async()=>{
    const driver=new DraftGuardProbe(new Set(['Continue editing your draft?'])) as any;
    const taps:string[]=[];driver.sleep=async()=>{};
    driver.tapElement=async(_u:string,value:string)=>{taps.push(value);driver.controls=new Set(['gallery-header-title']);};
    await driver.checkPrompt();
    assert.deepEqual(taps,['label == "Start new video" AND visible == 1']);
});
test('Instagram still stops on a discard-draft prompt',async()=>{
    const driver=new DraftGuardProbe(new Set(['camera-discard-draft'])) as any;driver.sleep=async()=>{};
    await assert.rejects(driver.checkPrompt(),/not discarded/);
    assert.equal(driver.inputRequests,0);
});
test('an unknown Instagram screen stops before import or draft cleanup',async()=>{
    const driver=new DraftGuardProbe(new Set());
    await assert.rejects(driver.check(),/left unchanged/);
    assert.equal(driver.inputRequests,0);
});
test('the Instagram tab bar allows a new composer without cleanup input',async()=>{
    const driver=new DraftGuardProbe(new Set(['profile-tab']));
    await driver.check();
    assert.equal(driver.inputRequests,0);
});

test('a changed Instagram cover frame stops before saving it',async()=>{
    for(const frame of [{x:420,y:700,width:50,height:60},{x:0,y:900,width:50,height:60}]) {
        const driver=new InstagramRelease('http://unused',new AbortController().signal) as any;
        const actions:string[]=[];
        driver.tapElement=async(_using:string,name:string)=>{actions.push(name);};
        driver.rect=async()=>frame;
        await assert.rejects(driver.reviewOpeningCover(),/cover controls moved/);
        assert.deepEqual(actions,['Edit cover']);
    }
});

test('Instagram moves a mapped cover to the opening once and requires its readback',async()=>{
    for(const returnedX of [8,238]) {
        const d=new InstagramRelease('http://unused',new AbortController().signal) as any;
        const actions:string[]=[];let reads=0;let drags=0;
        d.tapElement=async(_using:string,name:string)=>{actions.push(name);};
        d.assertInputApp=async()=>{};
        d.rect=async()=>({x:reads++===0?238:returnedX,y:755,width:51,height:76});
        d.request=async(route:string,body:any)=>{assert.match(route,/dragfromtoforduration/);assert.equal(body.toX,1);drags++;return{value:{}};};
        if(returnedX===8){assert.equal((await d.reviewOpeningCover()).selectionMoved,true);assert.deepEqual(actions,['Edit cover','done-button']);}
        else{await assert.rejects(d.reviewOpeningCover(),/opening cover frame/);assert.deepEqual(actions,['Edit cover']);}
        assert.equal(drags,1);
    }
});
test('Instagram saves a verified opening cover frame',async()=>{
    const driver=new InstagramRelease('http://unused',new AbortController().signal) as any;
    const actions:string[]=[];
    driver.tapElement=async(_using:string,name:string)=>{actions.push(name);};
    driver.rect=async()=>({x:0,y:700,width:50,height:60});
    assert.equal((await driver.reviewOpeningCover()).openingFrame,true);
    assert.deepEqual(actions,['Edit cover','done-button']);
});

test('Instagram targets the cover button instead of its larger container',async()=>{
    const d=new InstagramRelease('http://unused',new AbortController().signal) as any;
    let query='';let touch:number[]=[];
    d.rect=async(using:string,value:string)=>{assert.equal(using,'predicate string');query=value;return{x:150,y:360,width:101,height:31};};
    d.tapPoint=async(x:number,y:number)=>{touch=[x,y];};d.sleep=async()=>{};
    await d.tapElement('accessibility id','Edit cover','Edit cover');
    assert.match(query,/XCUIElementTypeButton/);
    assert.deepEqual(touch,[200.5,375.5]);
});
test('new Reel preparation preserves an unfinished comment',async()=>{
 const d=new InstagramRelease('http://unused',new AbortController().signal)as any;
 let touches=0;d.visible=async(_using:string,name:string)=>name==='text-view'?'comment':null;
 d.read=async(_using:string,_name:string,attribute:string)=>attribute==='label'?'Add a comment':'Owner unfinished text';
 d.tapPoint=async()=>{touches++;};
 await assert.rejects(d.requireProfileForNewComposer(),/unsent comment text/);assert.equal(touches,0);
});
test('new Reel preparation closes only a mapped empty comment drawer',async()=>{
 const d=new InstagramRelease('http://unused',new AbortController().signal)as any;
 let closed=false;d.visible=async(_using:string,name:string)=>name==='text-view'&&!closed||name==='profile-tab'&&closed?'control':null;
 d.read=async(_using:string,_name:string,attribute:string)=>attribute==='label'?'Add a comment':'';
 d.request=async()=>({value:'<XCUIElementTypeButton type="XCUIElementTypeButton" label="Dismiss" visible="true" x="198" y="294" width="34" height="3"/>'});
 d.tapPoint=async(x:number,y:number)=>{assert.equal(x,215);assert.equal(y,295.5);closed=true;};d.sleep=async()=>{};
 await d.requireProfileForNewComposer();assert.equal(closed,true);
});
test('related Reel selection never scrolls the feed after a composer closes',async()=>{
 const d=new InstagramRelease('http://unused',new AbortController().signal)as any;let touches=0;
 d.visible=async()=>null;d.swipeUp=async()=>{touches++;};
 await assert.rejects(d.selectRelatedReel({url:'https://www.instagram.com/reel/Dd7K1yvCIgq/',label:'Claude YouTube',caption:'Reviewed caption'}),/no scrolling sent/);assert.equal(touches,0);
});
