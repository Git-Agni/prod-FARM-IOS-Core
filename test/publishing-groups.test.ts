import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser module is also used for calendar regression tests.
import {contentGroups} from '../static/publishing/groups.mjs';
const m=(id:string, platform:string, status:string, time:number, hash='same')=>({item:{id,media:{sha256:hash}},input:{deviceUdid:'phone'},targets:[{platform}],st:{key:status},runAt:time,day:String(time)});
test('one card retains posted and pending destinations across different times',()=>{
 const g=contentGroups([m('ig','instagram','posted',1),m('yt','youtube','held',Date.now()+10000),m('tt','tiktok','scheduled',Date.now()+10000)]);
 assert.equal(g.length,1);assert.equal(g[0].members.length,3);assert.equal(g[0].st.key,'held');assert.equal(g[0].targets.length,3);
});
test('different media and cancelled rows stay separate; partial delivery is not posted',()=>{
 const g=contentGroups([m('ig','instagram','posted',1),m('yt','youtube','review',2),m('old','instagram','cancelled',1),m('new','instagram','held',3,'different')]);
 assert.equal(g.length,3);assert.equal(g[0].st.key,'review');
});
