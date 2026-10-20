import {escapeHtml as esc,renderCover} from './books.js';
import {icon} from './icons.js';
import {PLANS,bookPrice} from './membership.js';
import {dateLabel} from './account-page.js';

export function createMembershipDialog({dialog,service,getUid,onChange,onDismiss}){
 const content=dialog.querySelector('.membership-content'),closeButton=dialog.querySelector('.membership-close'),motion=matchMedia('(prefers-reduced-motion:reduce)');
 let step='plans',planId='monthly',context={},kind='subscription',controller,returnFocus,record,error='',animations=[],busy=false,completed=false,silent=false,session=0,renderedStep=null;
 const stop=()=>{animations.forEach(animation=>animation.cancel());animations=[];};
 // A classic scrollbar narrows the body; the actions and close button follow it, and a fade marks more below.
 const moreBelow=scroller=>scroller.toggleAttribute('data-more',scroller.scrollTop+scroller.clientHeight<scroller.scrollHeight-2);
 const gutter=new ResizeObserver(([entry])=>{dialog.style.setProperty('--membership-gutter',`${entry.target.offsetWidth-entry.target.clientWidth}px`);moreBelow(entry.target);});
 function bookSummary(){
  const book=context.book;
  return book?`<div class="membership-book"><span>${renderCover(book)}</span><div><strong>${esc(book.title)}</strong><small>${esc(book.author)}</small><small>${step==='plans'?'Chapter One · Free preview':kind==='purchase'?'Complete book · Yours to read':'Included with Folio Plus'}</small></div></div>`:'';
 }
 function render(){
  stop();const previous=dialog.open?dialog.getBoundingClientRect().height:0,plan=PLANS[planId],book=context.book,price=bookPrice(book),purchase=kind==='purchase';
  closeButton.setAttribute('aria-label',step==='plans'?'Close reading options':step==='success'?'Close confirmation':'Close checkout');
  let heading,body,actions;
  if(step==='plans'){
   heading=`<span class="plus-wordmark">folio<span>+</span></span><p class="eyebrow membership-kicker">${book?'The story continues.':'Make room for more stories.'}</p><h2 id="membership-dialog-title">${book?(context.intent==='purchase'?'Your story. <span class="heading-line">Your way to read.</span>':'One chapter in. <span class="heading-line">A whole world ahead.</span>'):'Your next chapter. <span class="heading-line">And the one after that.</span>'}</h2><p class="membership-intro">${book?(context.intent==='purchase'?`Keep <em>${esc(book.title)}</em> in your library, or explore every story with Folio Plus.`:`You’ve reached the end of the free preview of <em>${esc(book.title)}</em>. Keep this book, or explore every story with Folio Plus.`):'Every story in the collection, ready when you are. Unlock every chapter with Folio Plus.'}</p>`;
   body=`${bookSummary()}${book?`<section class="membership-purchase-option" aria-label="Buy this book"><div><strong>One story. Yours to keep.</strong><p>Full access to every chapter. No subscription needed.</p></div><button class="glass-button full-width" type="button" data-membership-action="buy">Buy this book <span>${price.price}</span></button></section><p class="membership-choice-divider">Or read every book with Folio Plus</p>`:''}<fieldset class="membership-plans"><legend class="sr-only">Choose your Folio Plus plan</legend>${Object.values(PLANS).map(option=>`<label class="membership-plan"><input type="radio" name="membership-plan" value="${option.id}" ${option.id===planId?'checked':''}><span><strong>${option.label}${option.id==='annual'?'<small>Save 37%</small>':''}</strong><span>${option.id==='annual'?'Billed yearly · About $5.00 / month':'Billed monthly'}</span></span><span class="plan-price">${option.price}<small>/ ${option.interval}</small></span></label>`).join('')}</fieldset>`;
   actions=`<button class="pill full-width" type="button" data-membership-action="checkout">Continue with Folio Plus ${icon('arrow-right')}</button><button class="membership-secondary" type="button" data-membership-action="close">${book?'Keep the preview':'Maybe later'}</button>`;
  }else if(step==='checkout'){
   heading=`<button class="membership-back text-action" type="button" data-membership-action="back">${icon('chevron-left')} ${book?'Reading options':'Plans'}</button><h2 id="membership-dialog-title">${purchase?'Make this story yours.':'A little more Folio.'}</h2><p class="membership-intro">${purchase?'One book. Every chapter. Always ready when you are.':`${plan.label} membership. Every book, every chapter.`}</p>`;
   body=`${purchase?bookSummary():''}<div class="checkout-summary"><div><span>${purchase?esc(book.title):`Folio Plus · ${plan.label}`}</span><strong>${purchase?price.price:`${plan.price} / ${plan.interval}`}</strong></div><div><span>Total</span><strong>${purchase?price.price:plan.price} USD</strong></div></div><div class="checkout-payment-method">${icon('credit-card')}<span><strong>Folio checkout</strong><small>${purchase?'One-time purchase':'Manage your plan from your account'}</small></span></div>`;
   actions=`${error?`<p class="membership-error" role="alert">${esc(error)}</p>`:''}<button class="pill full-width" type="button" data-membership-action="pay">Confirm ${purchase?'purchase':'subscription'} · ${purchase?price.price:plan.price}</button><p class="membership-disclosure">${purchase?'This book will be added to your library.':'Cancel renewal at any time from your account.'}</p>`;
  }else{
   heading=`<div class="membership-success-mark">${icon('check')}</div><p class="eyebrow membership-kicker">${purchase?'Added to your library':'Folio Plus'}</p><h2 id="membership-dialog-title">Your next chapter <span class="heading-line">is ready.</span></h2><p class="membership-intro">${purchase?`<em>${esc(book.title)}</em> is yours to read.`:'Your subscription is active. Make yourself comfortable.'}</p>`;
   body=`<div class="membership-receipt"><div><span>${purchase?esc(book.title):`${plan.label} membership`}</span><strong>${purchase?price.price:`${plan.price} / ${plan.interval}`}</strong></div><p>${purchase?'Full book access · No subscription needed':`Access through ${dateLabel(record.expiresAt)}`}</p><small>${purchase?'Purchase confirmed':'Subscription confirmed'}</small></div>`;
   actions=`<button class="pill full-width" type="button" data-membership-action="close">${book?'Continue reading':'Go to your account'} ${icon('arrow-right')}</button>`;
  }
  // Only the body scrolls, so the actions stay in reach; a new step starts at its top.
  const scrollTop=step===renderedStep?content.querySelector('.membership-body')?.scrollTop||0:0;renderedStep=step;
  content.innerHTML=`<div class="membership-step" data-step="${step}" data-checkout-kind="${kind}"><div class="membership-body">${heading}${body}</div><div class="membership-actions">${actions}</div></div>`;
  const scroller=content.querySelector('.membership-body');scroller.scrollTop=scrollTop;gutter.disconnect();gutter.observe(scroller);scroller.addEventListener('scroll',()=>moreBelow(scroller),{passive:true});moreBelow(scroller);
  if(dialog.open&&!motion.matches){
   const next=dialog.getBoundingClientRect().height;
   // The body would overflow mid-animation; hiding it avoids a flash of scrollbar and a narrowed CTA.
   if(previous){scroller.style.overflowY='hidden';const resize=dialog.animate([{height:`${previous}px`},{height:`${next}px`}],{duration:320,easing:'cubic-bezier(.22,1,.36,1)'});resize.onfinish=resize.oncancel=()=>scroller.style.removeProperty('overflow-y');animations.push(resize);}
   animations.push(content.querySelector('.membership-step').animate([{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'none'}],{duration:260,easing:'cubic-bezier(.22,1,.36,1)'}));
  }
  const title=content.querySelector('h2');title.tabIndex=-1;if(dialog.open)title.focus({preventScroll:true});
 }
 function close(options={}){silent=options.silent===true;controller?.abort();dialog.close();}
 async function pay(){
  if(busy||step!=='checkout')return;busy=true;const uid=getUid(),attempt=new AbortController(),attemptSession=session;controller=attempt;
  const button=content.querySelector('[data-membership-action="pay"]');
  button.disabled=true;button.innerHTML='<span class="payment-spinner" aria-hidden="true"></span> Confirming…';content.setAttribute('aria-busy','true');
  content.querySelector('[data-membership-action="back"]').disabled=true;
  try{
   record=kind==='purchase'?await service.purchaseBook({uid,book:context.book,signal:attempt.signal}):await service.checkout({uid,planId,signal:attempt.signal});
   if(!dialog.open||attempt.signal.aborted||uid!==getUid()||session!==attemptSession)return;
   completed=true;step='success';error='';onChange(record,{...context,purchase:kind==='purchase'});render();
  }catch(failure){if(failure.name!=='AbortError'&&dialog.open&&session===attemptSession&&uid===getUid()){error=failure.message;render();}}
  finally{if(controller===attempt){controller=null;busy=false;content.removeAttribute('aria-busy');}}
 }
 dialog.addEventListener('click',event=>{
  const action=event.target.closest('[data-membership-action]')?.dataset.membershipAction;
  if(action==='close')close();
  else if(action==='pay')void pay();
  else if(!busy&&action==='checkout'){kind='subscription';step='checkout';error='';render();}
  else if(!busy&&action==='buy'&&context.book){kind='purchase';step='checkout';error='';render();}
  else if(!busy&&action==='back'){step='plans';error='';render();}
 });
 dialog.addEventListener('change',event=>{if(event.target.name==='membership-plan')planId=event.target.value;});
 // Focus lands on the small radio, so bring its whole card (and focus ring) into view.
 dialog.addEventListener('focusin',event=>{if(event.target.name!=='membership-plan')return;const card=event.target.closest('.membership-plan'),scroller=card.closest('.membership-body'),box=card.getBoundingClientRect(),view=scroller.getBoundingClientRect(),below=scroller.hasAttribute('data-more')?48:8;if(box.bottom+below>view.bottom)scroller.scrollTop+=box.bottom+below-view.bottom;else if(box.top-8<view.top)scroller.scrollTop-=view.top-box.top+8;});
 dialog.addEventListener('cancel',()=>controller?.abort());
 dialog.addEventListener('close',()=>{
  controller?.abort();controller=null;busy=false;stop();content.removeAttribute('aria-busy');
  if(!silent){
   onDismiss({...context,completed,purchase:kind==='purchase'});
   if(returnFocus?.isConnected&&!returnFocus.closest('[hidden],[inert]'))returnFocus.focus({preventScroll:true});
  }
 });
 motion.addEventListener('change',()=>{if(motion.matches)stop();});
 return {open(next={}){if(dialog.open)return;session++;returnFocus=document.activeElement;context=next;completed=false;silent=false;kind=next.intent==='purchase'&&next.book?'purchase':'subscription';step=kind==='purchase'?'checkout':'plans';planId=service.read(getUid())?.planId || 'monthly';error='';record=null;renderedStep=null;render();dialog.showModal();const title=content.querySelector('h2');title.focus({preventScroll:true});},close};
}
