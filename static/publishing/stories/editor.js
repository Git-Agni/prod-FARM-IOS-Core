const defaults=[
{title:'Open the loop',headline:'I gave an iPhone a job.\nIt now has a posting calendar.',support:"I'm building this so posting doesn't become a second full-time job.",reason:'Start with an unusual, real detail. The calendar gives the idea something concrete to stand on.'},
{title:'Show the friction',headline:'The video is done.\nThen the admin starts.',support:'Pick the cover. Paste the caption. Check each app. Somehow the upload has homework.',reason:'Name the work the viewer recognizes. Keep the humor tied to the problem.'},
{title:'Explain the setup',headline:'One calendar.\nA dedicated iPhone.',support:'The plan is to send each video to the right app, with its caption and a frame from the intro.',reason:'Explain the mechanism in plain language. This describes the intended flow, not a claim that it never fails.'},
{title:'Show the honest part',headline:'A green button is nice.\nAn actual post is better.',support:"We're checking the result on each platform. If something needs review, I want to see it here.",reason:'Show the real review states. A useful build update can include unfinished work.'},
{title:'Invite a response',headline:'What part of posting\nwould you hand off first?',support:'The captions, the covers, or remembering to actually post? Reply and tell me.',reason:'End with one easy reply. No keyword delivery promise or untested sticker is needed.'}
].map(f=>({...f,style:'block',position:'top',asset:'calendar'}));
const key='phone-farm-story-draft-v1';let frames=structuredClone(defaults),current=0;try{const v=JSON.parse(localStorage.getItem(key));if(Array.isArray(v)&&v.length===5&&v.every(f=>f&&typeof f.headline==='string'&&typeof f.support==='string'))frames=v.map((f,i)=>({...defaults[i],headline:f.headline.slice(0,160),support:f.support.slice(0,220),style:['block','plain','lime'].includes(f.style)?f.style:'block',position:f.position==='middle'?'middle':'top',asset:f.asset==='none'?'none':'calendar'}));}catch{}
const $=id=>document.getElementById(id);function textBlock(id,text){const s=document.createElement('span');s.className='copy';s.textContent=text;$(id).replaceChildren(s)}
function preview(){const f=frames[current];$('phone').className=f.style+' '+f.position;textBlock('story-copy',f.headline);textBlock('bottom-copy',f.support);$('photo').src='/publishing/stories/calendar.png';$('photo').hidden=f.asset==='none';}
function render(){const f=frames[current];$('frames').replaceChildren(...frames.map((x,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-current',String(i===current));const n=document.createElement('span');n.textContent=String(i+1).padStart(2,'0');b.append(n,document.createTextNode(x.title));b.onclick=()=>{current=i;render()};return b}));$('progress').replaceChildren(...frames.map((_,i)=>{const e=document.createElement('i');e.className=i<=current?'on':'';return e}));$('step').textContent='FRAME '+(current+1)+' OF 5';$('frame-title').textContent=f.title;$('reason').textContent=f.reason;for(const id of ['headline','support','style','position','asset'])$(id).value=f[id];preview()}
for(const id of ['headline','support','style','position','asset'])$(id).addEventListener('input',()=>{frames[current][id]=$(id).value;preview();$('saved').textContent='Unsaved edits. Save here or download a copy.'});
$('save').onclick=()=>{try{localStorage.setItem(key,JSON.stringify(frames));$('saved').textContent='Saved in this browser. Nothing is scheduled or published.'}catch{$('saved').textContent='Browser storage is unavailable. Download the draft to keep your edits.'}};
$('download').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,status:'draft',nativeDraftCreated:false,platforms:['instagram','facebook'],source:'AI SDR five-frame reference',asset:'/publishing/stories/calendar.png',frames},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='phone-farm-story-draft.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};render();
async function loadStorySchedule() {
    const target = document.getElementById('story-schedule-status');
    try {
        const response = await fetch('/api/publishing/stories/schedule');
        if (!response.ok) throw new Error('Schedule unavailable');
        const schedule = await response.json();
        const next = schedule.slots.filter(s => new Date(s.run_at) > new Date()).sort((a,b) => new Date(a.run_at) - new Date(b.run_at))[0];
        target.textContent = 'Daily targets: 9:00 AM and 5:00 PM Los Angeles time. ' +
            (schedule.worker?.healthy ? 'Phone Farm Story planner is running. It does not run video releases. ' : 'Phone Farm Story planner has no recent heartbeat. Stored slots do not prove it is running. ') +
            (next ? 'Next planning slot: ' + new Date(next.run_at).toLocaleString('en-US', { timeZone: schedule.timezone }) + '. ' : 'No future slot found. ') +
            'Prepare drafts 24 hours ahead. Native posting passed an attended test. Unattended Story publishing is not enabled. No Codex or Claude routine owns this schedule.';
    } catch { target.textContent = 'Could not read the app schedule. Do not assume the daily job is running.'; }
}
void loadStorySchedule();
