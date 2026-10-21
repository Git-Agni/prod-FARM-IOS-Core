/** Vision quality score for a Story sequence of 3 to 10 frames (Antonio, Oct 17: "a small vision model to score the quality of the
 * story sequences"). Read-only: sends the native preview frames to a small vision model on OpenRouter and returns
 * per-frame scores plus a pass/fail verdict. The OpenRouter key is read from 1Password inside this process only. */
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {recognizeWords} from '../tiktok/ocr.js';

export const STORY_SCORE_MODELS=['google/gemma-4-26b-a4b-it','qwen/qwen3-vl-30b-a3b-instruct'] as const;
export const STORY_SCORE_PASS=7;
export type FrameScore={frame:number;readability:number;clipping:number;image:number;privacy:'ok'|'flag';fit:number;note:string;textFound?:string};
export type StoryScore={model:string;frames:FrameScore[];hook:number;cta:number;overall:number;pass:boolean;reasons:string[];scoredAt:string};

let key:string|undefined;
export function openRouterKey(){
    key??=execFileSync('/usr/bin/python3',['-c',`
import importlib.util,os
s=importlib.util.spec_from_file_location("s",os.path.expanduser("~/.local/share/c2c-secrets/c2c_secrets.py"));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(m.fields("c2c-monorepo","OPENROUTER_API_KEY")["credential"])`],{encoding:'utf8',timeout:60_000}).trim();
    return key;
}
const RUBRIC=`You review an Instagram Story sequence for @antoniorevenue (AI for business). Each image is a native Instagram
Story editor preview or the frame image itself. The round buttons on the right edge, the X at top left and the bottom bar ("Your stories",
"Close Friends", arrow) are Instagram UI, not content. Score each frame 0-10:
- readability: is the overlay text easy to read (contrast, size, not on a busy background)?
- clipping: 10 if no text is cut off or hidden behind the right-edge buttons or the edges; lower if any word is clipped.
- image: is the photo bright, sharp and attractive, with the person clearly visible?
- privacy: "flag" only if it shows personal data of a lead, customer or rep (email address, phone number, home address, a private person's full name next to their data), else "ok". Revenue dashboards, cash numbers, client results and business or client names are approved for public posting and are "ok".
- fit: does this frame support the story told by the sequence (frame 1 hook, middle frames proof/value, the last frame call to action), and does its text follow from the previous frame as one idea with its reason, not a fragment or a repeat?
Also score hook (frame 1 stops the scroll: a real named thing or the viewer's own thing in its first words, plus a number or a side someone could argue with; 0-10) and cta (the last frame's call to action is clear, fully visible and says exactly what the viewer gets, 0-10).
Reply with JSON only: {"frames":[{"frame":1,"readability":0,"clipping":0,"image":0,"privacy":"ok","fit":0,"note":"short reason"}, one object per frame],"hook":0,"cta":0}`;


const words=(t:string)=>t.toLowerCase().replace(/[^a-z0-9%$ ]+/g,' ').split(/\s+/).filter(Boolean);
function near(a:string,b:string){if(a===b)return true;if(a.length<4||Math.abs(a.length-b.length)>1)return false;
    let i=0,j=0,e=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++e>1)return false;if(a.length>b.length)i++;else if(b.length>a.length)j++;else{i++;j++;}}return e+(a.length-i)+(b.length-j)<=1;}
/** On-device check (Oct 17): the vision model passed a call to action cut off behind Instagram's buttons. Read the text
 * band with Apple Vision OCR (crop, enlarge, keep bright pixels, invert) and count how many planned words are really there. */
export async function textCoverage(frame:Buffer,expected:string){
    const want=words(expected);if(!want.length)return {score:10,found:''};
    const m=await sharp(frame).metadata(),H=m.height!,Wd=m.width!;
    // Several reads, best kept (Oct 17: keeping only bright pixels turned palm leaves into noise and hid a clear CTA).
    const crop=(t:number,h:number)=>sharp(frame).extract({left:0,top:Math.round(H*t),width:Wd,height:Math.round(H*h)}).resize({width:Wd*2}).grayscale();
    const reads=[crop(0.06,0.40).png(),crop(0.06,0.40).threshold(235).negate().png(),crop(0.06,0.80).threshold(235).negate().png(),crop(0.06,0.80).normalise().png()];
    let got:string[]=[],hit=-1;
    for(const r of reads){const g=words((await recognizeWords(await r.toBuffer())).map(w=>w.text).join(' '));const h=want.filter(w=>g.some(x=>near(w,x))).length;if(h>hit){hit=h;got=g;}if(h===want.length)break;}
    return {score:Math.round(10*hit/want.length),found:got.join(' ').slice(0,160)};
}

export function verdict(frames:FrameScore[],hook:number,cta:number){
    const reasons:string[]=[];
    for(const f of frames){
        if(f.readability<STORY_SCORE_PASS)reasons.push(`frame ${f.frame}: text hard to read (${f.readability})`);
        if(f.clipping<STORY_SCORE_PASS)reasons.push(`frame ${f.frame}: text clipped (${f.clipping})`);
        if(f.privacy==='flag')reasons.push(`frame ${f.frame}: private data`);
    }
    if(hook<STORY_SCORE_PASS)reasons.push(`weak hook (${hook})`);
    if(cta<STORY_SCORE_PASS)reasons.push(`weak call to action (${cta})`);
    const all=frames.flatMap(f=>[f.readability,f.clipping,f.image,f.fit]).concat(hook,cta);
    const overall=Math.round(all.reduce((a,b)=>a+b,0)/all.length*10)/10;
    if(overall<STORY_SCORE_PASS)reasons.push(`overall ${overall}`);
    return {overall,pass:reasons.length===0,reasons};
}

export async function scoreStory(frames:Buffer[],title:string,texts:string[]=[],signal=AbortSignal.timeout(180_000)):Promise<StoryScore>{
    const ocr=await Promise.all(frames.map((f,n)=>texts[n]?textCoverage(f,texts[n]!).catch(()=>undefined):Promise.resolve(undefined)));
    const errors:string[]=[];
    if(frames.length<3||frames.length>10)throw new Error('A Story score needs 3 to 10 frames');
    // Send 720 px JPEGs: full-size PNG frames exceeded the provider's 30 MB image limit (Oct 17).
    const small=await Promise.all(frames.map(b=>sharp(b).resize({width:720}).jpeg({quality:82}).toBuffer()));
    const content=[{type:'text',text:RUBRIC+`\nSequence title: ${title}`},...small.map(b=>({type:'image_url',image_url:{url:'data:image/jpeg;base64,'+b.toString('base64')}}))];
    let last='';
    for(const model of STORY_SCORE_MODELS){
        try{
            const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',signal,headers:{authorization:'Bearer '+openRouterKey(),'content-type':'application/json'},
                body:JSON.stringify({model,temperature:0,response_format:{type:'json_object'},messages:[{role:'user',content}]})});
            const j=await r.json() as any;if(!r.ok)throw new Error(j?.error?.message??('HTTP '+r.status));
            const text=String(j.choices?.[0]?.message?.content??'');const p=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1));
            const fr:FrameScore[]=(p.frames??[]).map((f:any,n:number)=>({frame:Number(f.frame??n+1),readability:+f.readability,clipping:+f.clipping,image:+f.image,privacy:f.privacy==='flag'?'flag':'ok',fit:+f.fit,note:String(f.note??'').slice(0,160)}));
            if(fr.length!==frames.length||fr.some(f=>[f.readability,f.clipping,f.image,f.fit].some(x=>!Number.isFinite(x))))throw new Error('Model reply missing scores');
            fr.forEach((f,n)=>{const o=ocr[n];if(o){f.readability=Math.min(f.readability,o.score);f.clipping=Math.min(f.clipping,o.score);f.textFound=o.found;}});
            return {model,frames:fr,hook:+p.hook,cta:Math.min(+p.cta,ocr[frames.length-1]?.score??10),...verdict(fr,+p.hook,Math.min(+p.cta,ocr[frames.length-1]?.score??10)),scoredAt:new Date().toISOString()};
        }catch(e){last=`${model}: ${e instanceof Error?e.message:String(e)}`;errors.push(last);}
    }
    throw new Error('Story score failed: '+errors.join(' | '));
}
