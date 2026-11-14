/** Missed-slot alert (Antonio, Oct 15). Deterministic: no AI, no phone input, no posting. Every 30 minutes under launchd.
 * For each platform slot (src/publishing/cadence.ts) that passed 40 minutes to 6 hours ago, checks that a published post
 * is booked at that slot: Instagram (with linked Facebook), TikTok and YouTube (22 minutes after the slot). A miss sends one Slack DM with the reason; each slot alerts once
 * (.scheduler-data/slot-alerts.json). Usage: slot-alert.ts [--dry-run] */
import {readFile,writeFile} from 'node:fs/promises';
import {Message,Blocks,Md} from 'slack-block-builder';
import {createDatabaseConnection} from '../src/database/client.js';
import {publishingCadence as cadence,slotsFrom} from '../src/publishing/cadence.js';
import {laneHours} from '../src/publishing/lanes.js';
import {sendAlert} from './lib/ops-notify.js';

const dryRun=process.argv.includes('--dry-run'),statePath='.scheduler-data/slot-alerts.json',minute=60000;
const pt=(ms:number)=>new Date(ms).toLocaleString('en-US',{timeZone:cadence.timezone,weekday:'short',hour:'numeric',minute:'2-digit'});
const db=createDatabaseConnection();
try{
 const now=Date.now(),lanes=laneHours();
 const sent:string[]=JSON.parse(await readFile(statePath,'utf8').catch(()=>'[]'));
 const misses:string[]=[];let checked=0;
 for(const [p,hours] of Object.entries(lanes)){
  const off=p==='youtube'?cadence.youtubeOffsetMinutes*minute:0;
  for(const slot of slotsFrom(now-6*60*minute,hours,1).map(s=>s+off).filter(s=>s<=now-40*minute)){
   const key=p+':'+slot;checked++;
   if(sent.includes(key))continue;sent.push(key);
   const rows=(await db.pool.query(`SELECT i.media->>'name' n,r.state,r.result->>'error' e FROM scheduler.publishing_releases r JOIN scheduler.publishing_items i ON i.id=r.item_id
     WHERE r.run_at BETWEEN $1 AND $2 AND r.state<>'cancelled' AND i.input->'targets' @> $3::jsonb`,[new Date(slot-5*minute),new Date(slot+5*minute),JSON.stringify([{platform:p}])])).rows;
   if(rows.some(r=>r.state==='published'))continue;
   misses.push(`*${p} ${pt(slot)}*: `+(rows.length?`${rows[0].n} is *${rows[0].state}*${rows[0].e?` (${String(rows[0].e).slice(0,140)})`:''}`:'no video was booked for this slot'));
  }
 }
 if(misses.length){
  const text=`Phone Farm missed ${misses.length} posting slot(s)`;
  const msg=Message({text}).blocks(Blocks.Section({text:`:warning: ${Md.bold(text)}`}),...misses.map(m=>Blocks.Section({text:m}))).buildToObject() as any;
  if(dryRun)console.log(JSON.stringify(msg.blocks,null,1));else console.log(JSON.stringify(await sendAlert(msg.blocks,text,{title:text})));
 }
 if(!dryRun)await writeFile(statePath,JSON.stringify(sent.slice(-200)));
 console.log(new Date().toISOString(),'slots checked',checked,'misses',misses.length);
}finally{await db.close();}
