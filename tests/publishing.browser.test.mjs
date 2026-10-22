import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';

const require=createRequire(import.meta.url),{chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.FOLIO_TEST_URL||'http://127.0.0.1:4173/';
const author={uid:'author-a',email:'author@example.test',displayName:'The Author'};
const recipient={uid:'reader-b',email:'reader@example.test',displayName:'Another Reader'};
const unrelated={uid:'reader-c',email:'unrelated@example.test',displayName:'A Third Reader'};
const ownedKey=uid=>'folio.ownership.v1.'+(uid?'user.'+encodeURIComponent(uid):'guest');
const escape=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const paragraph=Array.from({length:110},(_,index)=>`word${index}`).join(' ');
const manuscript=`# A door opens\n\n${paragraph}\n\nA quiet beginning.\n\n# Through the gate\n\n${paragraph}\n\n# The far shore\n\nThe final lighthouse belongs to everyone who arrived.\n\n${paragraph}`;
async function capture(page,name){if(!process.env.FOLIO_QA_SCREENSHOTS)return;await mkdir(process.env.FOLIO_QA_SCREENSHOTS,{recursive:true});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(process.env.FOLIO_QA_SCREENSHOTS,name+'.png')});}

// One backend is shared by genuinely separate browser contexts. This exercises
// cloud reads and claims across devices rather than copying localStorage.
// Like the service, every read except getBookContent returns a book's details without its chapters.
function backendFixture(){
 const books=new Map(),publications=new Map(),owned=new Map(),library=new Map(),progress=new Map(),calls=[],gates=new Map();
 function holdNext(action){let release,started;const wait=new Promise(resolve=>release=resolve),received=new Promise(resolve=>started=resolve);gates.set(action,{wait,started});return{release,received};}
 const holdNextPublication=()=>holdNext('publishBook');
 const bucket=(map,uid)=>{if(!map.has(uid))map.set(uid,new Map());return map.get(uid);};
 const fail=(message='This shared book is unavailable.',code='folio/share-not-found',status=404)=>{throw Object.assign(new Error(message),{status,code});};
 function lookup(id,token){const entry=books.get(id);if(!entry||entry.shareToken!==token)fail();return entry;}
 const details=entry=>{const {chapters,...meta}=entry.book;return meta;};
 function edition(uid,input,previous){
  assert.ok(Array.isArray(input.chapters)&&input.chapters.length,'the UI supplies parsed chapters');
  const chapters=input.chapters,wordCount=chapters.flatMap(chapter=>chapter.paragraphs).reduce((total,p)=>total+p.trim().split(/\s+/u).length,0),now=Date.now();
  return {id:previous?.id||'b-'+randomUUID(),title:input.title,author:input.author,description:input.description,category:input.category||'Fiction',genre:input.genre||input.category||'Fiction',kind:input.kind||'shape',kicker:'An original story',priceCents:input.priceCents??499,cover:escape(input.title),ownerUid:uid,source:'folio-publication',publishedAt:previous?.publishedAt||now,updatedAt:now,revision:(previous?.revision||0)+1,chapterCount:chapters.length,wordCount,pages:Math.max(1,Math.ceil(wordCount/250)),contentBytes:Buffer.byteLength(JSON.stringify(chapters)),chapters};
 }
 function dispatch({action,uid,args=[]}){
  calls.push({action,uid,args});
  if(action==='getCatalog')return[];
  if(action==='getSharedBook')return details(lookup(...args));
  if(action==='getBookContent')return lookup(...args).book;
  if(!uid)throw Object.assign(new Error('Sign in to continue.'),{status:403});
  if(action==='publishBook'){
   const book=edition(uid,args[0]),shareToken=randomBytes(32).toString('hex'),entry={book,shareToken};
   books.set(book.id,entry);bucket(publications,uid).set(book.id,entry);return entry;
  }
  if(action==='updateBook'){
   const [id,input,{expectedRevision}={}]=args,entry=bucket(publications,uid).get(id);if(!entry)fail();
   if(entry.book.revision!==expectedRevision)fail('This book was changed somewhere else. Reopen it to get the latest edition, then make your changes again.','folio/edit-conflict',409);
   entry.book=edition(uid,input,entry.book);return entry;
  }
  if(action==='watchPublications')return[...bucket(publications,uid).values()].map(entry=>({...details(entry),shareToken:entry.shareToken}));
  if(action==='watchOwnedBooks')return[...bucket(owned,uid).entries()].map(([id,acquiredAt])=>{const entry=books.get(id);return{...details(entry),shareToken:entry.shareToken,acquiredAt};});
  if(action==='getPublicationShare'){
   const entry=bucket(publications,uid).get(args[0]);if(!entry)fail();return{book:details(entry),shareToken:entry.shareToken};
  }
  if(action==='claimSharedBook'){
   const entry=lookup(...args);if(!bucket(owned,uid).has(entry.book.id))bucket(owned,uid).set(entry.book.id,Date.now());return{...details(entry),shareToken:entry.shareToken};
  }
  if(action==='watchLibrary')return[...bucket(library,uid).values()];
  if(action==='saveLibraryBook'){bucket(library,uid).set(args[0],{id:args[0],...args[1]});return null;}
  if(action==='removeLibraryBook'){bucket(library,uid).delete(args[0]);return null;}
  if(action==='watchReadingProgress')return Object.fromEntries(bucket(progress,uid));
  if(action==='saveReadingProgress'){bucket(progress,uid).set(args[0],args[1]);return null;}
  throw new Error('Unexpected Firebase fixture operation: '+action);
 }
 const adapter=`
  let user=window.__folioInitialUser||null,observers=new Set();
  const notify=next=>{user=next;for(const cb of observers)cb(user)};
  window.folioTestAuth=notify;
  const call=async(action,args=[],uid=user?.uid)=>{const response=await fetch('/__folio_fixture__',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,args,uid})});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error),{code:result.code||'folio/not-found'});return result.value;};
  const mine=uid=>{if(!user||uid!==user.uid)throw Error('Wrong account.');};
  const watch=(action,uid,cb)=>{mine(uid);let active=true;call(action,[],uid).then(items=>{if(active)cb(items)}).catch(error=>{if(active)cb(null,error)});return()=>{active=false}};
  export const initFirebase=async()=>({configured:true,user,googleSignInEnabled:false,emailSignUpEnabled:true});
  export const subscribeAuth=cb=>{observers.add(cb);queueMicrotask(()=>cb(user));return()=>observers.delete(cb)};
  export const mergeReadingProgress=(a,b)=>!a?b:!b?a:(a.updatedAt||0)>=(b.updatedAt||0)?a:b;
  export const getCatalog=()=>call('getCatalog');
  export const watchCatalog=cb=>{queueMicrotask(()=>cb([]));return()=>{}};
  export const watchLibrary=(uid,cb)=>watch('watchLibrary',uid,cb);
  export const watchReadingProgress=(uid,cb)=>watch('watchReadingProgress',uid,cb);
  export const watchPublications=(uid,cb)=>watch('watchPublications',uid,cb);
  export const watchOwnedBooks=(uid,cb)=>watch('watchOwnedBooks',uid,cb);
  export const saveLibraryBook=async(uid,...args)=>{mine(uid);return call('saveLibraryBook',args,uid)};
  export const removeLibraryBook=async(uid,...args)=>{mine(uid);return call('removeLibraryBook',args,uid)};
  export const saveReadingProgress=async(uid,...args)=>{mine(uid);return call('saveReadingProgress',args,uid)};
  export const publishBook=async(uid,...args)=>{mine(uid);return call('publishBook',args,uid)};
  export const updateBook=async(uid,...args)=>{mine(uid);return call('updateBook',args,uid)};
  export const getSharedBook=(...args)=>call('getSharedBook',args);
  export const getBookContent=(...args)=>call('getBookContent',args);
  export const getPublicationShare=async(uid,...args)=>{mine(uid);return call('getPublicationShare',args,uid)};
  export const claimSharedBook=async(uid,...args)=>{mine(uid);return call('claimSharedBook',args,uid)};
  export const signOut=async()=>notify(null);
  export const signIn=async email=>notify({uid:email,email,displayName:'Reader'});
  export const signUp=async(email,password,displayName)=>notify({uid:email,email,displayName});
  export const sendPasswordReset=async()=>{};
  export const signInWithGoogle=async()=>{};
 `;
 async function attach(context,identity){
  await context.addInitScript(identity=>{window.__folioInitialUser=identity},identity||null);
  await context.route('**/js/firebase-service.js',route=>route.fulfill({contentType:'text/javascript',body:adapter}));
  await context.route('**/__folio_fixture__',async route=>{
   try{const packet=route.request().postDataJSON(),gate=gates.get(packet.action);if(gate){gates.delete(packet.action);gate.started();await gate.wait;}await route.fulfill({json:{value:dispatch(packet)}})}
   catch(error){await route.fulfill({status:error.status||500,json:{error:error.message,code:error.code}})}
  });
 }
 return{attach,books,publications,owned,calls,holdNext,holdNextPublication};
}

// About 4.5 MB of chapters with quotes, CJK and emoji, over 300 chapters: far past the old 450 KB and 50-chapter limits.
function largeManuscript(){
 const paragraph=index=>`Paragraph ${index} carries “quotes”, a CJK phrase 界, and a wave 🌊 across a long line of prose that keeps going. `.repeat(4);
 return Array.from({length:330},(_,chapter)=>`# Chapter ${chapter+1}\n\n`+Array.from({length:30},(_,index)=>paragraph(index)).join('\n\n')).join('\n\n');
}
async function assertFullBook(page,book){
 await page.locator('.fr-book[aria-busy="false"]').waitFor();
 assert.equal(await page.locator('.fr-locked-chapter').count(),0,'all chapters are available to an owner');
 assert.equal(await page.locator('.fr-preview-continue').isVisible(),false,'an owned book never shows a preview gate');
 const words=book.chapters.flatMap(chapter=>chapter.paragraphs).join(' ').trim().split(/\s+/u).length;
 assert.equal(await page.locator('.fr-progress-range').getAttribute('max'),String(words-1));
 await page.keyboard.press('End');
 assert.equal(await page.locator('#membership-dialog').isVisible(),false,'the final page does not show a paywall');
 assert.doesNotMatch(await page.locator('.fr-page-count').innerText(),/Preview/);
}

test('published links convey one complete book across accounts and guest devices',async t=>{
 const useWebkit=process.env.FOLIO_BROWSER_ENGINE==='webkit',bundle=process.env.FOLIO_WEBKIT_BUNDLE;
 const browser=useWebkit?await webkit.launch({headless:true,...(bundle?{executablePath:bundle+'/bin/MiniBrowser',env:{...process.env,WEBKIT_EXEC_PATH:bundle+'/bin',WEBKIT_INJECTED_BUNDLE_PATH:bundle+'/lib',WEBKIT_INSPECTOR_RESOURCES_PATH:bundle+'/share'}}:{})}):await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const fixture=backendFixture(),contexts=[],errors=[];
 async function contextFor(identity,width=390){const context=await browser.newContext({viewport:{width,height:844},isMobile:width<900,hasTouch:width<900,reducedMotion:'reduce'});contexts.push(context);await fixture.attach(context,identity);const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));return{context,page};}
 let shareUrl,book;
 try{
  await t.test('only a signed-in author can publish and recover their sharing link',async()=>{
   const {page:guest}=await contextFor(null,320);await guest.goto(base+'#publish');
   await guest.getByRole('heading',{name:/publish|story/i}).first().waitFor();
   assert.equal(await guest.locator('#publish-form').count(),0,'guests cannot submit a publication');
   assert.equal(fixture.calls.filter(call=>call.action==='publishBook').length,0);
   const {page}=await contextFor(author);await page.goto(base+'#publish');await page.locator('#publish-form').waitFor();
   await page.locator('#publish-title').fill('The <Quiet> Ledger');
   await page.locator('#publish-author').fill('A. Writer');
   await page.locator('#publish-description').fill('A story shared freely with everyone who receives its link.');
   await page.locator('#publish-price').fill('4.99');
   await page.locator('#publish-text').fill(manuscript);
   await page.evaluate(()=>scrollTo(0,0));await capture(page,'publisher-390');
   await page.getByRole('button',{name:'Publish book',exact:true}).click();
   await page.locator('.publish-success').waitFor();shareUrl=await page.locator('#published-share-link').inputValue();
   await capture(page,'published-390');
   assert.match(shareUrl,/#shared\/b-[\w-]+\/[a-f0-9]{64}$/);
   const id=shareUrl.split('#shared/')[1].split('/')[0];book=fixture.books.get(id).book;
   assert.equal(book.ownerUid,author.uid);assert.equal(book.priceCents,499);assert.equal(book.chapters.length,3);assert.equal(book.revision,1);
   assert.equal(fixture.calls.filter(call=>call.action==='publishBook').length,1);
   assert.equal(await page.locator('.publish-success img').count(),0,'book text cannot inject markup');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.goto(base+'#account');
   const shareButton=page.locator(`#main-content .profile-publications [data-action="share-book"][data-book="${book.id}"]`);await shareButton.waitFor();
   assert.match(await page.locator('#main-content .profile-publications').textContent(),/The <Quiet> Ledger/);
   await shareButton.click();
   await page.locator('#share-dialog').waitFor({state:'visible'});
   assert.equal(await page.locator('#share-book-link').inputValue(),shareUrl);
   await capture(page,'share-link-390');
   await page.keyboard.press('Escape');await page.goto(base+'#read/'+book.id);await assertFullBook(page,book);
  });
  await t.test('a guest automatically owns the shared book and retains full reading after reload',async()=>{
   const {page}=await contextFor(null,390);await page.goto(shareUrl);
   await page.locator('.book-ownership-label').getByText('Owned',{exact:false}).waitFor();
   assert.equal(new URL(page.url()).hash,'#book/'+book.id);
   await capture(page,'guest-owned-390');
   assert.equal(await page.locator('[data-action="buy-book"]').count(),0);
   const owned=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),ownedKey());
   assert.equal(owned.books.filter(record=>record.bookId===book.id&&record.source==='shared').length,1);
   await page.goto(shareUrl);await page.locator('.book-ownership-label').waitFor();
   const reopened=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),ownedKey());
   assert.equal(reopened.books.filter(record=>record.bookId===book.id).length,1,'opening the same link twice creates one ownership record');
   await page.locator('.detail-copy [data-action="read"]').click();await assertFullBook(page,book);
   await page.reload();await assertFullBook(page,book);
   await page.locator('.fr-menu-toggle').click();await page.locator('.fr-search-toggle').click();
   await page.locator('.fr-book-search').fill('final lighthouse');
   assert.ok(await page.locator('.fr-search-results button').count()>0,'owned book search includes chapters beyond the free preview');
   await page.keyboard.press('Escape');
   await page.goto(base+'#library');await page.locator(`.library-book[data-book-id="${book.id}"]`).waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.goto(base+'#read/quiet');await page.locator('.fr-book[aria-busy="false"]').waitFor();
   assert.ok(await page.locator('.fr-locked-chapter').count()>0,'sharing one title does not grant Folio Plus');
  });
  await t.test('a signed-in recipient can recover owned content on a separate device',async()=>{
   const {page}=await contextFor(recipient);await page.goto(shareUrl);
   await page.locator('.book-ownership-label').getByText('Owned',{exact:false}).waitFor();
   assert.ok(fixture.owned.get(recipient.uid)?.has(book.id),'the recipient claim is stored in the cloud');
   await page.locator('.detail-copy [data-action="read"]').click();await assertFullBook(page,book);
   const {page:otherDevice}=await contextFor(recipient,1440);
   await otherDevice.goto(base+'#account');await otherDevice.waitForFunction(name=>document.querySelector('#profile-name')?.textContent===name,recipient.displayName);
   await otherDevice.goto(base+'#library');await otherDevice.locator(`.library-book[data-book-id="${book.id}"]`).waitFor();
   await otherDevice.locator(`.library-book[data-book-id="${book.id}"] [data-action="read"]`).first().click();await assertFullBook(otherDevice,book);
   await otherDevice.goto(base+'#book/'+book.id);await otherDevice.locator('.detail-copy [data-action="share-book"]').click();
   await otherDevice.locator('#share-dialog').waitFor({state:'visible'});
   await otherDevice.evaluate(identity=>window.folioTestAuth(identity),unrelated);
   await otherDevice.locator('#share-dialog').waitFor({state:'hidden'});
   assert.equal(await otherDevice.locator('#share-book-link').inputValue(),'','switching accounts clears the share capability from the modal');
   await otherDevice.goto(base+'#account');
   await otherDevice.waitForFunction(name=>document.querySelector('#profile-name')?.textContent===name,unrelated.displayName);
   await otherDevice.goto(base+'#library');await otherDevice.locator('.library-view').waitFor();
   assert.equal(await otherDevice.locator(`.library-book[data-book-id="${book.id}"]`).count(),0,'another account inherits no private book');
   const otherOwned=await otherDevice.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),ownedKey(unrelated.uid));
   assert.ok(!otherOwned?.books?.some(record=>record.bookId===book.id),'identity switching creates no entitlement');
  });
  await t.test('a guest keeps a shared book when signing in and can open it on another device',async()=>{
   const identity={uid:'guest-to-account',email:'formerly-guest@example.test',displayName:'A New Account'};
   const {page}=await contextFor(null);await page.goto(shareUrl);await page.locator('.book-ownership-label').waitFor();
   await page.goto(base+'#account');await page.locator('.profile-view').waitFor();
   await page.evaluate(identity=>window.folioTestAuth(identity),identity);
   await page.waitForFunction(({key,id})=>JSON.parse(localStorage.getItem(key)||'null')?.books?.some(book=>book.bookId===id),{key:ownedKey(identity.uid),id:book.id});
   assert.ok(fixture.owned.get(identity.uid)?.has(book.id),'the guest capability becomes a verified account claim');
   const {page:secondDevice}=await contextFor(identity,390);await secondDevice.goto(base+'#library');
   await secondDevice.locator(`.library-book[data-book-id="${book.id}"] [data-action="read"]`).first().click();
   await assertFullBook(secondDevice,book);
  });
  await t.test('a late publication response cannot revive a session after switching away and back',async()=>{
   const {page}=await contextFor(author);await page.goto(base+'#publish');await page.locator('#publish-form').waitFor();
   await page.locator('#publish-title').fill('An unfinished session');await page.locator('#publish-author').fill('The Author');
   await page.locator('#publish-description').fill('A delayed publication used to verify identity boundaries.');await page.locator('#publish-text').fill(manuscript);
   const gate=fixture.holdNextPublication();await page.getByRole('button',{name:'Publish book',exact:true}).click();await gate.received;
   await page.evaluate(identity=>window.folioTestAuth(identity),unrelated);await page.locator('#publish-form').waitFor();
   await page.evaluate(identity=>window.folioTestAuth(identity),author);await page.locator('#publish-form').waitFor();
   const completed=page.waitForResponse(response=>response.url().endsWith('/__folio_fixture__')&&response.request().postDataJSON()?.action==='publishBook');
   gate.release();await completed;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(await page.locator('.publish-success').count(),0,'a completed request from the old identity session cannot show a success screen');
   assert.ok(await page.locator('#publish-form').isVisible());
   assert.equal(await page.locator('#published-share-link').count(),0,'no stale share capability is rendered');
  });
  await t.test('a multi-megabyte manuscript stays editable, survives a reload, and publishes whole',async()=>{
   const {page}=await contextFor(author,1440);await page.goto(base+'#publish');await page.locator('#publish-form').waitFor();
   await page.locator('#publish-title').fill('A Very Long Voyage');await page.locator('#publish-author').fill('A. Writer');
   await page.locator('#publish-description').fill('Hundreds of chapters, far beyond the old limit.');
   const field=page.locator('#publish-text'),size=page.locator('#publish-size'),toast=page.locator('#folio-toast');
   assert.equal(await field.getAttribute('maxlength'),null,'no character limit can trap typing');
   assert.match(await page.locator('.publisher-manuscript').innerText(),/1,000 chapters and 5 MB/);
   await page.locator('#publish-file').setInputFiles({name:'too-large.txt',mimeType:'text/plain',buffer:Buffer.alloc(5_000_001,'a')});
   await toast.getByText('Choose a text file of 5 MB or less.').waitFor();
   assert.equal(await field.inputValue(),'','an oversized file changes nothing');
   const text=largeManuscript();
   await page.locator('#publish-file').setInputFiles({name:'voyage.txt',mimeType:'text/plain',buffer:Buffer.from(text)});
   await toast.getByText('Your manuscript is ready.',{exact:false}).waitFor();
   assert.equal((await field.inputValue()).length,text.length);
   assert.match(await size.textContent(),/^4\.\d MB of 5 MB$/);
   // The literal bug: after a large import, typed text was refused.
   await field.evaluate(element=>{element.focus();element.setSelectionRange(element.value.length,element.value.length);});
   await page.keyboard.type(' more');
   assert.ok((await field.inputValue()).endsWith(' more'),'typing continues after a multi-megabyte import');
   // The typing pause saves the draft; poll what IndexedDB holds before reloading.
   const storedDraft=()=>page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('folio-books');request.onerror=()=>resolve(-1);request.onsuccess=()=>{const db=request.result,get=db.transaction('drafts').objectStore('drafts').get('user.author-a');get.onsuccess=()=>{db.close();resolve(get.result?.manuscript?.length??0);};};}));
   for(const started=Date.now();await storedDraft()!==text.length+5;await page.waitForTimeout(100))assert.ok(Date.now()-started<10000,'the draft reaches IndexedDB after a pause in typing');
   assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('folio.publish-draft')).length),0);
   await page.reload();await page.locator('#publish-form').waitFor();
   assert.equal((await field.inputValue()).length,text.length+5,'the draft is kept on this device, not in localStorage');
   // Over the limit, the size says so and the form refuses to publish.
   const publishes=fixture.calls.filter(call=>call.action==='publishBook').length;
   await field.evaluate((element,extra)=>{element.value+=extra;element.dispatchEvent(new Event('input',{bubbles:true}));},'\n\n'+'x'.repeat(600_000));
   await size.getByText('Too large to publish',{exact:false}).waitFor();
   await page.getByRole('button',{name:'Publish book',exact:true}).click();await page.waitForTimeout(200);
   assert.equal(fixture.calls.filter(call=>call.action==='publishBook').length,publishes);
   assert.ok(await field.evaluate(element=>element.validity.customError));
   await field.evaluate((element,value)=>{element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));},text+' more');
   await page.waitForFunction(()=>/^4\.\d MB of 5 MB$/.test(document.querySelector('#publish-size').textContent));
   await page.getByRole('button',{name:'Publish book',exact:true}).click();await page.locator('.publish-success').waitFor({timeout:60000});
   const input=fixture.calls.filter(call=>call.action==='publishBook').at(-1).args[0],bytes=Buffer.byteLength(JSON.stringify(input.chapters));
   assert.equal(input.chapters.length,330);assert.ok(bytes>4_000_000&&bytes<=5_000_000,`stored size ${bytes}`);
   assert.match(input.chapters.at(-1).paragraphs.at(-1),/ more$/);
   assert.equal(await page.locator('#publish-text').count(),0);
   await page.locator('#main-content').getByRole('button',{name:'Publish another book'}).click();
   await page.locator('#publish-form').waitFor();assert.equal(await field.inputValue(),'','publishing clears the stored draft');
  });
  await t.test('a publication arrives as details and loads its text only when opened',async()=>{
   const identity={uid:'lazy-reader',email:'lazy@example.test',displayName:'A Patient Reader'};
   const {page}=await contextFor(identity,1440);await page.goto(shareUrl);await page.locator('.book-ownership-label').waitFor();
   const downloads=()=>fixture.calls.filter(call=>call.action==='getBookContent').length;
   const {page:device}=await contextFor(identity,390),before=downloads();
   await device.goto(base+'#library');await device.locator(`.library-book[data-book-id="${book.id}"]`).waitFor();
   assert.equal(downloads(),before,'listing an owned book never downloads its text');
   const gate=fixture.holdNext('getBookContent');
   await device.locator(`.library-book[data-book-id="${book.id}"] [data-action="read"]`).first().click();await gate.received;
   await device.getByRole('status').filter({hasText:'Finding every chapter.'}).waitFor();
   assert.equal(await device.locator('#main-content h1').textContent(),`Opening ${book.title}…`);
   gate.release();await assertFullBook(device,book);
   assert.equal(downloads(),before+1);
   await device.keyboard.press('Escape');await device.goto(base+'#book/'+book.id);await device.locator('.excerpt-text .drop-cap').waitFor();
   assert.equal(downloads(),before+1,'the opening lines reuse the text already on this device');
  });
  await t.test('link holders get the new edition the next time they open the book',async()=>{
   const {page:guest}=await contextFor(null,390);await guest.goto(shareUrl);await guest.locator('.book-ownership-label').waitFor();
   await guest.locator('.detail-copy [data-action="read"]').click();await assertFullBook(guest,book);
   const {page:writer}=await contextFor(author,1440);await writer.goto(base+'#account');await writer.locator('.profile-view').waitFor();
   const input={title:'The Quiet Ledger, Revised',author:book.author,description:book.description,category:book.category,kind:book.kind,priceCents:book.priceCents,chapters:[...book.chapters,{title:'A new edition',paragraphs:['The author returned with one more chapter for everyone holding the link.']}]};
   const update=expectedRevision=>writer.evaluate(async({uid,id,input,expectedRevision})=>{const service=await import('/js/firebase-service.js');try{return (await service.updateBook(uid,id,input,{expectedRevision})).book.revision;}catch(error){return error.code;}},{uid:author.uid,id:book.id,input,expectedRevision});
   assert.equal(await update(1),2);assert.equal(await update(1),'folio/edit-conflict','a stale edit is refused');
   const edited=fixture.books.get(book.id).book;book=edited;
   await guest.goto(base+'#library');await guest.reload();
   await guest.locator(`.library-book[data-book-id="${book.id}"] [data-action="read"]`).first().click();
   await assertFullBook(guest,edited);
   await guest.locator('.fr-menu-toggle').click();await guest.locator('.fr-search-toggle').click();
   await guest.locator('.fr-book-search').fill('one more chapter');
   assert.ok(await guest.locator('.fr-search-results button').count()>0,'the reader shows the new chapter');
   await guest.keyboard.press('Escape');await guest.keyboard.press('Escape');
   await guest.goto(base+'#library');await guest.locator('.library-book h2').filter({hasText:'The Quiet Ledger, Revised'}).waitFor({state:'attached'});
   // The device replaced its copy: without a connection the new edition still opens.
   const downloads=fixture.calls.filter(call=>call.action==='getBookContent').length;
   await guest.route('**/__folio_fixture__',route=>route.abort());await guest.reload();
   await guest.locator(`.library-book[data-book-id="${book.id}"] [data-action="read"]`).first().click();
   await assertFullBook(guest,edited);
   assert.equal(fixture.calls.filter(call=>call.action==='getBookContent').length,downloads);
  });
  await t.test('a guest owns a shared book even when this device cannot store its text',async()=>{
   const unavailable=()=>Object.defineProperty(window,'indexedDB',{configurable:true,get(){return undefined;}});
   const full=()=>{IDBObjectStore.prototype.put=function(){throw new DOMException('The quota has been exceeded.','QuotaExceededError');};};
   for(const blocked of [unavailable,full]){
    const {context,page}=await contextFor(null,390);await context.addInitScript(blocked);
    await page.goto(shareUrl);await page.locator('.book-ownership-label').getByText('Owned',{exact:false}).waitFor();
    const owned=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),ownedKey());
    assert.equal(owned.books.filter(record=>record.bookId===book.id&&record.source==='shared').length,1,'ownership never depends on caching the text');
    await page.locator('.detail-copy [data-action="read"]').click();await assertFullBook(page,book);
   }
   const {context,page}=await contextFor(author,1440);await context.addInitScript(full);
   await page.goto(base+'#publish');await page.locator('#publish-form').waitFor();
   await page.locator('#publish-text').fill('# A draft\n\nThat this device cannot keep.');
   await page.locator('#publish-draft-status').getByText('Not saved on this device',{exact:false}).waitFor();
  });
  await t.test('book text and drafts move out of localStorage once',async()=>{
   const entry=fixture.books.get(book.id),{revision,...legacy}=entry.book;
   const {context,page}=await contextFor(null,390);
   await context.addInitScript(seed=>{if(sessionStorage.getItem('seeded'))return;sessionStorage.setItem('seeded','1');for(const [key,value] of seed)localStorage.setItem(key,value);},[
    ['folio.books.v1.guest',JSON.stringify([{...legacy,shareToken:entry.shareToken}])],
    [ownedKey(),JSON.stringify({version:1,books:[{bookId:book.id,source:'shared',acquiredAt:Date.now(),shareId:entry.shareToken}]})],
    ['folio.library.v1.guest',JSON.stringify({saved:[book.id],progress:{},mutations:{}})]
   ]);
   await page.route('**/__folio_fixture__',route=>route.abort());
   await page.goto(base+'#library');await page.waitForFunction(()=>localStorage.getItem('folio.books.v1.guest')===null);
   const details=await page.evaluate(()=>JSON.parse(localStorage.getItem('folio.books.v2.guest')));
   assert.deepEqual(details.map(value=>[value.id,'chapters' in value]),[[book.id,false]],'only the details stay in localStorage');
   await page.locator(`.library-book[data-book-id="${book.id}"] [data-action="read"]`).first().click();
   await assertFullBook(page,{...legacy,chapters:entry.book.chapters});
   const {context:writerContext,page:writer}=await contextFor(author,1440),key='folio.publish-draft.v1.user.'+author.uid;
   await writerContext.addInitScript(key=>{if(sessionStorage.getItem('seeded'))return;sessionStorage.setItem('seeded','1');localStorage.setItem(key,JSON.stringify({title:'A draft from before',manuscript:'# Kept\n\nFrom the old draft.'}));},key);
   await writer.goto(base+'#publish');await writer.locator('#publish-form').waitFor();
   assert.equal(await writer.locator('#publish-title').inputValue(),'A draft from before');
   await writer.waitForFunction(key=>localStorage.getItem(key)===null,key);
   await writer.reload();await writer.locator('#publish-form').waitFor();
   assert.equal(await writer.locator('#publish-text').inputValue(),'# Kept\n\nFrom the old draft.');
  });
  await t.test('invalid, missing, and unrelated links never grant ownership',async()=>{
   for(const hash of [`#shared/${book.id}/${'0'.repeat(64)}`,'#shared/b-missing/'+('1'.repeat(64)),`#shared/${book.id}/bad`]){
    const {page}=await contextFor(null);await page.goto(base+hash);await page.locator('.shared-error').waitFor();
    assert.equal(await page.locator('.book-ownership-label').count(),0);
    const owned=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),ownedKey());
    assert.ok(!owned?.books?.some(record=>record.bookId===book.id),'an invalid token grants nothing');
    await page.goto(base+'#discover');await page.locator('.home-view').waitFor();
    assert.equal(await page.locator(`.book-card[data-book-id="${book.id}"]`).count(),0,'a private publication is absent from public Discover');
   }
   assert.deepEqual(errors,[]);
  });
  if(process.env.FOLIO_QA_SCREENSHOTS){
   // Capture a separate, human-readable edition for the review artifact. The
   // security fixture above retains its markup-like title and assertions.
   const {page}=await contextFor({...author,displayName:'Alex Rowan'});await page.goto(base+'#publish');await page.locator('#publish-form').waitFor();
   await page.locator('#publish-title').fill('The Quiet Ledger');await page.locator('#publish-author').fill('Alex Rowan');
   await page.locator('#publish-description').fill('A forgotten notebook. A small coastal town. A story about the things we choose to keep.');
   const cleanManuscript='# A door opens\n\nThe notebook was waiting on the kitchen table, exactly where she had left it twenty years ago. Beyond the open window, the harbour was beginning to wake.\n\nShe ran a finger along the faded blue cover. Some things had changed beyond recognition. Others had simply been waiting for her to come home.\n\n# Through the gate\n\nBy morning, the first page had become a question. She took it with her to the water.\n\n# The far shore\n\nThere was room in the ledger for a different kind of ending.';
   await page.locator('#publish-text').fill(cleanManuscript);await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});await capture(page,'publisher-390');
   await page.getByRole('button',{name:'Publish book',exact:true}).click();await page.locator('.publish-success').waitFor();
   const cleanShare=await page.locator('#published-share-link').inputValue(),cleanId=cleanShare.split('#shared/')[1].split('/')[0];
   await page.locator('#folio-toast').waitFor({state:'hidden'});await page.evaluate(()=>document.activeElement?.blur());await capture(page,'published-390');
   await page.goto(base+'#account');await page.locator(`.profile-publications [data-action="share-book"][data-book="${cleanId}"]`).click();
   await page.locator('#share-dialog').waitFor({state:'visible'});await capture(page,'share-link-390');
   const {page:guest}=await contextFor(null);await guest.goto(cleanShare);await guest.locator('.book-ownership-label').waitFor();
   await guest.locator('#folio-toast').waitFor({state:'hidden'});await guest.evaluate(()=>{document.activeElement?.blur();scrollTo(0,document.querySelector('.detail-copy').getBoundingClientRect().top+scrollY-98)});await capture(guest,'guest-owned-390');
   const {page:buyer}=await contextFor(null);await buyer.goto(base+'#book/quiet');await buyer.getByRole('button',{name:/^Buy this book/i}).click();
   await buyer.locator('#membership-dialog [data-step="checkout"]').waitFor();await buyer.evaluate(()=>document.activeElement?.blur());await capture(buyer,'purchase-checkout-390');
  }
 }finally{await Promise.all(contexts.map(context=>context.close()));await browser.close();}
});
