import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mirroringHelperPath } from './controller.js';
import { phoneAudioStatus, verifiedPhoneMute } from './audio.js';

export interface MirrorLine { text:string; confidence:number; x:number; y:number; width:number; height:number }
export interface MirrorSnapshot { width:number; height:number; text:string[]; lines:MirrorLine[]; png:string }
export const normalizeMirrorText = (text:string) => text.normalize('NFKC').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g,' ').trim();
export function containsCaption(lines:string[], caption:string) {
    // Vision does not transcribe emoji consistently. Keep every word, punctuation mark
    // and hashtag exact; the entered caption itself still includes its saved emoji.
    const text=(s:string)=>normalizeMirrorText(s.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,''));
    return text(lines.join(' ')).includes(text(caption));
}
export function nativeHomeContext(s:MirrorSnapshot){
    // Clock text and video subtitles can change before the controller reads them.
    // Returning Home uses one stable native control, never a publishing action.
    const labels=['Add a comment','Add comment','Trial insights','Create trial reel','Edit profile','Search','Siri Suggestions','Top Hit','iCloud Drive','TV Cast','Name Contains','New reel','Caption','Dashboard','Content','Trial reels','YouTube Studio','Instagram','Facebook','TikTok','Files'];
    const label=labels.find(value=>s.text.some(line=>normalizeMirrorText(line).toLowerCase().includes(value.toLowerCase())));
    if(!label)throw new Error('No stable native control was found before returning Home');
    return [label];
}
const searchField=(s:MirrorSnapshot)=>s.lines.find(l=>l.confidence>=0.5&&l.y>0.9&&l.y<0.95&&l.x>0.1&&l.x<0.7
    &&['Search','Files','Instagram','Facebook','TikTok','YouTube Studio','YT Studio'].includes(normalizeMirrorText(l.text)));

/** All commands go through the user's permission-owning app. No clipboard, XCTest or other app input. */
export async function mirrorCommand(input:Record<string,unknown>, signal:AbortSignal):Promise<any> {
    signal.throwIfAborted();
    return new Promise((resolve,reject)=>{
        const child=spawn(mirroringHelperPath(),['client-command'],{stdio:['pipe','pipe','pipe'],signal,
            timeout:35_000});
        const chunks:Buffer[]=[];let size=0;
        child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>16_000_000)child.kill();else chunks.push(chunk);});
        child.stderr.resume();
        child.on('error',reject);
        child.on('close',code=>{
            try { const value=JSON.parse(Buffer.concat(chunks).toString());
                if(code!==0||value.error)throw new Error(value.error || 'Mirroring command failed');
                resolve(value);
            } catch(error){reject(error);}
        });
        child.stdin.end(JSON.stringify(input));
    });
}

export class MirrorScreen {
    beforeInput?:()=>Promise<void>;
    constructor(readonly signal:AbortSignal) {}
    async snapshot():Promise<MirrorSnapshot> {
        const s=await mirrorCommand({command:'snapshot'},this.signal);
        if(!Array.isArray(s.lines)||!Array.isArray(s.text)||typeof s.png!=='string')throw new Error('The Mirroring controller needs its current build');
        const text=normalizeMirrorText(s.text.join(' ')).toLowerCase();
        if(['iphone in use','lock your iphone to connect','unlock your iphone','iphone mirroring ended'].some(x=>text.includes(x)))
            throw new Error('Lock the physical iPhone and reconnect Mirroring');
        return s;
    }
    has(s:MirrorSnapshot,text:string) { return normalizeMirrorText(s.text.join(' ')).toLowerCase().includes(normalizeMirrorText(text).toLowerCase()); }
    async waitFor(expected:string[],timeout=20_000):Promise<MirrorSnapshot> {
        const end=Date.now()+timeout;
        do {const s=await this.snapshot();if(expected.every(x=>this.has(s,x)))return s;
            await delay(400,undefined,{signal:this.signal});}while(Date.now()<end);
        throw new Error('Expected native screen did not appear: '+expected.join(', '));
    }
    async waitUntil(check:(s:MirrorSnapshot)=>boolean,reason:string,timeout=20_000):Promise<MirrorSnapshot> {
        const end=Date.now()+timeout;
        do {const s=await this.snapshot();if(check(s))return s;
            await delay(500,undefined,{signal:this.signal});}while(Date.now()<end);
        throw new Error(reason);
    }
    async input(command:string, requiredText:string[],fields:Record<string,unknown>={}) {
        await this.beforeInput?.();
        if(!verifiedPhoneMute(await phoneAudioStatus()))throw new Error('Phone audio mute must pass before any input');
        let r:any;
        try {r=await mirrorCommand({command,requiredText,...fields},this.signal);}
        catch(error) {throw new Error(`Native ${command} failed in context [${requiredText.join(', ')}]: ${error instanceof Error?error.message:String(error)}`);}
        if(r.inputSent!==true)throw new Error('The controller did not confirm input');
    }
    async tap(x:number,y:number,expected:string[]){await this.input('tap',expected,{x,y});}
    async doubleTap(x:number,y:number,expected:string[]){await this.input('double-tap',expected,{x,y});}
    async tapText(text:string,expected:string[],minY=0,maxY=1){await this.input('tap-text',expected,{matchText:text,minY,maxY});}
    async tapTextPrefix(text:string,suffix:string,expected:string[],minY:number,maxY:number,anchorX=0.5){await this.input('tap-text-prefix',expected,{matchText:text,suffix,minY,maxY,anchorX});}
    async key(key:string,expected:string[]){await this.input('key',expected,{key});}
    async type(text:string,expected:string[]) {
        // Bound each app request so its status port remains responsive between text chunks.
        const characters=Array.from(text);
        for(let offset=0;offset<characters.length;offset+=40)
            await this.input('text',expected,{text:characters.slice(offset,offset+40).join('')});
    }
    async scroll(pixels:number,expected:string[],x=0.5,y=0.5){await this.input('scroll',expected,{pixels,x,y});}
    async drag(fromX:number,fromY:number,toX:number,toY:number,expected:string[]){await this.input('drag',expected,{fromX,fromY,toX,toY});}
    async home() { await this.beforeInput?.();const s=await this.waitUntil(v=>{
        try{nativeHomeContext(v);return true;}catch{return false;}
    },'No stable native control was found before returning Home',6_000);
        const r=await mirrorCommand({command:'home',requiredText:nativeHomeContext(s)},this.signal);
        if(r.inputSent!==true)throw new Error('The controller did not confirm Home');
    }
    async openApp(app:string) {
        const appName=app==='YouTube Studio'?'YT Studio':app;
        await this.home();
        const home=await this.waitFor(['Search']);
        await this.key('spotlight',['Search']);
        const suggestions=await this.waitUntil(s=>this.has(s,'Siri Suggestions')||this.has(s,'Top Hit')||!!searchField(s),'Spotlight did not open');
        const suggested=suggestions.lines.find(x=>normalizeMirrorText(x.text)===appName&&x.y>0.2&&x.y<0.3);
        if(this.has(suggestions,'Siri Suggestions')&&suggested) {
            // The app name is below the icon. Mirroring can ignore taps on the label.
            await this.tap(suggested.x+suggested.width/2,suggested.y-0.045,['Siri Suggestions',appName]);
        }else{
            // Clear a retained query, then use the exact native app result.
            // Files is now searchable after the controller's modifier-key fix.
            const oldQuery=searchField(suggestions);
            if(this.has(suggestions,'Top Hit')||oldQuery&&normalizeMirrorText(oldQuery.text)!=='Search'){
                // Expanded search results can hide the clear icon. Focus only
                // the native search field, then replace its retained query.
                const context=this.has(suggestions,'Top Hit')?['Top Hit']:[oldQuery!.text];
                await this.tap(0.35,0.927,context);
                // Focusing removes the initial selection handles and reveals
                // the native clear control. Hardware Delete is not forwarded here.
                await this.tap(0.853,0.927,context);
            }
            const empty=await this.waitUntil(s=>this.has(s,'Siri Suggestions')||normalizeMirrorText(searchField(s)?.text??'')==='Search','The native app search did not clear');
            await this.type(app,this.has(empty,'Siri Suggestions')?['Siri Suggestions']:['Search']);
            const hit=await this.waitFor(['Top Hit',appName]);
            const name=hit.lines.find(x=>normalizeMirrorText(x.text)===appName&&x.y>0.15&&x.y<0.3);
            if(!name)throw new Error('The exact Spotlight app icon was not found');
            await this.tap(name.x+name.width/2,name.y-0.045,['Top Hit',appName]);
        }
        await this.waitUntil(s=>!this.has(s,'Siri Suggestions')&&!this.has(s,'Top Hit'),'The selected app did not open');
        return home;
    }
}
