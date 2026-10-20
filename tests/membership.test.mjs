import test from 'node:test';
import assert from 'node:assert/strict';
import {createMembershipService,membershipKey,previewLimit,PLANS} from '../js/membership.js';
function harness(time=Date.UTC(2026,0,31)){
 const data=new Map();let clock=time;
 const service=createMembershipService({storage:{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)},now:()=>clock,delay:1});
 return {service,data,advance:ms=>clock+=ms};
}
test('a preview includes exactly Chapter One words',()=>{
 assert.equal(previewLimit({chapters:[{paragraphs:['One two.',' Three\n four ']},{paragraphs:['Not free.']}]}),4);
 assert.equal(previewLimit(null),0);
});
test('approval persists a demo receipt and clamps the next monthly date',async()=>{
 const {service,data}=harness();const record=await service.checkout({uid:'reader-a',planId:'monthly'});
 assert.equal(record.active,true);assert.equal(record.demo,true);assert.equal(record.expiresAt,Date.UTC(2026,1,28));
 assert.match(record.receiptId,/^FOLIO-DEMO-/);assert.equal(data.size,1);assert.equal(PLANS.monthly.amount,799);assert.equal(PLANS.annual.amount,5999);
 assert.equal(service.read('reader-b'),null);assert.equal(service.read(),null);
 assert.notEqual(membershipKey(),membershipKey('guest'),'an account named guest is still isolated');
});
test('a declined payment never grants or replaces existing access',async()=>{
 const {service,data}=harness();await assert.rejects(service.checkout({planId:'annual',outcome:'declined'}),{code:'payment/declined'});assert.equal(data.size,0);
 const active=await service.checkout({planId:'monthly'});
 await assert.rejects(service.checkout({planId:'annual',outcome:'declined'}),{code:'payment/declined'});
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
test('malformed records and unknown plans never enable the demo',async()=>{
 const {service,data}=harness();for(const value of ['broken','{}',JSON.stringify({demo:true,planId:'constructor'})]){data.set(membershipKey('a'),value);assert.equal(service.read('a'),null);}
 await assert.rejects(service.checkout({planId:'constructor'}),/Choose/);await assert.rejects(service.checkout({planId:'monthly',outcome:'other'}),/Choose/);
});
test('a blocked storage write fails checkout instead of pretending to activate access',async()=>{
 const service=createMembershipService({storage:{getItem:()=>null,setItem:()=>{throw Error('blocked')}},delay:1});
 await assert.rejects(service.checkout({planId:'monthly'}),/couldn’t save/);assert.equal(service.read(),null);
});
