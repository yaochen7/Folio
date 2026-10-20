// Opt-in browser regression; run the dev server and configure Playwright as in README.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.FOLIO_TEST_URL||'http://127.0.0.1:4173/';
const expanded=page=>page.locator('.fr-liquid-surface[data-fr-expanded="true"]').waitFor();
async function openMenu(page){
 await page.waitForFunction(()=>!['opening','closing'].includes(document.querySelector('.fr-reader')?.dataset.frAppearance));
 if(await page.locator('.fr-menu-toggle').getAttribute('aria-expanded')!=='true')await page.locator('.fr-menu-toggle').click();
 await expanded(page);await page.waitForTimeout(650);
}

test('one liquid reader button exposes working, accessible controls',async t=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{
  for(const width of [320,390,1440])await t.test(String(width),async()=>{
   const context=await browser.newContext({viewport:{width,height:844},hasTouch:width<900,isMobile:width<900,reducedMotion:'no-preference'});
   await context.route('**/firebase-config.json',route=>route.fulfill({json:{}}));
   await context.addInitScript(()=>localStorage.setItem('folio.demo-membership.v1.guest',JSON.stringify({demo:true,planId:'monthly',startedAt:Date.now(),expiresAt:Date.now()+86400000,renew:true,receiptId:'FOLIO-DEMO-reader-fixture'})));
   const page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   page.setDefaultTimeout(10000);
   await page.goto(base+'#read/quiet');
   await page.locator('.fr-book[aria-busy="false"]').waitFor();
   await page.waitForTimeout(1100);
   assert.equal(await page.locator('.fr-tap-input').isChecked(),false);
   const bookBounds=await page.locator('.fr-book').boundingBox();
   if(width<900){
    assert.deepEqual(bookBounds,{x:0,y:0,width,height:844},'mobile pages fill the viewport');
    assert.equal(await page.locator('.fr-book').evaluate(e=>getComputedStyle(e).boxShadow),'none');
   }
   const initialOffset=await page.locator('.fr-progress-range').inputValue();
   for(const x of [bookBounds.x+bookBounds.width-8,bookBounds.x+8]){
    if(width<900)await page.touchscreen.tap(x,bookBounds.y+bookBounds.height*.45);
    else await page.mouse.click(x,bookBounds.y+bookBounds.height*.45);
   }
   assert.equal(await page.locator('.fr-progress-range').inputValue(),initialOffset,'edge taps do not turn pages by default');
   assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#reader-root button')].filter(e=>e.getClientRects().length&&e.tabIndex>=0&&!e.closest('[hidden],[inert]')).length),1);
   assert.equal(await page.locator('.fr-controls-host svg[data-gooey-svg]').count(),1);
   assert.equal(await page.locator('.fr-liquid-actions').evaluate(e=>getComputedStyle(e).opacity),'0');
   assert.equal(await page.locator('.fr-toolbar button,.fr-footer button').count(),0);
   await openMenu(page);
   assert.ok(await page.evaluate(()=>{
    const bounds=[...document.querySelectorAll('.fr-controls-host button')].map(e=>e.getBoundingClientRect());
    return bounds.every(r=>r.left>=12&&r.right<=innerWidth-12&&r.top>=0&&r.bottom<=innerHeight-8&&r.width>=44&&r.height>=44)&&bounds.every((r,i)=>bounds.every((s,j)=>i===j||Math.max(s.left-r.right,r.left-s.right,s.top-r.bottom,r.top-s.bottom)>=8));
   }),'expanded controls have visible breathing room');
   assert.ok(await page.locator('[data-fr-action="previous"]').isDisabled());
   await page.locator('.fr-appearance-toggle').click();
   const offset=await page.locator('.fr-progress-range').inputValue();
   await page.locator('.fr-theme-option[data-fr-theme-option="night"]').click();
   assert.equal(await page.locator('.fr-reader').getAttribute('data-fr-theme'),'night');
   await page.locator('.fr-appearance-panel [data-fr-action="larger"]').click();
   assert.equal(await page.locator('.fr-progress-range').inputValue(),offset);
   await page.keyboard.press('Escape');
   assert.ok(await page.evaluate(()=>document.activeElement.matches('.fr-appearance-toggle')));
   await openMenu(page);
   await page.locator('.fr-search-toggle').click();
   await page.locator('.fr-book-search').fill('quiet');
   assert.ok(await page.locator('.fr-search-results button').count()>0);
   await page.keyboard.press('Escape');
   await openMenu(page);
   await page.locator('.fr-contents-toggle').click();
   await page.locator('.fr-progress-range').focus();
   await page.keyboard.press('ArrowRight');
   assert.ok(await page.locator('.fr-contents-panel').isVisible());
   assert.ok(await page.evaluate(()=>document.activeElement.matches('.fr-progress-range')));
   await page.locator('.fr-chapter-list button').last().click();
   await openMenu(page);
   assert.equal(await page.locator('[data-fr-action="previous"]').isDisabled(),false);
   await page.locator('[data-fr-action="previous"]').click();
   await page.waitForFunction(()=>!document.querySelector('.fr-book').classList.contains('fr-turning'));
   assert.equal(await page.locator('.fr-liquid-surface').getAttribute('data-fr-expanded'),'false');
   await page.locator('.fr-menu-toggle').focus();
   await page.keyboard.press('Enter');
   await expanded(page);
   assert.ok(await page.evaluate(()=>document.activeElement.matches('.fr-contents-toggle')));
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('.fr-liquid-surface').getAttribute('data-fr-expanded'),'false');
   assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.fr-base .fr-page-body')].every(e=>e.scrollHeight<=e.clientHeight+1)));
   await page.emulateMedia({reducedMotion:'reduce'});
   await openMenu(page);
   assert.ok(await page.locator('.fr-liquid-row').first().evaluate(e=>getComputedStyle(e).transitionDuration.split(',').every(x=>parseFloat(x)===0)));
   await page.locator('.fr-close').click();
   assert.equal(await page.locator('.fr-controls-host svg').count(),0);
   assert.equal(await page.evaluate(()=>document.body.classList.contains('reader-open')),false);
   await page.goto(base+'#read/atlas');
   await page.locator('.fr-book[aria-busy="false"]').waitFor();
   assert.equal(await page.locator('.fr-menu-toggle').count(),1);
   assert.deepEqual(errors,[]);
   await context.close();
  });
  await t.test('closing controls stay visible while flowing back and can reverse',async()=>{
   const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'no-preference'});
   await context.route('**/firebase-config.json',route=>route.fulfill({json:{}}));
   await context.addInitScript(()=>localStorage.setItem('folio.demo-membership.v1.guest',JSON.stringify({demo:true,planId:'monthly',startedAt:Date.now(),expiresAt:Date.now()+86400000,renew:true,receiptId:'FOLIO-DEMO-reader-fixture'})));
   const page=await context.newPage();
   await page.goto(base+'#read/quiet');
   await page.locator('.fr-book[aria-busy="false"]').waitFor();
   await page.waitForTimeout(1100);
   await openMenu(page);
   const result=await page.evaluate(async()=>{
    const group=document.querySelector('.fr-liquid-actions'),item=document.querySelector('.fr-contents-toggle').closest('.fr-liquid-item'),menu=document.querySelector('.fr-menu-toggle');
    const y=()=>Number(item.style.transform.match(/, ([-\d.]+)px/)?.[1]||0),start=Math.abs(y()),frames=[];
    menu.click();
    const inert=group.inert&&[...group.querySelectorAll('button')].every(e=>e.tabIndex<0);
    const until=performance.now()+650;
    await new Promise(resolve=>{const record=()=>{frames.push({remaining:Math.abs(y())/start,opacity:Number(getComputedStyle(group).opacity)});if(performance.now()<until)requestAnimationFrame(record);else resolve()};requestAnimationFrame(record)});
    menu.click();
    await new Promise(resolve=>setTimeout(resolve,160));
    menu.click();
    await new Promise(resolve=>setTimeout(resolve,130));
    menu.click();
    return{inert,frames};
   });
   assert.equal(result.inert,true,'closing tools stop receiving input immediately');
   const returning=result.frames.filter(frame=>frame.remaining>.15&&frame.remaining<.65);
   assert.ok(returning.length>0,'the return motion includes intermediate positions');
   assert.ok(returning.every(frame=>frame.opacity>.8),'surfaces remain visible during the return');
   await page.waitForFunction(()=>{
    const e=document.querySelector('.fr-contents-toggle').closest('.fr-liquid-item'),y=Number(e.style.transform.match(/, ([-\d.]+)px/)?.[1]||0);
    return Math.abs(y+parseFloat(e.style.top))<.25;
   });
   assert.equal(await page.locator('.fr-menu-toggle').getAttribute('aria-expanded'),'true','interrupted motion reaches the latest state');
   assert.equal(await page.locator('.fr-controls-host svg[data-gooey-svg]').count(),1);
   await context.close();
  });
  await t.test('Themes & Text shares a surface with its pill and reverses without jumping',async()=>{
   const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'no-preference'});
   await context.route('**/firebase-config.json',route=>route.fulfill({json:{}}));
   await context.addInitScript(()=>localStorage.setItem('folio.demo-membership.v1.guest',JSON.stringify({demo:true,planId:'monthly',startedAt:Date.now(),expiresAt:Date.now()+86400000,renew:true,receiptId:'FOLIO-DEMO-reader-fixture'})));
   const page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.goto(base+'#read/quiet');
   await page.locator('.fr-book[aria-busy="false"]').waitFor();
   await page.waitForTimeout(1100);
   await openMenu(page);
   const result=await page.evaluate(async()=>{
    const reader=document.querySelector('.fr-reader'),pill=document.querySelector('.fr-appearance-toggle'),surface=document.querySelector('.fr-appearance-surface'),panel=document.querySelector('.fr-appearance-panel'),content=document.querySelector('.fr-appearance-content');
    const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const source=rect(pill);
    pill.click();
    const start=rect(surface),target=rect(panel),toolsInert=document.querySelector('.fr-controls-host').inert;
    await wait(140);
    const middle=rect(surface),textTransform=getComputedStyle(content).transform;
    const beforeBack=rect(surface);
    panel.querySelector('[data-fr-action="close-panel"]').click();
    const afterBack=rect(surface),closingInert=panel.inert;
    await wait(110);
    const beforeReopen=rect(surface);
    pill.click();
    const afterReopen=rect(surface);
    return{source,start,target,middle,textTransform,toolsInert,closingInert,beforeBack,afterBack,beforeReopen,afterReopen};
   });
   const sameRect=(a,b)=>Object.keys(a).every(key=>Math.abs(a[key]-b[key])<1);
   assert.ok(sameRect(result.start,result.source),'the surface starts at the actual pill');
   assert.ok(result.middle.height>result.source.height+10&&result.middle.height<result.target.height,'the glass grows through intermediate shapes');
   assert.ok(result.textTransform==='none'||/^matrix\(1, 0, 0, 1,/.test(result.textTransform),'settings text is translated, never scaled');
   assert.equal(result.toolsInert,true,'the fading menu cannot receive hidden input');
   assert.equal(result.closingInert,true,'returning settings stop receiving input immediately');
   assert.ok(sameRect(result.beforeBack,result.afterBack),'Back reverses from the current glass bounds');
   assert.ok(sameRect(result.beforeReopen,result.afterReopen),'reopening continues from the current glass bounds');
   await page.waitForFunction(()=>document.querySelector('.fr-reader').dataset.frAppearance==='open');
   assert.equal(await page.locator('.fr-appearance-surface').isVisible(),false);
   await page.locator('[data-fr-theme-option="night"]').click();
   await page.getByRole('button',{name:'Back to reading tools'}).click();
   await page.waitForFunction(()=>document.querySelector('.fr-reader').dataset.frAppearance==='closed');
   assert.ok(await page.evaluate(()=>document.activeElement.matches('.fr-appearance-toggle')));
   assert.equal(await page.locator('.fr-menu-toggle').getAttribute('aria-expanded'),'true');
   await page.locator('.fr-appearance-toggle').click();
   await page.setViewportSize({width:844,height:390});
   await page.waitForFunction(()=>document.querySelector('.fr-reader').dataset.frAppearance==='open');
   assert.ok(await page.locator('.fr-appearance-panel').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}),'resize settles into the correct panel bounds');
   assert.equal(await page.locator('[data-fr-theme-option="night"]').getAttribute('aria-pressed'),'true');
   await page.emulateMedia({reducedMotion:'reduce'});
   await page.keyboard.press('Escape');
   await page.locator('.fr-appearance-toggle').click();
   assert.equal(await page.locator('.fr-reader').getAttribute('data-fr-appearance'),'open');
   assert.equal(await page.locator('.fr-appearance-surface').isVisible(),false,'reduced motion changes state immediately');
   await page.keyboard.press('Escape');
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('.fr-menu-toggle').getAttribute('aria-expanded'),'false');
   assert.deepEqual(errors,[]);
   await context.close();
  });
  await t.test('tap turning is an opt-in context setting that persists',async()=>{
   const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
   await context.route('**/firebase-config.json',route=>route.fulfill({json:{}}));
   await context.addInitScript(()=>localStorage.setItem('folio.demo-membership.v1.guest',JSON.stringify({demo:true,planId:'monthly',startedAt:Date.now(),expiresAt:Date.now()+86400000,renew:true,receiptId:'FOLIO-DEMO-reader-fixture'})));
   const page=await context.newPage();
   await page.goto(base+'#read/quiet');
   await page.locator('.fr-book[aria-busy="false"]').waitFor();
   await openMenu(page);
   await page.locator('.fr-appearance-toggle').click();
   await page.getByRole('checkbox',{name:/Tap to turn pages/}).check();
   await page.keyboard.press('Escape');
   await page.keyboard.press('Escape');
   const before=await page.locator('.fr-progress-range').inputValue();
   await page.touchscreen.tap(382,400);
   await page.waitForFunction(()=>Number(document.querySelector('.fr-progress-range').value)>0);
   assert.notEqual(await page.locator('.fr-progress-range').inputValue(),before);
   await page.reload();
   await page.locator('.fr-book[aria-busy="false"]').waitFor();
   assert.equal(await page.locator('.fr-tap-input').isChecked(),true,'explicit preference survives reload');
   await openMenu(page);
   await page.locator('.fr-appearance-toggle').click();
   await page.getByRole('checkbox',{name:/Tap to turn pages/}).uncheck();
   await page.keyboard.press('Escape');
   await page.keyboard.press('Escape');
   const offset=await page.locator('.fr-progress-range').inputValue();
   await page.touchscreen.tap(382,400);
   await page.touchscreen.tap(8,400);
   assert.equal(await page.locator('.fr-progress-range').inputValue(),offset,'switching it off immediately protects both edges');
   await page.reload();
   await page.locator('.fr-book[aria-busy="false"]').waitFor();
   assert.equal(await page.locator('.fr-tap-input').isChecked(),false);
   await context.close();
  });
  await t.test('spacing survives short screens and safe areas',async()=>{
   const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true});
   await context.route('**/firebase-config.json',route=>route.fulfill({json:{}}));
   await context.addInitScript(()=>localStorage.setItem('folio.demo-membership.v1.guest',JSON.stringify({demo:true,planId:'monthly',startedAt:Date.now(),expiresAt:Date.now()+86400000,renew:true,receiptId:'FOLIO-DEMO-reader-fixture'})));
   const page=await context.newPage();
   await page.goto(base+'#read/quiet');
   await page.locator('.fr-book[aria-busy="false"]').waitFor();
   await page.waitForTimeout(1100);
   await page.addStyleTag({content:'#reader-root .fr-reader{--fr-safe-left:47px;--fr-safe-right:47px;--fr-safe-bottom:21px}'});
   await openMenu(page);
   for(const viewport of [{width:844,height:390},{width:568,height:280}]){
    await page.setViewportSize(viewport);
    await page.waitForFunction(size=>document.querySelector('.fr-liquid-surface').style.getPropertyValue('--fr-control-size')===`${size}px`,viewport.height<320?44:52);
    await page.waitForFunction(()=>[...document.querySelectorAll('.fr-liquid-actions .fr-liquid-item')].every((e,index)=>{
     const match=e.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px/);
     if(!match)return false;
     const left=parseFloat(e.style.left),top=parseFloat(e.style.top);
     const x=index<3?-left:-left*(6-index)/3,y=index<3?-top*(3-index)/3:0;
     return Math.abs(Number(match[1])-x)<.25&&Math.abs(Number(match[2])-y)<.25;
    }));
    assert.ok(await page.evaluate(()=>{
     const bounds=[...document.querySelectorAll('.fr-controls-host button')].map(e=>e.getBoundingClientRect());
     // Fractional motion can report a 44px target as 43.99999px in DOMRect.
     return bounds.every(r=>r.left>=47+12&&r.right<=innerWidth-47-12&&r.top>=16&&r.bottom<=innerHeight-21-12&&r.width>=43.99&&r.height>=43.99)&&bounds.every((r,i)=>bounds.every((s,j)=>i===j||Math.max(s.left-r.right,r.left-s.right,s.top-r.bottom,r.top-s.bottom)>=8));
    }),'controls retain margins and 44px targets in landscape');
   }
   await context.close();
  });
 }finally{await browser.close();}
});
