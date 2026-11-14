import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOwnedSourceAnchor} from '../src/publishing/mirroring-owned-reel.js';
const source={id:'source',status:'needs_review',input:{deviceUdid:'phone',caption:'The exact existing source caption',targets:[{platform:'instagram',account:'antoniorevenue'}]}};
const anchor={id:'anchor',status:'published',input:{deviceUdid:'phone',targets:[{platform:'instagram',account:'antoniorevenue'}],instagramRelatedReel:{url:'https://www.instagram.com/reel/owned/',label:'Owned source',caption:source.input.caption}},results:{release:{receipts:{instagram:{verified:true,source:'instagram_app'}}}}};
test('an observed source reference preserves the old review status and does not invent a Share claim',()=>{
    const before=JSON.stringify({source,anchor});assert.deepEqual(assertOwnedSourceAnchor(source,anchor),anchor.input.instagramRelatedReel);
    assert.equal(JSON.stringify({source,anchor}),before);
});
test('owned source observations require a verified native anchor and the exact linked caption',()=>{
    assert.throws(()=>assertOwnedSourceAnchor(source,{...anchor,status:'held'}),/verified Instagram post/);
    assert.throws(()=>assertOwnedSourceAnchor(source,{...anchor,results:{release:{receipts:{instagram:{verified:true,source:'queue'}}}}}),/verified Instagram post/);
    assert.throws(()=>assertOwnedSourceAnchor({...source,input:{...source.input,caption:'Other caption'}},anchor),/verified Instagram post/);
    assert.throws(()=>assertOwnedSourceAnchor({...source,input:{...source.input,deviceUdid:'another-phone'}},anchor),/verified Instagram post/);
    assert.throws(()=>assertOwnedSourceAnchor({...source,input:{...source.input,targets:[{platform:'instagram',account:'another_owner'}]}},anchor),/verified Instagram post/);
});
