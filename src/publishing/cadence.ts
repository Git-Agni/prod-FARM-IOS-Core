import { CronExpressionParser } from 'cron-parser';

const hourly = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] as const;
const fourADay = [9, 13, 17, 21] as const;

/** Antonio's cadence: one video every 2 hours from Oct 11 16:45 (every 3 hours from Oct 7, hourly from Oct 5). Target times, not publication approval. */
export const publishingCadence = {
    owner: 'phone_farm_worker', timezone: 'America/Los_Angeles',
    videoCron: '22 0-23/2 * * *', videoIntervalMinutes: 120,
    platforms: ['instagram', 'facebook', 'youtube', 'tiktok'],
    videosPerDayPerPlatform: 12, tiktokDailyLimit: 24,
    // Stories at 08:00 and 16:00 (Oct 15): Instagram posts at 09:00 and 17:00 now, so the old Story slots collided.
    // Each new slot has only the 07:00 or 15:00 Instagram post before it and a clear 45 minutes before the next video.
    storyCron: '0 8,16 * * *', storyTimes: ['08:00', '16:00'],
    storySequencesPerDay: 2, planningDays: 3,
    missedSlotPolicy: 'review_before_rescheduling',
    // Antonio, Oct 20: Instagram Trial Reels (each with its linked Facebook post) post hourly from 07:00 to 23:00 PT
    // (17 a day); TikTok and YouTube Shorts stay at 4 a day (9, 13, 17, 21). Keep the calendar-page override
    // (.scheduler-data/lane-hours.json) equal to these lists. scripts/lane-slotter.ts owns every armed post's time,
    // one lane per platform; a Short posts 22 minutes after its slot so it never collides with the Instagram post.
    instagramHours: hourly, tiktokHours: fourADay, youtubeHours: fourADay, youtubeOffsetMinutes: 22,
} as const;

export function upcomingVideoSlots(now = new Date(), count = 72): Date[] {
    const cron = CronExpressionParser.parse(publishingCadence.videoCron, {
        currentDate: now, tz: publishingCadence.timezone,
    });
    return Array.from({length: count}, () => cron.next().toDate());
}

/** UTC ms for hour `h` (PT) on the PT calendar day `day` (YYYY-MM-DD), handling daylight saving. */
function ptHour(day:string,h:number){
 const guess=Date.parse(`${day}T${String(h).padStart(2,'0')}:00:00Z`);
 const offsetAt=(ms:number)=>{
  const shown=new Date(ms).toLocaleString('en-US',{timeZone:publishingCadence.timezone,hour12:false,hour:'2-digit',year:'numeric',month:'2-digit',day:'2-digit'});
  const [md,hh]=shown.split(', ');const [m,d,y]=md.split('/');
  return Date.parse(`${y}-${m}-${d}T${hh.padStart(2,'0').replace('24','00')}:00:00Z`)-Math.floor(ms/3600000)*3600000;
 };
 // Take the offset at the answer, not at the guess, so early hours on a clock-change day land right.
 return guess-offsetAt(guess-offsetAt(guess));
}
export function slotsFrom(from:number,hours:readonly number[],days=30){
 const out:number[]=[];
 for(let n=0;n<=days;n++){
  const day=new Date(from+n*86400000).toLocaleDateString('en-CA',{timeZone:publishingCadence.timezone});
  for(const h of hours){const t=ptHour(day,h);if(t>=from)out.push(t);}
 }
 return [...new Set(out)].sort((a,b)=>a-b);
}
