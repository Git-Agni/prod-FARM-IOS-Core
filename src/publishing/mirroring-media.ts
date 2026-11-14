import { createHash } from 'node:crypto';
import { readFile, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ReleaseMedia } from './instagram-release.js';
import type {NativeImportJournal} from './mirroring-media-store.js';
import { MirrorScreen } from '../devices/mirroring/screen.js';

export async function stageMirroringMedia(media:ReleaseMedia) {
    if(!/^[a-f0-9]{64}$/.test(media.sha256)||media.mimeType!=='video/mp4')throw new Error('Mirroring needs a saved MP4 and its SHA-256 hash');
    const bytes=await readFile(media.path);
    if(createHash('sha256').update(bytes).digest('hex')!==media.sha256)throw new Error('The saved video changed; no phone action was sent');
    const name='PF-'+media.sha256.slice(0,12);
    const root=path.join(os.homedir(),'Library/Mobile Documents/com~apple~CloudDocs/PhoneFarm-Preview');
    await mkdir(root,{recursive:true});
    const staged=path.join(root,name+'.mp4');
    let cached:Buffer|undefined;
    try{cached=await readFile(staged);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(cached&&createHash('sha256').update(cached).digest('hex')!==media.sha256)
        throw new Error('The staged filename belongs to a different video');
    // Recopying identical bytes invalidates the iPhone's iCloud download cache.
    if(!cached)await copyFile(media.path,staged);
    if(createHash('sha256').update(await readFile(staged)).digest('hex')!==media.sha256)throw new Error('The staged video does not match its saved hash');
    return {name,path:staged,sha256:media.sha256};
}

/** Native Files import only. Never opens a social composer, Shares a post, or marks publication. */
export async function importMirroringMedia(screen:MirrorScreen,media:ReleaseMedia,journal?:NativeImportJournal) {
    if(!journal)throw new Error('A durable native import journal is required');
    const state=await journal.state(media.sha256);
    if(state==='claimed')throw new Error('An earlier Save Video is uncertain. Review the native gallery');
    const staged=await stageMirroringMedia(media);
    if(state==='imported')return {...staged,publicationVerified:false as const,evidence:'Existing native import claim preserved. Composer cover must still match the exact source frame.'};
    await screen.openApp('Files');
    let s=await screen.snapshot();
    if(screen.has(s,'TV Cast')) {
        // Close the known Files video preview. This leaves its existing iCloud search open.
        await screen.tap(0.116,0.132,['TV Cast']);
        s=await screen.waitFor(['iCloud Drive','Recents']);
    }
    if(!screen.has(s,'iCloud Drive')||!screen.has(s,'Recents'))throw new Error('Prepare Files in iCloud Drive search before the first Mirroring import');
    // Only the search clear control is changed. Existing files and folders are preserved.
    await screen.tap(0.756,0.132,['iCloud Drive','Recents']);
    await screen.type(staged.name,['iCloud Drive','Recents']);
    await screen.waitFor([staged.name,'Name Contains','1 item'],60_000);
    // This calibrated cell is usable only after the unique filename and one-result readback.
    await screen.doubleTap(0.19,0.31,[staged.name,'Name Contains','1 item']);
    await screen.waitFor([staged.name,'TV Cast'],90_000);
    await screen.tap(0.861,0.935,[staged.name,'TV Cast']);
    await screen.waitFor(['Save Video']);
    await journal.claim(media.sha256);
    await screen.tapText('Save Video',['Save Video']);
    await screen.waitFor([staged.name,'TV Cast']);
    await journal.complete(media.sha256);
    return {...staged,publicationVerified:false as const,
        evidence:'Exact hash staged in iCloud Drive; unique native Files search and Save Video action completed. Social gallery selection is still required.'};
}
