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
    return bounds.every(r=>r.left>=12&&r.right<=innerWidth-12&&r.top>=0&&r.bottom<=innerHeight-8&&r.width>=44&&r.height>=44)&&bounds.every((r,i)=>bounds.every((s,j)=>i===j||r.right<=s.left+1||s.right<=r.left+1||r.bottom<=s.top+1||s.bottom<=r.top+1));
   }));
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
 }finally{await browser.close();}
});
