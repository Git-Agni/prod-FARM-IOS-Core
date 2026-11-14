import test from 'node:test';
import assert from 'node:assert/strict';
import { planMigration } from '../src/publishing/migration.js';
const date={dateTime:'2026-10-01T11:00:00',timezone:'America/Los_Angeles'};
test('migration preserves excluded platforms and already published results',()=>{
 const source={id:1,date,providers:[{network:'instagram',status:'PENDING'},{network:'facebook',status:'PUBLISHED'},{network:'youtube',status:'PENDING'},{network:'linkedin',status:'PENDING'}]};
 const copy=JSON.stringify(source);const [plan]=planMigration([source]);
 assert.deepEqual(plan.migrate,['instagram']);assert.equal(plan.preserve.length,3);assert.equal(plan.phoneEnabled,false);assert.equal(plan.removeWholeMetricoolItem,false);assert.equal(JSON.stringify(source),copy);
});
test('migration rejects repeated source IDs and preserves standalone YouTube',()=>{
 const source={id:1,date,providers:[{network:'youtube',status:'PENDING'}]};
 assert.throws(()=>planMigration([source,source]),/duplicate/);assert.equal(planMigration([source])[0].action,'leave_unchanged');
});
