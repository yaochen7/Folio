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
function backendFixture(){
 const books=new Map(),publications=new Map(),owned=new Map(),library=new Map(),progress=new Map(),calls=[];
 let nextPublicationGate;
 function holdNextPublication(){let release,started;const wait=new Promise(resolve=>release=resolve),received=new Promise(resolve=>started=resolve);nextPublicationGate={wait,started};return{release,received};}
 const bucket=(map,uid)=>{if(!map.has(uid))map.set(uid,new Map());return map.get(uid);};
 const fail=(message='This shared book is unavailable.')=>{throw Object.assign(new Error(message),{status:404});};
 function lookup(id,token){const entry=books.get(id);if(!entry||entry.shareToken!==token)fail();return entry;}
 function dispatch({action,uid,args=[]}){
  calls.push({action,uid,args});
  if(action==='getCatalog')return[];
  if(action==='getSharedBook')return lookup(...args).book;
  if(!uid)throw Object.assign(new Error('Sign in to continue.'),{status:403});
  if(action==='publishBook'){
   const input=args[0],id='b-'+randomUUID(),shareToken=randomBytes(32).toString('hex');
   assert.ok(Array.isArray(input.chapters)&&input.chapters.length,'the UI supplies parsed chapters');
   const book={id,title:input.title,author:input.author,description:input.description,category:input.category||'Fiction',genre:input.genre||input.category||'Fiction',kind:input.kind||'quiet',kicker:'An original story',priceCents:input.priceCents??499,pages:3,cover:escape(input.title),chapters:input.chapters,ownerUid:uid,publishedAt:Date.now(),source:'folio-publication'};
   const entry={book,shareToken};books.set(id,entry);bucket(publications,uid).set(id,{...book,shareToken});return entry;
  }
  if(action==='watchPublications')return[...bucket(publications,uid).values()];
  if(action==='watchOwnedBooks')return[...bucket(owned,uid).values()];
  if(action==='getPublicationShare'){
   const book=bucket(publications,uid).get(args[0]);if(!book)fail();return{book,shareToken:book.shareToken};
  }
  if(action==='claimSharedBook'){
   const entry=lookup(...args);bucket(owned,uid).set(entry.book.id,{...entry.book,shareToken:entry.shareToken});return{...entry.book,shareToken:entry.shareToken};
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
  const call=async(action,args=[],uid=user?.uid)=>{const response=await fetch('/__folio_fixture__',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,args,uid})});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error),{code:'folio/not-found'});return result.value;};
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
  export const getSharedBook=(...args)=>call('getSharedBook',args);
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
   try{const packet=route.request().postDataJSON();if(packet.action==='publishBook'&&nextPublicationGate){const gate=nextPublicationGate;nextPublicationGate=null;gate.started();await gate.wait;}await route.fulfill({json:{value:dispatch(packet)}})}
   catch(error){await route.fulfill({status:error.status||500,json:{error:error.message}})}
  });
 }
 return{attach,books,publications,owned,calls,holdNextPublication};
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
   assert.equal(book.ownerUid,author.uid);assert.equal(book.priceCents,499);assert.equal(book.chapters.length,3);
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
