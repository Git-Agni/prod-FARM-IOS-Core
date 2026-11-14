import test from 'node:test';
import assert from 'node:assert/strict';
import {InstagramRelease} from '../src/publishing/instagram-release.js';
const cell=(name:string,label:string,x:number,y:number,width:number,height:number)=>`<XCUIElementTypeCell type="XCUIElementTypeCell" visible="true" name="${name}" label="${label}" x="${x}" y="${y}" width="${width}" height="${height}"/>`;
function fixture(offscreen=false,unknown=false){
 const d=new InstagramRelease('http://unused',new AbortController().signal) as any;
 const taps:number[][]=[];let stage=0,scrolls=0;
 d.session='/session/test';d.input={targets:[{platform:'instagram',account:'antoniorevenue'}]};
 d.sleep=async()=>{};d.visible=async(_using:string,value:string)=>value==='profile-tab'?'profile':null;
 d.read=async()=> 'antoniorevenue';d.tapElement=async(_u:string,v:string)=>{assert.equal(v,'profile-tab');stage=1;};
 d.tapPoint=async(x:number,y:number)=>{taps.push([x,y]);stage++;};
 d.waitFor=async(_u:string,v:string)=>{assert.equal(v,'reels-video-thumbnail');return 'grid';};
 d.request=async(route:string)=>{
  if(route.endsWith('/wda/dragfromtoforduration')){scrolls++;return {};}
  assert.ok(route.endsWith('/source'));
  if(stage<2)return {value:unknown?'':cell('Reels','Reels',99,offscreen&&scrolls===0?844:109,88,48)};
  if(stage===2)return {value:cell('open-drafts','Drafts',0,157,143,254)};
  return {value:cell('Trial reels','Trial reels',0,844,430,54)};
 };
 return {d,taps,scrolls:()=>scrolls};
}
test('Trial navigation opens the current Drafts cell and Trial sheet once',async()=>{
 const f=fixture();await f.d.openTrialReelsGrid();assert.deepEqual(f.taps,[[143,133],[71.5,284],[215,871]]);assert.equal(f.scrolls(),0);
});
test('profile Reels tab near the bottom bar is scrolled into view before tapping',async()=>{
 const f=fixture(true);await f.d.openTrialReelsGrid();assert.equal(f.scrolls(),1);assert.deepEqual(f.taps[0],[143,133]);
});
test('unknown profile layout stops after one scroll and never guesses a tab position',async()=>{
 const f=fixture(false,true);await assert.rejects(f.d.openTrialReelsGrid(),/not safely visible/);assert.equal(f.scrolls(),1);assert.deepEqual(f.taps,[]);
});
