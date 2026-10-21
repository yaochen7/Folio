import test from 'node:test';
import assert from 'node:assert/strict';
import {createMembershipService,membershipKey,ownershipKey,bookPrice,previewLimit,PLANS} from '../js/membership.js';
function harness(time=Date.UTC(2026,0,31),options={}){
 const data=new Map();let clock=time;
 const service=createMembershipService({storage:{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)},now:()=>clock,delay:1,...options});
 return {service,data,advance:ms=>clock+=ms};
}
test('a preview includes exactly Chapter One words',()=>{
 assert.equal(previewLimit({chapters:[{paragraphs:['One two.',' Three\n four ']},{paragraphs:['Not free.']}]}),4);
 assert.equal(previewLimit(null),0);
});
test('approval persists access and clamps the next monthly date',async()=>{
 const {service,data}=harness();const record=await service.checkout({uid:'reader-a',planId:'monthly'});
 assert.equal(record.active,true);assert.equal(record.version,1);assert.equal(record.demo,undefined);assert.equal(record.expiresAt,Date.UTC(2026,1,28));
 assert.match(record.receiptId,/^FOLIO-/);assert.equal(data.size,1);assert.equal(PLANS.monthly.amount,799);assert.equal(PLANS.annual.amount,5999);
 assert.equal(service.read('reader-b'),null);assert.equal(service.read(),null);
 assert.notEqual(membershipKey(),membershipKey('guest'),'an account named guest is still isolated');
});
test('a declined payment never grants or replaces existing access',async()=>{
 let approve=false;const {service,data}=harness(undefined,{processor:async()=>({approved:approve})});
 await assert.rejects(service.checkout({planId:'annual'}),{code:'payment/declined'});assert.equal(data.size,0);approve=true;
 const active=await service.checkout({planId:'monthly'});
 approve=false;await assert.rejects(service.checkout({planId:'annual'}),{code:'payment/declined'});
 assert.deepEqual(service.read(),active);
});
test('leaving checkout before approval never grants access',async()=>{
 const {service,data}=harness(),controller=new AbortController();
 const result=service.checkout({uid:'a',planId:'annual',signal:controller.signal});controller.abort();
 await assert.rejects(result,{name:'AbortError'});assert.equal(data.size,0);
 await assert.rejects(service.checkout({planId:'monthly',signal:controller.signal}),{name:'AbortError'});assert.equal(data.size,0);
});
test('cancelled renewal retains access until expiry, can resume, and does not affect another owner',async()=>{
 const {service,advance}=harness();const first=await service.checkout({uid:'a',planId:'annual'});
 await service.checkout({uid:'b',planId:'monthly'});
 const cancelled=service.setRenewal('a',false);assert.equal(cancelled.active,true);assert.equal(cancelled.renew,false);assert.equal(cancelled.expiresAt,first.expiresAt);
 assert.equal(service.read('b').renew,true);assert.equal(service.setRenewal('a',true).renew,true);
 advance(first.expiresAt-first.startedAt);assert.equal(service.read('a').active,false);assert.throws(()=>service.setRenewal('a',true),/no active/);
});
test('an annual period handles leap days',async()=>{
 const {service}=harness(Date.UTC(2028,1,29));const record=await service.checkout({planId:'annual'});assert.equal(record.expiresAt,Date.UTC(2029,1,28));
});
test('malformed records and unknown plans never enable access',async()=>{
 const {service,data}=harness();for(const value of ['broken','{}',JSON.stringify({demo:true,planId:'constructor'})]){data.set(membershipKey('a'),value);assert.equal(service.read('a'),null);}
 await assert.rejects(service.checkout({planId:'constructor'}),/Choose/);
});
test('a blocked storage write fails checkout instead of pretending to activate access',async()=>{
 const service=createMembershipService({storage:{getItem:()=>null,setItem:()=>{throw Error('blocked')}},delay:1});
 await assert.rejects(service.checkout({planId:'monthly'}),/couldn’t save/);assert.equal(service.read(),null);
});
test('previous subscriptions remain active and are upgraded when managed',()=>{
 const {service,data}=harness();
 data.set(membershipKey('a'),JSON.stringify({demo:true,planId:'monthly',startedAt:Date.UTC(2026,0,1),expiresAt:Date.UTC(2026,1,1),renew:true,receiptId:'FOLIO-DEMO-previous'}));
 assert.equal(service.read('a').active,true);assert.equal(service.read('a').demo,undefined);
 service.setRenewal('a',false);const saved=JSON.parse(data.get(membershipKey('a')));
 assert.equal(saved.version,1);assert.equal(saved.demo,undefined);assert.equal(saved.renew,false);
});
test('book prices use the published amount and a consistent catalog fallback',()=>{
 assert.deepEqual(bookPrice({priceCents:1250}),{amount:1250,price:'$12.50',currency:'USD'});
 assert.equal(bookPrice({priceCents:0}).amount,0);
 for(const priceCents of [-1,3.5,'299',NaN,99999999999,undefined])assert.equal(bookPrice({priceCents}).amount,499);
});
test('a book purchase persists independently of membership and never expires',async()=>{
 const requests=[],{service,advance,data}=harness(undefined,{processor:async request=>{requests.push(request);return {approved:true};}});
 const record=await service.purchaseBook({uid:'a',book:{id:'quiet',priceCents:699}});
 assert.equal(record.source,'purchase');assert.equal(record.amountCents,699);assert.equal(requests[0].amount,699);assert.equal(requests[0].bookId,'quiet');assert.equal(requests[0].type,'purchase');
 assert.equal(service.ownsBook('a','quiet'),true);assert.equal(service.ownsBook('a','atlas'),false);assert.equal(service.ownsBook('b','quiet'),false);assert.equal(service.ownsBook(null,'quiet'),false);
 assert.equal(service.read('a'),null);assert.equal(data.has(ownershipKey('a')),true);
 advance(10*365*24*60*60*1000);assert.equal(service.ownsBook('a','quiet'),true);
 assert.deepEqual(await service.purchaseBook({uid:'a',book:{id:'quiet',priceCents:1200}}),record);assert.equal(requests.length,1,'an owned book is not purchased a second time');
});
test('shared access is idempotent, survives reload, and stays with its recipient',async()=>{
 const {service,data}=harness(),first=service.grantSharedBook(null,'published-book',{shareId:'link-1'});
 assert.equal(first.source,'shared');assert.equal(first.shareId,'link-1');assert.equal(service.ownsBook(null,'published-book'),true);
 assert.deepEqual(service.grantSharedBook(null,'published-book',{shareId:'link-2'}),first);assert.equal(service.readOwned(null).length,1);
 assert.equal(service.ownsBook('guest','published-book'),false);assert.notEqual(ownershipKey(null),ownershipKey('guest'));
 const reloaded=createMembershipService({storage:{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)}});
 assert.equal(reloaded.ownsBook(null,'published-book'),true);assert.equal(reloaded.ownsBook('a','published-book'),false);
 reloaded.grantSharedBook('a','published-book',{shareId:'link-1'});assert.equal(reloaded.ownsBook('a','published-book'),true);
 const purchase=await service.purchaseBook({uid:'b',book:{id:'quiet'}});assert.deepEqual(service.grantSharedBook('b','quiet'),purchase,'sharing does not replace a purchase receipt');
});
test('failed or cancelled book checkout grants no ownership',async()=>{
 const {service,data}=harness(undefined,{processor:async()=>({approved:false})});
 await assert.rejects(service.purchaseBook({uid:'a',book:{id:'quiet'}}),{code:'payment/declined'});assert.equal(data.size,0);
 const controller=new AbortController(),pending=service.purchaseBook({uid:'a',book:{id:'quiet'},signal:controller.signal});controller.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(data.size,0);
 await assert.rejects(service.purchaseBook({uid:'a',book:{id:''}}),/Choose a book/);
 const blocked=createMembershipService({storage:{getItem:()=>null,setItem:()=>{throw Error('blocked')}},delay:1});
 await assert.rejects(blocked.purchaseBook({book:{id:'quiet'}}),/couldn’t save/);assert.equal(blocked.ownsBook(null,'quiet'),false);
 assert.throws(()=>blocked.grantSharedBook(null,'quiet'),/couldn’t save/);
});
test('cancellation during processor work cannot later save an entitlement',async()=>{
 let finish,started;
 const didStart=new Promise(resolve=>started=resolve),{service,data}=harness(undefined,{processor:()=>{started();return new Promise(resolve=>finish=resolve);}});
 const controller=new AbortController(),pending=service.purchaseBook({uid:'a',book:{id:'quiet'},signal:controller.signal});
 await didStart;controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(data.size,0);
 finish({approved:true});await Promise.resolve();await Promise.resolve();assert.equal(data.size,0);
});
test('processor failures use a neutral retry message and never change existing access',async()=>{
 let fail=false;const {service,data}=harness(undefined,{processor:async()=>{if(fail)throw new Error('internal processor details');return {approved:true};}});
 const first=await service.checkout({uid:'a',planId:'monthly'});fail=true;
 await assert.rejects(service.checkout({uid:'a',planId:'annual'}),{code:'payment/failed',message:'We couldn’t complete checkout. Please try again.'});
 assert.deepEqual(service.read('a'),first);
 await assert.rejects(service.purchaseBook({uid:'a',book:{id:'quiet'}}),{code:'payment/failed'});
 assert.equal(data.has(ownershipKey('a')),false);
});
test('corrupt ownership cannot unlock a book or cross into another identity',()=>{
 const {service,data}=harness();
 for(const value of ['broken','{}',JSON.stringify({version:1,books:[null,{bookId:'quiet',source:'purchase',acquiredAt:Date.now()},{bookId:'atlas',source:'shared',acquiredAt:-1}]})]){
  data.set(ownershipKey('a'),value);assert.deepEqual(service.readOwned('a'),[]);assert.equal(service.ownsBook('a','quiet'),false);
 }
 assert.throws(()=>service.grantSharedBook('a',''),/isn’t available/);
});
