import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import{ownReelViewer,exactOwnReelCaption,visibleNativeNodes}from'../src/publishing/native-xml.js';
test('recorded Instagram Trial viewer accepts the new owner label with Trial proof',async()=>{
 const xml=await readFile('docs/evidence/prompt-instagram-2026-10-06/trial-viewer.xml','utf8');
 assert.equal(ownReelViewer(xml,'antoniorevenue'),true);
 assert.equal(ownReelViewer(xml,'anotheraccount'),false);
 assert.equal(ownReelViewer(xml.replaceAll('Trial insights','Other insights'),'antoniorevenue'),false);
 assert.equal(ownReelViewer(xml.replaceAll('comment-button','missing-control'),'antoniorevenue'),false);
 const caption=visibleNativeNodes(xml).find(n=>n.label.startsWith('Comment CHATCUT'))!.label;
 assert.equal(exactOwnReelCaption(xml,caption,'antoniorevenue'),true);
 assert.equal(exactOwnReelCaption(xml,'Comment PROMPT','antoniorevenue'),false);
});
