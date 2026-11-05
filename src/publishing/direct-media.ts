import type {Pool} from 'pg';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {ReleaseMedia} from './instagram-release.js';
/** Shared import journal. The caller holds the phone lock; an uncertain import is never retried. */
export class DirectMediaStore {
 constructor(private pool:Pool){}
 async initialize(){await this.pool.query(`CREATE TABLE IF NOT EXISTS scheduler.direct_media_imports (
  device_udid text NOT NULL, sha256 text NOT NULL, album_name text NOT NULL, state text NOT NULL,
  receipt jsonb, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(device_udid,sha256))`);}
 /** Only after the caller proved the album is gone from the phone (Story driver swiped the whole album row).
  * Forgets a finished import so the next ensure imports a fresh copy. Uncertain imports are never forgotten. */
 async forgetMissingAlbum(device:string,sha256:string){
  return (await this.pool.query("DELETE FROM scheduler.direct_media_imports WHERE device_udid=$1 AND sha256=$2 AND state='imported'",[device,sha256])).rowCount===1;
 }
 /** Oct 30: YouTube picks from Recents (newest first), so an import days old sits under hundreds of photos. Forget an
  * import older than maxAgeMs so ensure() sends a fresh copy that lands at the top. The old copy stays in Photos. */
 async forgetIfOlder(device:string,sha256:string,maxAgeMs:number){
  return (await this.pool.query("DELETE FROM scheduler.direct_media_imports WHERE device_udid=$1 AND sha256=$2 AND state='imported' AND created_at<now()-make_interval(secs=>$3)",[device,sha256,maxAgeMs/1000])).rowCount===1;
 }
 async ensure(device:string,media:ReleaseMedia,base:string,signal:AbortSignal){
  const bytes=await readFile(media.path);
  if(createHash('sha256').update(bytes).digest('hex')!==media.sha256)throw Error('Source video hash changed');
  const album='PF-'+media.sha256.slice(0,12);
  const claim=await this.pool.query(`INSERT INTO scheduler.direct_media_imports(device_udid,sha256,album_name,state)
   VALUES($1,$2,$3,'importing') ON CONFLICT DO NOTHING RETURNING sha256`,[device,media.sha256,album]);
  if(!claim.rowCount){
   const existing=(await this.pool.query('SELECT * FROM scheduler.direct_media_imports WHERE device_udid=$1 AND sha256=$2',[device,media.sha256])).rows[0];
   if(existing?.state!=='imported'||!existing.receipt?.localIdentifier)throw Error('A prior import needs review; no second import was sent');
   return {...existing.receipt,createdAt:new Date(existing.created_at)} as {albumName:string;localIdentifier:string;createdAt:Date};
  }
  try{
   const response=await fetch(base+'/wda/import-media',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:media.name,mimeType:media.mimeType,data:bytes.toString('base64'),albumName:album}),signal});
   const value=(await response.json() as any).value;
   if(!response.ok||value?.albumName!==album||!value?.localIdentifier)throw Error('Native import receipt is missing');
   await this.pool.query("UPDATE scheduler.direct_media_imports SET state='imported',receipt=$3 WHERE device_udid=$1 AND sha256=$2",[device,media.sha256,JSON.stringify(value)]);
   const at=(await this.pool.query('SELECT created_at FROM scheduler.direct_media_imports WHERE device_udid=$1 AND sha256=$2',[device,media.sha256])).rows[0]?.created_at;
   return {...value,createdAt:new Date(at??Date.now())} as {albumName:string;localIdentifier:string;createdAt:Date};
  }catch(error){await this.pool.query("UPDATE scheduler.direct_media_imports SET state='uncertain' WHERE device_udid=$1 AND sha256=$2",[device,media.sha256]);throw error;}
 }
}
