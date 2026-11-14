import test from 'node:test';
import assert from 'node:assert/strict';
import {exactOwnReelCaption,visibleNativeNodes} from '../src/publishing/native-xml.js';
const xml='<XCUIElementTypeOther visible="true" label="Reel by antoniorevenue."/><XCUIElementTypeStaticText visible="true" label="A &quot;real&quot; caption &amp; more&#10;Second line"/>';
test('receipt requires the exact full caption and the intended account',()=>{
 assert.equal(exactOwnReelCaption(xml,'A "real" caption & more\nSecond line','@antoniorevenue'),true);
 assert.equal(exactOwnReelCaption(xml,'A "real" caption','antoniorevenue'),false);
 assert.equal(exactOwnReelCaption(xml,'A "real" caption & more\nSecond line','other'),false);
 assert.equal(exactOwnReelCaption(xml.replace('visible="true" label="A','visible="false" label="A'),'A "real" caption & more\nSecond line','antoniorevenue'),false);
});
test('encoded markup remains label text, never an extra visible node',()=>{
 assert.equal(visibleNativeNodes('<XCUIElementTypeOther visible="true" label="&lt;XCUIElementTypeOther visible=&quot;true&quot; /&gt;"/>').length,1);
});
