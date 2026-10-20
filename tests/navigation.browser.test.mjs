// Opt-in browser regression: start `npm run dev` and install Playwright first.
// PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE can point to an existing installation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.FOLIO_TEST_URL||'http://127.0.0.1:4173/';
const settle=page=>page.waitForFunction(()=>!document.querySelector('#main-content').dataset.navigation&&!document.querySelector('.route-layer'));

test('book returns animate and restore their source across history, search, and interruptions',async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:844},hasTouch:width<900,isMobile:width<900,reducedMotion:'no-preference'});
   // An isolated guest session never loads Firebase or touches account data.
   await context.route('**/firebase-config.json',route=>route.fulfill({json:{}}));
   await context.addInitScript(()=>{
    window.routeSamples=[];window.routeWidths=[];
    addEventListener('DOMContentLoaded',()=>{
     const main=document.querySelector('#main-content');
     new MutationObserver(()=>{
      if(main.dataset.navigation){
       window.routeSamples.push(main.dataset.navigation);
       const measure=()=>{window.routeWidths.push(document.documentElement.scrollWidth);if(main.dataset.navigation)requestAnimationFrame(measure);};
       measure();
      }
     }).observe(main,{attributes:true,attributeFilter:['data-navigation']});
    });
   });
   const page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   page.setDefaultTimeout(10000);
   await page.goto(base);
   await page.locator('.hero-shelf').waitFor();
   await page.evaluate(()=>document.fonts.ready);
   await page.locator('.gallery-hero .pill').click();
   await settle(page);
   await page.locator('.nav-back').click();
   await page.waitForFunction(()=>document.body.dataset.page==='home');
   assert.ok(await page.evaluate(()=>window.routeSamples.includes('back')),`${width}: Back has a reverse animation`);
   await settle(page);
   assert.ok(await page.evaluate(()=>scrollY<2),`${width}: featured book returns to the hero`);
   assert.ok(await page.evaluate(()=>document.activeElement.matches('.gallery-hero .pill')),`${width}: source focus restored`);
   await page.goForward();
   await page.waitForFunction(()=>document.body.dataset.page==='book');
   await settle(page);
   assert.equal(await page.evaluate(()=>window.routeSamples.at(-1)),'forward');
   await page.goBack();
   await page.waitForFunction(()=>document.body.dataset.page==='home');
   await settle(page);

   await page.locator('[data-nav="discover"]').click();
   await page.locator('[data-action="genre"][data-genre="Fiction"]').click();
   const cover=page.locator('#main-content .discover-sheet .cover-button[data-book="quiet"]');
   await cover.scrollIntoViewIfNeeded();
   const shelfY=await page.evaluate(()=>scrollY);
   await cover.click();
   await settle(page);
   await page.locator('.nav-back').click();
   await page.waitForFunction(()=>document.body.dataset.page==='home');
   await settle(page);
   assert.ok(await page.evaluate(y=>Math.abs(scrollY-y)<2,shelfY),`${width}: shelf scroll restored`);
   assert.equal(await page.locator('[data-action="genre"][data-genre="Fiction"]').getAttribute('aria-pressed'),'true');
   assert.ok(await page.evaluate(()=>document.activeElement.matches('.discover-sheet .cover-button[data-book="quiet"]')));

   await page.locator('.shelf-search').click();
   await page.locator('#book-search').fill('Iris');
   await page.locator('#main-content .cover-button').click();
   await settle(page);
   await page.locator('.nav-back').click();
   await page.waitForFunction(()=>document.body.dataset.page==='search');
   await settle(page);
   assert.equal(await page.locator('#book-search').inputValue(),'Iris');
   assert.equal(await page.locator('#main-content .book-card').count(),1);

   await page.locator('.brand').click();
   await settle(page);
   await page.evaluate(()=>{
    document.querySelector('.gallery-hero .pill').click();
    document.querySelector('.nav-back').click();
    document.querySelector('.nav-back').click();
    document.querySelector('.brand').click();
   });
   await page.waitForFunction(()=>document.body.dataset.page==='home');
   await settle(page);
   assert.equal(await page.locator('#main-content .home-view').count(),1);
   assert.ok(await page.evaluate(()=>!document.querySelector('#main-content').inert&&!document.body.classList.contains('reader-open')));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.ok(await page.evaluate(width=>window.routeWidths.every(value=>value<=width),width),`${width}: motion never expands the viewport`);

   await page.locator('.gallery-hero .pill').click();
   await page.emulateMedia({reducedMotion:'reduce'});
   await settle(page);
   await page.locator('.nav-back').click();
   await page.waitForFunction(()=>document.body.dataset.page==='home');
   assert.equal(await page.locator('.route-layer').count(),0);
   assert.ok(await page.evaluate(()=>!document.querySelector('#main-content').getAnimations().some(a=>a.playState==='running')));
   assert.deepEqual(errors,[]);
   await context.close();
  }
 }finally{await browser.close();}
});
