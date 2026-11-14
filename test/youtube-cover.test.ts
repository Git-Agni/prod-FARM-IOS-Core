import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { prepareYouTubeCover, fileHash } from '../src/publishing/youtube-cover.js';
import { validateYouTubeDetails } from '../src/publishing/youtube-shorts.js';

const details = { title: 'Test', channelId: 'UC'+'x'.repeat(22), visibility: 'private', madeForKids: false,
    publishing: { category: 'Howto & Style', tags: ['Claude Code'], hashtags: ['#ClaudeCode'], commentKeyword: 'CODE', aiUse: 'no', coverMode: 'replace_first_frame', relatedVideoId: '12345678901' } };
test('YouTube publishing metadata preserves requested values and rejects malformed fields', () => {
    assert.deepEqual(validateYouTubeDetails(details), details);
    for (const bad of [{tags: []}, {hashtags: ['#bad tag']}, {relatedVideoId: 'url'}, {aiUse: false}, {category: 'AI'}, {coverMode: 'auto'}, {commentKeyword:'a.*'}])
        assert.throws(() => validateYouTubeDetails({...details, publishing: {...details.publishing, ...bad}}));
});

test('Cover replaces only frame zero, preserves source, duration and exact audio packets', async () => {
    const dir = await mkdtemp(path.join(tmpdir(),'youtube-cover-'));
    try {
        const source=path.join(dir,'source.mp4'), cover=path.join(dir,'cover.png');
        execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=90x160:r=30:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source]);
        await sharp({create:{width:90,height:160,channels:3,background:'#ff0000'}}).png().toFile(cover);
        const before=await fileHash(source), result=await prepareYouTubeCover(source,cover,dir);
        assert.equal(await fileHash(source),before);
        assert.equal(result.receipt.thumbnailSelectionVerified,false);
        const frames=execFileSync('ffmpeg',['-v','error','-i',result.media.path,'-frames:v','2','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
        const middle=(80*90+45)*3, second=90*160*3+middle;
        assert.ok(frames[middle]!>240 && frames[middle+2]!<10, 'first frame must be the red cover');
        assert.ok(frames[second]!<10 && frames[second+2]!>240, 'second frame must still be original blue');
        const audio=(f:string)=>execFileSync('ffmpeg',['-v','error','-i',f,'-map','0:a:0','-c','copy','-f','adts','pipe:1']);
        assert.deepEqual(audio(result.media.path),audio(source));
        assert.equal(result.receipt.original.durationSeconds,result.receipt.prepared.durationSeconds);
        await assert.rejects(prepareYouTubeCover(source,cover,dir)); // Never overwrite an existing derivative.
    } finally { await rm(dir,{recursive:true,force:true}); }
});
