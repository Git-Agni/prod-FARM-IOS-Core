import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {chooseRelatedReel,headlineSimilarity,locateHeadlineInCells,reelCatalog,reelByUrl,topicsIn} from '../src/publishing/instagram-related.js';
import {validatePostingInput} from '../src/publishing/model.js';

// The Oct 5 picker screenshot: three columns of 430 px tiles, 760 px tall, from y=402 (device pixels, 3x).
const grid=[0,1,2].flatMap(row=>[0,1,2].map(col=>({x:col*430/3,y:(402+row*760)/3,width:420/3,height:610/3})));
const picker=()=>readFile('docs/evidence/hourly-recovery-2026-10-05/chatcut-b-ig/related-picker-reference.png');

test('every catalog Reel the picker lists can be linked',()=>{
    assert.ok(reelByUrl(reelCatalog.defaultUrl));
    const urls=new Set<string>();
    for(const r of reelCatalog.reels){
        assert.ok(!urls.has(r.url));urls.add(r.url);
        if(!r.inPicker||!r.headline)continue;
        validatePostingInput({requestId:'related-catalog-test',deviceUdid:'synthetic-device',runAt:'2026-10-21T16:00:00Z',timezone:'America/Los_Angeles',caption:'c',targets:[{platform:'instagram',account:'antoniorevenue'}],instagramTrial:true,automaticPromotion:true,facebookMode:'linked_from_instagram',instagramRelatedReel:{url:r.url,caption:r.caption,label:r.label}});
        assert.ok(r.label.length<=15&&r.sha256&&r.topics.length);
        for(const o of reelCatalog.reels)if(o!==r&&o.headline)assert.ok(headlineSimilarity(r.headline,o.headline)<.8,r.headline+' ~ '+o.headline);
    }
});
test('a post links the Reel that matches its topic',()=>{
    assert.equal(chooseRelatedReel({caption:'Connect Claude to Canva and it designs your carousel posts',sha256:'new'}).reel.label,'Canva carousels');
    assert.equal(chooseRelatedReel({caption:'OpenAI just shipped new ChatGPT agents for your team',sha256:'new'}).reel.label,'ChatGPT updates');
    assert.equal(chooseRelatedReel({caption:'Comment PHONE and give Claude Code a phone number so it can call you',sha256:'new'}).reel.url,reelCatalog.defaultUrl,'Trial Reels are not in the picker');
});
test('a weak, generic or self match keeps the default Reel',()=>{
    assert.equal(chooseRelatedReel({caption:'A trip to the beach',sha256:'new'}).reel.url,reelCatalog.defaultUrl);
    assert.equal(chooseRelatedReel({caption:'Claude Code github open source agent agents skill',sha256:'new'}).reel.url,reelCatalog.defaultUrl,'generic words alone');
    const canva=reelCatalog.reels.find(r=>r.label==='Canva carousels')!,ask='Connect Claude to Canva and it designs your carousel posts';
    assert.notEqual(chooseRelatedReel({caption:canva.caption,sha256:'new'}).reel.url,canva.url,'same caption');
    assert.notEqual(chooseRelatedReel({caption:ask,sha256:canva.sha256}).reel.url,canva.url,'same video');
    assert.notEqual(chooseRelatedReel({caption:ask,sha256:'recut',headline:'YOUR CLAUDE DESIGNS CAROUSELSIN CANVA'}).reel.url,canva.url,'same cover');
});
test('topics match whole words only',()=>{
    assert.deepEqual(topicsIn('Phones and callers',['phone','call']),[]);
    assert.deepEqual(topicsIn('Give Claude a #phone. Call it.',['phone','call']),['phone','call']);
});
test('the picker tile is found by its cover headline',async()=>{
    const png=await picker();
    const train=await locateHeadlineInCells(png,grid,'TRAIN YOUR OWN AI MODEL');
    assert.deepEqual([train.found?.x,train.found?.y],[grid[3]!.x+70,grid[3]!.y+97]);
    const google=await locateHeadlineInCells(png,grid,"GOOGLE'S FREE AGENT SKILLS");
    assert.deepEqual([google.found?.x,google.found?.y],[grid[7]!.x+70,grid[7]!.y+97]);
    assert.equal((await locateHeadlineInCells(png,grid,'CLAUDE CODE PHONE NUMBER CALLS YOU')).found,undefined,'not on this page');
});
test('a headline on two tiles selects nothing',async()=>{
    const png=await picker();
    const tile=await sharp(png).extract({left:0,top:1162,width:420,height:610}).png().toBuffer();
    const twice=await sharp(png).composite([{input:tile,left:860,top:1922}]).png().toBuffer();
    await assert.rejects(locateHeadlineInCells(twice,grid,'TRAIN YOUR OWN AI MODEL'),/two picker tiles/);
    await assert.rejects(locateHeadlineInCells(png,grid,'AI'),/too short/);
});
test('the Oct 20 live picker pages find each listed Reel on exactly one tile',async()=>{
    const root='docs/evidence/instagram-related-topics-2026-10-20',scan=JSON.parse(await readFile(root+'/picker-scan.json','utf8'));
    const page=async(n:number)=>({png:await readFile(`${root}/scan-page${n}.png`),cells:scan.find((p:any)=>p.page===n).tiles});
    const p0=await page(0),p2=await page(2);
    assert.deepEqual((await locateHeadlineInCells(p0.png,p0.cells,'FABLE 5.5 ALREADY HERE?')).found,{x:70,y:230,score:1});
    assert.equal((await locateHeadlineInCells(p2.png,p2.cells,'CLAUDE CAN PLAN YOUR WEBSITE IN 6 DOCS')).found?.y,657,'split across OCR passes');
    assert.equal((await locateHeadlineInCells(p2.png,p2.cells,'FABLE 5.5 ALREADY HERE?')).found,undefined);
});
