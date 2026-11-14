/** Build src/publishing/instagram-reels.json from published Instagram items: permalink from the native receipt, exact
 * caption, and the cover headline OCR reads on the source video's opening frame. Keeps existing entries (they may be
 * hand-edited) unless --rebuild. Database read only; no phone input. Usage: refresh-instagram-reels.ts [--rebuild]
 * A headline that looks like another Reel's is cleared, so neither Reel can be picked by OCR. New Reels start with
 * inPicker false: Trial Reels are not in the native picker until promoted. Set it after a picker scan. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {createDatabaseConnection} from '../src/database/client.js';
import {coverHeadline,headlineSimilarity,topicsIn,reviewedRelatedReel,type CatalogReel} from '../src/publishing/instagram-related.js';
const run=promisify(execFile),file=new URL('../src/publishing/instagram-reels.json',import.meta.url);
const json=JSON.parse(await readFile(file,'utf8')),rebuild=process.argv.includes('--rebuild');
const kept=new Map<string,CatalogReel>(rebuild?[]:json.reels.map((r:CatalogReel)=>[r.url,r]));
const label=(headline:string)=>{let out='';for(const w of headline.toLowerCase().replace(/(^|\s)\S/g,s=>s.toUpperCase()).split(' ')){if((out+' '+w).trim().length>15)break;out=(out+' '+w).trim();}return out;};
const db=createDatabaseConnection();
try{
 const rows=(await db.pool.query(`SELECT input->>'caption' caption,media,results->'release'->'receipts'->'instagram'->>'url' url FROM scheduler.publishing_items
   WHERE status='published' AND input->'targets' @> '[{"platform":"instagram"}]' AND results->'release'->'receipts'->'instagram'->>'verified'='true'
   AND results->'release'->'receipts'->'instagram'->>'url' ~ '^https://www[.]instagram[.]com/reel/[A-Za-z0-9_-]+/$' ORDER BY updated_at DESC`)).rows;
 const reels:CatalogReel[]=[];
 const reviewed=(await db.pool.query(`SELECT input->'instagramRelatedReel' r FROM scheduler.publishing_items WHERE input->'instagramRelatedReel'->>'url'=$1 LIMIT 1`,[reviewedRelatedReel])).rows[0]?.r;
 if(reviewed)reels.push(kept.get(reviewedRelatedReel)??{...reviewed,headline:'',sha256:'',topics:[],inPicker:true});
 for(const r of rows){
  // A video already catalogued under its corrected permalink (Oct 20: two same-caption receipts named one Reel) is skipped.
  if(reels.some(x=>x.url===r.url)||[...kept.values()].some(x=>x.url!==r.url&&x.sha256===r.media.sha256))continue;
  const old=kept.get(r.url);if(old){reels.push(old);continue;}
  let headline='';
  try{const {stdout}=await run('ffmpeg',['-loglevel','error','-i',r.media.path,'-frames:v','1','-f','image2pipe','-vcodec','png','-'],{encoding:'buffer',maxBuffer:64<<20});headline=await coverHeadline(stdout as unknown as Buffer);}
  catch(e){console.log('no frame:',r.media.name,String(e).slice(0,80));}
  reels.push({url:r.url,caption:r.caption,label:label(headline),headline,sha256:r.media.sha256,topics:topicsIn(r.caption+' '+headline,json.vocabulary),inPicker:false});
 }
 // Keep entries added by hand from the Instagram Graph API (older Reels with no database item, sha256 empty).
 for(const r of kept.values())if(!reels.some(x=>x.url===r.url))reels.push(r);
 const clash=reels.filter(a=>a.headline&&reels.some(b=>b!==a&&b.headline&&headlineSimilarity(a.headline,b.headline)>=.8));
 for(const a of clash){console.log('ambiguous headline:',a.url,a.headline);a.headline='';}
 await writeFile(file,JSON.stringify({...json,reels},null,1)+'\n');
 console.log(reels.length,'Reels;',reels.filter(r=>r.headline).length,'with a usable headline');
}finally{await db.close();}
