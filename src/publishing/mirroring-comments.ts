import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {MirrorScreen,type MirrorSnapshot} from '../devices/mirroring/screen.js';
import {validateNativePhase,validateNativePhaseReferences,runNativePhase,type NativePhase} from './mirroring-flow.js';
import type {PostingInput} from './model.js';
import type {CommentDriver,CommentPlatform,CommentResult} from './post-comments.js';
export interface NativeCommentFlow {
    version:1;platform:CommentPlatform;openPost:NativePhase;compose:NativePhase;receipt:NativePhase;
    send:{label:'Send'|'Post';context:string[];minY:number;maxY:number};
    pin?:NativePhase;pinUnavailable?:{context:string[]};
}
export function validateNativeCommentFlow(value:unknown):NativeCommentFlow {
    const v=value as NativeCommentFlow;if(!v||v.version!==1||!['instagram','facebook','tiktok'].includes(v.platform))throw new Error('Invalid comment flow');
    for(const p of [v.openPost,v.compose,v.receipt,...(v.pin?[v.pin]:[])])validateNativePhase(p);
    const has=(p:NativePhase,name:string,field:string)=>p.checks.some(c=>c.kind==='field'&&c.name===name&&c.field===field);
    if(!has(v.openPost,'published_caption','caption')||!has(v.openPost,'published_account','account')||!has(v.compose,'comment_draft','firstComment')||!has(v.receipt,'comment_text','firstComment')||!has(v.receipt,'comment_account','account'))throw new Error('Full post, draft, comment and author checks are required');
    if(!v.compose.steps.some(s=>s.kind==='proof'&&s.check.kind==='label'&&s.check.name==='empty_comment'))throw new Error('The native comment field must be empty before typing');
    if(!v.send||!['Send','Post'].includes(v.send.label)||!v.send.context.length||v.send.minY<0||v.send.maxY>1||v.send.minY>=v.send.maxY)throw new Error('Invalid comment submit control');
    if(v.platform==='tiktok'&&(!v.pinUnavailable?.context.length||v.pin))throw new Error('TikTok requires a mapped own-comment menu without Pin');
    if(v.platform!=='tiktok'&&(!v.pin?.checks.some(c=>c.kind==='label'&&c.label==='Unpin comment')))throw new Error('Instagram and Facebook pin receipts must show Unpin comment');
    return structuredClone(v);
}
export async function loadNativeCommentFlow(platform:CommentPlatform){const flow=validateNativeCommentFlow(JSON.parse(await readFile(path.resolve('.scheduler-data/native-layouts',platform+'-comment.json'),'utf8')));if(flow.platform!==platform)throw new Error('Native comment platform mismatch');for(const p of [flow.openPost,flow.compose,flow.receipt,...(flow.pin?[flow.pin]:[])])await validateNativePhaseReferences(p);return flow;}
/** Comment claims are separate from video claims. This driver has no video Share method. */
export class MirroringCommentDriver implements CommentDriver {
    readonly screen:MirrorScreen;
    constructor(signal:AbortSignal,private flow:NativeCommentFlow,private root:string){validateNativeCommentFlow(flow);this.screen=new MirrorScreen(signal);}
    private async proof(name:string,s:MirrorSnapshot){await mkdir(this.root,{recursive:true,mode:0o700});await writeFile(path.join(this.root,name+'.png'),Buffer.from(s.png,'base64'),{mode:0o600});}
    async commentOnPost(input:PostingInput,text:string,claim:()=>Promise<void>):Promise<CommentResult>{
        const target=input.targets.find(t=>t.platform===this.flow.platform);if(!target||text!==input.firstComment)throw new Error('The exact saved comment and platform are required');
        const value={...input,targets:[target]};
        for(const [name,phase] of [['post',this.flow.openPost],['draft',this.flow.compose]] as const)await runNativePhase(this.screen,phase,name,value,undefined,this.proof.bind(this));
        await this.screen.waitFor(this.flow.send.context);
        await claim();await this.screen.tapText(this.flow.send.label,this.flow.send.context,this.flow.send.minY,this.flow.send.maxY);
        await runNativePhase(this.screen,this.flow.receipt,'comment-receipt',value,undefined,this.proof.bind(this));
        if(this.flow.pin){await runNativePhase(this.screen,this.flow.pin,'pin-receipt',value,undefined,this.proof.bind(this));return {status:'comment_posted_pinned',commentVerified:true,pinned:true,evidence:'Exact native comment author and text matched; reopened own-comment menu shows Unpin comment.'};}
        const menu=await this.screen.waitFor(this.flow.pinUnavailable!.context);
        if(menu.lines.some(l=>/^pin(?: comment)?$/i.test(l.text)))throw new Error('TikTok now offers Pin. Review its new controls');
        await this.proof('pin-unavailable-menu',menu);
        return {status:'comment_posted_pin_unavailable',commentVerified:true,pinned:false,evidence:'Exact native comment and author matched; mapped own-comment menu has no Pin control.'};
    }
    async leaveVideo(){await this.screen.home();}
}
