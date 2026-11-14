import type {Pool} from 'pg';
export interface NativeImportJournal {
    state(hash:string):Promise<'new'|'claimed'|'imported'>;
    claim(hash:string):Promise<void>;
    complete(hash:string):Promise<void>;
}
/** Imports have their own durable claim. An uncertain Save Video cannot be repeated. */
export class MirroringMediaStore {
    constructor(private pool:Pool){}
    async initialize(){await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.mirroring_media_imports(
        device_udid text NOT NULL, sha256 text NOT NULL, state text NOT NULL CHECK(state IN('claimed','imported')),
        claimed_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, PRIMARY KEY(device_udid,sha256))`);}
    forPhone(phone:string):NativeImportJournal {
        return {
            state:async hash=>(await this.pool.query('SELECT state FROM scheduler.mirroring_media_imports WHERE device_udid=$1 AND sha256=$2',[phone,hash])).rows[0]?.state??'new',
            claim:async hash=>{const r=await this.pool.query("INSERT INTO scheduler.mirroring_media_imports(device_udid,sha256,state) VALUES($1,$2,'claimed') ON CONFLICT DO NOTHING RETURNING sha256",[phone,hash]);if(r.rowCount!==1)throw new Error('Save Video was already attempted. Inspect the gallery before another import');},
            complete:async hash=>{const r=await this.pool.query("UPDATE scheduler.mirroring_media_imports SET state='imported',completed_at=now() WHERE device_udid=$1 AND sha256=$2 AND state='claimed' RETURNING sha256",[phone,hash]);if(r.rowCount!==1)throw new Error('Native import claim changed');},
        };
    }
}
