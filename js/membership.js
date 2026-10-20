// A device-local payment simulator. This is deliberately separate from Firebase
// identity and from the server-verified entitlements a live processor will need.
export const PLANS = Object.freeze({
 monthly: {id:'monthly',label:'Monthly',amount:799,price:'$7.99',interval:'month'},
 annual: {id:'annual',label:'Annual',amount:5999,price:'$59.99',interval:'year'}
});
export const membershipKey = uid => 'folio.demo-membership.v1.' + (uid ? 'user.' + encodeURIComponent(uid) : 'guest');
export function previewLimit(book){
 for(const chapter of book?.chapters || []){
  const count=(chapter.paragraphs || []).join(' ').trim().split(/\s+/u).filter(Boolean).length;
  if(count)return count;
 }
 return 0;
}
function periodEnd(start,planId){
 const date=new Date(start),day=date.getUTCDate();date.setUTCDate(1);
 if(planId==='annual')date.setUTCFullYear(date.getUTCFullYear()+1);else date.setUTCMonth(date.getUTCMonth()+1);
 const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
 date.setUTCDate(Math.min(day,last));return date.getTime();
}
export function createMembershipService({storage,now=Date.now,delay=900}={}){
 const storageApi=()=>storage || globalThis.localStorage;
 function read(uid){
  try{
   const value=JSON.parse(storageApi().getItem(membershipKey(uid)) || 'null');
   if(value?.demo!==true || !Object.hasOwn(PLANS,value.planId) || !Number.isSafeInteger(value.startedAt) || value.startedAt<0 || !Number.isSafeInteger(value.expiresAt) || value.expiresAt>4102444800000 || value.expiresAt<=value.startedAt || typeof value.receiptId!=='string' || typeof value.renew!=='boolean')return null;
   return {...value,active:value.expiresAt>now()};
  }catch{return null;}
 }
 function save(uid,value){
  const {active,...record}=value;
  try{storageApi().setItem(membershipKey(uid),JSON.stringify(record));}
  catch{throw new Error('We couldn’t save your demo access on this device. Please try again.');}
  return read(uid);
 }
 async function checkout({uid,planId,outcome='approved',signal}={}){
  if(!Object.hasOwn(PLANS,planId))throw new Error('Choose a subscription plan.');
  if(!['approved','declined'].includes(outcome))throw new Error('Choose a demo payment result.');
  await new Promise((resolve,reject)=>{
   if(signal?.aborted){reject(new DOMException('Checkout cancelled.','AbortError'));return;}
   const abort=()=>{clearTimeout(timer);reject(new DOMException('Checkout cancelled.','AbortError'));};
   const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},delay);
   signal?.addEventListener('abort',abort,{once:true});
  });
  if(signal?.aborted)throw new DOMException('Checkout cancelled.','AbortError');
  if(outcome==='declined')throw Object.assign(new Error('The demo payment was declined. Choose Approved to try again. You haven’t been charged.'),{code:'payment/declined'});
  const startedAt=now();
  return save(uid,{demo:true,planId,startedAt,expiresAt:periodEnd(startedAt,planId),renew:true,receiptId:'FOLIO-DEMO-'+(globalThis.crypto?.randomUUID?.() || `${startedAt}-${Math.random().toString(36).slice(2)}`)});
 }
 function setRenewal(uid,renew){
  const record=read(uid);if(!record?.active)throw new Error('There is no active demo subscription to manage.');
  return save(uid,{...record,renew:Boolean(renew)});
 }
 return {read,checkout,setRenewal};
}
