import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';

// Antonio, Oct 17: the phone farm must post without Claude. Walk every local module the worker imports and prove that no
// model API is reachable, except the Story quality score, which only decides whether a Story auto-approves.
const MODEL_API=/api\.anthropic\.com|@anthropic-ai|openrouter\.ai|api\.openai\.com|generativelanguage\.googleapis|claude\s+-p\b|codex\s+exec/;
const ALLOWED=new Set(['src/publishing/story-score.ts']);

function graph(entry:string){
    const seen=new Set<string>(),todo=[entry];
    while(todo.length){
        const file=todo.pop()!;
        if(seen.has(file))continue;seen.add(file);
        const src=readFileSync(file,'utf8');
        for(const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)){
            const next=path.normalize(path.join(path.dirname(file),m[1]!.replace(/\.js$/,'.ts')));
            if(existsSync(next))todo.push(next);
        }
    }
    return [...seen];
}

for(const entry of ['src/scheduler/worker.ts','scripts/autopilot-backlog.ts','scripts/lane-slotter.ts','scripts/instagram-trial-on.ts',
    'scripts/one-variant-per-video.ts','scripts/upgrade-queued-media.ts','scripts/slot-alert.ts','scripts/autopilot-status.ts','scripts/monitor.ts','scripts/device-alert.ts','scripts/burn-in-report.ts','src/api/server.ts']){
    test(`no model API in the posting path from ${entry}`,()=>{
        const hits=graph(entry).filter(f=>!ALLOWED.has(f)&&MODEL_API.test(readFileSync(f,'utf8')));
        assert.deepEqual(hits,[]);
    });
}

test('the Story score is reached only through the Story capture step',()=>{
    const importers=graph('src/scheduler/worker.ts').filter(f=>/from\s*['"]\.\/story-score\.js['"]/.test(readFileSync(f,'utf8')));
    assert.deepEqual(importers,['src/publishing/wda-stories.ts']);
});

test('a Story failure cannot skip receipt checks and comments in the release loop',()=>{
    const src=readFileSync('src/publishing/release-loop.ts','utf8');
    assert.match(src,/timed\('stories',[^\n]*\)\)\)\.catch\(/);
});
