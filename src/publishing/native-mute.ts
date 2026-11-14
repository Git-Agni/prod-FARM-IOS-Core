import {WdaApp} from './wda-app.js';
/** Empty Control Center background below every visible control. On iOS 27 a tap there closes it; Home and edge swipes did not. */
export function controlCenterBlankPoint(xml:string){
 let bottom=0,screenW=430,screenH=932;
 for(const m of xml.matchAll(/<XCUIElementType\w+\b[^>]*>/g)){
  const a=Object.fromEntries([...m[0].matchAll(/(\w+)="([^"]*)"/g)].map(v=>[v[1],v[2]]));
  const y=Number(a.y),w=Number(a.width),h=Number(a.height);
  if(a.type==='XCUIElementTypeApplication'&&w>0&&h>0){screenW=w;screenH=h;}
  if(a.visible!=='true'||!Number.isFinite(y+w+h)||w>=screenW*0.9)continue;
  bottom=Math.max(bottom,y+h);
 }
 const floor=screenH-32;// keep clear of the home indicator
 if(!bottom||floor-bottom<60)throw Error('No empty Control Center area to tap; no app playback allowed');
 return{x:Math.round(screenW/2),y:Math.round((bottom+floor)/2)};
}
/** Last passing zero-volume check in this worker. Antonio (Oct 7): check at most once an hour, not before every action. */
let lastZeroVolume=0;
export const MUTE_RECHECK_MS=60*60_000;
export function resetMuteCache(){lastZeroVolume=0;}
/** The enlarged volume view: the volume slider is visible but the Control Center grid is not. */
const expandedVolume=(xml:string)=>/name="cc-volume-slider"[^>]*visible="true"/.test(xml)&&!(xml.includes('Add Controls')&&xml.includes('Power'));
/** Caller holds the phone advisory lock. Never changes Mac or meeting audio. */
export class NativeMuteGuard extends WdaApp {
 private checkedAt=0;
 async prepare(options:{preserveForeground?:boolean}={}){
  if(Date.now()-lastZeroVolume<MUTE_RECHECK_MS&&(await this.request('/wda/locked')).value===false){this.checkedAt=Date.now();return;}
  if((await this.request('/wda/locked')).value!==false)throw Error('Unlock the iPhone before checking media volume');
  const id=(await this.request('/status')).sessionId;
  if(id)this.session='/session/'+id;
  else {if(options.preserveForeground)throw Error('Cannot preserve the composer without an active native session');await this.start('com.apple.springboard');}
  await this.request(this.session+'/appium/settings',{settings:{defaultActiveApplication:'com.apple.springboard',waitForIdleTimeout:0,animationCoolOffTimeout:0,snapshotMaxDepth:20}});
  if(!options.preserveForeground)await this.request('/wda/homescreen',{});await this.sleep(600);
  // iOS 27 (Oct 10 21:37): changing the volume opens an enlarged slider without the Add Controls/Power markers.
  const ccOpen=(xml:string)=>xml.includes('Add Controls')&&xml.includes('Power')||expandedVolume(xml);
  const initial=String((await this.request(this.session+'/source')).value);
  if(!ccOpen(initial))await this.request('/wda/absolute-actions',{actions:[{type:'pointer',id:'mute-check',parameters:{pointerType:'touch'},actions:[{type:'pointerMove',duration:0,x:415,y:5,origin:'viewport'},{type:'pointerDown',button:0},{type:'pointerMove',duration:350,x:415,y:280,origin:'viewport'},{type:'pointerUp',button:0}]}]});
  await this.sleep(500);
  try{
   let xml='';
   for(let read=0;read<3;read++){xml=String((await this.request(this.session+'/source')).value);if(ccOpen(xml))break;await this.sleep(500);}
   if(!ccOpen(xml))throw Error('Control Center did not open; no volume change sent');
   const tags=[...xml.matchAll(/<XCUIElementType\w+\b[^>]*>/g)].map(m=>Object.fromEntries([...m[0].matchAll(/(\w+)="([^"]*)"/g)].map(a=>[a[1],a[2]])));
   const volumes=tags.filter(a=>a.visible==='true'&&(a.name==='cc-volume-slider'||a.type==='XCUIElementTypeSlider'&&a.name==='Volume'));
   if(volumes.length!==1)throw Error('The media volume control is missing or ambiguous');
   if(volumes[0]!.value!=='0%'){
    const rows=(await this.request(this.session+'/elements',{using:'accessibility id',value:volumes[0]!.name})).value;
    if(rows.length!==1)throw Error('The media volume control is ambiguous');
    const row=this.id(rows[0]),rect=(await this.request(this.session+'/element/'+row+'/rect')).value;
    if(rect.x<20||rect.x+rect.width>431||rect.y<120||rect.y+rect.height>800)throw Error('Media volume control moved; no volume adjustment sent');
    await this.request(this.session+'/element/'+row+'/value',{value:['0']});
    // iOS 27 (Oct 10 21:36): the expanded slider stopped at 6% after a value set. Drag it to the bottom, then re-read.
    for(let n=0;n<2&&String((await this.request(this.session+'/element/'+row+'/attribute/value')).value)!=='0%';n++){
     await this.request(this.session+'/wda/dragfromtoforduration',{fromX:rect.x+rect.width/2,fromY:rect.y+rect.height/2,toX:rect.x+rect.width/2,toY:Math.min(rect.y+rect.height+60,925),duration:0.4});
     await this.sleep(500);
    }
    if(String((await this.request(this.session+'/element/'+row+'/attribute/value')).value)!=='0%')throw Error('Native media volume is not zero');
   }
   this.checkedAt=Date.now();lastZeroVolume=this.checkedAt;
  }finally{
   // Tap empty background. The top status area can open Privacy; Home and the home-indicator swipe leave it open.
   let overlay=String((await this.request(this.session+'/source')).value);
   // Tap the dimmed area beside the enlarged slider to return to Control Center (or close it).
   for(let n=0;n<2&&expandedVolume(overlay);n++){
    await this.request('/wda/absolute-actions',{actions:[{type:'pointer',id:'mute-collapse',parameters:{pointerType:'touch'},actions:[{type:'pointerMove',duration:0,x:40,y:760,origin:'viewport'},{type:'pointerDown',button:0},{type:'pause',duration:80},{type:'pointerUp',button:0}]}]});
    await this.sleep(800);overlay=String((await this.request(this.session+'/source')).value);
   }
   if(expandedVolume(overlay))throw Error('Enlarged volume control did not close; no app playback allowed');
   if(overlay.includes('Add Controls')&&overlay.includes('Power')){
    const blank=controlCenterBlankPoint(overlay);
    await this.request('/wda/absolute-actions',{actions:[{type:'pointer',id:'mute-dismiss',parameters:{pointerType:'touch'},actions:[{type:'pointerMove',duration:0,x:blank.x,y:blank.y,origin:'viewport'},{type:'pointerDown',button:0},{type:'pause',duration:80},{type:'pointerUp',button:0}]}]});
    await this.request(this.session+'/appium/settings',{settings:{defaultActiveApplication:'auto'}});
    let closed=false;for(let n=0;n<3;n++){await this.sleep(800);if(!String((await this.request(this.session+'/source')).value).includes('Add Controls')){closed=true;break;}}
    if(!closed)throw Error('Control Center did not close; no app playback allowed');
   }
   await this.request(this.session+'/appium/settings',{settings:{defaultActiveApplication:'auto'}});
   if(!options.preserveForeground)await this.request('/wda/homescreen',{});
  }
 }
 async verify(){if(!this.checkedAt||Date.now()-this.checkedAt>10*60000)throw Error('Fresh native zero-volume check is required');if((await this.request('/wda/locked')).value!==false)throw Error('The iPhone locked; no Story input sent');}
}
