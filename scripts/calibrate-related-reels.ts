/** Attended, no-Share calibration of topic-matched related Reels. Holds the phone lock, opens one item's composer
 * (as rehearse-release.ts does), then for each catalog Reel: opens the "Select a reel" picker, finds the tile by its
 * cover headline, taps it and saves the Edit-link screen. Every Reel but the last is cancelled; the last runs the
 * real selection with its label and readback. The composer is then left through abandon/resetAfterFailure.
 * Never taps Share. The item and its release are unchanged (the related Reel is set in memory only).
 * Usage: calibrate-related-reels.ts ITEM_ID URL,URL,URL */
import {mkdir,writeFile} from 'node:fs/promises';
import {createDatabaseConnection} from '../src/database/client.js';
import {DirectMediaStore} from '../src/publishing/direct-media.js';
import {NativeMuteGuard} from '../src/publishing/native-mute.js';
import {InstagramRelease} from '../src/publishing/instagram-release.js';
import {reelByUrl,relatedReelInput} from '../src/publishing/instagram-related.js';
import type {PostingInput} from '../src/publishing/model.js';
const [id,urls]=process.argv.slice(2);if(!/^[a-f0-9-]{36}$/.test(id??'')||!urls)throw Error('Usage: calibrate-related-reels.ts ITEM_ID URL,URL,URL');
const reels=urls.split(',').map(u=>{const r=reelByUrl(u);if(!r?.headline)throw Error('Not a catalog Reel with a headline: '+u);return r;});
const root='docs/evidence/instagram-related-topics-2026-10-20';await mkdir(root,{recursive:true});
const log:unknown[]=[];const save=(o:unknown)=>{log.push(o);console.log(JSON.stringify(o).slice(0,300));return writeFile(root+'/calibration.json',JSON.stringify(log,null,1));};
class Calibration extends InstagramRelease{
 n=0;
 protected override async pickerPage(png:Buffer,page:number,tiles:unknown[]){await writeFile(`${root}/reel${this.n}-page${page}.png`,png);await save({reel:this.n,page,tiles});}
 protected override async selectRelatedReel(related:NonNullable<PostingInput['instagramRelatedReel']>){
  for(;this.n<reels.length-1;this.n++){
   const r=reels[this.n]!;
   for(let k=0;k<3&&!(await this.visible('accessibility id','Link a reel'));k++)await this.swipeUp();
   await this.tapElement('accessibility id','Link a reel','Related Reel');
   await this.waitFor('accessibility id','Select a reel','Owned Reel picker');
   const found=await this.findRelatedTile(relatedReelInput(r));
   await this.tapPoint(found.x,found.y);
   await this.waitFor('accessibility id','Edit linked reel','Link title');
   const shot=Buffer.from((await this.request('/screenshot')).value,'base64');await writeFile(`${root}/reel${this.n}-selected.png`,shot);
   await writeFile(`${root}/reel${this.n}-selected.xml`,(await this.request(this.session+'/source')).value);
   await save({reel:this.n,url:r.url,headline:r.headline,tapped:found});
   await this.tapElement('accessibility id','Cancel','Cancel this link');await this.sleep(1500);
   await writeFile(`${root}/reel${this.n}-after-cancel.xml`,(await this.request(this.session+'/source')).value);
   if(!await this.visible('accessibility id','share-sheet-share-button'))throw Error('Cancel did not return to the composer');
  }
  const result=await super.selectRelatedReel(related);
  await writeFile(`${root}/reel${this.n}-composer.xml`,(await this.request(this.session+'/source')).value);
  await save({reel:this.n,url:related.url,label:related.label,result});
  return result;
 }
}
const db=createDatabaseConnection(),c=await db.pool.connect(),base='http://127.0.0.1:8100';
const signal=AbortSignal.timeout(20*60_000);let locked=false,phone='',driver:Calibration|undefined;
try{
 const item=(await c.query('SELECT * FROM scheduler.publishing_items WHERE id=$1',[id])).rows[0];if(!item)throw Error('Item not found');
 const release=(await c.query('SELECT share_claimed_at FROM scheduler.publishing_releases WHERE item_id=$1',[id])).rows[0];
 if(release?.share_claimed_at||item.status==='published')throw Error('This item already has a Share attempt');
 phone=item.input.deviceUdid;
 locked=(await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) l',[phone])).rows[0].l;if(!locked)throw Error('Phone busy');
 const imports=new DirectMediaStore(db.pool);await imports.initialize();
 driver=new Calibration(base,signal,imports);
 await new NativeMuteGuard(base,signal).prepare();
 const input={...item.input,instagramRelatedReel:relatedReelInput(reels.at(-1)!)};
 const evidence=await driver.preflight(input,item.media);
 console.log('CALIBRATION PASSED; stopped before Share.',JSON.stringify(evidence.relatedReel));
}catch(e:any){
 console.log('CALIBRATION STOPPED:',e.message);
 if(driver)console.log('evidence:',await driver.captureFailure('related-calibration').catch(()=>'none'));
}finally{
 try{await driver?.abandon();}catch{}
 try{await driver?.resetAfterFailure();}catch{}
 if(locked)await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[phone]);c.release();await db.close();
}
