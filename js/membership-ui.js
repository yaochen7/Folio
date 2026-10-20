import {escapeHtml as esc,renderCover} from './books.js';
import {icon} from './icons.js';
import {PLANS} from './membership.js';
import {dateLabel} from './account-page.js';

export function createMembershipDialog({dialog,service,getUid,onChange,onDismiss}){
 const content=dialog.querySelector('.membership-content'),motion=matchMedia('(prefers-reduced-motion:reduce)');
 let step='plans',planId='monthly',context={},controller,returnFocus,record,error='',animations=[],busy=false,completed=false,silent=false;
 const stop=()=>{animations.forEach(animation=>animation.cancel());animations=[];};
 function render(){
  stop();const previous=dialog.open?dialog.getBoundingClientRect().height:0,plan=PLANS[planId];
  const close=`<button class="membership-close icon-button" type="button" data-membership-action="close" aria-label="Close ${step==='plans'?'Folio Plus':'checkout'}">${icon('x')}</button>`;
  const book=context.book;
  const heading=step==='plans'?`<span class="plus-wordmark">folio<span>+</span></span><p class="membership-kicker">${book?'The story continues.':'Make room for more stories.'}</p><h2 id="membership-dialog-title">${book?'One chapter in.<br>A whole world ahead.':'Your next chapter.<br>And the one after that.'}</h2><p class="membership-intro">${book?`You’ve reached the end of the free preview of <em>${esc(book.title)}</em>.`:'Every story in the collection, ready when you are.'} Unlock every chapter with Folio Plus.</p>`:step==='checkout'?`<button class="membership-back text-action" type="button" data-membership-action="back">${icon('chevron-left')} Plans</button><h2 id="membership-dialog-title">A little more Folio.</h2><p class="membership-intro">${plan.label} membership. Every book, every chapter.</p>`:`<div class="membership-success-mark">${icon('check')}</div><p class="membership-kicker">Folio Plus · Demo</p><h2 id="membership-dialog-title">Your next chapter<br>is ready.</h2><p class="membership-intro">Your demo subscription is active. Make yourself comfortable.</p>`;
  content.innerHTML=`${close}<div class="membership-step" data-step="${step}">${heading}${step==='plans'?`${book?`<div class="membership-book"><span>${renderCover(book)}</span><div><strong>${esc(book.title)}</strong><small>${esc(book.author)}</small><small>Chapter One · Free preview</small></div></div>`:''}<fieldset class="membership-plans"><legend class="sr-only">Choose your Folio Plus plan</legend>${Object.values(PLANS).map(option=>`<label class="membership-plan"><input type="radio" name="membership-plan" value="${option.id}" ${option.id===planId?'checked':''}><span><strong>${option.label}${option.id==='annual'?'<small>Save 37%</small>':''}</strong><span>${option.id==='annual'?'Billed yearly · About $5.00 / month':'Billed monthly'}</span></span><span class="plan-price">${option.price}<small>/ ${option.interval}</small></span></label>`).join('')}</fieldset><button class="pill full-width" type="button" data-membership-action="checkout">Continue to demo checkout ${icon('arrow-right')}</button><button class="membership-secondary" type="button" data-membership-action="close">${book?'Keep the preview':'Maybe later'}</button>`:step==='checkout'?`<div class="checkout-summary"><div><span>Folio Plus · ${plan.label}</span><strong>${plan.price} / ${plan.interval}</strong></div><div><span>Demo total today</span><strong>${plan.price} USD</strong></div></div><div class="demo-payment-method">${icon('credit-card')}<span><strong>Demo card ···· 4242</strong><small>No payment details needed</small></span><span class="demo-badge">Test mode</span></div><label class="demo-outcome">Demo payment result<select name="payment-result"><option value="approved">Approved</option><option value="declined" ${error?'selected':''}>Declined</option></select></label>${error?`<p class="membership-error" role="alert">${esc(error)}</p>`:''}<button class="pill full-width" type="button" data-membership-action="pay">Confirm demo subscription · ${plan.price}</button>`:`<div class="membership-receipt"><div><span>${plan.label} membership</span><strong>${plan.price} / ${plan.interval}</strong></div><p>Demo access through ${dateLabel(record.expiresAt)}</p><small>Demo payment approved · No charge made</small></div><button class="pill full-width" type="button" data-membership-action="close">${book?'Continue reading':'Go to your account'} ${icon('arrow-right')}</button>`}<p class="membership-disclosure">Mock checkout. No money is collected. Demo access stays on this device.</p></div>`;
  if(dialog.open&&!motion.matches){
   const next=dialog.getBoundingClientRect().height;
   if(previous)animations.push(dialog.animate([{height:`${previous}px`},{height:`${next}px`}],{duration:320,easing:'cubic-bezier(.22,1,.36,1)'}));
   animations.push(content.querySelector('.membership-step').animate([{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'none'}],{duration:260,easing:'cubic-bezier(.22,1,.36,1)'}));
  }
  const title=content.querySelector('h2');title.tabIndex=-1;if(dialog.open)title.focus({preventScroll:true});
 }
 function close(options={}){silent=options.silent===true;controller?.abort();dialog.close();}
 async function pay(){
  if(busy)return;busy=true;const uid=getUid(),attempt=new AbortController();controller=attempt;
  const outcome=content.querySelector('[name="payment-result"]').value,button=content.querySelector('[data-membership-action="pay"]');
  button.disabled=true;button.innerHTML='<span class="payment-spinner" aria-hidden="true"></span> Processing demo payment…';content.setAttribute('aria-busy','true');
  content.querySelector('select').disabled=true;content.querySelector('[data-membership-action="back"]').disabled=true;
  try{
   record=await service.checkout({uid,planId,outcome,signal:attempt.signal});
   if(!dialog.open||attempt.signal.aborted||uid!==getUid())return;
   completed=true;step='success';error='';onChange(record);render();
  }catch(failure){if(failure.name!=='AbortError'&&dialog.open){error=failure.message;render();}}
  finally{if(controller===attempt){controller=null;busy=false;content.removeAttribute('aria-busy');}}
 }
 dialog.addEventListener('click',event=>{
  const action=event.target.closest('[data-membership-action]')?.dataset.membershipAction;
  if(action==='close')close();
  else if(action==='pay')void pay();
  else if(!busy&&action==='checkout'){step='checkout';error='';render();}
  else if(!busy&&action==='back'){step='plans';error='';render();}
 });
 dialog.addEventListener('change',event=>{if(event.target.name==='membership-plan')planId=event.target.value;});
 dialog.addEventListener('cancel',()=>controller?.abort());
 dialog.addEventListener('close',()=>{
  controller?.abort();controller=null;busy=false;stop();content.removeAttribute('aria-busy');
  if(!silent){
   onDismiss({completed,...context});
   if(returnFocus?.isConnected&&!returnFocus.closest('[hidden],[inert]'))returnFocus.focus({preventScroll:true});
  }
 });
 motion.addEventListener('change',()=>{if(motion.matches)stop();});
 return {open(next={}){if(dialog.open)return;returnFocus=document.activeElement;context=next;completed=false;silent=false;step='plans';planId=service.read(getUid())?.planId || 'monthly';error='';render();dialog.showModal();const title=content.querySelector('h2');title.focus({preventScroll:true});},close};
}
