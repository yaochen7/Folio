// Opt-in browser regression; run the dev server and configure Playwright as in README.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.FOLIO_TEST_URL||'http://127.0.0.1:4173/';
const expanded=page=>page.locator('.fr-liquid-surface[data-fr-expanded="true"]').waitFor();
async function openMenu(page){await page.locator('.fr-menu-toggle').click();await expanded(page);await page.waitForTimeout(650);}

test('one liquid reader button exposes working, accessible controls',async t=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{
  for(const width of [320,390,1440])await t.test(String(width),async()=>{
   const context=await browser.newContext({viewport:{width,height:844},hasTouch:width<900,isMobile:width<900,reducedMotion:'no-preference'});
   await context.route('**/firebase-config.json',route=>route.fulfill({json:{}}));
   const page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   page.setDefaultTimeout(10000);
   await page.goto(base+'#read/quiet');
   await page.locator('.fr-book[aria-busy="false"]').waitFor();
   await page.waitForTimeout(1100);
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
   assert.ok(await page.evaluate(()=>document.activeElement.matches('.fr-menu-toggle')));
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
  await t.test('spacing survives short screens and safe areas',async()=>{
   const context=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true});
   await context.route('**/firebase-config.json',route=>route.fulfill({json:{}}));
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
     return bounds.every(r=>r.left>=47+12&&r.right<=innerWidth-47-12&&r.top>=16&&r.bottom<=innerHeight-21-12&&r.width>=44&&r.height>=44)&&bounds.every((r,i)=>bounds.every((s,j)=>i===j||Math.max(s.left-r.right,r.left-s.right,s.top-r.bottom,r.top-s.bottom)>=8));
    }),'controls retain margins and 44px targets in landscape');
   }
   await context.close();
  });
 }finally{await browser.close();}
});
