import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {TikTokRelease} from './tiktok-release.js';
import {preparedInputHash} from './prepared-instagram.js';
import {assertRelease,type ReleaseEvidence} from './release-policy.js';
import type {PostingInput} from './model.js';
import type {ReleaseMedia} from './instagram-release.js';

export interface PreparedTikTokProof {
 kind:'tiktok'; itemId:string; itemVersion:number; sourceSha256:string; inputHash:string;
 sessionId:string; checkedAt:string; expiresAt:string; evidence:ReleaseEvidence;
 coverReviewed:boolean; duplicateCheckComplete:boolean; phoneVolumeZero:boolean;
 nativeExport:{galleryLabel:string;coverHook:string;downloadedAt:string};
}
/** This proof permits one scheduler handoff of an attended, reviewed composer. */
export function assertPreparedTikTok(item:any,proof:PreparedTikTokProof,now=Date.now()) {
 if(proof?.kind!=='tiktok'||proof.itemId!==item.id||proof.itemVersion!==item.version
  ||proof.sourceSha256!==item.media.sha256||proof.inputHash!==preparedInputHash(item.input,item.media.sha256)
  ||!proof.sessionId||!proof.coverReviewed||!proof.duplicateCheckComplete||!proof.phoneVolumeZero
  ||!proof.nativeExport?.galleryLabel||!proof.nativeExport.coverHook
  ||!Number.isFinite(Date.parse(proof.nativeExport.downloadedAt))
  ||!Number.isFinite(Date.parse(proof.checkedAt))||!Number.isFinite(Date.parse(proof.expiresAt))
  ||Date.parse(proof.checkedAt)>now||Date.parse(proof.expiresAt)<=now
  ||Date.parse(proof.expiresAt)-Date.parse(proof.checkedAt)>10*60_000
  ||item.status!=='held'||item.input.targets.length!==1||item.input.targets[0].platform!=='tiktok')
   throw Error('Prepared TikTok evidence changed or expired');
 assertRelease(item.input,proof.evidence);
}
export class PreparedTikTokRelease extends TikTokRelease {
 constructor(base:string,signal:AbortSignal,private item:any){super(base,signal);}
 override async preflight(input:PostingInput,mediaValue:unknown):Promise<ReleaseEvidence>{
  const proof=this.item.results.preparedNative as PreparedTikTokProof;
  assertPreparedTikTok(this.item,proof);
  const media=mediaValue as ReleaseMedia;
  if(createHash('sha256').update(await readFile(media.path)).digest('hex')!==proof.sourceSha256)throw Error('Prepared source hash changed');
  if((await this.request('/wda/locked')).value!==false)throw Error('Prepared phone is locked');
  if((await this.request('/status')).sessionId!==proof.sessionId)throw Error('Prepared native session changed');
  this.session='/session/'+proof.sessionId;
  this.expectedBundleId='com.zhiliaoapp.musically';
  if((await this.request(this.session+'/wda/activeAppInfo')).value.bundleId!=='com.zhiliaoapp.musically')throw Error('Prepared TikTok composer is no longer active');
  const field=await this.composerField('Add description...');
  if((await this.request(`${this.session}/element/${field.id}/attribute/value`)).value!==input.caption)throw Error('Prepared TikTok caption changed');
  const screen=await this.screen();
  if(!screen.words.map(w=>w.text).join(' ').includes('Everyone can view this post'))throw Error('Prepared TikTok visibility changed');
  await this.waitFor('accessibility id','Post','Final Post');
  this.input=input;this.prepared=true;return proof.evidence;
 }
}
