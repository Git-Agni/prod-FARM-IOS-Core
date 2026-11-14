import { test } from 'node:test';
import assert from 'node:assert/strict';
import { galleryDate, parseGalleryCell, WdaApp } from '../src/publishing/wda-app.js';

test('parses the gallery cell label Instagram shows for a video', () => {
    assert.deepEqual(parseGalleryCell('Video thumbnail, video duration: 0:29, TUESDAY, SEPTEMBER 29, 2026'), { seconds: 29, date: 'TUESDAY, SEPTEMBER 29, 2026' });
    assert.deepEqual(parseGalleryCell('Video thumbnail, video duration: 1:05, WEDNESDAY, SEPTEMBER 30, 2026')?.seconds, 65);
    assert.equal(parseGalleryCell('Photo thumbnail, TUESDAY, SEPTEMBER 29, 2026'), null);
});

test('gallery date is the Pacific calendar day in Instagram format', () => {
    assert.equal(galleryDate(new Date('2026-09-30T04:17:00Z')), 'TUESDAY, SEPTEMBER 29, 2026');
    assert.equal(galleryDate(new Date('2026-09-30T16:00:00Z')), 'WEDNESDAY, SEPTEMBER 30, 2026');
});

test('a locked phone never receives an app launch or unlock request', async t => {
    const requests:string[]=[];
    t.mock.method(globalThis,'fetch',async (url:unknown)=>{
        requests.push(String(url));
        return new Response(JSON.stringify({value:true}),{status:200});
    });
    await assert.rejects(new WdaApp('http://phone',new AbortController().signal).start('com.burbn.basel'),/Unlock the iPhone/);
    assert.deepEqual(requests,['http://phone/wda/locked']);
});

test('switching native apps reuses the WDA session without restarting or terminating either app',async t=>{
    const requests:{url:string;body:any}[]=[];
    t.mock.method(globalThis,'fetch',async(url:unknown,options:any)=>{
        requests.push({url:String(url),body:options?.body?JSON.parse(options.body):null});
        return new Response(JSON.stringify(String(url).endsWith('/wda/locked')?{value:false}:
            String(url).endsWith('/status')?{sessionId:'existing-session',value:{ready:true}}:{value:{}}));
    });
    await new WdaApp('http://phone',new AbortController().signal).start('com.burbn.instagram');
    assert.deepEqual(requests.map(r=>r.url),['http://phone/wda/locked','http://phone/status',
        'http://phone/session/existing-session/wda/apps/activate','http://phone/session/existing-session/appium/settings']);
    assert.deepEqual(requests[2].body,{bundleId:'com.burbn.instagram'});
});

test('a first WDA session disables forced relaunch and termination',async t=>{
    let capabilities:any;
    t.mock.method(globalThis,'fetch',async(url:unknown,options:any)=>{
        const route=String(url);
        if(route.endsWith('/wda/locked'))return new Response(JSON.stringify({value:false}));
        if(route.endsWith('/status'))return new Response(JSON.stringify({sessionId:null,value:{ready:true}}));
        if(route.endsWith('/session')){capabilities=JSON.parse(options.body).capabilities.alwaysMatch;return new Response(JSON.stringify({sessionId:'new-session',value:{}}));}
        return new Response(JSON.stringify({value:{}}));
    });
    await new WdaApp('http://phone',new AbortController().signal).start('com.burbn.instagram');
    assert.equal(capabilities.forceAppLaunch,false);
    assert.equal(capabilities.shouldTerminateApp,false);
});

test('native cleanup goes Home and preserves the app and its unsent composer',async t=>{
    class Probe extends WdaApp { cleanup(){return this.exitApp('com.burbn.instagram');} }
    const requests:string[]=[];
    t.mock.method(globalThis,'fetch',async(url:unknown)=>{
        requests.push(String(url));return new Response(JSON.stringify({value:{}}));
    });
    await new Probe('http://phone',new AbortController().signal).cleanup();
    assert.deepEqual(requests,['http://phone/wda/homescreen']);
});

test('coordinate input stops when another app or system overlay is active', async t => {
    class Probe extends WdaApp {
        constructor(){super('http://phone',new AbortController().signal);this.session='/session/test';this.expectedBundleId='com.google.ios.youtube';}
        touch(){return this.tapPoint(20,80);}
    }
    const requests:string[]=[];
    t.mock.method(globalThis,'fetch',async (url:unknown)=>{
        requests.push(String(url));
        return new Response(JSON.stringify({value:{bundleId:'com.apple.springboard'}}));
    });
    await assert.rejects(new Probe().touch(),/native input stopped/);
    assert.deepEqual(requests,['http://phone/session/test/wda/activeAppInfo']);
});

test('coordinate input sends one touch when the expected app is active', async t => {
    class Probe extends WdaApp {
        constructor(){super('http://phone',new AbortController().signal);this.session='/session/test';this.expectedBundleId='com.google.ios.youtube';}
        touch(){return this.tapPoint(20,80);}
    }
    const requests:string[]=[];
    t.mock.method(globalThis,'fetch',async (url:unknown)=>{
        requests.push(String(url));
        return new Response(JSON.stringify({value:{bundleId:'com.google.ios.youtube'}}));
    });
    await new Probe().touch();
    assert.deepEqual(requests,['http://phone/session/test/wda/activeAppInfo','http://phone/session/test/source','http://phone/wda/absolute-actions']);
});

test('a notification banner blocks a touch even when the expected app is active',async t=>{
    class Probe extends WdaApp {
        constructor(){super('http://phone',new AbortController().signal);this.session='/session/test';this.expectedBundleId='com.burbn.instagram';}
        touch(){return this.tapPoint(20,80);}
    }
    const requests:string[]=[];
    t.mock.method(globalThis,'fetch',async(url:unknown)=>{
        requests.push(String(url));
        return new Response(JSON.stringify({value:String(url).endsWith('/source')
            ? '<XCUIElementTypeOther name="NotificationShortLookView" visible="true" />'
            : {bundleId:'com.burbn.instagram'}}));
    });
    await assert.rejects(new Probe().touch(),/notification banner/);
    assert.deepEqual(requests,['http://phone/session/test/wda/activeAppInfo','http://phone/session/test/source']);
});
