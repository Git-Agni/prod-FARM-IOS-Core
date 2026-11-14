import test from'node:test';import assert from'node:assert/strict';import{NativeMuteGuard,controlCenterBlankPoint,resetMuteCache}from'../src/publishing/native-mute.js';import{beforeEach}from'node:test';
beforeEach(()=>resetMuteCache());
test('native mute guard cannot admit playback from an old or missing check',async()=>{const d=new NativeMuteGuard('http://unused',new AbortController().signal)as any;d.request=async()=>({value:false});await assert.rejects(d.verify(),/Fresh/);d.checkedAt=Date.now()-11*60000;await assert.rejects(d.verify(),/Fresh/);d.checkedAt=Date.now();await d.verify();d.request=async()=>({value:true});await assert.rejects(d.verify(),/locked/);});
test('native volume check reads zero without changing the volume or locking the phone',async()=>{const d=new NativeMuteGuard('http://unused',new AbortController().signal)as any;const routes:string[]=[];let dismiss=false;d.sleep=async()=>{};d.request=async(p:string)=>{routes.push(p);if(p==='/wda/locked')return{value:false};if(p==='/status')return{sessionId:'synthetic'};if(p==='/wda/absolute-actions'&&routes.filter(p=>p==='/wda/absolute-actions').length===1)dismiss=true;if(p.endsWith('/source'))return{value:dismiss?'Home':'<XCUIElementTypeOther type="XCUIElementTypeOther" name="cc-volume-slider" visible="true" value="0%" x="280" y="300" width="145" height="150"/> Add Controls Power'};if(p.endsWith('/elements'))return{value:[{ELEMENT:'volume'}]};if(p.endsWith('/rect'))return{value:{x:280,y:300,width:145,height:150}};if(p.endsWith('/attribute/value'))return{value:'0%'};return{value:null};};await d.prepare();await d.verify();assert.ok(!routes.some(p=>p.endsWith('/value')&&!p.endsWith('/attribute/value')));assert.ok(!routes.includes('/wda/lock'));assert.equal(routes.at(-2),'/wda/homescreen');});
test('mute check creates a safe SpringBoard session after WDA restarts',async()=>{
 const d=new NativeMuteGuard('http://unused',new AbortController().signal)as any;
 let started='',dismiss=false;d.sleep=async()=>{};
 d.start=async(bundle:string)=>{started=bundle;d.session='/session/fresh';};
 d.request=async(p:string)=>{
  if(p==='/wda/locked')return{value:false};if(p==='/status')return{sessionId:null};
  if(p==='/wda/absolute-actions')dismiss=true;
  if(p.endsWith('/source'))return{value:dismiss?'Home':'<XCUIElementTypeOther type="XCUIElementTypeOther" name="cc-volume-slider" visible="true" value="0%" x="280" y="300" width="145" height="150"/> Add Controls Power'};
  return{value:null};
 };
 await d.prepare();await d.verify();assert.equal(started,'com.apple.springboard');
});

test('preserving a composer checks volume without sending Home',async()=>{
 const d=new NativeMuteGuard('http://unused',new AbortController().signal)as any;const routes:string[]=[];let dismissed=false;d.sleep=async()=>{};
 d.request=async(p:string)=>{routes.push(p);if(p==='/wda/locked')return{value:false};if(p==='/status')return{sessionId:'existing'};if(p==='/wda/absolute-actions')dismissed=true;if(p.endsWith('/source'))return{value:dismissed?'Composer':'<XCUIElementTypeOther type="XCUIElementTypeOther" name="cc-volume-slider" visible="true" value="0%" x="280" y="300" width="145" height="150"/> Add Controls Power'};return{value:null};};
 await d.prepare({preserveForeground:true});await d.verify();assert.ok(!routes.includes('/wda/homescreen'));
 resetMuteCache();d.request=async(p:string)=>p==='/wda/locked'?{value:false}:{sessionId:null};await assert.rejects(d.prepare({preserveForeground:true}),/active native session/);
});

test('Control Center closes with a tap below every control, away from the privacy indicator',async()=>{
 const d=new NativeMuteGuard('http://unused',new AbortController().signal)as any;let dismissed=false;let action:any;d.sleep=async()=>{};
 d.request=async(p:string,b:any)=>{if(p==='/wda/locked')return{value:false};if(p==='/status')return{sessionId:'existing'};if(p==='/wda/absolute-actions'){action=b.actions[0].actions;dismissed=true;}if(p.endsWith('/source'))return{value:dismissed?'Composer':'<XCUIElementTypeOther type="XCUIElementTypeOther" name="cc-volume-slider" visible="true" value="0%" x="280" y="300" width="145" height="150"/> Add Controls Power'};return{value:null};};
 await d.prepare({preserveForeground:true});assert.deepEqual([action[0].x,action[0].y],[215,675]);assert.equal(action[2].type,'pause');assert.equal(action[3].type,'pointerUp');
});

test('blank Control Center point uses the live iOS 27 layout and refuses a full screen',()=>{
 const el=(t:string,y:number,h:number,w=73)=>`<XCUIElementType${t} type="XCUIElementType${t}" visible="true" x="46" y="${y}" width="${w}" height="${h}"/>`;
 const live=el('Application',0,932,430)+el('Other',0,932,430)+el('Button',578,74)+el('Button',667,73);
 assert.deepEqual(controlCenterBlankPoint(live),{x:215,y:820});
 assert.throws(()=>controlCenterBlankPoint(el('Application',0,932,430)+el('Button',800,80)),/No empty Control Center area/);
 assert.throws(()=>controlCenterBlankPoint('Add Controls Power'),/No empty Control Center area/);
});

test('a passing zero-volume check is reused for an hour without opening Control Center again',async()=>{
 let actions=0,dismissed=false;
 const request=async(p:string,b:any)=>{if(p==='/wda/locked')return{value:false};if(p==='/status')return{sessionId:'s'};
  if(p==='/wda/absolute-actions'){actions++;if(b?.actions?.[0]?.id==='mute-dismiss')dismissed=true;else dismissed=false;}
  if(p.endsWith('/source'))return{value:dismissed?'Home':'<XCUIElementTypeOther type="XCUIElementTypeOther" name="cc-volume-slider" visible="true" value="0%" x="280" y="300" width="145" height="150"/> Add Controls Power'};return{value:null};};
 const d=new NativeMuteGuard('http://unused',new AbortController().signal)as any;d.sleep=async()=>{};d.request=request;
 await d.prepare();const first=actions;assert.ok(first>0);
 const e=new NativeMuteGuard('http://unused',new AbortController().signal)as any;e.sleep=async()=>{};e.request=request;
 await e.prepare();await e.verify();assert.equal(actions,first);
});
