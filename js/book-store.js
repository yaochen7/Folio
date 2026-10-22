/** Book text and manuscript drafts on this device. IndexedDB when the browser allows it, otherwise memory for this visit. */
const NAME='folio-books',VERSION=1,CONTENT='content',DRAFTS='drafts',MEMORY_BOOKS=4;
const validContent=value=>Boolean(value&&Number.isSafeInteger(value.revision)&&value.revision>=0&&value.book&&typeof value.book==='object');

export function createBookStore({indexedDB:factory,timeout=2000,now=Date.now}={}){
 // Memory holds only writes that never reached IndexedDB, so it is always the newer copy.
 const memory={[CONTENT]:new Map(),[DRAFTS]:new Map()};
 let database=null;
 function open(){
  return database||=new Promise(resolve=>{
   let settled=false,request;
   // A browser that refuses or stalls IndexedDB keeps memory for the rest of this visit.
   const finish=db=>{if(settled){db?.close();return;}settled=true;clearTimeout(timer);resolve(db);};
   const timer=setTimeout(()=>finish(null),timeout);
   // Reading globalThis.indexedDB itself can throw where storage is blocked.
   try{request=(factory||globalThis.indexedDB).open(NAME,VERSION);}catch{finish(null);return;}
   request.onupgradeneeded=()=>{const db=request.result;for(const name of [CONTENT,DRAFTS])if(!db.objectStoreNames.contains(name))db.createObjectStore(name);};
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();database=null;};db.onclose=()=>{database=null;};finish(db);};
   request.onerror=()=>finish(null);
  });
 }
 async function run(name,mode,operation,{commit=mode==='readwrite'}={}){
  const db=await open();if(!db)return {ok:false};
  return new Promise(resolve=>{
   let transaction,value;
   // Committing at once gives a write made while the page is hiding its best chance to land.
   try{transaction=db.transaction(name,mode);const request=operation(transaction.objectStore(name));if(request)request.onsuccess=()=>{value=request.result;};if(commit)transaction.commit?.();}
   catch(error){resolve({ok:false,error});return;}
   transaction.oncomplete=()=>resolve({ok:true,value});
   transaction.onabort=()=>resolve({ok:false,error:transaction.error});
  });
 }
 function keep(name,key,value){
  const values=memory[name];values.delete(key);values.set(key,value);
  if(name===CONTENT&&values.size>MEMORY_BOOKS)values.delete(values.keys().next().value);
 }
 async function read(name,key){
  if(memory[name].has(key))return memory[name].get(key);
  const result=await run(name,'readonly',store=>store.get(key));
  return result.ok?result.value??null:null;
 }
 // Resolves true only when the value is kept on this device; false leaves it in memory for this visit.
 async function write(name,key,value){
  let result=await run(name,'readwrite',store=>store.put(value,key));
  // Cached books can be downloaded again and drafts cannot, so a full device makes room by forgetting books.
  if(!result.ok&&result.error?.name==='QuotaExceededError'){
   if(name===CONTENT)result=await run(name,'readwrite',store=>{store.clear();return store.put(value,key);});
   else if((await run(CONTENT,'readwrite',store=>store.clear())).ok)result=await run(name,'readwrite',store=>store.put(value,key));
  }
  if(result.ok){memory[name].delete(key);return true;}
  keep(name,key,value);return false;
 }
 async function remove(name,key){memory[name].delete(key);return (await run(name,'readwrite',store=>store.delete(key))).ok;}
 // Read, compare and delete in one transaction, so a draft another tab saved in between is kept.
 async function removeIf(name,key,keep){
  if(memory[name].has(key)){if(keep(memory[name].get(key)))return false;memory[name].delete(key);}
  let removed=false;
  const result=await run(name,'readwrite',store=>{const request=store.get(key);request.onsuccess=()=>{if(request.result!==undefined&&!keep(request.result)){store.delete(key);removed=true;}};},{commit:false});
  return result.ok&&removed;
 }
 return {
  async getContent(bookId){const value=await read(CONTENT,bookId);return validContent(value)&&value.bookId===bookId?{revision:value.revision,book:value.book}:null;},
  putContent(bookId,{revision,book}={}){
   const value={bookId,revision,book,savedAt:now()};
   return validContent(value)&&typeof bookId==='string'?write(CONTENT,bookId,value):Promise.resolve(false);
  },
  async getDraft(key){const value=await read(DRAFTS,key);return value&&typeof value==='object'?value:null;},
  putDraft:(key,draft)=>draft&&typeof draft==='object'?write(DRAFTS,key,draft):Promise.resolve(false),
  deleteDraft:key=>remove(DRAFTS,key),
  /** Deletes the draft only while `matches(draft)` holds for what is stored now. Resolves true when it was deleted. */
  deleteDraftIf:(key,matches)=>removeIf(DRAFTS,key,value=>!(value&&typeof value==='object'&&matches(value)))
 };
}
