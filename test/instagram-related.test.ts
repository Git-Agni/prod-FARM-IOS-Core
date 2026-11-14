import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import {locateRelatedCover,uniqueCoverMatch,reviewedRelatedReel} from '../src/publishing/instagram-related.js';
test('related picker rejects missing and ambiguous cover matches',()=>{
 for(const scores of [[],[.1,.2],[.01,.02],[NaN,.1]])assert.throws(()=>uniqueCoverMatch(scores),/missing or ambiguous/);
 assert.equal(uniqueCoverMatch([.3,.01,.2]),1);
});
test('related picker finds the reviewed cover after its grid cell moves',async()=>{
 const reference=await readFile('docs/evidence/hourly-recovery-2026-10-05/chatcut-b-ig/related-picker-reference.png');
 const related={url:reviewedRelatedReel,label:'Claude YouTube',caption:'reviewed'};
 assert.equal((await locateRelatedCover(reference,related)).x,70);
 const cover=await sharp(reference).extract({left:0,top:402,width:420,height:610}).png().toBuffer();
 const moved=await sharp({create:{width:1290,height:2796,channels:3,background:'#ff00ff'}}).composite([{input:cover,left:860,top:1162}]).png().toBuffer();
 const position=await locateRelatedCover(moved,related);assert.equal(position.x,1070/3);assert.equal(position.y,1452/3);
 await assert.rejects(locateRelatedCover(reference,{...related,url:'https://www.instagram.com/reel/other/'}),/own reviewed/);
});

test('a Trial receipt distinguishes a saved link from a visible Watch button',async()=>{
 const{InstagramRelease}=await import('../src/publishing/instagram-release.js');const d=new InstagramRelease('http://unused',new AbortController().signal) as any;
 d.input={instagramRelatedReel:{url:reviewedRelatedReel,label:'Claude YouTube'}};d.request=async()=>({value:'<XCUIElementTypeButton visible="true" name="more-options-button"/>'});
 const taps:string[]=[];d.tapElement=async(_u:string,v:string)=>{taps.push(v)};d.read=async()=> 'Claude YouTube';
 const r={instagram:{verified:true,evidence:'Native Reel'}};await d.verifyRelatedReel(r);
 assert.match(r.instagram.evidence,/Watch button visibility was not verified/);assert.equal(taps.at(-1),'Cancel');assert.equal(taps.length,3);
 d.read=async()=> 'Wrong';await assert.rejects(d.verifyRelatedReel(r),/label does not match/);
});
