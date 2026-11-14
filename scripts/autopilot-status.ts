/** One read-only health check for posting without Claude (Antonio, Oct 17: "make sure the phone farm will post without
 * Claude, just normal cloud based scripts"). Deterministic: no AI, no phone input, no posting, no writes.
 * Prints: launchd agents, worker heartbeat, WDA and phone, lane hours, the next 6 slots per platform with the booked
 * video, posts published in the last 24 h per platform, and every missed slot in the last 24 h.
 * Usage: autopilot-status.ts [--json]. Exit code 1 when something blocks posting. */
import {execFileSync} from 'node:child_process';
import {createDatabaseConnection} from '../src/database/client.js';
import {publishingCadence as cadence,slotsFrom} from '../src/publishing/cadence.js';
import {laneHours,type Lane} from '../src/publishing/lanes.js';
import {probeDevice} from './lib/device-health.js';

const minute=60_000,json=process.argv.includes('--json');
const pt=(t:number|Date)=>new Date(t).toLocaleString('en-US',{timeZone:cadence.timezone,weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const AGENTS=['worker','wda','backlog','slot-alert','device-alert','monitor','summary','burn-in','backup','web','tunnel','audio-mute','awake','appium'];
// Agents that must stay running for a post to go out. The rest are timers that run and exit.
const KEEP_ALIVE=['worker','wda','web','awake'];

function agents(){
    let out='';try{out=execFileSync('launchctl',['list'],{encoding:'utf8'});}catch{/* launchctl unavailable */}
    return AGENTS.map(name=>{
        const line=out.split('\n').find(l=>l.endsWith('\tai.clicktoclose.phone-farm.'+name));
        const [pid,status]=line?line.split('\t'):['',''];
        return {name,loaded:!!line,running:!!pid&&pid!=='-',lastExit:status===''?null:Number(status)};
    });
}

const db=createDatabaseConnection();
const problems:string[]=[];
try{
    const now=Date.now(),lanes=laneHours();
    const agentRows=agents();
    for(const a of agentRows){
        if(!a.loaded)problems.push(`launchd agent ${a.name} is not loaded`);
        else if(KEEP_ALIVE.includes(a.name)&&!a.running)problems.push(`launchd agent ${a.name} is not running`);
    }
    const worker=(await db.pool.query(`SELECT last_tick,control_mode,state,blockers FROM scheduler.publishing_worker_health WHERE id=1`)).rows[0];
    const stories=(await db.pool.query(`SELECT last_tick,mode FROM scheduler.story_worker_health WHERE id=1`)).rows[0];
    // A release can hold one tick for up to 25 minutes, so a quiet heartbeat is only stale after 30.
    const workerAge=worker?Math.round((now-new Date(worker.last_tick).getTime())/minute):null;
    if(!worker)problems.push('worker has never written a heartbeat');
    else{
        if(workerAge!>30)problems.push(`worker heartbeat is ${workerAge} min old`);
        if(worker.state!=='running')problems.push('worker is blocked: '+(worker.blockers??[]).join('; '));
    }
    const phone=await probeDevice();
    if(!phone.usbConnected)problems.push('iPhone is not connected to this Mac');
    if(!phone.wdaReady)problems.push('WDA is not ready'+(phone.serviceMessage?': '+phone.serviceMessage:''));
    if(phone.locked)problems.push('iPhone is locked');

    const booked=async(p:Lane,slot:number)=>(await db.pool.query(`SELECT i.media->>'name' n,r.state,r.result->>'error' e FROM scheduler.publishing_releases r
      JOIN scheduler.publishing_items i ON i.id=r.item_id WHERE r.run_at BETWEEN $1 AND $2 AND r.state<>'cancelled'
      AND i.input->'targets' @> $3::jsonb ORDER BY (r.state='published') DESC,r.run_at`,[new Date(slot-5*minute),new Date(slot+5*minute),JSON.stringify([{platform:p}])])).rows;
    const lanesOut:Record<string,{hours:number[];next:{at:string;video:string;state:string}[];published24h:number;missed:{at:string;why:string}[]}>={};
    for(const p of Object.keys(lanes) as Lane[]){
        const off=p==='youtube'?cadence.youtubeOffsetMinutes*minute:0;
        const next=[];
        for(const slot of slotsFrom(now-off,lanes[p],2).map(s=>s+off).filter(s=>s>=now).slice(0,6)){
            const r=(await booked(p,slot))[0];
            next.push({at:pt(slot),video:r?.n??'(nothing booked)',state:r?.state??'empty'});
        }
        const missed=[];
        for(const slot of slotsFrom(now-24*60*minute,lanes[p],1).map(s=>s+off).filter(s=>s>=now-24*60*minute&&s<=now-40*minute)){
            const rows=await booked(p,slot);
            if(rows.some(r=>r.state==='published'))continue;
            // Oct 25: a post that waited or failed here and was then moved to a later slot left this slot looking unbooked.
            const moved=rows.length?undefined:(await db.pool.query(`SELECT i.media->>'name' n,i.results->'autopilotBacklog'->'priorRelease'->'result'->>'error' e FROM scheduler.publishing_items i
              WHERE (i.results->'autopilotBacklog'->>'priorRunAt')::timestamptz BETWEEN $1 AND $2 AND i.input->'targets' @> $3::jsonb LIMIT 1`,
              [new Date(slot-5*minute),new Date(slot+5*minute),JSON.stringify([{platform:p}])])).rows[0];
            missed.push({at:pt(slot),why:rows.length?`${rows[0].n} is ${rows[0].state}${rows[0].e?' ('+String(rows[0].e).slice(0,120)+')':''}`
              :moved?`${moved.n} was booked, then moved to a later slot (${moved.e?String(moved.e).slice(0,100):'it had not started'})`:'no video was booked'});
        }
        // Facebook rides on the Instagram item, so count its own verified receipt.
        // Oct 25: count by Share time; a receipt recorded later (caption-block catch-up) is not a new post.
        const published=Number((await db.pool.query(`SELECT count(*) c FROM scheduler.publishing_releases r JOIN scheduler.publishing_items i ON i.id=r.item_id
          WHERE r.state='published' AND coalesce(r.share_claimed_at,r.updated_at)>now()-interval '24 hours' AND i.input->'targets' @> $1::jsonb`,[JSON.stringify([{platform:p}])])).rows[0].c);
        lanesOut[p]={hours:lanes[p],next,published24h:published,missed};
    }
    const facebook24h=Number((await db.pool.query(`SELECT count(*) c FROM scheduler.publishing_releases r JOIN scheduler.publishing_items i ON i.id=r.item_id
      WHERE r.state='published' AND coalesce(r.share_claimed_at,r.updated_at)>now()-interval '24 hours' AND (i.results->'release'->'receipts'->'facebook'->>'verified')::boolean`)).rows[0].c);
    const queue=(await db.pool.query(`SELECT state,count(*)::int c FROM scheduler.publishing_releases WHERE state IN('armed','running','needs_review') GROUP BY 1`)).rows;
    const report={at:pt(now),problems,agents:agentRows,
        worker:worker?{lastTick:pt(worker.last_tick),minutesAgo:workerAge,mode:worker.control_mode,state:worker.state,blockers:worker.blockers}:null,
        storyWorker:stories?{lastTick:pt(stories.last_tick),mode:stories.mode}:null,
        phone:{usbConnected:phone.usbConnected,wdaReady:phone.wdaReady,locked:phone.locked,battery:phone.battery,service:phone.serviceMessage||undefined},
        queue:Object.fromEntries(queue.map(r=>[r.state,r.c])),lanes:lanesOut,facebookPublished24h:facebook24h};
    if(json)console.log(JSON.stringify(report,null,1));
    else{
        const L=(s='')=>console.log(s);
        L(`Phone Farm autopilot status, ${report.at} PT`);
        L(problems.length?`BLOCKED: ${problems.length} problem(s)`:'OK: nothing blocks posting');
        for(const p of problems)L('  - '+p);
        L();L('launchd agents (no Claude, no model):');
        for(const a of agentRows)L(`  ${a.name.padEnd(13)} ${!a.loaded?'NOT LOADED':a.running?'running':'idle'}${a.lastExit?`  last exit ${a.lastExit}`:''}`);
        L();L(`Worker: ${report.worker?`${report.worker.state}, mode ${report.worker.mode}, last tick ${report.worker.lastTick} (${workerAge} min ago)`:'no heartbeat'}`);
        L(`Story worker: ${report.storyWorker?`${report.storyWorker.mode}, last tick ${report.storyWorker.lastTick}`:'no heartbeat'}`);
        L(`Phone: USB ${phone.usbConnected?'yes':'NO'}, WDA ${phone.wdaReady?'ready':'NOT READY'}, ${phone.locked===null?'lock unknown':phone.locked?'LOCKED':'unlocked'}, battery ${phone.battery?phone.battery.pct+'%'+(phone.battery.charging?' charging':''):'unknown'}`);
        L(`Queue: ${queue.map(r=>`${r.c} ${r.state}`).join(', ')||'empty'}`);
        for(const [p,v] of Object.entries(lanesOut)){
            L();L(`${p}: hours ${v.hours.join(',')}${p==='youtube'?` (+${cadence.youtubeOffsetMinutes} min)`:''}. Published last 24 h: ${v.published24h}${p==='instagram'?`, Facebook receipts ${facebook24h}`:''}`);
            for(const n of v.next)L(`  next ${n.at.padEnd(22)} ${n.state.padEnd(12)} ${n.video}`);
            for(const m of v.missed)L(`  MISSED ${m.at}: ${m.why}`);
        }
    }
}finally{await db.close();}
process.exitCode=problems.length?1:0;
