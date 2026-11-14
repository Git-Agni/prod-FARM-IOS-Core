import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { openingCoverDistance, mirrorSwitchState, MirroringInstagramRelease } from '../src/publishing/mirroring-release.js';
import {publishedCoverDistance} from '../src/publishing/mirroring-cover.js';

test('the cover check rejects a different opening image',async()=>{
    const red=await sharp({create:{width:108,height:192,channels:3,background:'#ff0000'}}).png().toBuffer();
    const blue=await sharp({create:{width:696,height:1532,channels:3,background:'#0000ff'}}).png().toBuffer();
    const snapshot={width:696,height:1532,text:[],lines:[],png:blue.toString('base64')};
    assert.ok(await openingCoverDistance(red,snapshot)>0.5);
});
test('published cover receipts reject a different video even when captions match',async()=>{
    const red=await sharp({create:{width:108,height:192,channels:3,background:'#ff0000'}}).png().toBuffer();
    const blue=await sharp({create:{width:108,height:192,channels:3,background:'#0000ff'}}).png().toBuffer();
    const tile=await sharp(red).resize(100,178).extract({left:0,top:0,width:100,height:140}).png().toBuffer();
    const screen=await sharp({create:{width:400,height:800,channels:3,background:'#ffffff'}}).composite([{input:tile,left:100,top:200}]).png().toBuffer();
    const snapshot={width:400,height:800,text:['The same caption #chatcut'],lines:[],png:screen.toString('base64')};
    const rect={x:.25,y:.25,width:.25,height:.175};
    assert.ok(await publishedCoverDistance(red,snapshot,rect,178/800)<.01);
    assert.ok(await publishedCoverDistance(blue,snapshot,rect,178/800)>.5);
});

test('ambiguous switch pixels stop native preflight',async()=>{
    const grey=await sharp({create:{width:696,height:1532,channels:3,background:'#808080'}}).png().toBuffer();
    await assert.rejects(mirrorSwitchState({width:696,height:1532,text:[],lines:[],png:grey.toString('base64')},0.5),/ambiguous/);
});

test('a cover match alone cannot authorize Share after an incomplete preflight',async()=>{
    const driver=new MirroringInstagramRelease(new AbortController().signal,'/unused');
    (driver as any).input={};(driver as any).coverChecked=true;
    let taps=0;driver.screen.tapText=async()=>{taps++;};
    await assert.rejects(driver.shareOnce(),/preflight is incomplete/);
    assert.equal(taps,0);
});

test('an uncertain Mirroring Share cannot be tapped a second time',async()=>{
    const driver=new MirroringInstagramRelease(new AbortController().signal,'/unused');
    (driver as any).input={};(driver as any).coverChecked=true;(driver as any).preflightComplete=true;
    let taps=0;driver.screen.tapText=async()=>{taps++;throw new Error('Uncertain result');};
    await assert.rejects(driver.shareOnce(),/Uncertain result/);
    await assert.rejects(driver.shareOnce(),/already attempted/);
    assert.equal(taps,1);
});
