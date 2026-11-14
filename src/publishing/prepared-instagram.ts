import {hasPreparedTrialEvidence} from './native-xml.js';
import {assertInstagramWritesAllowed} from './instagram-write-hold.js';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {InstagramRelease,type ReleaseMedia} from './instagram-release.js';
import {requestHash,validatePostingInput,type PostingInput} from './model.js';
import {assertRelease,type ReleaseEvidence} from './release-policy.js';
import {exactOwnReelCaption,visibleNativeNodes} from './native-xml.js';

export interface PreparedInstagramProof {
 kind:'instagram'; itemId:string; itemVersion:number; sourceSha256:string; inputHash:string;
 sessionId:string; checkedAt:string; expiresAt:string; evidence:ReleaseEvidence;
 coverReviewed:boolean; duplicateCheckComplete:boolean; phoneVolumeZero:boolean;
}
export const preparedInputHash=(input:PostingInput,hash:string)=>requestHash(validatePostingInput(input),hash);

/** An attended composer may hand off one fresh, exact item to the normal scheduler. */
export function assertPreparedInstagram(item:any,proof:PreparedInstagramProof,now=Date.now()) {
 if(proof?.kind!=='instagram'||proof.itemId!==item.id||proof.itemVersion!==item.version
    ||proof.sourceSha256!==item.media.sha256||proof.inputHash!==preparedInputHash(item.input,item.media.sha256)
    ||!proof.sessionId||!proof.coverReviewed||!proof.duplicateCheckComplete||!proof.phoneVolumeZero
    ||!Number.isFinite(Date.parse(proof.checkedAt))||!Number.isFinite(Date.parse(proof.expiresAt))
    ||Date.parse(proof.checkedAt)>now||Date.parse(proof.expiresAt)<=now
    ||Date.parse(proof.expiresAt)-Date.parse(proof.checkedAt)>10*60_000
    ||item.status!=='held')throw Error('Prepared Instagram evidence changed or expired');
 assertRelease(item.input,proof.evidence);
}
export class PreparedInstagramRelease extends InstagramRelease {
 private readyToShare=false;
 constructor(base:string,signal:AbortSignal,private item:any){super(base,signal);}
 override async preflight(input:PostingInput,mediaValue:unknown):Promise<ReleaseEvidence>{
  if(this.base.startsWith('http://127.0.0.1:'))await assertInstagramWritesAllowed();
  const proof=this.item.results.preparedNative as PreparedInstagramProof;
  assertPreparedInstagram(this.item,proof);
  const media=mediaValue as ReleaseMedia;
  if(createHash('sha256').update(await readFile(media.path)).digest('hex')!==proof.sourceSha256)throw Error('Prepared source hash changed');
  if((await this.request('/wda/locked')).value!==false)throw Error('Prepared phone is locked');
  if((await this.request('/status')).sessionId!==proof.sessionId)throw Error('Prepared native session changed');
  this.session='/session/'+proof.sessionId;
  this.expectedBundleId='com.burbn.instagram';
  if((await this.request(this.session+'/wda/activeAppInfo')).value.bundleId!=='com.burbn.instagram')throw Error('Prepared Instagram composer is no longer active');
  const nodes=visibleNativeNodes((await this.request(this.session+'/source')).value);
  // Source snapshots can truncate long labels. Read the full field directly.
  // The composer scrolls its caption out of view when Trial is visible. Read
  // that unique live field without touching it or scrolling away from Trial.
  const fields=(await this.request(this.session+'/elements',{using:'accessibility id',value:'caption-cell-text-view'})).value;
  if(fields.length!==1)throw Error('Prepared caption field is missing or ambiguous');
  const caption=String((await this.request(this.session+'/element/'+this.id(fields[0])+'/attribute/value')).value??'');
  if(caption!==input.caption
     ||!hasPreparedTrialEvidence(nodes)
     ||!nodes.some(n=>n.name==='share-sheet-share-button'&&n.label==='Share'))throw Error('Prepared Instagram composer changed');
  this.input=input;this.readyToShare=true;return proof.evidence;
 }
 override async shareOnce(){
  if(this.base.startsWith('http://127.0.0.1:'))await assertInstagramWritesAllowed();
  if(!this.readyToShare)throw Error('A fresh prepared preflight is required');
  this.readyToShare=false;
  const r=await this.rect('accessibility id','share-sheet-share-button','Final Share');
  if(r.x<200||r.y<800||r.y+r.height>910)throw Error('Final Share moved outside the reviewed bounds');
  await this.tapPoint(r.x+r.width/2,r.y+r.height/2);
 }
}
