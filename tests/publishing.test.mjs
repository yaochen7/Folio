import test from 'node:test';
import assert from 'node:assert/strict';
import {parseManuscript,decoratePublication,publicationCacheKey,shareUrl} from '../js/publishing.js';

test('manuscript headings preserve chapter order and paragraph boundaries',()=>{
 assert.deepEqual(parseManuscript('# A beginning\r\n\r\nOne paragraph.\r\nStill the same.\r\n\r\nAnother.\r\n\r\n## The ending\r\n\r\nLast words.'),[{title:'A beginning',paragraphs:['One paragraph.\nStill the same.','Another.']},{title:'The ending',paragraphs:['Last words.']}]);
 assert.deepEqual(parseManuscript('A story without a heading.'),[{title:'Chapter One',paragraphs:['A story without a heading.']}]);
});
test('empty, oversized and excessive chapters fail before publishing',()=>{
 assert.throws(()=>parseManuscript('# Empty'),/beneath/);
 assert.throws(()=>parseManuscript(''),/manuscript/);
 assert.throws(()=>parseManuscript('x'.repeat(20001)),/paragraphs/);
 assert.throws(()=>parseManuscript(Array.from({length:51},(_,i)=>`# Chapter ${i}\n\nText.`).join('\n\n')),/50 chapters/);
 assert.throws(()=>parseManuscript(Array.from({length:12},()=> '界'.repeat(15000)).join('\n\n')),/450 KB/);
});
test('cached cover titles cannot inject HTML and account namespaces are distinct',()=>{
 const book=decoratePublication({id:'b-12345678-1234-4123-8123-123456789012',title:'<img src=x onerror=alert(1)>',author:'Someone',cover:'<script>bad()</script>',kind:'unknown',chapters:[{title:'One',paragraphs:['Words.']}]});
 assert.equal(book.cover,'&lt;img src=x onerror=alert(1)&gt;');assert.equal(book.kind,'shape');
 assert.equal(decoratePublication({...book,chapters:[]}),null);
 assert.notEqual(publicationCacheKey(null),publicationCacheKey('guest'));
 assert.notEqual(publicationCacheKey('reader-a'),publicationCacheKey('reader-b'));
});
test('sharing uses the hosting origin and hash capability route',()=>{
 const previous=globalThis.location;globalThis.location={href:'https://folio.example/#publish'};
 try{assert.equal(shareUrl({id:'b-123',shareToken:'abc'}),'https://folio.example/#shared/b-123/abc');assert.equal(shareUrl({id:'b-123'}),'');}finally{globalThis.location=previous;}
});
