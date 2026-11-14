import sharp from 'sharp';
import {execFile} from 'node:child_process';
import {readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {promisify} from 'node:util';
import type {MirrorSnapshot} from '../devices/mirroring/screen.js';
export interface NativeRect {x:number;y:number;width:number;height:number}
export function validRect(r:NativeRect) {
    return !!r && [r.x,r.y,r.width,r.height].every(Number.isFinite) && r.x>=0&&r.y>=0&&r.width>0&&r.height>0&&r.x+r.width<=1&&r.y+r.height<=1;
}
export async function openingFrame(file:string):Promise<Buffer> {
    const {stdout}=await promisify(execFile)('ffmpeg',['-v','error','-i',file,'-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'],{encoding:'buffer',maxBuffer:16_000_000,timeout:30_000});
    return stdout;
}
/** Compare a bounded native image with an actual source frame. Unknown crops fail closed. */
export async function nativeImageDistance(source:Buffer,s:MirrorSnapshot,rect:NativeRect,crop:'centre'|'top'='centre') {
    if(!validRect(rect))throw new Error('Invalid native image region');
    const width=Math.round(s.width*rect.width),height=Math.round(s.height*rect.height);
    const fitted=await sharp(source).resize(width,height,{fit:'cover',position:crop==='top'?'top':'centre'}).png().toBuffer();
    const expected=await sharp(fitted).resize(48,64,{fit:'fill'}).removeAlpha().toColourspace('srgb').raw().toBuffer();
    const actual=await sharp(Buffer.from(s.png,'base64')).extract({left:Math.round(s.width*rect.x),top:Math.round(s.height*rect.y),width,height}).resize(48,64).removeAlpha().toColourspace('srgb').raw().toBuffer();
    if(expected.length!==actual.length)throw new Error('Native image channels differ');
    return expected.reduce((sum,v,i)=>sum+Math.abs(v-actual[i]!),0)/(expected.length*255);
}
/** Compare only the visible top of a native video tile, excluding counters and navigation. */
export async function publishedCoverDistance(source:Buffer,s:MirrorSnapshot,rect:NativeRect,fullHeight:number){
    if(!validRect(rect)||!Number.isFinite(fullHeight)||fullHeight<rect.height||fullHeight>1)throw new Error('Invalid published cover crop');
    const width=Math.round(s.width*rect.width),height=Math.round(s.height*rect.height);
    const expected=await sharp(source).resize(width,Math.round(s.height*fullHeight),{fit:'cover',position:'centre'})
        .extract({left:0,top:0,width,height}).png().toBuffer();
    return nativeImageDistance(expected,s,rect);
}
export function uniqueImageMatch(distances:number[],maxDistance:number,minGap:number) {
    if(!distances.length||!distances.every(Number.isFinite)||maxDistance<=0||maxDistance>0.15||minGap<0.05)throw new Error('Invalid native image match');
    const sorted=distances.map((value,index)=>({value,index})).sort((a,b)=>a.value-b.value);
    if(sorted[0]!.value>maxDistance||(sorted[1]&&sorted[1].value-sorted[0]!.value<minGap))throw new Error('The native cover is missing or ambiguous');
    return sorted[0]!;
}

export async function nativeReference(file:string,sha256:string){
    const root=await realpath(path.resolve('.scheduler-data/native-layouts'));
    const resolved=await realpath(file);
    if(!resolved.startsWith(root+path.sep)||!/^[a-f0-9]{64}$/.test(sha256))throw new Error('Native switch reference must be saved inside native layouts');
    const bytes=await readFile(resolved);if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw new Error('Native switch reference changed');
    return bytes;
}
export async function nativeReferenceDistance(reference:Buffer,s:MirrorSnapshot,rect:NativeRect){
    if(!validRect(rect))throw new Error('Invalid native switch region');
    const expected=await sharp(reference).resize(64,32,{fit:'fill'}).removeAlpha().toColourspace('srgb').raw().toBuffer();
    const actual=await sharp(Buffer.from(s.png,'base64')).extract({left:Math.round(s.width*rect.x),top:Math.round(s.height*rect.y),width:Math.round(s.width*rect.width),height:Math.round(s.height*rect.height)}).resize(64,32,{fit:'fill'}).removeAlpha().toColourspace('srgb').raw().toBuffer();
    if(expected.length!==actual.length)throw new Error('Native switch channels differ');
    return expected.reduce((sum,v,i)=>sum+Math.abs(v-actual[i]!),0)/(expected.length*255);
}
