import {countWords} from './words.js';
// Device-local checkout and access records. A live payment processor will need
// server-verified entitlements; these records never handle payment credentials.
export const PLANS = Object.freeze({
 monthly: {id:'monthly',label:'Monthly',amount:799,price:'$7.99',interval:'month'},
 annual: {id:'annual',label:'Annual',amount:5999,price:'$59.99',interval:'year'}
});
const identity = uid => uid ? 'user.' + encodeURIComponent(uid) : 'guest';
// Keep the original storage key so previously granted access remains available.
export const membershipKey = uid => 'folio.demo-membership.v1.' + identity(uid);
export const ownershipKey = uid => 'folio.ownership.v1.' + identity(uid);
export function bookPrice(book){
 const amount=Number.isSafeInteger(book?.priceCents)&&book.priceCents>=0&&book.priceCents<=9999999?book.priceCents:499;
 return {amount,price:new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(amount/100),currency:'USD'};
}
// Chapter One's words, counted as the reader counts them.
export function previewLimit(book){
 for(const chapter of book?.chapters || []){
  const count=(chapter.paragraphs || []).reduce((total,paragraph)=>total+countWords(paragraph),0);
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
const validBookId = value => typeof value==='string'&&value.trim().length>0&&value.length<=200;
const validTime = value => Number.isSafeInteger(value)&&value>=0&&value<=4102444800000;
const cancelled = () => new DOMException('Checkout cancelled.','AbortError');
const requireActive = signal => {if(signal?.aborted)throw cancelled();};
const receiptId = () => 'FOLIO-'+(globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const unavailable = () => Object.assign(new Error('Payment processor cannot be reached.'),{code:'payment/unavailable'});
function pause(ms,signal){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(cancelled());return;}
  const abort=()=>{clearTimeout(timer);reject(cancelled());};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},Math.max(0,ms));
  signal?.addEventListener('abort',abort,{once:true});
 });
}
// No payment provider is configured for this site, so the gateway connection times out.
export const unreachableProcessor = ({timeout=3200}={}) => async({signal}={}) => {await pause(timeout,signal);throw unavailable();};

export function createMembershipService({storage,now=Date.now,delay=900,processor=unreachableProcessor()}={}){
 const storageApi=()=>storage || globalThis.localStorage;
 function read(uid){
  try{
   const value=JSON.parse(storageApi().getItem(membershipKey(uid)) || 'null');
   if((value?.version!==1&&value?.demo!==true) || !Object.hasOwn(PLANS,value.planId) || !validTime(value.startedAt) || !validTime(value.expiresAt) || value.expiresAt<=value.startedAt || typeof value.receiptId!=='string' || typeof value.renew!=='boolean')return null;
   const {demo,active,...record}=value;
   return {...record,version:1,active:value.expiresAt>now()};
  }catch{return null;}
 }
 function write(key,value){
  try{storageApi().setItem(key,JSON.stringify(value));}
  catch{throw new Error('We couldn’t save your access on this device. Please try again.');}
 }
 function save(uid,value){
  const {active,demo,...record}=value;write(membershipKey(uid),{...record,version:1});return read(uid);
 }
 function readOwned(uid){
  try{
   const value=JSON.parse(storageApi().getItem(ownershipKey(uid)) || 'null');
   if(value?.version!==1||!Array.isArray(value.books))return [];
   const unique=new Map();
   for(const item of value.books){
    if(!validBookId(item?.bookId)||!validTime(item.acquiredAt)||!['purchase','shared'].includes(item.source))continue;
    if(item.source==='purchase'&&(!Number.isSafeInteger(item.amountCents)||item.amountCents<0||item.amountCents>9999999||typeof item.receiptId!=='string'||!item.receiptId))continue;
    const record={bookId:item.bookId,source:item.source,acquiredAt:item.acquiredAt};
    if(item.source==='purchase')Object.assign(record,{amountCents:item.amountCents,receiptId:item.receiptId});
    else if(typeof item.shareId==='string'&&item.shareId.length<=200)record.shareId=item.shareId;
    // A valid purchase remains a purchase when the same book is also shared.
    if(!unique.has(record.bookId)||record.source==='purchase')unique.set(record.bookId,record);
   }
   return [...unique.values()];
  }catch{return [];}
 }
 const ownsBook = (uid,bookId) => validBookId(bookId)&&readOwned(uid).some(record=>record.bookId===bookId);
 function saveOwned(uid,record){
  const books=readOwned(uid),existing=books.find(item=>item.bookId===record.bookId);
  if(existing)return existing;
  write(ownershipKey(uid),{version:1,books:[...books,record]});return record;
 }
 async function authorize(request,signal){
  requireActive(signal);
  await pause(delay,signal);
  requireActive(signal);
  let result;
  try{
   result=await new Promise((resolve,reject)=>{
    const settle=(callback,value)=>{signal?.removeEventListener('abort',abort);callback(value);};
    const abort=()=>settle(reject,cancelled());
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return;}
    Promise.resolve().then(()=>{requireActive(signal);return processor({...request,signal});})
     .then(value=>settle(resolve,value),error=>settle(reject,error));
   });
  }
  catch(error){
   if(signal?.aborted||error?.name==='AbortError')throw cancelled();
   if(error?.code==='payment/unavailable')throw unavailable();
   throw Object.assign(new Error('We couldn’t complete checkout. Please try again.'),{code:'payment/failed'});
  }
  requireActive(signal);
  if(result?.approved!==true)throw Object.assign(new Error('Your payment wasn’t approved. Please try again.'),{code:'payment/declined'});
 }
 async function checkout({uid,planId,signal}={}){
  if(!Object.hasOwn(PLANS,planId))throw new Error('Choose a subscription plan.');
  await authorize({type:'subscription',uid,planId,amount:PLANS[planId].amount,currency:'USD'},signal);
  const startedAt=now();
  return save(uid,{version:1,planId,startedAt,expiresAt:periodEnd(startedAt,planId),renew:true,receiptId:receiptId()});
 }
 async function purchaseBook({uid,book,signal}={}){
  requireActive(signal);
  if(!validBookId(book?.id))throw new Error('Choose a book to continue.');
  const bookId=book.id,existing=readOwned(uid).find(item=>item.bookId===bookId);if(existing)return existing;
  const price=bookPrice(book);
  await authorize({type:'purchase',uid,bookId,amount:price.amount,currency:price.currency},signal);
  return saveOwned(uid,{bookId,source:'purchase',acquiredAt:now(),amountCents:price.amount,receiptId:receiptId()});
 }
 function grantSharedBook(uid,bookId,{shareId}={}){
  if(!validBookId(bookId))throw new Error('This book isn’t available.');
  const record={bookId,source:'shared',acquiredAt:now()};
  if(typeof shareId==='string'&&shareId.length<=200)record.shareId=shareId;
  return saveOwned(uid,record);
 }
 function setRenewal(uid,renew){
  const record=read(uid);if(!record?.active)throw new Error('There is no active subscription to manage.');
  return save(uid,{...record,renew:Boolean(renew)});
 }
 return {read,checkout,setRenewal,readOwned,ownsBook,purchaseBook,grantSharedBook};
}
