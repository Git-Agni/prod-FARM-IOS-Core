import{readFile}from'node:fs/promises';
import{createHash}from'node:crypto';
import sharp from'sharp';
import{PreparedYouTubeRelease}from'./prepared-youtube.js';
import{longFormById,pickerRowMatches}from'./youtube-longform.js';
import{visibleNativeNodes}from'./native-xml.js';
import{NativeMuteGuard}from'./native-mute.js';
import{inspectShortsVideo}from'./youtube-shorts.js';
import{recognizeWords}from'../tiktok/ocr.js';
import type{DirectMediaStore}from'./direct-media.js';
import type{ReleaseMedia}from'./instagram-release.js';
import type{PostingInput}from'./model.js';
import type{ReleaseEvidence}from'./release-policy.js';
export function isFullYouTubeTrim(value:string,durationSeconds:number){
 // Past a minute the end reads "1 minute 5 seconds" (Oct 13). The start must still be the very beginning.
 // YouTube rounds from the video track, not the container: a 44.52 s file read "to 44 seconds" (Oct 13), so allow under one second.
 const prefix='Selected from Less than a second to ';
 return Number.isFinite(durationSeconds)&&durationSeconds>0&&value.startsWith(prefix)&&Math.abs(galleryDurationSeconds(value.slice(prefix.length))-durationSeconds)<1;
}

/** Oct 19: OCR reads the capital I of "AITools" and "AIAgents" as a lowercase l ("AlTools"); six Shorts stopped at the tag
 * check with every chip typed correctly. Compare tags with I, l, 1 and | folded together. */
/** Oct 29: PF album names read from the "Select album" screenshot. OCR mixes up O/o and 0, and l/I/i/| and 1 (seen
 * "PF-01e36aaf7fcO"); album names are hex, so map those back and keep only exact PF-<12 hex> rows. */
export function ocrAlbumRows(words:{text:string,y:number,height:number}[]){
 return words.map(w=>({name:w.text.replace(/^PF[-–—~]/i,'PF-').replace(/^(PF-)(.*)$/,(_,p,h:string)=>p+h.replace(/[oO]/g,'0').replace(/[lIi|]/g,'1').toLowerCase()),y:w.y+w.height/2}))
  .filter(r=>/^PF-[0-9a-f]{12}$/.test(r.name));
}
export const ocrTagKey=(value:string)=>value.toLowerCase().replace(/[il1|]/g,'i');
export function nativeTagsMatch(expected:string[],seen:string[]){const keys=new Set(seen.map(ocrTagKey));return expected.every(tag=>keys.has(ocrTagKey(tag)));}
/** Oct 19 07:25: a title with the word "Tags" ("Walmart's Price Tags Now...") made the Tags row ambiguous. Row labels sit in
 * the left label column (about 51 pt, 153 px); the title starts at 107 pt and mid-line words sit further right. */
/** Oct 19 14:41: the Tags entry sits at the end of the Attributes row, "AI use, Tags" (OCR: "Al" 158, "use," 217,
 * "Tags" 324), so a lone "Tags" in the label column never matched. Match the whole line from its first word, with
 * the same I/l folding as tags and punctuation ignored. */
const rowWordKey=(value:string)=>ocrTagKey(value).replace(/[^\p{L}\p{N}]/gu,'');
export function metadataRowMatches<W extends {text:string,x:number,y:number}>(words:W[],phrase:string){
 const parts=phrase.split(' ').map(rowWordKey);
 return words.filter(w=>rowWordKey(w.text)===parts[0]&&w.y>280&&w.y<2400&&w.x>=100&&w.x<300).filter(w=>{
  const line=words.filter(n=>Math.abs(n.y-w.y)<25&&n.x>=w.x).sort((a,b)=>a.x-b.x);
  return parts.every((p,n)=>line[n]&&rowWordKey(line[n].text)===p);
 });
}
/** Fresh native composer for one reviewed file. Submission still uses the normal one-shot claim. */
/** Gallery cells read "45 seconds" or, past a minute, "1 minute 5 seconds" (Oct 13: a 65 s Short failed the old check). */
export function galleryDurationSeconds(value:string){
 const m=/^(?:(\d+) minutes?,? ?)?(?:(\d+) seconds?)?/.exec(value);
 if(!m||(m[1]===undefined&&m[2]===undefined))return NaN;
 return Number(m[1]??0)*60+Number(m[2]??0);
}
/** Oct 30: opening YouTube's album menu freezes its accessibility tree (9,240 bytes, every depth and timeout), so the
 * gallery after an album pick cannot be read. The default Recents grid stays readable and each Video cell's value names
 * its length and import minute ("50 seconds, created October 30, 2026 at 14:22"). Match both: length within 1 s and the
 * import minute (Pacific) within 1 minute of the direct_media_imports record. Returns every visible matching cell. */
export function recentsVideoMatches(xml:string,durationSeconds:number,importedAt:Date){
 const minute=(d:Date)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));
  return `${p.month} ${Number(p.day)}, ${p.year} ${p.hour}:${p.minute}`;};
 const wanted=new Set([-60_000,0,60_000].map(o=>minute(new Date(importedAt.getTime()+o))));
 const out:{x:number;y:number;width:number;height:number;value:string}[]=[];
 for(const tag of xml.matchAll(/<XCUIElementTypeCell\b[^>]*>/g)){
  const a=Object.fromEntries([...tag[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
  if(a.name!=='Video'||a.visible!=='true'||!a.value)continue;
  const m=/created (\w+ \d+, \d{4}) at (\d{1,2}):(\d{2})(?:\s*([AP]M))?/.exec(a.value);if(!m)continue;
  let h=Number(m[2]);if(m[4]==='PM'&&h<12)h+=12;if(m[4]==='AM'&&h===12)h=0;
  const at=`${m[1]} ${String(h).padStart(2,'0')}:${m[3]}`;
  if(!wanted.has(at)||Math.abs(galleryDurationSeconds(a.value)-durationSeconds)>1)continue;
  out.push({x:Number(a.x),y:Number(a.y),width:Number(a.width),height:Number(a.height),value:a.value});
 }
 return out;
}
export class YouTubeRelease extends PreparedYouTubeRelease {
 constructor(base:string,signal:AbortSignal,private saved:any,private imports:DirectMediaStore){super(base,signal,saved);}
 private foregroundRecoveries=0;
 /** Oct 30: the 20:22 and 08:22 Shorts lost YouTube to the home screen about 6 minutes in, before any Next or Upload, with
  * no crash report. Before Upload nothing is posted, so bring YouTube back (twice at most) and keep going; log which app
  * took the foreground and save the screen so the cause shows next time. After this.ready (Upload stage) it still stops. */
 protected override async assertInputApp(){
  if(!this.ready&&this.foregroundRecoveries<2){
   const active=(await this.request(this.session+'/wda/activeAppInfo')).value;
   if(active?.bundleId!==this.expectedBundleId){
    this.foregroundRecoveries++;
    const evidence=await this.captureFailure('youtube-left-foreground').catch(()=>'');
    console.log(new Date().toISOString(),'YouTube left the foreground before Upload; active app',active?.bundleId,'evidence',evidence,'recovery',this.foregroundRecoveries);
    await this.request(this.session+'/wda/apps/activate',{bundleId:this.expectedBundleId});await this.sleep(3000);
   }
  }
  return super.assertInputApp();
 }
 private async nodes(){return visibleNativeNodes(String((await this.request(this.session+'/source')).value));}
 private async selectAlbum(name:string){
  let last='';
  // One PF album per upload (Oct 8: 60+). Scroll until found or the list stops moving.
  // Oct 25: 377 PF albums, about 5 rows per drag. 40 drags stopped near PF-7f, so every Short whose album sorts later
  // (PF-cd, PF-e0, PF-e4, PF-e8) failed from Oct 22. 250 drags reach about 1,200 albums; a stalled list still stops early.
  const maxPasses=250;
  for(let pass=0;pass<maxPasses;pass++){
   // The list renders after the album-list tap; wait for it once instead of reading too early.
   // Oct 29 14:22-18:22: YouTube's full-page "Select album" list stopped appearing in the accessibility tree (probe:
   // same 9,240-byte tree at 15/60/120 s snapshot timeouts). Fall back to reading the PF names by OCR.
   if(pass===0&&!await this.waitFor('predicate string','name == "id.creation.photolibrary.album.cell" AND visible == 1','Native album list',10_000).then(()=>true,()=>false))return this.selectAlbumByOcr(name);
   else if(!(await this.nodes()).some(n=>n.name==='id.creation.photolibrary.album.cell'))throw Error('Native album list changed');
   const rows=(await this.request(this.session+'/elements',{using:'predicate string',value:'type == "XCUIElementTypeCell" AND label == "'+name+'" AND visible == 1'})).value;
   if(rows.length>1)throw Error('YouTube source album is ambiguous');
   if(rows.length===1){const r=(await this.request(this.session+'/element/'+this.id(rows[0])+'/rect')).value;
    if(r.y>=90&&r.y+r.height<=850){await this.tapPoint(r.x+r.width/2,r.y+r.height/2);return;}
    // Found but near an edge (many PF albums): nudge it toward the middle, then look again. Never tap off-screen.
    if(pass===maxPasses-1)throw Error('YouTube source album is outside the visible list');
    await this.assertInputApp();await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:r.y<90?300:700,toX:215,toY:r.y<90?600:400,duration:.4});await this.sleep(600);continue;}
   const current=(await this.nodes()).filter(n=>n.type==='XCUIElementTypeCell'&&n.name==='id.creation.photolibrary.album.cell').map(n=>n.label).join('|');
   if(!current||current===last||pass===maxPasses-1)throw Error('YouTube source album was not reached; import was not repeated');last=current;
   await this.assertInputApp();await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:780,toX:215,toY:250,duration:.4});await this.sleep(500);
  }
 }
 /** Album rows by OCR when the native list is not exposed. Only taps one exact PF match; completeGallery then checks the
  * selected album through the native gallery title, so a wrong tap stops before any video is chosen. */
 private async selectAlbumByOcr(name:string){
  let last='';
  for(let pass=0;pass<250;pass++){
   const png=Buffer.from((await this.request('/screenshot')).value,'base64'),m=await sharp(png).metadata();
   if(m.width!==1290||m.height!==2796)throw Error('YouTube album screen size changed');
   const rows=ocrAlbumRows(await recognizeWords(png));
   const hit=rows.filter(r=>r.name===name);
   if(hit.length>1)throw Error('YouTube source album is ambiguous (OCR rows at y '+hit.map(r=>Math.round(r.y/3)).join(', ')+')');
   if(hit.length===1){const y=hit[0]!.y/3;
    if(y>=110&&y<=850){await this.tapPoint(215,y);return;}
    await this.assertInputApp();await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:y<110?300:700,toX:215,toY:y<110?600:400,duration:.4});await this.sleep(600);continue;}
   const current=rows.map(r=>r.name).join('|');
   if(current===last)throw Error('YouTube source album was not reached; import was not repeated');last=current;
   // Names sort ascending. Scroll back up only when every visible PF name is past the target.
   const up=rows.length>0&&rows.every(r=>r.name>name),far=rows.length>0&&Math.abs(parseInt(rows[0]!.name.slice(3,5),16)-parseInt(name.slice(3,5),16))>2;
   await this.assertInputApp();
   await this.request(this.session+'/wda/dragfromtoforduration',up?{fromX:215,fromY:250,toX:215,toY:780,duration:.4}:{fromX:215,fromY:780,toX:215,toY:250,duration:far?.15:.4});await this.sleep(far?900:500);
  }
  throw Error('YouTube source album is outside the visible list');
 }
 /** OCR only locates a visible row. Full metadata values are checked through native fields. */
 private async metadataRow(phrase:string){
  let last='';
  for(let pass=0;pass<3;pass++){
   // Oct 17 16:27-18:27: three Shorts stopped here while the composer was still drawing (the failure capture shows the
   // Upload Short button visible). Wait up to 10 s for it instead of checking once.
   await this.waitFor('accessibility id','id.metadata_editor.upload_button','Upload Short button',10_000).catch(()=>{throw Error('YouTube metadata composer is not active');});
   const png=Buffer.from((await this.request('/screenshot')).value,'base64'),m=await sharp(png).metadata();
   if(m.width!==1290||m.height!==2796)throw Error('YouTube metadata screen size changed');
   const words=await recognizeWords(png),found=metadataRowMatches(words,phrase);
   if(found.length>1)throw Error('YouTube metadata row is ambiguous: '+phrase);
   if(found.length===1){const w=found[0]!;await this.tapPoint(250,(w.y+w.height/2)/3);return;}
   const current=words.map(w=>w.text).join('|');if(current===last||pass===2)throw Error('YouTube metadata row is missing: '+phrase);last=current;
   await this.assertInputApp();await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:750,toX:215,toY:300,duration:.4});await this.sleep(500);
  }
 }
 /** iOS 27 (Oct 10 12:12): full-screen OCR no longer reads the small "AI use / No" row. Crop the row from its
  * element rect, enlarge it, and read it alone. No answer other than "No" counts as saved. */
 private async aiUseIsNo(){
  // Nov 6 16:40 PT: after choosing No the row label reads "AI use, No", so an exact "AI use" match found no row and
  // a saved No failed the check. Read the value from the label when it carries one; OCR stays the fallback.
  const rows=(await this.nodes()).filter(n=>n.name==='id.elements.components.metadata_editor.altered_content_picker'&&/^AI use(,|$)/.test(n.label??''));
  if(rows.some(n=>n.label==='AI use, Yes'))return false;
  if(rows.some(n=>n.label==='AI use, No'))return true;
  const row=rows.find(n=>n.label==='AI use');
  if(!row)return false;
  const shot=Buffer.from((await this.request('/screenshot')).value,'base64'),width=(await sharp(shot).metadata()).width!,scale=width/430;
  const crop=await sharp(shot).extract({left:0,top:Math.round(row.y*scale),width,height:Math.round(row.height*scale)}).resize({width:width*2}).png().toBuffer();
  const words=(await recognizeWords(crop)).map(w=>w.text);
  return words.includes('No')&&!words.includes('Yes');
 }
 private async attributes(input:PostingInput){
  // The small grey Attributes heading is not reliably recognized. Its unique
  // Tags subtitle is visible on the same reviewed row.
  if(!await this.visible('accessibility id','Attributes'))await this.metadataRow('AI use, Tags');await this.waitFor('accessibility id','Attributes','Native Attributes');
  let words:Awaited<ReturnType<typeof recognizeWords>>;
  if(!await this.aiUseIsNo()){
   await this.tapElement('predicate string','name == "id.elements.components.metadata_editor.altered_content_picker" AND label BEGINSWITH "AI use" AND visible == 1','AI use');
   await this.tapElement('accessibility id','No','AI use No');
   await this.tapElement('accessibility id','id.elements.components.metadata_editor.app_bar.back_button','Back to Attributes');
   // Oct 8 11:30: the first frame after Back came before the screen settled; the saved frame reads No. Re-read it.
   let saved=false;
   for(let read=0;read<4&&!saved;read++){if(read)await this.sleep(700);saved=await this.aiUseIsNo();}
   if(!saved)throw Error('YouTube AI use did not save; no Upload');
  }
  await this.tapElement('accessibility id','Add tags','Native tags');
  for(const tag of input.youtube!.publishing!.tags){await this.assertInputApp();await this.request(this.session+'/wda/keys',{value:[tag+'\n']});}
  // Oct 11 12:56 (iOS 27): full-screen OCR missed two of five visible tag chips. Also read the chip area enlarged.
  const shot=Buffer.from((await this.request('/screenshot')).value,'base64');
  words=await recognizeWords(shot);
  const {width=1290}=await sharp(shot).metadata(),scale=width/430;
  // Each read misses different chips (verified on the 12:56 frame); a tag counts when any read finds it.
  const area=()=>sharp(shot).extract({left:0,top:Math.round(130*scale),width,height:Math.round(420*scale)});
  // Oct 29 09:33: every read above missed the middle "aitools" chip; a threshold read and a 3x negative read find it.
  const reads=await Promise.all([area().resize({width:width*2}),area().negate({alpha:false}).grayscale().resize({width:width*2}),area().negate({alpha:false}).grayscale(),
   area().grayscale().threshold(90).negate({alpha:false}),area().negate({alpha:false}).grayscale().resize({width:width*3})]
   .map(async img=>recognizeWords(await img.png().toBuffer())));
  if(!nativeTagsMatch(input.youtube!.publishing!.tags,[...words.filter(w=>w.y<1700),...reads.flat()].map(w=>w.text)))throw Error('Native YouTube tags did not match');
  await this.tapElement('accessibility id','id.elements.components.metadata_editor.app_bar.back_button','Back to details');
  await this.metadataRow('Community');await this.waitFor('accessibility id','Community','Native Community');
  if(!(await this.nodes()).some(n=>n.name==='id.elements.components.metadata_editor.comment_picker'&&n.label==='Comments. On'))throw Error('YouTube comments are not On');
  await this.tapElement('accessibility id','id.elements.components.metadata_editor.app_bar.back_button','Back to details');
 }
 private async related(){
  const video=longFormById(this.input?.youtube?.publishing?.relatedVideoId);if(!video)throw Error('Related long-form video is not in the owned catalog; no Upload');
  await this.metadataRow('Related video');await this.waitFor('accessibility id','Select video','Owned video picker');let last='';
  // Newest videos list first; every new Short pushes the long-form further down (Oct 7 22:29 ran out at 5 scrolls).
  // Oct 19: topic-matched links can be the oldest long-form, so allow 60 scrolls; the loop stops when the list ends.
  for(let n=0;n<60;n++){
   const nodes=await this.nodes(),matching=nodes.filter(n=>pickerRowMatches(n.label,video));
   const rows=[...new Map(matching.map(n=>[[n.x,n.y,n.width,n.height,n.label].join('|'),n])).values()];
   if(rows.length){if(rows.length!==1)throw Error('Related long-form video is ambiguous');const r=rows[0]!;await this.tapPoint(r.x+r.width/2,r.y+r.height/2);return;}
   const current=nodes.filter(n=>n.name==='eml.cvr').map(n=>n.label).join('|');
   if(!current||current===last||n===59)throw Error('Related long-form video was not reached; no Upload');last=current;
   await this.assertInputApp();await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:780,toX:215,toY:200,duration:.5});await this.sleep(500);
  }
 }
 override async preflight(input:PostingInput,mediaValue:unknown):Promise<ReleaseEvidence>{
  this.ready=false;this.input=input;const media=mediaValue as ReleaseMedia,review=this.saved.results?.directYouTubeReview;
  if(!review?.coverReviewed||review.sourceSha256!==media.sha256||!input.youtube?.publishing||!longFormById(input.youtube.publishing.relatedVideoId)||review.relatedVideoId!==input.youtube.publishing.relatedVideoId||input.youtube.visibility!=='public'||input.youtube.madeForKids||input.youtube.publishing.aiUse!=='no')throw Error('This YouTube source needs its own reviewed cover and long-form link');
  if(createHash('sha256').update(await readFile(media.path)).digest('hex')!==media.sha256)throw Error('Reviewed YouTube file changed');
  const probe=await inspectShortsVideo(media.path);await new NativeMuteGuard(this.base,this.signal).prepare();await this.start('com.google.ios.youtube');
  // Oct 11 02:52: YouTube now closes after each job (no picture-in-picture), so a cold launch can stay black past 20 s.
  // Wait for its tab bar or an open composer, read-only, before any tap.
  for(const end=Date.now()+45_000;Date.now()<end&&!await this.visible('accessibility id','id.ui.pivotbar.FElibrary.button')&&!await this.visible('accessibility id','id.metadata_editor.upload_button')&&!await this.visible('accessibility id','id.creation.editor.button.next');)await this.sleep(1500);
  // Oct 29 07:22: the 07:22 Short failed on a black cold launch that never drew its tab bar in 45 s. Nothing rendered, so
  // close YouTube once and wait again (exitApp closes it after every job anyway; its sign-in and drafts are kept).
  if(!await this.visible('accessibility id','id.ui.pivotbar.FElibrary.button')&&!await this.visible('accessibility id','id.metadata_editor.upload_button')&&!await this.visible('accessibility id','id.creation.editor.button.next')&&!(await this.nodes()).some(n=>n.name?.startsWith('id.'))){
   await this.request(this.session+'/wda/apps/terminate',{bundleId:'com.google.ios.youtube'}).catch(()=>undefined);await this.sleep(2000);await this.start('com.google.ios.youtube');
   for(const end=Date.now()+45_000;Date.now()<end&&!await this.visible('accessibility id','id.ui.pivotbar.FElibrary.button')&&!await this.visible('accessibility id','id.metadata_editor.upload_button')&&!await this.visible('accessibility id','id.creation.editor.button.next');)await this.sleep(1500);
  }
  if(await this.visible('accessibility id','id.metadata_editor.upload_button')||await this.visible('accessibility id','id.creation.editor.button.next')||await this.visible('accessibility id','id.creation.photolibrary.picker.button.show_album_list')||(await this.nodes()).some(n=>n.name==='id.creation.photolibrary.album.cell'))throw Error('An existing YouTube composer needs review; it was not overwritten');
  await this.tapElement('accessibility id','id.ui.pivotbar.FElibrary.button','You');
  if(await this.visible('accessibility id','View channel'))await this.tapElement('accessibility id','View channel','Owned channel');
  await this.waitFor('accessibility id','@'+input.targets[0]!.account.replace(/^@/,''),'Reviewed YouTube channel');
  if(!(await this.nodes()).some(n=>n.name==='@'+input.targets[0]!.account.replace(/^@/,'')))throw Error('YouTube account is not the reviewed channel');
  // Oct 30: 08:22 and 11:22 Shorts for Oct 31 were imported Oct 25, far below Recents' first screens. Re-import if older than 6 h.
  await this.imports.forgetIfOlder(input.deviceUdid,media.sha256,6*3600_000);
  const imported=await this.imports.ensure(input.deviceUdid,media,this.base,this.signal);
  await this.tapElement('accessibility id','id.ui.pivotbar.FEuploads.button','Create');
  // A saved draft triggers "Continue your draft video?". Start over keeps that draft and opens a new Short.
  for(let n=0;n<4;n++){
   if(await this.visible('accessibility id','id.creation.camera.button.segment_import'))break;
   if(await this.visible('predicate string','label == "Continue your draft video?" AND visible == 1')){await this.tapElement('predicate string','label == "Start over" AND visible == 1','Start over (draft is kept)');break;}
   await this.sleep(1000);
  }
  await this.tapElement('accessibility id','id.creation.camera.button.segment_import','Choose saved video');
  return this.selectFromRecents(input,media,(imported as {createdAt?:Date}).createdAt,probe.durationSeconds);
 }
 /** Oct 30: pick the reviewed video in the Recents grid (see recentsVideoMatches); never opens the album menu. */
 private async selectFromRecents(input:PostingInput,media:ReleaseMedia,importedAt:Date|undefined,durationSeconds:number):Promise<ReleaseEvidence>{
  if(!importedAt)throw Error('Import time is missing; Recents selection needs it');
  await this.waitFor('predicate string','name == "id.creation.gallery.title.create" AND label == "Recents"','Recents gallery',15_000);
  let last='';
  for(let n=0;n<40;n++){
   const xml=String((await this.request(this.session+'/source')).value),hits=recentsVideoMatches(xml,durationSeconds,importedAt);
   if(hits.length>1)throw Error('Recents has more than one matching video; no selection');
   const hit=hits[0];
   if(hit&&hit.y>=110&&hit.y+hit.height<=850){await this.tapPoint(hit.x+hit.width/2,hit.y+hit.height/2);await this.sleep(1500);return this.completeSelectedVideo(input,media,'Recents');}
   // Attribute order varies (YouTube writes value before name), so read each Cell tag whole. Count photo cells too:
   // Oct 30 17:22, a screen of Story photos between videos read as an empty grid and stopped the search early.
   const seen=[...xml.matchAll(/<XCUIElementTypeCell\b[^>]*>/g)].map(m=>m[0]).filter(t=>/ name="(Video|Photo ?)"/.test(t)).map(t=>/ value="([^"]*)"/.exec(t)?.[1]??'').join('|');
   if(!seen&&n<5){await this.sleep(1500);continue;} // the grid can still be drawing
   if(!hit&&(seen===last||!seen))throw Error('Reviewed video was not found in Recents; no selection');last=seen;
   await this.assertInputApp();
   await this.request(this.session+'/wda/dragfromtoforduration',hit?{fromX:215,fromY:hit.y<110?300:700,toX:215,toY:hit.y<110?600:400,duration:.4}:{fromX:215,fromY:780,toX:215,toY:250,duration:.4});await this.sleep(700);
  }
  throw Error('Reviewed video was not reached in Recents; no selection');
 }
 /** Resume only an attended, source-bound gallery checkpoint, never an uncertain upload. */
 protected async completeGallery(input:PostingInput,media:ReleaseMedia,albumName:string,durationSeconds:number):Promise<ReleaseEvidence>{
  this.ready=false;this.input=input;
  if(createHash('sha256').update(await readFile(media.path)).digest('hex')!==media.sha256)throw Error('Source changed before gallery selection');
  // The picker renders after the album-list tap (seen Oct 7 at 12:54). Wait for one of its known states first.
  let current=await this.nodes();
  for(let n=0;n<10&&!current.some(x=>x.name==='id.creation.gallery.title.create'||x.name==='id.creation.photolibrary.album.cell'||x.label==='All Albums');n++){await this.sleep(1000);current=await this.nodes();}
  const sourceGallery=current.some(n=>n.name==='id.creation.gallery.title.create'&&n.label===albumName);
  if(!sourceGallery){
   if(await this.visible('accessibility id','All Albums'))await this.tapElement('accessibility id','All Albums','All Albums');
   else if(!current.some(n=>n.name==='id.creation.photolibrary.album.cell'))throw Error('Source-bound album picker is not active');
   await this.selectAlbum(albumName);
  }
  await this.waitFor('predicate string','name == "id.creation.gallery.title.create" AND label == "'+albumName+'" AND visible == 1','Selected source album');
  if(await this.read('accessibility id','id.creation.gallery.title.create','label','Selected album')!==albumName)throw Error('YouTube selected a different album');
  const videos=(await this.request(this.session+'/elements',{using:'predicate string',value:'type == "XCUIElementTypeCell" AND name == "Video" AND visible == 1'})).value;
  if(videos.length!==1)throw Error('YouTube album must contain exactly one visible video');
  const gallery=String((await this.request(this.session+'/element/'+this.id(videos[0])+'/attribute/value')).value),seconds=galleryDurationSeconds(gallery);
  if(!Number.isFinite(seconds)||Math.abs(seconds-durationSeconds)>1)throw Error('YouTube gallery duration does not match the reviewed source');
  await this.tapElement('predicate string','type == "XCUIElementTypeCell" AND name == "Video" AND visible == 1','Reviewed video');
  return this.completeSelectedVideo(input,media);
 }
 protected async completeSelectedVideo(input:PostingInput,media:ReleaseMedia,gallery='PF-'+media.sha256.slice(0,12)):Promise<ReleaseEvidence>{
  this.ready=false;this.input=input;
  if(await this.read('accessibility id','id.creation.gallery.title.create','label','Source album')!==gallery)throw Error('Selected YouTube source album changed');
  if(!await this.visible('accessibility id','id.creation.thumbnail_belt.cell'))throw Error('No source-bound selection');
  if(((await this.request(this.session+'/elements',{using:'accessibility id',value:'id.creation.thumbnail_belt.cell'})).value??[]).length!==1)throw Error('More than one video is selected; no Next');
  await this.tapElement('accessibility id','id.creation.gallery.next.button','Gallery Next');
  return this.completeTrimmedVideo(input,media);
 }
 /** Continue a known source selection without changing the full-length trim. */
 protected async completeTrimmedVideo(input:PostingInput,media:ReleaseMedia):Promise<ReleaseEvidence>{
  this.ready=false;this.input=input;
  const probe=await inspectShortsVideo(media.path);
  if(!isFullYouTubeTrim(await this.read('accessibility id','Trim filmstrip','value','Full source trim'),probe.durationSeconds))throw Error('YouTube trim differs from the reviewed full source');
  await this.tapElement('accessibility id','id.creation.segment_import.done.button','Keep full source trim');
  await this.tapElement('accessibility id','id.creation.editor.button.next','Editor Next',30000);await this.waitFor('accessibility id','id.metadata_editor.upload_button','New Short details',60000);
  const titles=(await this.request(this.session+'/elements',{using:'class name',value:'XCUIElementTypeTextView'})).value;if(titles.length!==1)throw Error('YouTube title field is ambiguous');
  await this.assertInputApp();await this.request(this.session+'/element/'+this.id(titles[0])+'/value',{value:[input.youtube!.title]});
  if(await this.read('class name','XCUIElementTypeTextView','value','Saved Short title')!==input.youtube!.title)throw Error('YouTube title differs');
  await this.tapElement('accessibility id','id.elements.components.metadata_editor.open_shorts_thumbnail_editor','Opening thumbnail');
  return this.completeOpeningCover(input,media);
 }
 protected async completeOpeningCover(input:PostingInput,media:ReleaseMedia):Promise<ReleaseEvidence>{
  this.ready=false;this.input=input;
  if(createHash('sha256').update(await readFile(media.path)).digest('hex')!==media.sha256)throw Error('Reviewed cover source changed');
  const frame=await this.rect('accessibility id','Thumbnail frame selector','Thumbnail frame');
  if(frame.x<0||frame.x+frame.width>431||frame.y<800||frame.y+frame.height>910)throw Error('YouTube thumbnail selector moved');
  // The accessibility value setter rounds to one second. The left edge selects
  // the actual opening frame and its native value must confirm it.
  await this.tapPoint(frame.x+2,frame.y+frame.height/2);
  if(await this.read('accessibility id','Thumbnail frame selector','value','Opening frame')!=='Less than a second')throw Error('YouTube opening cover was not selected');
  await this.tapElement('accessibility id','id.metadata.thumbnail_editor.done.button','Save opening thumbnail');
  return this.completeMetadataDetails(input);
 }
 protected async completeMetadataDetails(input:PostingInput):Promise<ReleaseEvidence>{
  this.ready=false;this.input=input;
  // The details screen settles after the thumbnail Done tap; wait for the row instead of reading once.
  await this.waitFor('predicate string','label == "Visibility, Public" AND visible == 1','Public visibility',10_000).catch(()=>{throw Error('YouTube public visibility needs native review');});
  let nodes=await this.nodes();if(!nodes.some(n=>n.label==='Visibility, Public'))throw Error('YouTube public visibility needs native review');
  if(!nodes.some(n=>n.label==="Audience, No, it's not made for kids")){
   if(!nodes.some(n=>n.name==='id.elements.components.metadata_editor.audience_picker'&&n.label==='Select audience'))throw Error('YouTube audience changed');
   await this.tapElement('predicate string','name == "id.elements.components.metadata_editor.audience_picker" AND label == "Select audience" AND visible == 1','Audience');
   const noKids='name == "id.elements.components.metadata_editor.audience_settings.mfk.2" AND label == "No, it\'s not made for kids" AND visible == 1';
   // YouTube nests two elements with this name: the outer one holds value 1 when selected, the inner one holds the label.
   const selected='name == "id.elements.components.metadata_editor.audience_settings.mfk.2" AND value == "1"';
   if(!await this.visible('predicate string',selected))await this.tapElement('predicate string',noKids,'Not made for kids');
   let saved=false;for(let n=0;n<6&&!saved;n++){saved=!!await this.visible('predicate string',selected);if(!saved)await this.sleep(500);}
   if(!saved)throw Error('YouTube audience did not save');
   await this.tapElement('accessibility id','id.elements.components.metadata_editor.app_bar.back_button','Back to details');
  }
  await this.tapElement('accessibility id','id.elements.components.metadata_editor.expander.collapsed_button','More details');await this.metadataRow('Description');
  return this.completeDescription(input);
 }
 protected async completeDescription(input:PostingInput):Promise<ReleaseEvidence>{
  this.ready=false;this.input=input;
  // iOS 27 (Oct 10 11:56): the open editor was missed by the OCR band alone. The heading is also an element named
  // "Add description" with the mentions editor below it; accept either, rechecking for a few seconds while it draws.
  let active=false;
  for(let n=0;n<6&&!active;n++){
   if(n)await this.sleep(800);
   active=!!await this.visible('predicate string','name == "Add description" AND visible == 1')
    &&!!await this.visible('accessibility id','id.elements.components.metadata_editor.mentions_description_editor');
   if(!active){const header=await recognizeWords(Buffer.from((await this.request('/screenshot')).value,'base64'));
    active=header.filter(w=>w.y>120&&w.y<340).sort((a,b)=>a.x-b.x).map(w=>w.text.toLowerCase()).join(' ').includes('add description');}
  }
  if(!active)throw Error('Native description editor is not active');
  const fields=(await this.request(this.session+'/elements',{using:'class name',value:'XCUIElementTypeTextView'})).value,candidates=[];
  // YouTube keeps an offscreen title field in the hierarchy. The actual
  // description field can itself report visible=false while the keyboard is open.
  for(const f of fields){const id=this.id(f),r=(await this.request(this.session+'/element/'+id+'/rect')).value;if(r.x>=12&&r.x<=20&&r.y>=100&&r.y<=150&&r.width>=390&&r.width<=410)candidates.push(id);}
  if(candidates.length!==1)throw Error('YouTube description is ambiguous');const field=candidates[0]!;
  const existing=String((await this.request(this.session+'/element/'+field+'/attribute/value')).value??'');
  if(existing&&existing!==input.caption)throw Error('An edited description was left unchanged');
  if(existing!==input.caption){await this.assertInputApp();await this.request(this.session+'/element/'+field+'/value',{value:[input.caption]});}
  if(String((await this.request(this.session+'/element/'+field+'/attribute/value')).value??'')!==input.caption)throw Error('YouTube description differs');
  // Hashtag suggestions incorrectly mark the visible header as hidden. The
  // screenshot checks the editor, and duplicate hierarchy nodes must share one rect.
  const backRows=(await this.request(this.session+'/elements',{using:'accessibility id',value:'id.elements.components.metadata_editor.app_bar.back_button'})).value,backRects=[];
  for(const b of backRows)backRects.push((await this.request(this.session+'/element/'+this.id(b)+'/rect')).value);
  const distinct=[...new Map(backRects.map(r=>[JSON.stringify(r),r])).values()];
  if(distinct.length!==1)throw Error('Description Back is ambiguous');const back=distinct[0]!;
  if(back.x< -5||back.x>5||back.y<50||back.y>65||back.width!==48||back.height!==48)throw Error('Description Back moved');
  // Hashtag suggestions mark the whole screen hidden, so decide by existence, not visibility (Oct 7 13:24):
  // the Upload button exists only on the details screen. If it is absent, the Back only closed the
  // suggestions, so tap the same verified Back position again. Never touches Upload.
  const uploadExists=async()=>((await this.request(this.session+'/elements',{using:'accessibility id',value:'id.metadata_editor.upload_button'})).value??[]).length>0;
  // Oct 19 20:22 and 21:22: two fixed-wait Back taps with the keyboard up left the editor open. Wait for the
  // details screen after each tap, and tap again only while the editor's own Back is still there (max 3 taps).
  const editorBack=async()=>((await this.request(this.session+'/elements',{using:'accessibility id',value:'id.elements.components.metadata_editor.app_bar.back_button'})).value??[]).length>0;
  await this.sleep(800);
  for(let tap=0;tap<3&&!await uploadExists();tap++){
   if(!await editorBack())break;
   await this.assertInputApp();await this.tapPoint(back.x+back.width/2,back.y+back.height/2);
   for(let wait=0;wait<10&&!await uploadExists();wait++)await this.sleep(400);
  }
  if(!await uploadExists())throw Error('Phone control is missing: Leave description');
  // Hashtag suggestions can stay open over the details screen. While open, iOS reports the whole screen hidden
  // (Upload, Related video, title). Tap the title bar by position, which is not a control, to close the list.
  for(let n=0;n<4&&!await this.visible('accessibility id','id.metadata_editor.upload_button');n++){
   if(await this.visible('accessibility id','id.elements.hashtag_suggestion')){await this.assertInputApp();await this.tapPoint(215,75);}
   await this.sleep(900);
  }
  await this.waitFor('accessibility id','id.metadata_editor.upload_button','Return to source details',5_000);
  await this.related();
  return this.completeAttributes(input);
 }
 protected async completeAttributes(input:PostingInput):Promise<ReleaseEvidence>{
  this.ready=false;this.input=input;await this.attributes(input);
  for(let n=0;n<3&&(!await this.visible('class name','XCUIElementTypeTextView')||!(await this.nodes()).some(n=>n.name==='id.elements.components.identity_chip_component'));n++){
   if(n===2)throw Error('YouTube source details did not return to the top');
   await this.assertInputApp();await this.request(this.session+'/wda/dragfromtoforduration',{fromX:215,fromY:250,toX:215,toY:780,duration:.4});await this.sleep(500);
  }
  if(!(await this.nodes()).some(n=>n.name==='id.elements.components.identity_chip_component'&&n.label.includes('@'+input.targets[0]!.account.replace(/^@/,''))))throw Error('YouTube upload account changed');
  await this.waitFor('accessibility id','id.metadata_editor.upload_button','Upload button on screen',10_000);
  this.ready=true;return{exactMedia:true,videoFrameCover:true,caption:true,account:true,automaticPromotion:false,linkedFacebook:false,youtubeRelatedVideo:{id:input.youtube!.publishing!.relatedVideoId!,format:'long_form',verified:true}};
 }
}
