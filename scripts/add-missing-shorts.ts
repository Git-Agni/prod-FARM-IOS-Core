/** Give every queued or recent video a YouTube Short (Antonio, Oct 8: "you need to post on youtube shorts").
 * Usage: add-missing-shorts.ts                      list videos without a YouTube item (caption, keyword, hashtags)
 *        add-missing-shorts.ts --titles=FILE.json   dry run with reviewed titles ({"<video key>": "Title"})
 *        add-missing-shorts.ts --titles=FILE.json --apply   create held YouTube items; the backlog arms them.
 * A Short reuses its video's caption (comment keyword + hashtags), links the reviewed long-form video and is held
 * until record-shorts-cover-review.ts records its frame-zero review. Writes no phone input. */
import {readFile} from 'node:fs/promises';
import {createDatabaseConnection} from '../src/database/client.js';
import {PublishingStore} from '../src/publishing/store.js';
import {validatePostingInput,requestHash} from '../src/publishing/model.js';
import {inspectShortsVideo} from '../src/publishing/youtube-shorts.js';
import {chooseLongForm} from '../src/publishing/youtube-longform.js';

const titlesArg=process.argv.find(v=>v.startsWith('--titles='))?.split('=')[1],apply=process.argv.includes('--apply');
const key=(name:string)=>name.replace(/^video-/,'').replace(/\.mp4$/,'');
const db=createDatabaseConnection();
try{
 const items=(await db.pool.query(`SELECT i.*,r.state rstate,r.run_at,r.updated_at rupdated FROM scheduler.publishing_items i
   LEFT JOIN scheduler.publishing_releases r ON r.item_id=i.id WHERE i.status<>'cancelled'`)).rows;
 const groups=new Map<string,any[]>();
 for(const i of items){const k=key(i.media.name);groups.set(k,[...(groups.get(k)??[]),i]);}
 const titles=titlesArg?JSON.parse(await readFile(titlesArg,'utf8')) as Record<string,string>:undefined;
 const store=new PublishingStore(db.pool);let made=0;
 for(const [k,g] of groups){
  if(g.some(i=>i.input.targets.some((t:any)=>t.platform==='youtube')))continue;
  const live=g.filter(i=>i.rstate==='armed'||(i.status==='published'&&Date.now()-new Date(i.updated_at).getTime()<3*86400_000));
  if(!live.length)continue;
  // Prefer the Instagram item's caption and file; TikTok-only videos use the TikTok item.
  const src=g.find(i=>i.input.targets.some((t:any)=>t.platform==='instagram'))??g.find(i=>i.input.targets.some((t:any)=>t.platform==='tiktok'))??g[0];
  const caption:string=src.input.caption;
  const keyword=/Comment\s+["“]?([A-Z0-9]{2,})["”]?/.exec(caption)?.[1];
  const hashtags=[...new Set(caption.split(/\s+/).filter(t=>/^#[A-Za-z0-9_]+$/.test(t)))].slice(0,5);
  const armedAt=g.filter(i=>i.rstate==='armed').map(i=>new Date(i.run_at).getTime()).sort()[0];
  if(!titles){console.log(JSON.stringify({key:k,keyword,hashtags,armedAt:armedAt?new Date(armedAt).toISOString():null,caption:caption.slice(0,240)}));continue;}
  const title=titles[k];if(!title){console.log('skip (no reviewed title):',k);continue;}
  if(!keyword||!hashtags.length){console.log('skip (caption has no keyword or hashtags):',k);continue;}
  const probe=await inspectShortsVideo(src.media.path);
  if(!probe.eligible){console.log('skip (not a valid Short):',k,JSON.stringify(probe));continue;}
  const input=validatePostingInput({
   requestId:`autoshorts-20261008-${k}-yt`.slice(0,120),caption,timezone:'America/Los_Angeles',deviceUdid:src.input.deviceUdid,
   runAt:new Date(armedAt??Date.now()+86400_000).toISOString(),targets:[{platform:'youtube',account:'antoniorevenue'}],
   facebookMode:'direct',instagramTrial:false,automaticPromotion:false,
   youtube:{title,channelId:'UCMZWuXp0lsxE2vmuifYMWuA',visibility:'public',madeForKids:false,publishing:{
    tags:hashtags.map(h=>h.slice(1).toLowerCase()),aiUse:'no',category:'Howto & Style',hashtags,coverMode:'existing_frame',
    commentKeyword:keyword,relatedVideoId:chooseLongForm({caption,youtube:{title,publishing:{tags:hashtags.map(h=>h.slice(1).toLowerCase())}}}).video.id}},
  });
  if(!apply){console.log('would create:',k,'|',title,'|',keyword,'|',hashtags.join(' '));continue;}
  const results={youtubePreparation:{...probe,checkedAt:new Date().toISOString(),status:'media_validated',uploaded:false,published:false,nativeChannelVerified:false},autoShorts:{createdAt:new Date().toISOString(),from:src.id}};
  const {item,replayed}=await store.create(input,requestHash(input,src.media.sha256),src.media,undefined,results);
  console.log(replayed?'exists:':'created:',k,item.id);made++;
 }
 if(titles)console.log(apply?`created ${made}`:'dry run');
}finally{await db.close();}
