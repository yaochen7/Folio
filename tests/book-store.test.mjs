import test from 'node:test';
import assert from 'node:assert/strict';
import {createBookStore} from '../js/book-store.js';

// A small asynchronous IndexedDB stand-in: stores survive across store instances like a reload,
// writes are cloned, and a transaction over the byte quota aborts with QuotaExceededError.
function fakeIndexedDB({quota=Infinity,refuse=false,stall=false}={}){
 const stores=new Map(),log={opened:0,transactions:0};
 function transaction(name){
  log.transactions++;
  const store=stores.get(name);if(!store)throw new DOMException('No such store.','NotFoundError');
  const staged=new Map(store),requests=[],tx={error:null};
  const request=apply=>{const value={apply};requests.push(value);return value;};
  const objectStore={get:key=>request(()=>structuredClone(staged.get(key))),put:(value,key)=>request(()=>{staged.set(key,structuredClone(value));return key;}),delete:key=>request(()=>{staged.delete(key);}),clear:()=>request(()=>{staged.clear();})};
  tx.objectStore=()=>objectStore;
  setTimeout(()=>{
   // Like IndexedDB, a success callback may place further requests in the same transaction.
   for(let index=0;index<requests.length;index++){const item=requests[index];item.result=item.apply();item.onsuccess?.();}
   const others=[...stores].filter(([key])=>key!==name).reduce((total,[,values])=>total+[...values.values()].reduce((sum,value)=>sum+JSON.stringify(value).length,0),0);
   const size=others+[...staged.values()].reduce((sum,value)=>sum+JSON.stringify(value).length,0);
   if(size>quota){tx.error=new DOMException('The quota has been exceeded.','QuotaExceededError');tx.onabort?.();return;}
   stores.set(name,staged);
   tx.oncomplete?.();
  });
  return tx;
 }
 return {log,stores,open(){
  if(refuse)throw new DOMException('IndexedDB is disabled.','InvalidStateError');
  log.opened++;const request={};
  if(!stall)setTimeout(()=>{
   const db={objectStoreNames:{contains:name=>stores.has(name)},createObjectStore:name=>stores.set(name,new Map()),transaction,close(){}};
   request.result=db;if(!stores.size)request.onupgradeneeded?.();request.onsuccess?.();
  });
  return request;
 }};
}
const edition=(revision,text='Words.')=>({revision,book:{id:'b-1',title:'A book',revision,chapters:[{title:'One',paragraphs:[text]}]}});

test('book text and drafts survive a reload when IndexedDB is available',async()=>{
 const indexedDB=fakeIndexedDB(),first=createBookStore({indexedDB});
 assert.equal(await first.getContent('b-1'),null);
 assert.equal(await first.putContent('b-1',edition(2)),true);
 assert.equal(await first.putDraft('user.a',{title:'Draft',manuscript:'# One\n\nText.'}),true);
 const second=createBookStore({indexedDB});
 assert.deepEqual(await second.getContent('b-1'),edition(2));
 assert.deepEqual(await second.getDraft('user.a'),{title:'Draft',manuscript:'# One\n\nText.'});
 assert.equal(await second.getDraft('guest'),null,'drafts are kept per key');
 assert.equal(await second.putContent('b-1',edition(3,'New words.')),true);
 assert.equal((await createBookStore({indexedDB}).getContent('b-1')).revision,3,'a newer edition replaces the cached copy');
 assert.equal(await second.deleteDraft('user.a'),true);assert.equal(await createBookStore({indexedDB}).getDraft('user.a'),null);
 assert.equal(indexedDB.log.opened,4,'each store opens the database once');
});

test('without IndexedDB the store keeps values for this visit only and reports they are not saved',async()=>{
 for(const indexedDB of [undefined,fakeIndexedDB({refuse:true}),fakeIndexedDB({stall:true})]){
  const store=createBookStore({indexedDB,timeout:20});
  assert.equal(await store.putContent('b-1',edition(1)),false);
  assert.deepEqual(await store.getContent('b-1'),edition(1));
  assert.equal(await store.putDraft('guest',{manuscript:'Text.'}),false);
  assert.deepEqual(await store.getDraft('guest'),{manuscript:'Text.'});
  assert.equal(await createBookStore({indexedDB,timeout:20}).getDraft('guest'),null,'nothing outlives the visit');
 }
});

test('a full device forgets other cached books, never drafts, and never throws',async()=>{
 const indexedDB=fakeIndexedDB({quota:900}),store=createBookStore({indexedDB});
 assert.equal(await store.putDraft('user.a',{manuscript:'x'.repeat(200)}),true);
 assert.equal(await store.putContent('b-1',edition(1,'a'.repeat(200))),true);
 assert.equal(await store.putContent('b-2',{revision:1,book:{id:'b-2',chapters:[{title:'Two',paragraphs:['b'.repeat(300)]}]}}),true,'older cached books make room');
 assert.equal(await createBookStore({indexedDB}).getContent('b-1'),null);
 assert.equal((await createBookStore({indexedDB}).getDraft('user.a')).manuscript.length,200,'drafts are never evicted for cached books');
 assert.equal(await store.putContent('b-3',edition(1,'c'.repeat(2000))),false,'a book that cannot fit reports false');
 assert.equal((await store.getContent('b-3')).revision,1,'it stays readable for this visit');
 assert.equal(await store.putDraft('user.a',{manuscript:'y'.repeat(2000)}),false);
 assert.equal((await store.getDraft('user.a')).manuscript[0],'y','the newer unsaved draft wins over the stored one');
 assert.equal((await createBookStore({indexedDB}).getDraft('user.a')).manuscript[0],'x','the last saved draft is untouched');
 assert.equal(await store.putDraft('user.a',{manuscript:'z'}),true);
 assert.equal((await store.getDraft('user.a')).manuscript,'z','a later save replaces the unsaved copy');
});

test('a full device forgets cached books to keep a draft, which cannot be downloaded again',async()=>{
 const indexedDB=fakeIndexedDB({quota:900}),store=createBookStore({indexedDB});
 assert.equal(await store.putContent('b-1',edition(1,'a'.repeat(500))),true);
 assert.equal(await store.putDraft('user.a',{manuscript:'x'.repeat(500)}),true,'the draft makes room');
 assert.equal((await createBookStore({indexedDB}).getDraft('user.a')).manuscript.length,500,'it is kept on this device');
 assert.equal(await createBookStore({indexedDB}).getContent('b-1'),null,'the cached book was forgotten');
 assert.equal(await store.putDraft('user.a',{manuscript:'y'.repeat(2000)}),false,'a draft that cannot fit at all still reports false');
 assert.equal((await store.getDraft('user.a')).manuscript[0],'y');
});

test('a draft is deleted only while it still holds what the caller expects',async()=>{
 const indexedDB=fakeIndexedDB(),store=createBookStore({indexedDB});
 await store.putDraft('user.a',{title:'Another tab',manuscript:'Theirs.'});
 assert.equal(await store.deleteDraftIf('user.a',draft=>draft.title==='This tab'),false);
 assert.equal((await createBookStore({indexedDB}).getDraft('user.a')).title,'Another tab','a draft saved elsewhere is kept');
 assert.equal(await store.deleteDraftIf('user.a',draft=>draft.title==='Another tab'),true);
 assert.equal(await createBookStore({indexedDB}).getDraft('user.a'),null);
 assert.equal(await store.deleteDraftIf('user.a',()=>true),false,'nothing to delete');
 const memoryOnly=createBookStore({indexedDB:undefined});await memoryOnly.putDraft('guest',{title:'Kept'});
 assert.equal(await memoryOnly.deleteDraftIf('guest',draft=>draft.title==='Other'),false);assert.equal((await memoryOnly.getDraft('guest')).title,'Kept');
 assert.equal(await memoryOnly.deleteDraftIf('guest',draft=>draft.title==='Kept'),false,'only memory held it, so nothing was stored');assert.equal(await memoryOnly.getDraft('guest'),null);
});

test('malformed records and inputs are refused',async()=>{
 const indexedDB=fakeIndexedDB(),store=createBookStore({indexedDB});
 assert.equal(await store.getDraft('guest'),null);
 assert.equal(await store.putContent('b-1',{revision:-1,book:{}}),false);
 assert.equal(await store.putContent('b-1',{revision:1.5,book:{}}),false);
 assert.equal(await store.putContent('b-1',{revision:1}),false);
 assert.equal(await store.putDraft('guest',null),false);
 indexedDB.stores.get('content').set('b-9',{bookId:'b-8',revision:1,book:{}});
 indexedDB.stores.get('content').set('b-7','corrupt');
 assert.equal(await store.getContent('b-9'),null,'a record filed under another book is ignored');
 assert.equal(await store.getContent('b-7'),null);
});
