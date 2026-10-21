import {books as originalBooks,renderCover,escapeHtml as esc} from './books.js';
import {icon,hydrateIcons} from './icons.js';
import {collections,presentation} from './presentation.js';
import {createReader} from './reader.js';
import {createNavigation} from './navigation.js';
import * as cloud from './firebase-service.js';
import {createMembershipService,previewLimit,membershipKey,ownershipKey,bookPrice} from './membership.js';
import {createMembershipDialog} from './membership-ui.js';
import {accountPage} from './account-page.js';
import {publisherPage} from './publisher-ui.js';
import {parseManuscript,decoratePublication,readPublicationCache,cachePublication,publicationCacheKey,shareUrl} from './publishing.js';

const main=document.querySelector('#main-content');
const dialog=document.querySelector('#account-dialog');
const toastElement=document.querySelector('#folio-toast');
const searchBar=document.querySelector('.search-bar');
const searchInput=document.querySelector('#book-search');
const searchClear=searchBar.querySelector('.search-clear');
function readLibraryView(){try{const value=JSON.parse(localStorage.getItem('folio.library.view.v1')||'{}');return{layout:value.layout==='list'?'list':'grid',sort:value.sort==='title'?'title':'recent'};}catch{return{layout:'grid',sort:'recent'};}}
const libraryView=readLibraryView();
function saveLibraryView(){try{localStorage.setItem('folio.library.view.v1',JSON.stringify(libraryView));}catch{}}
const state={homeGenre:'All',catalog:[...originalBooks],books:[...originalBooks],publications:[],acquired:[],cloudOwned:new Set(),publicationsLoading:false,ownedLoading:false,publishDraft:{},publishResult:null,publishing:false,publishError:'',user:null,firebase:'loading',googleSignInEnabled:false,emailSignUpEnabled:false,saved:new Set(),progress:{},mutations:{},lastRoute:'#discover',searchQuery:'',searchReturnRoute:'#discover',detailReturnRoute:'#discover',readerBook:null,authMode:'signin',authBusy:false,cloudError:false};
let libraryUnsubscribe,progressUnsubscribe,publicationUnsubscribe,ownedUnsubscribe,toastTimer,lastActionTarget,ignoreReaderClose=false,authGeneration=0,identityGeneration=0,pendingRouteFocus,accountReturnFocus,draftTimer,shareRequest=0;
const pendingProgress=new Map();
const syncingLibrary=new Map();
const membership=createMembershipService();
const membershipDialog=document.querySelector('#membership-dialog');
let membershipTimer;
const subscription=()=>membership.read(state.user?.uid);
const plusActive=()=>subscription()?.active===true;
const ownsBook=book=>Boolean(book&&(membership.ownsBook(state.user?.uid,book.id)||state.cloudOwned.has(book.id)||(state.user&&book.ownerUid===state.user.uid)));
const canReadFull=book=>Boolean(book&&(plusActive()||ownsBook(book)));
const membershipFlow=createMembershipDialog({dialog:membershipDialog,service:membership,getUid:()=>state.user?.uid,
 onChange:(_record,context)=>{if(context?.purchase&&context.book)ensureSaved(context.book.id);refreshMembership();},
 onDismiss:({completed,book,wordOffset})=>{
  const current=state.readerBook&&getBook(state.readerBook);
  if(current&&(completed||reader.preview===canReadFull(current)))reader.open(current,{wordOffset:Math.max(completed&&book?.id===current.id?wordOffset||0:0,state.progress[current.id]?.wordOffset||0),preview:!canReadFull(current)});
  else if(completed&&book)navigate('#read/'+encodeURIComponent(book.id));
  else if(completed&&!state.readerBook)navigate('#account');
 }
});
function refreshMembership(){
 clearTimeout(membershipTimer);const record=subscription();
 if(record?.active)membershipTimer=setTimeout(()=>refreshMembership(),Math.min(2147483647,record.expiresAt-Date.now()+20));
 if(state.readerBook&&!membershipDialog.open){const book=getBook(state.readerBook);if(book&&reader.preview===canReadFull(book))reader.open(book,{wordOffset:state.progress[book.id]?.wordOffset||0,preview:!canReadFull(book)});}
 if(!state.readerBook)refreshRouteContent();
}
function openMembership(id){const book=id&&getBook(id);membershipFlow.open(book?{book,wordOffset:Math.max(previewLimit(book),state.progress[id]?.wordOffset||0)}:{});}
function setMembershipRenewal(renew){try{membership.setRenewal(state.user?.uid,renew);notify(renew?'Your subscription renewal has resumed.':'Renewal cancelled. Your access continues until the end of this period.');}catch(error){notify(error.message);}refreshMembership();}
function renderProfile(){main.innerHTML=accountPage({user:state.user,saved:state.saved,progress:state.progress,books:state.books,membership:subscription(),cloudError:state.cloudError,publications:state.publications,ownedBooks:state.books.filter(ownsBook)});}
function refreshBooks(){const map=new Map([...state.catalog,...readPublicationCache(state.user?.uid),...state.acquired,...state.publications].map(book=>[book.id,book]));state.books=[...map.values()];}
function rememberPublication(book,{persist=true}={}){const safe=decoratePublication(book);if(!safe)throw new Error('This book could not be opened.');if(persist)cachePublication(state.user?.uid,safe);state.acquired=state.acquired.filter(value=>value.id!==safe.id);state.acquired.push(safe);refreshBooks();return safe;}
function ensureSaved(id){if(state.saved.has(id))return;state.saved.add(id);const uid=state.user?.uid;if(uid)state.mutations[id]={saved:true,updatedAt:Date.now()};persistCache();if(uid)void syncLibraryMutation(uid,id,state.mutations[id]);}
const draftKey=uid=>'folio.publish-draft.v1.'+(uid?'user.'+encodeURIComponent(uid):'guest');
function loadPublishDraft(){try{state.publishDraft=JSON.parse(localStorage.getItem(draftKey(state.user?.uid))||'{}')||{};}catch{state.publishDraft={};}}
function capturePublishDraft(){const form=main.querySelector('#publish-form');if(!form||state.publishing)return;state.publishDraft=Object.fromEntries(new FormData(form));delete state.publishDraft[''];}
function savePublishDraft(){clearTimeout(draftTimer);try{localStorage.setItem(draftKey(state.user?.uid),JSON.stringify(state.publishDraft));}catch{}}
function renderPublisher(){main.innerHTML=publisherPage({user:state.user,busy:state.publishing,result:state.publishResult,error:state.publishError,draft:state.publishDraft});if(state.publishing)main.querySelectorAll('#publish-form input,#publish-form textarea,#publish-form select').forEach(input=>input.disabled=true);}
async function submitPublication(form){
 if(state.publishing)return;
 if(!state.user){openAccount();return;}
 capturePublishDraft();savePublishDraft();const uid=state.user.uid,generation=identityGeneration,draft={...state.publishDraft};
 try{
  const chapters=parseManuscript(draft.manuscript),priceCents=Math.round(Number(draft.price)*100);
  if(!Number.isFinite(priceCents)||priceCents<99||priceCents>99999)throw new Error('Choose a book price between $0.99 and $999.99.');
  state.publishing=true;state.publishError='';renderPublisher();
  const result=await cloud.publishBook(uid,{title:String(draft.title||'').trim(),author:String(draft.author||'').trim(),description:String(draft.description||'').trim(),genre:draft.category||'Fiction',category:draft.category||'Fiction',kind:draft.kind||'shape',priceCents,chapters});
  if(state.user?.uid!==uid||generation!==identityGeneration)return;
  const book=rememberPublication({...result.book,shareToken:result.shareToken},{persist:false});
  try{cachePublication(uid,book);}catch{ /* The published cloud copy remains available. */ }
  state.publications=state.publications.filter(value=>value.id!==book.id);state.publications.unshift(book);
  try{membership.grantSharedBook(uid,book.id,{shareId:book.shareToken});}catch{ /* Authors retain cloud access to their own publications. */ }ensureSaved(book.id);
  state.publishResult=book;state.publishDraft={};savePublishDraft();state.publishing=false;
  if(location.hash==='#publish'){renderPublisher();focusMain();}else refreshRouteContent();
  notify('Your book is published. Your story is ready to share.');
 }catch(error){if(state.user?.uid!==uid||generation!==identityGeneration)return;state.publishing=false;state.publishError=error.message||'Your book could not be published. Please try again.';if(location.hash==='#publish'){renderPublisher();const message=main.querySelector('[role="alert"]');if(message){message.tabIndex=-1;message.focus({preventScroll:true});}}}
}
async function loadSharedBook(hash){
 const request=++shareRequest,uid=state.user?.uid||null,parts=hash.split('/');
 main.innerHTML='<section class="publisher-view shared-loading"><p class="eyebrow">A story, shared with you.</p><h1>Opening your book…</h1><p role="status">Finding every chapter.</p></section>';
 try{
  if(parts.length!==3)throw new Error('This book link is incomplete. Ask the author for the full link.');
  const id=decodeURIComponent(parts[1]),token=decodeURIComponent(parts[2]);
  const value=await cloud.getSharedBook(id,token);
  if(request!==shareRequest||location.hash!==hash)return;
  if((state.user?.uid||null)!==uid){void loadSharedBook(hash);return;}
  const book=decoratePublication({...value,shareToken:token});if(!book||book.id!==id)throw new Error('This book link could not be opened.');
  // Only a successfully fetched capability may create a shared entitlement.
  if(uid)await cloud.claimSharedBook(uid,id,token);
  if(request!==shareRequest||location.hash!==hash||(state.user?.uid||null)!==uid)return;
  if(uid){state.cloudOwned.add(id);rememberPublication(book,{persist:false});try{cachePublication(uid,book);membership.grantSharedBook(uid,id,{shareId:token});}catch{ /* The verified cloud ownership remains available. */ }}
  else{rememberPublication(book);membership.grantSharedBook(null,id,{shareId:token});}
  ensureSaved(id);
  state.detailReturnRoute='#library';navigate('#book/'+encodeURIComponent(id),{replace:true});notify('This book is yours. Every chapter is ready to read.');
 }catch(error){
  if(request!==shareRequest||location.hash!==hash)return;
  main.innerHTML=`<section class="publisher-view shared-error"><p class="eyebrow">A story, shared with you.</p><h1>We couldn’t open this book.</h1><p role="alert">${esc(error.message||'The link may be incomplete or unavailable. Ask the author for a new link.')}</p><button class="pill" type="button" data-action="retry-share">Try again</button><a class="text-action" href="#library">My Library ${icon('arrow-right')}</a></section>`;focusMain();
 }
}
let shareReturnFocus;
function openBookShare(id){const book=getBook(id);if(!book?.shareToken){notify('A share link isn’t available for this book.');return;}const shareDialog=document.querySelector('#share-dialog');shareReturnFocus=document.activeElement;shareDialog.querySelector('h2').textContent=book.title;shareDialog.querySelector('input').value=shareUrl(book);if(!shareDialog.open)shareDialog.showModal();}
async function copyBookLink(input){if(!input)return;try{await navigator.clipboard.writeText(input.value);notify('Link copied. Anyone with the link can read the whole book.');}catch{input.focus();input.select();notify('Select and copy the link to share your book.');}}
const storageKey=uid=>'folio.library.v1.'+(uid||'guest');
function readCache(uid){try{const value=JSON.parse(localStorage.getItem(storageKey(uid))||'{}');return{saved:Array.isArray(value.saved)?value.saved.filter(id=>typeof id==='string'):[],progress:value.progress&&typeof value.progress==='object'?value.progress:{},mutations:value.mutations&&typeof value.mutations==='object'?value.mutations:{}};}catch{return{saved:[],progress:{},mutations:{}};}}
function persistCache(){try{localStorage.setItem(storageKey(state.user?.uid),JSON.stringify({saved:[...state.saved],progress:state.progress,mutations:state.mutations}));}catch{}}
function loadCache(uid){const cache=readCache(uid);state.saved=new Set(cache.saved);state.progress=cache.progress;state.mutations=cache.mutations;state.acquired=[];state.cloudOwned=new Set();state.publications=readPublicationCache(uid).filter(book=>uid&&book.ownerUid===uid);refreshBooks();}
loadCache(null);
const getBook=id=>state.books.find(book=>book.id===id);
// The toast joins the top layer, inside any open modal so it stays readable and announced.
// It moves up rather than cover the control it confirms near the bottom of the screen.
function showToast(target){const host=[...document.querySelectorAll('dialog[open]')].pop()||document.body;if(toastElement.parentElement!==host)host.append(toastElement);if(target!==undefined){const a=target?.isConnected&&host.contains(target)&&target.getBoundingClientRect();toastElement.classList.toggle('toast-top',Boolean(a&&a.bottom>innerHeight-96&&a.top<innerHeight));}toastElement.hidden=false;toastElement.hidePopover?.();toastElement.showPopover?.();}
function notify(message){clearTimeout(toastTimer);toastElement.textContent=message;const target=lastActionTarget;lastActionTarget=null;showToast(target);toastTimer=setTimeout(()=>{toastElement.hidePopover?.();toastElement.hidden=true;},3600);}
function navigate(hash,{focus,...options}={}){if(focus)pendingRouteFocus=focus;navigation.navigate(hash,options);}
function focusMain(){const target=main.querySelector('h1')||main;target.setAttribute('tabindex','-1');target.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});}
function isSearchRoute(hash=location.hash){return hash==='#search'||hash.startsWith('#search?');}
function searchHash(){return state.searchQuery?'#search?q='+encodeURIComponent(state.searchQuery):'#search';}
function setSearch(open,{focus=false}={}){searchBar.hidden=!open;document.querySelectorAll('[data-action="search"]').forEach(button=>button.setAttribute('aria-expanded',String(open)));if(open){searchInput.value=state.searchQuery;searchClear.hidden=!searchInput.value;if(focus)searchInput.focus({preventScroll:true});}}
function openSearch(){if(!isSearchRoute())state.searchReturnRoute=location.hash&&!location.hash.startsWith('#read/')?location.hash:state.lastRoute;navigate(searchHash());setSearch(true,{focus:true});}
function closeSearch(){setSearch(false);navigate(state.searchReturnRoute||'#discover',{focus:document.querySelector('[data-action="search"]')});}
function renderPreservingFocus(render){
 const active=document.activeElement,inside=main.contains(active),bookCard=inside?active.closest('.book-card'):null;
 const openMenu=main.querySelector('.library-menu[open]'),openBook=openMenu?.closest('[data-book-id]')?.dataset.bookId;
 const menuSelector=openBook?`[data-book-id="${CSS.escape(openBook)}"] .library-menu`:openMenu?.matches('.library-sort')?'.library-sort':null;
 const focusedSummary=active.matches('.library-menu>summary');
 const previousIndex=bookCard?[...main.querySelectorAll('.book-card')].indexOf(bookCard):-1;
 const selector=inside&&active.dataset.action?`[data-action="${CSS.escape(active.dataset.action)}"]${active.dataset.book?`[data-book="${CSS.escape(active.dataset.book)}"]`:''}${active.dataset.genre?`[data-genre="${CSS.escape(active.dataset.genre)}"]`:''}${active.classList[0]?'.'+CSS.escape(active.classList[0]):''}`:null;
 const scroll={x:scrollX,y:scrollY};render();
 const restoredMenu=menuSelector&&main.querySelector(menuSelector);if(restoredMenu)restoredMenu.open=true;
 if(inside){const cards=main.querySelectorAll('.book-card'),fallback=cards[Math.min(previousIndex,cards.length-1)],heading=active.matches('h1,h2')?main.querySelector(active.tagName.toLowerCase()):null;const target=active===main?main:(focusedSummary&&restoredMenu?.querySelector('summary'))||(selector&&main.querySelector(selector))||heading||fallback?.querySelector(active.classList.contains('bookmark-button')?'.bookmark-button':'.book-title,.library-cover')||main.querySelector('.library-empty button, .library-empty a')||main.querySelector('button,a,input')||main;if(heading===target)target.setAttribute('tabindex','-1');target.focus({preventScroll:true});}
 window.scrollTo({left:scroll.x,top:scroll.y,behavior:'instant'});
}
function refreshRouteContent(){
 if(state.readerBook)return;const hash=location.hash||'#discover';
 if(hash.startsWith('#read/')){renderRoute();return;}
 if(hash.startsWith('#shared/'))return;
 if(hash==='#publish'){if(!main.querySelector('#publish-form')||state.publishResult)renderPublisher();return;}
 renderPreservingFocus(()=>{if(hash==='#account')renderProfile();else if(hash==='#library')renderLibrary();else if(hash.startsWith('#book/')){let id;try{id=decodeURIComponent(hash.slice(6));}catch{}renderDetails(id);}else if(isSearchRoute(hash)||hash==='#browse')renderSearch();else if(hash==='#home'||hash==='#discover'||hash==='#collections'||!location.hash)renderHome();});
 updateHeader();
}
function coverButton(book,extra=''){return `<button class="cover-button ${extra}" type="button" data-action="detail" data-book="${esc(book.id)}" aria-label="Discover ${esc(book.title)} by ${esc(book.author)}">${renderCover(book)}</button>`;}
function bookCard(book){return `<article class="book-card" data-book-id="${esc(book.id)}">${coverButton(book)}<div class="book-card-caption"><h3><button class="book-title" type="button" data-action="detail" data-book="${esc(book.id)}">${esc(book.title)}</button></h3><p class="author">${esc(book.author)}</p><p class="edition-meta">${esc(book.genre)}${Number.isFinite(book.pages)?` · ${book.pages}&nbsp;pages`:''}</p></div></article>`;}
function renderHome(){
 const shelf=state.catalog.filter(book=>state.homeGenre==='All'||book.category===state.homeGenre);
 main.innerHTML=`<div class="home-view">
  <section class="gallery-hero" aria-labelledby="hero-title">
   <p class="story-badge"><span aria-hidden="true"></span>Original stories · First chapter free</p>
   <h1 id="hero-title">A world between the covers.</h1>
   <p class="lead">Discover original stories and make a little time to read.</p>
   <div class="action-row"><button class="pill" type="button" data-action="detail" data-book="quiet">Start reading</button><a class="glass-button" href="#discover">Browse the collection</a></div>
   <div class="hero-shelf folio-glass"><div class="feature-books" aria-label="Featured stories">${state.catalog.slice(0,6).map(book=>coverButton(book)).join('')}</div></div>
  </section>
  <section class="collection" id="collection" aria-labelledby="collection-title"><div class="discover-sheet folio-glass">
   <div class="section-line"><h2 id="collection-title">Discover. <span>Six original stories.</span></h2><div class="shelf-tools"><div class="genre-picker" role="group" aria-label="Filter stories">${['All','Fiction','Ideas','Escape'].map(genre=>`<button type="button" data-action="genre" data-genre="${genre}" aria-pressed="${state.homeGenre===genre}">${genre}</button>`).join('')}</div><button class="icon-button shelf-search" type="button" data-action="search" aria-label="Search books" aria-expanded="false">${icon('search')}</button></div></div>
   <div class="book-grid">${shelf.map(bookCard).join('')}</div><p class="sr-only" role="status">${shelf.length} ${shelf.length===1?'story':'stories'} in ${state.homeGenre}</p>
  </div></section>
  <section class="collections-section" id="collections" aria-labelledby="collections-title"><h2 id="collections-title">Collections. <span>Something for every mood.</span></h2><div class="collection-cards">${collections.map(collection=>{const books=state.catalog.filter(book=>book.category===collection.category);return `<a class="collection-card folio-glass tone-${collection.tone}" href="#discover" data-action="collection" data-genre="${collection.category}"><div><span class="collection-count">${books.length} ${books.length===1?'story':'stories'}</span><h3>${collection.category}</h3><p>${collection.description}</p></div><div class="collection-covers" aria-hidden="true">${books.slice(0,3).map(book=>`<div>${renderCover(book)}</div>`).join('')}</div></a>`;}).join('')}</div></section>
  <section class="library-invitation" aria-labelledby="library-invitation-title"><div class="invitation-sheet folio-glass"><h2 id="library-invitation-title">Your library. Always with you.</h2><p>Save books and pick up on the same page. Guest libraries stay on this device; sign in to keep them across devices.</p><div class="action-row">${state.user?`<a class="pill" href="#library">Open My Library</a><button class="glass-button" type="button" data-action="account">Your account</button>`:`<button class="pill" type="button" data-action="signin">Sign in</button><a class="glass-button" href="#library">Continue as guest</a>`}</div></div></section>
 </div>`;
}
function renderDetails(id){
 const book=getBook(id);if(!book){if(id?.startsWith('b-')&&(state.firebase==='loading'||state.publicationsLoading||state.ownedLoading))main.innerHTML='<section class="publisher-view"><h1>Opening your book…</h1><p role="status">Finding your library.</p></section>';else renderNotFound();return;}
 const saved=state.saved.has(id),progress=state.progress[id]?.fraction||0,edition=presentation(book),opening=book.chapters[0],first=opening?.paragraphs[0]||'',lead=first.match(/^[\p{Pi}\p{Ps}"']*\S/u)?.[0]||first.charAt(0);
 document.querySelector('.folio-glow').style.setProperty('--edition-tint',edition.tint);
 const words=book.chapters.flatMap(chapter=>chapter.paragraphs).join(' ').trim().split(/\s+/).length;
 main.innerHTML=`<section class="detail-view"><div class="detail-layout"><div class="detail-art"><div class="detail-cover">${renderCover(book)}<span class="cover-sheen" aria-hidden="true"></span></div></div><div class="detail-copy"><p class="eyebrow">${esc(book.genre)}</p><h1>${esc(book.title)}</h1><p class="detail-author">${esc(book.author)}</p><p class="detail-description">${esc(edition.blurb)}</p><div class="detail-meta"><span>${esc(book.category||'Fiction')}</span>${Number.isFinite(book.pages)?`<span>${book.pages} pages</span>`:''}<span>${Math.max(1,Math.ceil(words/230))} min read</span></div><div class="action-row"><button class="pill" type="button" data-action="read" data-book="${esc(id)}">${progress>0.001?'Continue reading':'Read sample'}</button><button class="glass-button save-text" type="button" data-action="save" data-book="${esc(id)}" aria-pressed="${saved}">${icon(saved?'check':'plus')} <span>${saved?'In My Library':'Want to Read'}</span></button></div>${progress>0.001?`<p class="detail-progress">${Math.round(progress*100)}% read <button type="button" data-action="restart" data-book="${esc(id)}">Start over</button></p>`:''}</div></div>
 <section class="opening-lines" aria-labelledby="opening-title"><div class="opening-heading"><h2 id="opening-title">Opening lines.</h2><span>Chapter One · ${esc(opening?.title||'')}</span></div><div class="excerpt-paper"><div class="excerpt-text"><p><span class="drop-cap">${esc(lead)}</span>${esc(first.slice(lead.length))}</p>${(opening?.paragraphs.slice(1,3)||[]).map(paragraph=>`<p>${esc(paragraph)}</p>`).join('')}</div><div class="excerpt-fade"><button type="button" data-action="read" data-book="${esc(id)}">Keep reading</button></div></div></section>
 <section class="detail-related"><h2>More from Folio.</h2><div class="book-grid related-grid">${state.catalog.filter(item=>item.id!==id).sort((a,b)=>(b.category===book.category)-(a.category===book.category)).slice(0,4).map(bookCard).join('')}</div></section></section>`;
 const readButton=main.querySelector('.detail-copy [data-action="read"]');
 readButton.textContent=progress>0.001?'Continue reading':canReadFull(book)?'Start reading':'Read free preview';
 (main.querySelector('.detail-copy .detail-progress')||readButton.closest('.action-row')).insertAdjacentHTML('afterend',`<p class="detail-membership-note">${ownsBook(book)?'<span class="book-ownership-label">'+icon('check')+' Owned</span>':plusActive()?'Included with Folio Plus.':'Chapter One is free. <button type="button" data-action="subscribe">Every chapter with Folio Plus.</button>'}</p>`);
 if(!ownsBook(book))readButton.closest('.action-row').insertAdjacentHTML('beforeend',`<button class="glass-button" type="button" data-action="buy-book" data-book="${esc(id)}">Buy this book · ${bookPrice(book).price}</button>`);
 if(book.shareToken)readButton.closest('.action-row').insertAdjacentHTML('beforeend',`<button class="glass-button" type="button" data-action="share-book" data-book="${esc(id)}">${icon('link')} Share book</button>`);
}
function libraryBookCard(book){const progress=state.progress[book.id]?.fraction||0;return `<article class="book-card library-book" data-book-id="${esc(book.id)}"><button class="cover-button library-cover" type="button" data-action="read" data-book="${esc(book.id)}" aria-label="${progress>0?'Continue reading':'Read'} ${esc(book.title)} by ${esc(book.author)}">${renderCover(book)}</button><div class="library-row-copy"><h2>${esc(book.title)}</h2><p>${esc(book.author)}</p></div><div class="library-book-meta"><span class="library-reading-status">${ownsBook(book)?'Owned · ':''}${progress>0?`${Math.max(1,Math.round(progress*100))}%`:'Not started'}</span><details class="library-menu"><summary aria-label="Options for ${esc(book.title)}">${icon('more')}</summary><div class="library-book-menu"><button type="button" data-action="read" data-book="${esc(book.id)}">${progress>0?'Continue reading':'Start reading'}</button><button type="button" data-action="detail" data-book="${esc(book.id)}">Book details</button><button type="button" data-action="save" data-book="${esc(book.id)}" aria-pressed="true">Remove from library</button></div></details></div></article>`;}
function renderLibrary(){const selected=state.books.filter(book=>state.saved.has(book.id)),order=[...state.saved];selected.sort(libraryView.sort==='title'?(a,b)=>a.title.localeCompare(b.title):(a,b)=>(state.progress[b.id]?.updatedAt||0)-(state.progress[a.id]?.updatedAt||0)||order.indexOf(b.id)-order.indexOf(a.id));
 if(!selected.length&&(state.publicationsLoading||state.ownedLoading)){main.innerHTML='<section class="library-view"><h1>Library</h1><p role="status">Opening your books…</p></section>';return;}
 main.innerHTML=`<section class="library-view"><div class="library-heading"><h1>Library</h1><div class="library-view-actions"><button class="library-view-toggle" type="button" data-action="library-layout" aria-label="Show ${libraryView.layout==='grid'?'list':'covers'}" aria-pressed="${libraryView.layout==='list'}">${icon(libraryView.layout==='grid'?'rows':'grid')}</button><details class="library-menu library-sort"><summary aria-label="Sort library">${icon('sort')}</summary><div class="library-book-menu"><button type="button" data-action="library-sort" data-sort="recent" aria-pressed="${libraryView.sort==='recent'}">Recently read${libraryView.sort==='recent'?icon('check'):''}</button><button type="button" data-action="library-sort" data-sort="title" aria-pressed="${libraryView.sort==='title'}">Title${libraryView.sort==='title'?icon('check'):''}</button></div></details></div></div>${selected.length?`<div class="library-grid library-shelf" data-layout="${libraryView.layout}" aria-label="${selected.length} saved books">${selected.map(libraryBookCard).join('')}</div>`:`<div class="library-empty">${icon('book-open')}<h2>Your next chapter starts here.</h2><p><span>Save the books that catch your eye.</span> <span>They’ll be waiting here when you are.</span></p><button class="pill" type="button" data-action="browse">Find a book ${icon('arrow-right')}</button></div>`}</section>`;
}
function renderSearch(){const entered=isSearchRoute()?state.searchQuery:'',query=entered.trim().toLowerCase(),found=state.catalog.filter(book=>`${book.title} ${book.author} ${book.genre}`.toLowerCase().includes(query));
 main.innerHTML=`<section class="search-view"><p class="eyebrow">Follow your curiosity.</p><h1>${query?'Find your next chapter.':'The whole collection.'}</h1><p class="search-summary" role="status">${found.length} ${found.length===1?'book':'books'} ${query?'found':'to discover'}</p>${found.length?`<div class="discover-sheet folio-glass"><div class="book-grid search-grid">${found.map(bookCard).join('')}</div></div>`:`<div class="search-empty">${icon('search')}<h2>Let’s try another chapter.</h2><p><span>No books matched “${esc(entered.trim())}”.</span> <span>Try a different title, author, or genre.</span></p><button class="pill" type="button" data-action="clear-search">Show all books ${icon('arrow-right')}</button></div>`}</section>`;
}
function renderNotFound(){main.innerHTML=`<section class="library-view not-found-view"><div class="library-empty not-found"><h1>This story has moved.</h1><p>There’s another good book waiting for you.</p><a class="pill" href="#discover">Back to Folio</a></div></section>`;}
const reader=createReader({root:document.querySelector('#reader-root'),onPreviewEnd:openMembership,onProgress:(id,progress)=>{
 if(!Number.isFinite(progress.wordOffset)||!Number.isFinite(progress.fraction))return;
 if(!canReadFull(getBook(id))&&(state.progress[id]?.wordOffset||0)>=previewLimit(getBook(id)))return;
 const value={wordOffset:Math.max(0,Math.floor(progress.wordOffset)),fraction:Math.min(1,Math.max(0,progress.fraction)),updatedAt:Date.now()};
 state.progress[id]=value;persistCache();queueProgress(id,value);
},onClose:()=>{if(ignoreReaderClose)return;state.readerBook=null;navigation.backTo(state.lastRoute.startsWith('#read/')?'#discover':state.lastRoute);}});
const navigation=createNavigation({main,render:renderRoute,captureState:()=>({homeGenre:state.homeGenre,detailReturnRoute:state.detailReturnRoute}),restoreState:saved=>{if(saved){state.homeGenre=saved.homeGenre;state.detailReturnRoute=saved.detailReturnRoute;}}});
function renderRoute({restored=false,samePage=false}={}){
 const hash=location.hash||'#home';
 if(location.hash!=='#publish'){capturePublishDraft();savePublishDraft();}
 if(!hash.startsWith('#shared/'))shareRequest++;
 document.body.dataset.page=hash.startsWith('#book/')?'book':hash==='#publish'?'publish':hash.startsWith('#shared/')?'shared':hash==='#account'?'account':hash==='#library'?'library':isSearchRoute(hash)||hash==='#browse'?'search':'home';
 const previousFocus=document.activeElement;
 let readId;try{if(hash.startsWith('#read/'))readId=decodeURIComponent(hash.slice(6));}catch{}
 const readingBook=readId&&getBook(readId);
 if(readingBook){if(state.readerBook===readId)return;setSearch(false);dialog.close();state.readerBook=readId;reader.open(readingBook,{wordOffset:state.progress[readId]?.wordOffset||0,preview:!canReadFull(readingBook)});document.title=`${readingBook.title} — Folio`;return;}
 if(membershipDialog.open)membershipFlow.close({silent:true});
 document.querySelector('#share-dialog')?.close();
 if(state.readerBook){ignoreReaderClose=true;try{reader.close();}finally{ignoreReaderClose=false;state.readerBook=null;}}
 state.lastRoute=hash;
 document.title='Folio — A world between the covers';
 document.querySelectorAll('[data-nav]').forEach(link=>{const active=hash==='#collections'?link.dataset.nav==='collections':hash==='#discover'||hash.startsWith('#book/')?link.dataset.nav==='discover':false;if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
 if(hash.startsWith('#read/')){setSearch(false);renderDetails(readId);document.title='Your book — Folio';if(!restored)focusMain();}
 else if(hash.startsWith('#shared/')){setSearch(false);document.title='A book shared with you — Folio';void loadSharedBook(hash);}
 else if(hash==='#publish'){setSearch(false);renderPublisher();document.title='Publish your book — Folio';if(!restored)focusMain();}
 else if(hash==='#library'){setSearch(false);renderLibrary();if(!restored)focusMain();}
 else if(hash==='#account'){setSearch(false);renderProfile();document.title='Your account — Folio';if(!restored)focusMain();}
 else if(hash.startsWith('#book/')){setSearch(false);let id;try{id=decodeURIComponent(hash.slice(6));}catch{}renderDetails(id);if(!restored)focusMain();const book=getBook(id);if(book)document.title=`${book.title} — Folio`;}
 else if(isSearchRoute(hash)){state.searchQuery=new URLSearchParams(hash.split('?').slice(1).join('?')).get('q')||'';setSearch(true,{focus:!restored});renderSearch();if(!restored)window.scrollTo({top:0,behavior:'instant'});}
 else if(hash==='#browse'){setSearch(false);renderSearch();if(!restored)focusMain();}
 else{setSearch(false);const focusContent=main.contains(previousFocus)||previousFocus===document.body;renderHome();if(!restored){if(hash==='#collections'||hash==='#discover'){const collection=document.querySelector(hash==='#collections'?'#collections':'#collection');const heading=collection?.querySelector('h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}collection?.scrollIntoView({behavior:samePage&&!matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'instant',block:'start'});}else if(focusContent)focusMain();else window.scrollTo({top:0,behavior:samePage?'smooth':'instant'});}}
 updateHeader();
 if(pendingRouteFocus){const target=pendingRouteFocus;pendingRouteFocus=null;if(target.isConnected)target.focus({preventScroll:true});}
}
function updateHeader(){const back=document.querySelector('.nav-back');if(back){back.href=state.detailReturnRoute||'#discover';back.querySelector('.nav-back-label').textContent=state.detailReturnRoute==='#library'?'Library':state.detailReturnRoute==='#account'?'Account':isSearchRoute(state.detailReturnRoute)?'Search':state.detailReturnRoute==='#collections'?'Collections':'Discover';}document.querySelector('.library-count').textContent=state.saved.size?String(state.saved.size):'';const button=document.querySelector('.account-button');button.querySelector('.account-label').textContent=state.user?(state.user.displayName?.trim().split(/\s+/)[0]||'Account'):'Account';button.setAttribute('aria-label','Your account');}
function refreshSavedControls(){updateHeader();document.querySelectorAll('[data-action="save"]').forEach(button=>{const book=getBook(button.dataset.book);if(!book)return;const saved=state.saved.has(book.id);button.setAttribute('aria-pressed',String(saved));if(button.classList.contains('save-text'))button.innerHTML=`${icon(saved?'check':'plus')} <span>${saved?'In My Library':'Want to Read'}</span>`;else button.setAttribute('aria-label',`${saved?'Remove':'Save'} ${book.title}${saved?' from':' to'} your library`);});}
async function syncLibraryMutation(uid,id,mutation){
 const book=getBook(id);if(!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)||!mutation)return false;const key=`${uid}:${id}`,previous=syncingLibrary.get(key);if(previous?.version===mutation.updatedAt)return previous.promise;
 const operation=(previous?.promise||Promise.resolve()).catch(()=>false).then(async()=>{try{if(mutation.saved)await cloud.saveLibraryBook(uid,id,book?{title:book.title,author:book.author,genre:book.genre,kind:book.kind}:{});else await cloud.removeLibraryBook(uid,id);if(state.user?.uid===uid&&state.mutations[id]?.updatedAt===mutation.updatedAt){delete state.mutations[id];persistCache();}return true;}catch{if(state.user?.uid===uid)state.cloudError=true;return false;}}).finally(()=>{if(syncingLibrary.get(key)?.promise===operation)syncingLibrary.delete(key);});syncingLibrary.set(key,{version:mutation.updatedAt,promise:operation});return operation;
}
async function toggleSave(id){const book=getBook(id);if(!book)return;const had=state.saved.has(id);had?state.saved.delete(id):state.saved.add(id);const uid=state.user?.uid;if(uid)state.mutations[id]={saved:!had,updatedAt:Math.max(Date.now(),(state.mutations[id]?.updatedAt||0)+1)};persistCache();refreshSavedControls();if(location.hash==='#library')renderPreservingFocus(renderLibrary);notify(had?'Book removed from your library.':'A good story, saved for later.');if(uid){const complete=await syncLibraryMutation(uid,id,state.mutations[id]);if(!complete&&state.user?.uid===uid)notify('Saved on this device. Cloud sync will retry when you reconnect.');}}
function queueProgress(id,progress){if(!state.user)return;const old=pendingProgress.get(id);clearTimeout(old?.timer);const uid=state.user.uid;const timer=setTimeout(async()=>{pendingProgress.delete(id);if(state.user?.uid!==uid)return;try{await cloud.saveReadingProgress(uid,id,progress);}catch{state.cloudError=true;}},900);pendingProgress.set(id,{uid,progress,timer});}
function flushProgress(){for(const [id,item]of pendingProgress){clearTimeout(item.timer);if(state.user?.uid===item.uid)cloud.saveReadingProgress(item.uid,id,item.progress).catch(()=>{});}pendingProgress.clear();}
function normalizeRemote(book){
 if(!book||!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(book.id)||typeof book.title!=='string'||typeof book.author!=='string')return null;
 const original=originalBooks.find(item=>item.id===book.id),kinds=['shape','atlas','blue-hour','wild','slowly','tomorrow'];
 const chapters=Array.isArray(book.chapters)?book.chapters.filter(ch=>ch&&typeof ch.title==='string'&&Array.isArray(ch.paragraphs)).map(ch=>({title:ch.title.slice(0,200),paragraphs:ch.paragraphs.filter(p=>typeof p==='string').map(p=>p.slice(0,20000))})).filter(ch=>ch.paragraphs.length):original?.chapters;
 if(!chapters?.length)return null;
 return{...original,id:book.id,title:book.title.slice(0,160),author:book.author.slice(0,100),genre:String(book.genre||'Fiction').slice(0,50),description:String(book.description||original?.description||'A new story in the Folio collection.').slice(0,1500),kind:kinds.includes(book.kind)?book.kind:'tomorrow',kicker:original?.kicker||'A Folio story',cover:original?.cover||esc(book.title.slice(0,80)),chapters,category:book.category||'Fiction',priceCents:Number.isSafeInteger(book.priceCents)&&book.priceCents>=99&&book.priceCents<=99999?book.priceCents:499};
}
async function handleAuth(user){
 const previousUid=state.user?.uid||null,nextUid=user?.uid||null,identityChanged=previousUid!==nextUid;
 const generation=++authGeneration;flushProgress();libraryUnsubscribe?.();progressUnsubscribe?.();publicationUnsubscribe?.();ownedUnsubscribe?.();
 if(identityChanged&&membershipDialog.open)membershipFlow.close({silent:true});
 if(identityChanged){identityGeneration++;const share=document.querySelector('#share-dialog');share.close();share.querySelector('input').value='';share.querySelector('h2').textContent='Share your book';}
 let closedBook=null;
 if(identityChanged&&state.readerBook){closedBook=state.readerBook;ignoreReaderClose=true;reader.close();ignoreReaderClose=false;state.readerBook=null;}
 state.user=user;state.cloudError=false;loadCache(user?.uid);updateHeader();
 state.publicationsLoading=Boolean(user);state.ownedLoading=Boolean(user);
 if(identityChanged){shareRequest++;clearTimeout(draftTimer);state.publishing=false;state.publishResult=null;state.publishError='';loadPublishDraft();if(location.hash==='#publish')renderPublisher();}
 refreshMembership();
 if(closedBook)navigate('#book/'+encodeURIComponent(closedBook),{replace:true});
 if(dialog.open)renderAccount('',false,!user);
 if(!state.readerBook)refreshRouteContent();else refreshSavedControls();
 if(location.hash.startsWith('#shared/'))void loadSharedBook(location.hash);
 if(!user)return;
 publicationUnsubscribe=cloud.watchPublications(user.uid,(values,error)=>{
  if(generation!==authGeneration)return;state.publicationsLoading=false;
  if(error){state.cloudError=true;refreshRouteContent();return;}
  state.publications=values.map(decoratePublication).filter(Boolean);
  refreshBooks();
  for(const book of state.publications){try{cachePublication(user.uid,book);}catch{}ensureSaved(book.id);}
  refreshBooks();refreshMembership();
 });
 ownedUnsubscribe=cloud.watchOwnedBooks(user.uid,(values,error)=>{
  if(generation!==authGeneration)return;state.ownedLoading=false;
  if(error){state.cloudError=true;refreshRouteContent();return;}
  state.cloudOwned=new Set(values.map(book=>book.id));
  for(const value of values){try{const book=rememberPublication(value,{persist:false});try{cachePublication(user.uid,book);membership.grantSharedBook(user.uid,book.id,{shareId:book.shareToken});}catch{}ensureSaved(book.id);}catch{state.cloudError=true;}}
  refreshBooks();refreshMembership();
 });
 if(identityChanged&&!previousUid){
  const guestOwned=new Set(membership.readOwned(null).filter(record=>record.source==='shared').map(record=>record.bookId));
  for(const book of readPublicationCache(null).filter(book=>guestOwned.has(book.id)&&book.shareToken))void cloud.claimSharedBook(user.uid,book.id,book.shareToken).then(value=>{
   if(generation!==authGeneration)return;state.cloudOwned.add(book.id);const safe=rememberPublication({...value,shareToken:book.shareToken},{persist:false});try{cachePublication(user.uid,safe);membership.grantSharedBook(user.uid,book.id,{shareId:book.shareToken});}catch{}ensureSaved(book.id);refreshMembership();
  }).catch(()=>{if(generation===authGeneration)state.cloudError=true;});
 }
 const guest=readCache(null),guestSnapshot=JSON.stringify(guest),accountCache=readCache(user.uid);
 let firstLibrary=true,firstProgress=true,libraryImported=false,progressImported=false;
 const importingLibrary=new Set();
 function finishGuestImport(){if(libraryImported&&progressImported&&generation===authGeneration){try{if(JSON.stringify(readCache(null))===guestSnapshot)localStorage.setItem(storageKey(null),JSON.stringify({saved:[],progress:{},mutations:{}}));}catch{}}}
 libraryUnsubscribe=cloud.watchLibrary(user.uid,(items,error)=>{
  if(generation!==authGeneration)return;
  if(error){state.cloudError=true;return;}
  const remote=new Set(items.map(item=>item.bookId||item.id));
  if(firstLibrary){
   firstLibrary=false;
   const imports=guest.saved.filter(id=>/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)&&!remote.has(id)&&!state.mutations[id]);
   imports.forEach(id=>importingLibrary.add(id));
   Promise.all(imports.map(id=>{const mutation={saved:true,updatedAt:Date.now()};state.mutations[id]=mutation;return syncLibraryMutation(user.uid,id,mutation);})).then(results=>{if(results.every(Boolean)){libraryImported=true;importingLibrary.clear();finishGuestImport();}else if(generation===authGeneration)state.cloudError=true;}).catch(()=>{if(generation===authGeneration)state.cloudError=true;});
   for(const [id,mutation]of Object.entries(state.mutations))syncLibraryMutation(user.uid,id,mutation);
  }
  importingLibrary.forEach(id=>remote.add(id));
  for(const [id,mutation]of Object.entries(state.mutations)){if(mutation.saved)remote.add(id);else remote.delete(id);}
  state.saved=remote;persistCache();refreshSavedControls();if(location.hash==='#library')renderPreservingFocus(renderLibrary);else if(location.hash==='#account')renderPreservingFocus(renderProfile);
 });
 progressUnsubscribe=cloud.watchReadingProgress(user.uid,(remote,error)=>{
  if(generation!==authGeneration)return;if(error){state.cloudError=true;return;}
  remote={...remote};
  if(firstProgress){
   firstProgress=false;
   const imports=[];
   for(const id of new Set([...Object.keys(guest.progress),...Object.keys(accountCache.progress)])){
    if(!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id))continue;
    const local=cloud.mergeReadingProgress(guest.progress[id],accountCache.progress[id]);
    const chosen=cloud.mergeReadingProgress(local,remote[id]);
    if(chosen&&(!remote[id]||chosen.updatedAt>remote[id].updatedAt||(chosen.updatedAt===remote[id].updatedAt&&chosen.wordOffset>remote[id].wordOffset))){remote[id]=chosen;imports.push(cloud.saveReadingProgress(user.uid,id,chosen));}
   }
   Promise.all(imports).then(()=>{progressImported=true;finishGuestImport();}).catch(()=>{if(generation===authGeneration)state.cloudError=true;});
  }
  for(const [id,value]of Object.entries(state.progress)){const merged=cloud.mergeReadingProgress(value,remote[id]);if(merged)remote[id]=merged;}
  state.progress=remote;persistCache();refreshRouteContent();
 });
}
function renderAccount(message='',error=false,preserveInputs=false){
 if(!state.emailSignUpEnabled&&state.authMode==='signup')state.authMode='signin';
 const content=document.querySelector('#account-content');
 dialog.querySelector('.account-close').setAttribute('aria-label',state.user&&state.authMode!=='reset'?'Close account':'Close sign in');
 const entered=preserveInputs?['auth-name','auth-email','auth-password'].map(id=>({id,value:document.getElementById(id)?.value,focused:document.activeElement?.id===id})):[];
 if(state.user&&state.authMode!=='reset'){content.innerHTML=`<div class="account-card"><span class="account-mark">${icon('user')}</span><p class="eyebrow">Your corner of Folio</p><h2 id="account-title">Hello, ${esc(state.user.displayName?.split(/\s+/)[0]||'reader')}.</h2><p class="account-email">${esc(state.user.email||'')}</p>${!state.emailSignUpEnabled?'<div class="account-switch">Accounts are managed by Xilo Web Systems.</div>':''}<div class="account-sync">${icon('cloud')}<span>${state.cloudError?'Your library is kept on this device while syncing is unavailable.':'Your library and reading place sync with your account.'}</span></div>${state.cloudError?'<button class="text-action" type="button" data-action="retry-sync">Try syncing again</button>':''}<button class="pill full-width" type="button" data-action="account-library">Open your library</button><button class="text-action account-signout" type="button" data-action="signout">Sign out ${icon('log-out')}</button></div>`;return;}
 const signup=state.authMode==='signup',reset=state.authMode==='reset',available=state.firebase==='ready';
 const accountSwitch=reset?`<button class="text-action" type="button" data-action="auth-mode" data-mode="signin">Back to sign in</button>`:state.emailSignUpEnabled?`${signup?'Already have an account?':'New to Folio?'} <button type="button" data-action="auth-mode" data-mode="${signup?'signin':'signup'}">${signup?'Sign in':'Create an account'}</button>`:'';
 const managedNote=!state.emailSignUpEnabled?'<div class="account-switch">Accounts are managed by Xilo Web Systems.</div>':'';
 content.innerHTML=`<div class="account-card"><span class="account-wordmark">folio</span><h2 id="account-title">${signup?'A little space for your stories.':reset?'A fresh start.':'Welcome back.'}</h2><p class="account-intro">${signup?'Your favourite books. Your reading place. All together.':reset?'Enter your email and we’ll send a link to reset your password.':'Sign in and pick up where you left off.'}</p>${!available?`<p class="account-availability" role="status">${state.firebase==='loading'?'Getting your account ready…':'Accounts will be available soon. You can keep reading as a guest.'}</p>`:''}${message?`<p class="auth-message ${error?'auth-error':''}" role="${error?'alert':'status'}">${esc(message)}</p>`:''}<form id="auth-form">${signup?'<label class="field-label" for="auth-name">Your name</label><input id="auth-name" name="name" type="text" autocomplete="name" maxlength="80" required>':''}<label class="field-label" for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="email" inputmode="email" required>${reset?'':`<label class="field-label" for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="${signup?'new-password':'current-password'}" minlength="6" required>`}<button class="pill full-width" type="submit" ${!available||state.authBusy?'disabled':''}>${state.authBusy?'Just a moment…':signup?'Create account':reset?'Send reset link':'Sign in'} ${icon('arrow-right')}</button></form>${!reset&&state.googleSignInEnabled?`<div class="auth-divider"><span>or</span></div><button class="google-button" type="button" data-action="google" ${!available||state.authBusy?'disabled':''}><span class="google-letter" aria-hidden="true">G</span> Continue with Google</button>`:''}${accountSwitch?`<div class="account-switch">${accountSwitch}</div>`:''}${managedNote}${!signup&&!reset?'<button class="forgot-password" type="button" data-action="auth-mode" data-mode="reset">Forgot your password?</button>':''}<button class="guest-link" type="button" data-action="close-account">Keep reading as a guest</button></div>`;
 for(const input of entered){const field=document.getElementById(input.id);if(field&&input.value!==undefined){field.value=input.value;if(input.focused)field.focus({preventScroll:true});}}
 content.querySelectorAll('[data-action="auth-mode"]').forEach(button=>button.disabled=state.authBusy);
 content.querySelector('form')?.setAttribute('aria-busy',String(state.authBusy));
}
function openAccount(){accountReturnFocus=document.activeElement;state.authMode='signin';renderAccount();if(!dialog.open)dialog.showModal();}
function setAuthBusy(busy){state.authBusy=busy;const form=dialog.querySelector('form');form?.setAttribute('aria-busy',String(busy));dialog.querySelectorAll('[data-action="auth-mode"],[data-action="google"],#auth-form [type="submit"]').forEach(button=>button.disabled=busy||state.firebase!=='ready');if(busy&&form)form.querySelector('[type="submit"]').textContent='Just a moment…';}
function focusAuthMessage(){const message=dialog.querySelector('.auth-message');if(message){message.tabIndex=-1;message.focus({preventScroll:true});}}
async function submitAuth(form){
 if(state.authBusy||state.firebase!=='ready')return;
 const data=new FormData(form),mode=state.authMode;
 if(mode==='signup'&&!state.emailSignUpEnabled)return;
 setAuthBusy(true);
 try{
  if(mode==='signup')await cloud.signUp(String(data.get('email')),String(data.get('password')),String(data.get('name')));
  else if(mode==='reset'){await cloud.sendPasswordReset(String(data.get('email')));state.authBusy=false;renderAccount('Check your inbox for a password reset link.',false,true);focusAuthMessage();return;}
  else await cloud.signIn(String(data.get('email')),String(data.get('password')));
  dialog.close();notify(mode==='signup'?'Welcome to Folio. Your next chapter starts here.':'Welcome back. Make yourself at home.');
 }catch(error){state.authBusy=false;renderAccount(error.message||'We couldn’t sign you in. Please try again.',true);const email=document.querySelector('#auth-email');if(email)email.value=String(data.get('email')||'');focusAuthMessage();}
 finally{setAuthBusy(false);}
}
async function googleAuth(){if(state.authBusy||state.firebase!=='ready'||!state.googleSignInEnabled)return;setAuthBusy(true);try{await cloud.signInWithGoogle();dialog.close();notify('Welcome to Folio.');}catch(error){state.authBusy=false;renderAccount(error.message||'Google sign-in didn’t finish. Please try again.',true,true);focusAuthMessage();}finally{setAuthBusy(false);updateHeader();}}
document.addEventListener('submit',event=>{if(event.target.id==='auth-form'){event.preventDefault();submitAuth(event.target);}else if(event.target.id==='publish-form'){event.preventDefault();void submitPublication(event.target);}});
main.addEventListener('input',event=>{if(!event.target.closest('#publish-form'))return;capturePublishDraft();clearTimeout(draftTimer);draftTimer=setTimeout(savePublishDraft,450);if(event.target.name==='title'||event.target.name==='author')for(const cover of main.querySelectorAll('.publisher-covers .book-cover')){cover.querySelector('.cover-title').textContent=state.publishDraft.title||'Your story';cover.querySelector('.cover-author').textContent=state.publishDraft.author||'Your name';}});
main.addEventListener('change',async event=>{if(event.target.id!=='publish-file')return;const file=event.target.files?.[0],form=event.target.closest('form'),uid=state.user?.uid;if(!file)return;try{if(file.size>450000)throw new Error('Choose a text file smaller than 450 KB.');const text=await file.text();if(!form.isConnected||state.user?.uid!==uid)return;form.elements.manuscript.value=text;capturePublishDraft();savePublishDraft();notify('Your manuscript is ready. Review the details, then publish.');}catch(error){notify(error.message||'This file could not be opened.');}finally{event.target.value='';}});
function placeLibraryMenu(menu){
 const popup=menu.querySelector('.library-book-menu'),anchor=menu.querySelector('summary').getBoundingClientRect();
 const header=document.querySelector('.folio-nav-surface')?.getBoundingClientRect().bottom||0;
 if(anchor.bottom<header+4||anchor.top>innerHeight){if(menu.contains(document.activeElement))menu.querySelector('summary').focus({preventScroll:true});menu.open=false;return;}
 const width=document.documentElement.clientWidth;
 const bottom=innerHeight-12;
 const x=Math.max(12,Math.min(anchor.right-popup.offsetWidth,width-popup.offsetWidth-12));
 const y=anchor.bottom+5+popup.offsetHeight<=bottom?anchor.bottom+5:Math.max(header+8,anchor.top-popup.offsetHeight-5);
 popup.style.left=`${x}px`;popup.style.top=`${y}px`;
}
document.addEventListener('toggle',event=>{
 const menu=event.target;if(!menu.matches?.('.library-menu')||!menu.open)return;
 for(const other of document.querySelectorAll('.library-menu[open]'))if(other!==menu)other.open=false;
 // A keyboard-opened trigger under the glass header scrolls clear first; scroll-padding keeps it below the header.
 const trigger=menu.querySelector('summary'),headerBottom=document.querySelector('.folio-nav-surface')?.getBoundingClientRect().bottom||0,rect=trigger.getBoundingClientRect();
 if(rect.bottom<headerBottom+4||rect.top>innerHeight)trigger.scrollIntoView({block:'nearest',behavior:'instant'});
 placeLibraryMenu(menu);
},true);
window.addEventListener('resize',()=>{for(const menu of document.querySelectorAll('.library-menu[open]'))placeLibraryMenu(menu);});
window.addEventListener('scroll',()=>{for(const menu of document.querySelectorAll('.library-menu[open]'))placeLibraryMenu(menu);},{passive:true});
document.addEventListener('click',async event=>{
 lastActionTarget=event.target.closest?.('button,a,summary');
 for(const menu of document.querySelectorAll('.library-menu[open]'))if(!menu.contains(event.target))menu.open=false;
 const navLink=event.target.closest('a[href^="#"]:not([data-action])');
 if(navLink&&!event.defaultPrevented&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&/^#(?:home|discover|collections|library|account|publish|browse|search(?:\?|$)|book\/|read\/|shared\/)/.test(navLink.getAttribute('href'))){event.preventDefault();if(navLink.matches('.nav-back'))navigation.backTo(state.detailReturnRoute);else navigate(navLink.getAttribute('href'),{source:navLink});return;}
 const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action,id=button.dataset.book;
 if(action==='detail'){if(!location.hash.startsWith('#book/')&&!location.hash.startsWith('#read/'))state.detailReturnRoute=location.hash||'#home';navigate('#book/'+encodeURIComponent(id),{source:button});}
 else if(action==='read'){state.lastRoute=location.hash&&!location.hash.startsWith('#read/')?location.hash:'#book/'+id;navigate('#read/'+encodeURIComponent(id));}
 else if(action==='save')toggleSave(id);
 else if(action==='library-layout'){libraryView.layout=libraryView.layout==='grid'?'list':'grid';saveLibraryView();renderPreservingFocus(renderLibrary);}
 else if(action==='library-sort'){libraryView.sort=button.dataset.sort==='title'?'title':'recent';saveLibraryView();renderLibrary();document.querySelector('.library-sort summary')?.focus({preventScroll:true});}
 else if(action==='genre'){state.homeGenre=['All','Fiction','Ideas','Escape'].includes(button.dataset.genre)?button.dataset.genre:'All';renderPreservingFocus(renderHome);}
 else if(action==='collection'){event.preventDefault();state.homeGenre=button.dataset.genre;navigate('#discover');}
 else if(action==='collections')navigate('#collections');
 else if(action==='browse')navigate('#browse');
 else if(action==='search'){if(searchBar.hidden)openSearch();else closeSearch();}
 else if(action==='close-search')closeSearch();
 else if(action==='clear-search'){state.searchQuery='';navigation.replaceHash(searchHash());setSearch(true,{focus:true});renderSearch();}
 else if(action==='account')navigate('#account',{source:button});
 else if(action==='signin')openAccount();
 else if(action==='subscribe')openMembership();
 else if(action==='buy-book'){const book=getBook(id);if(book)membershipFlow.open({book,wordOffset:state.progress[id]?.wordOffset||0,intent:'purchase'});}
 else if(action==='share-book')openBookShare(id);
 else if(action==='copy-share-link')void copyBookLink(document.querySelector('#share-book-link'));
 else if(action==='close-share')document.querySelector('#share-dialog').close();
 else if(action==='copy-published-link')void copyBookLink(document.querySelector('#published-share-link'));
 else if(action==='new-publication'){state.publishResult=null;state.publishError='';navigate('#publish');}
 else if(action==='retry-share')void loadSharedBook(location.hash);
 else if(action==='cancel-membership')setMembershipRenewal(false);
 else if(action==='resume-membership')setMembershipRenewal(true);
 else if(action==='reset-account-password'){openAccount();state.authMode='reset';renderAccount();document.querySelector('#auth-email').value=state.user?.email||'';}
 else if(action==='close-account')dialog.close();
 else if(action==='auth-mode'){if(state.authBusy)return;state.authMode=button.dataset.mode==='signup'&&!state.emailSignUpEnabled?'signin':button.dataset.mode;renderAccount('',false,true);document.querySelector('#account-content').scrollTop=0;const field=document.querySelector('#auth-name,#auth-email');field?.focus({preventScroll:true});field?.scrollIntoView({block:'nearest'});}
 else if(action==='retry-sync'){if(state.user){handleAuth(state.user);renderAccount();notify('Syncing your library…');}}
 else if(action==='account-library'){dialog.close();navigate('#library');}
 else if(action==='signout'){flushProgress();try{await cloud.signOut();dialog.close();notify('You’ve signed out. You can keep reading as a guest.');}catch(error){notify(error.message||'Sign out didn’t finish. Please try again.');}}
 else if(action==='google')googleAuth();
 else if(action==='restart'){state.progress[id]={wordOffset:0,fraction:0,updatedAt:Date.now()};persistCache();queueProgress(id,state.progress[id]);navigate('#read/'+encodeURIComponent(id));}
});
searchInput.addEventListener('input',()=>{state.searchQuery=searchInput.value;searchClear.hidden=!searchInput.value;if(!isSearchRoute())navigate(searchHash());else{navigation.replaceHash(searchHash());renderSearch();}});
searchInput.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeSearch();}});
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
dialog.addEventListener('close',()=>{if(!state.readerBook&&(dialog.contains(document.activeElement)||document.activeElement===document.body))(accountReturnFocus?.isConnected?accountReturnFocus:document.querySelector('.account-button')).focus({preventScroll:true});});
document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;for(const menu of document.querySelectorAll('.library-menu[open]')){menu.open=false;menu.querySelector('summary')?.focus({preventScroll:true});}});
// Opening or closing a modal re-hosts a visible toast, so it stays above the newest modal.
const toastHost=new MutationObserver(()=>{if(!toastElement.hidden)showToast();});for(const element of document.querySelectorAll('dialog'))toastHost.observe(element,{attributes:true,attributeFilter:['open']});
const shareDialog=document.querySelector('#share-dialog');
shareDialog.addEventListener('close',()=>{if(shareReturnFocus?.isConnected)shareReturnFocus.focus({preventScroll:true});});
shareDialog.addEventListener('click',event=>{if(event.target!==shareDialog)return;const rect=shareDialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)shareDialog.close();});
window.addEventListener('pagehide',()=>{flushProgress();capturePublishDraft();savePublishDraft();});
window.addEventListener('storage',event=>{if(event.key===publicationCacheKey(state.user?.uid)||event.key===null)refreshBooks();if([membershipKey(state.user?.uid),ownershipKey(state.user?.uid),publicationCacheKey(state.user?.uid),null].includes(event.key))refreshMembership();});
window.addEventListener('online',()=>{if(state.user){const user=state.user;handleAuth(user);for(const [id,progress]of Object.entries(state.progress))queueProgress(id,progress);}});
document.querySelector('.skip-link').addEventListener('click',event=>{event.preventDefault();main.focus({preventScroll:true});main.scrollIntoView({block:'start',behavior:'instant'});});
hydrateIcons();navigation.start();
cloud.subscribeAuth(handleAuth);
cloud.initFirebase().then(async result=>{state.firebase=result.configured&&!result.error?'ready':'unavailable';state.googleSignInEnabled=result.googleSignInEnabled!==false;state.emailSignUpEnabled=result.emailSignUpEnabled!==false;if(dialog.open&&!state.user)renderAccount('',false,true);if(result.configured){try{const records=await cloud.getCatalog();if(records?.length){const remote=records.map(normalizeRemote).filter(Boolean),map=new Map(originalBooks.map(book=>[book.id,book]));remote.forEach(book=>map.set(book.id,book));state.catalog=[...map.values()];refreshBooks();}}catch{}}refreshRouteContent();}).catch(()=>{state.firebase='unavailable';if(dialog.open)renderAccount('',false,true);refreshRouteContent();});

// The reference's subtle cover tilt only follows a mouse, never a reading gesture.
main.addEventListener('pointermove',event=>{const art=event.target.closest('.detail-art');if(!art||event.pointerType!=='mouse'||matchMedia('(prefers-reduced-motion:reduce)').matches)return;const rect=art.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width-.5,y=(event.clientY-rect.top)/rect.height-.5;art.querySelector('.detail-cover').style.transform=`rotateY(${(x*16).toFixed(2)}deg) rotateX(${(-y*10).toFixed(2)}deg)`;});
main.addEventListener('pointerout',event=>{const art=event.target.closest('.detail-art');if(art&&!art.contains(event.relatedTarget))art.querySelector('.detail-cover').style.transform='';});
