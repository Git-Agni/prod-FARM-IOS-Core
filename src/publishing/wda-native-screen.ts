import sharp from 'sharp';
import {MirrorScreen,normalizeMirrorText,type MirrorSnapshot} from '../devices/mirroring/screen.js';
import {WdaApp} from './wda-app.js';
import {visibleNativeNodes} from './native-xml.js';

const apps:Record<string,string>={Instagram:'com.burbn.instagram',Facebook:'com.facebook.Facebook',TikTok:'com.zhiliaoapp.musically','YouTube Studio':'com.google.ios.ytcreator'};
/** Run reviewed Story layouts on the iPhone. Every input remains guarded and bounded. */
export class WdaNativeScreen extends MirrorScreen {
 private phone:WdaApp;private bundle='';
 constructor(base:string,signal:AbortSignal,private verifySilent:()=>Promise<void>){super(signal);this.phone=new WdaApp(base,signal);}
 private get api(){return this.phone as any;}
 override async snapshot():Promise<MirrorSnapshot>{
  if(!this.bundle)throw Error('Open the reviewed native app first');
  const p=await this.phone.capturePreview(),meta=await sharp(p.screenshot).metadata();
  if(meta.width!==1290||meta.height!==2796)throw Error('Native Story screen size changed');
  const labels=visibleNativeNodes(p.source).filter(n=>n.label&&n.width>0&&n.height>0&&n.x>=0&&n.y>=0&&n.x+n.width<=431&&n.y+n.height<=933);
  const unique=[...new Map(labels.map(n=>[[n.label,n.x,n.y,n.width,n.height].join('|'),n])).values()];
  return {width:1290,height:2796,png:p.screenshot.toString('base64'),text:unique.map(n=>n.label),lines:unique.map(n=>({text:n.label,confidence:1,x:n.x/430,y:n.y/932,width:n.width/430,height:n.height/932}))};
 }
 override async input(command:string,context:string[],f:Record<string,unknown>={}){
  await this.beforeInput?.();await this.verifySilent();await this.waitFor(context,4000);await this.api.assertInputApp();
  const point=async(x:number,y:number)=>{if(![x,y].every(Number.isFinite)||x<0||x>1||y<.04||y>.97)throw Error('Native Story point is outside the reviewed screen');await this.api.tapPoint(x*430,y*932);};
  if(command==='tap')return point(Number(f.x),Number(f.y));
  if(command==='tap-text'){
   const s=await this.snapshot(),rows=s.lines.filter(l=>normalizeMirrorText(l.text)===normalizeMirrorText(String(f.matchText))&&l.y>=Number(f.minY)&&l.y+l.height<=Number(f.maxY));
   if(rows.length!==1)throw Error('Native Story control is missing or ambiguous');const r=rows[0]!;return point(r.x+r.width/2,r.y+r.height/2);
  }
  if(command==='text'){const value=String(f.text??'');if(!value||value.length>300)throw Error('Native Story text is outside the allowed length');await this.api.request(this.api.session+'/wda/keys',{value:[value]});return;}
  if(command==='scroll'||command==='drag'){
   let x=Number(f.fromX??f.x??.5),y=Number(f.fromY??f.y??.8),toX=Number(f.toX??x),toY=Number(f.toY??y-Number(f.pixels)/932);
   if(![x,y,toX,toY].every(n=>Number.isFinite(n)&&n>=.04&&n<=.96))throw Error('Native Story drag is outside the reviewed screen');
   await this.api.request(this.api.session+'/wda/dragfromtoforduration',{fromX:x*430,fromY:y*932,toX:toX*430,toY:toY*932,duration:.3});return;
  }
  // Hardware selection shortcuts belong to Mac Mirroring and cannot be reused.
  throw Error('This native Story command needs a reviewed iPhone control: '+command);
 }
 override async home(){await this.beforeInput?.();await this.api.request('/wda/homescreen',{});}
 override async openApp(name:string){const bundle=apps[name];if(!bundle)throw Error('Unmapped native Story app');await this.beforeInput?.();await this.verifySilent();await this.phone.start(bundle);this.bundle=bundle;return this.snapshot();}
}
