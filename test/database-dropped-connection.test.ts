import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabaseConnection} from '../src/database/client.js';

test('a dropped pooled connection is logged, not thrown (Oct 15 worker crash)',async()=>{
    const db=createDatabaseConnection('postgres://unused@127.0.0.1:1/none');
    assert.ok(db.pool.listenerCount('error')>=1);
    const fake=new (await import('node:events')).EventEmitter();
    db.pool.emit('connect',fake as any);
    assert.doesNotThrow(()=>fake.emit('error',new Error('Connection terminated unexpectedly')));
    await db.close();
});
