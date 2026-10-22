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
  await t.test('Themes & text shares a surface with its pill and reverses without jumping',async()=>{
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

// A deterministic multi-MB manuscript: every word names its own offset ("w" + base 36), so a
// page shows exactly which words it holds.
function scaleBook(id,{chapters:count,words},single=false){
 let seed=7,offset=0;const random=()=>(seed=seed*16807%2147483647)/2147483647,chapters=[],starts=[];
 for(let c=0;c<count;c++){
  const paragraphs=[];starts.push(offset);
  for(let total=0;total<words;){const length=random()<.3?8+Math.floor(random()*22):30+Math.floor(random()*120),tokens=[];for(let i=0;i<length;i++)tokens.push('w'+(offset++).toString(36));paragraphs.push(tokens.join(' ')+'.');total+=length;}
  chapters.push({title:`Part ${c+1}`,paragraphs});
 }
 return {starts,total:offset,book:{id,title:'Scale test',author:'Synthetic Author',genre:'Literary fiction',kind:'shape',kicker:'A novel',cover:'Scale',description:'Synthetic scale test.',category:'Fiction',chapters:single?[{title:'One long chapter',paragraphs:chapters.flatMap(c=>c.paragraphs)}]:chapters}};
}
async function scaleContext(browser,scale,{width,height,reducedMotion='no-preference'},progress){
 const context=await browser.newContext({viewport:{width,height},hasTouch:width<900,isMobile:width<900,reducedMotion});
 const books=await (await fetch(base+'js/books.js')).text();
 await context.route('**/firebase-config.json',route=>route.fulfill({json:{}}));
 await context.route('**/js/books.js',route=>route.fulfill({contentType:'text/javascript; charset=utf-8',body:`${books}\nbooks.push(${JSON.stringify(scale.book)});\n`}));
 await context.addInitScript(progress=>{
  localStorage.setItem('folio.demo-membership.v1.guest',JSON.stringify({demo:true,planId:'monthly',startedAt:Date.now(),expiresAt:Date.now()+86400000,renew:true,receiptId:'FOLIO-DEMO-reader-fixture'}));
  if(progress)localStorage.setItem('folio.library.v1.guest',JSON.stringify({saved:[],progress,mutations:{}}));
 },progress);
 return context;
}
// The offsets on each visible page, left to right.
const visibleWords=page=>page.evaluate(()=>[...document.querySelectorAll('.fr-base .fr-page')].map(element=>[...element.querySelectorAll('.fr-text')].flatMap(p=>(p.textContent.match(/\bw[0-9a-z]+\b/g)||[]).map(token=>parseInt(token.slice(1),36)))));
async function openTimed(page,id){
 return page.evaluate(async id=>{
  const started=performance.now();location.hash='#read/'+id;
  await new Promise(resolve=>{const check=()=>document.querySelector('.fr-book[aria-busy="false"] .fr-page .fr-text')?requestAnimationFrame(()=>resolve()):requestAnimationFrame(check);requestAnimationFrame(check);});
  return performance.now()-started;
 },id);
}
async function settledTurn(page,key){
 await page.keyboard.press(key);
 await page.waitForFunction(()=>!document.querySelector('.fr-book').classList.contains('fr-turning')&&document.querySelector('.fr-book').getAttribute('aria-busy')==='false');
}
function assertContiguous(pages,message){
 const words=pages.flat();
 assert.ok(words.length&&words.every((word,index)=>!index||word===words[index-1]+1),message);
}

test('a multi-MB book opens at once and keeps every word in place across chapters',async t=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const scale=scaleBook('scale',{chapters:240,words:3300});
 try{
  for(const viewport of [{width:1440,height:900},{width:390,height:844}])await t.test(String(viewport.width),async()=>{
   const context=await scaleContext(browser,scale,viewport),page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   page.setDefaultTimeout(20000);
   await page.goto(base+'#discover');
   await page.locator('.cover-button').first().waitFor();
   await page.evaluate(()=>document.fonts.load('19px Newsreader'));
   const elapsed=await openTimed(page,'scale');
   // Laying out the whole book first took 15 s or more at this size.
   assert.ok(elapsed<2500,`first page in ${Math.round(elapsed)} ms`);
   assert.match(await page.locator('.fr-page-count').textContent(),/^Pages? 1(–2)? of /);
   assert.deepEqual((await visibleWords(page))[0].slice(0,3),[0,1,2]);
   const spread=viewport.width>=900,chapter=150;
   await openMenu(page);
   await page.locator('.fr-contents-toggle').click();
   await page.locator('.fr-chapter-list button').nth(chapter).click();
   let pages=await visibleWords(page);
   // In two-page view the chapter opening may be the right-hand page of its spread, as in print.
   const opening=pages.findIndex(words=>words[0]===scale.starts[chapter]);
   assert.ok(opening>=0,'Contents shows the page that starts the chapter at its first word');
   assert.equal(await page.locator('.fr-base .fr-page').nth(opening).locator('.fr-chapter-heading').textContent(),`Part ${chapter+1}`);
   assert.equal(Number(await page.locator('.fr-progress-range').inputValue()),scale.starts[chapter],'the position stays a book-wide word offset');
   assertContiguous(pages,'a spread shows consecutive words');
   await settledTurn(page,'ArrowLeft');
   pages=await visibleWords(page);
   assert.equal(pages.at(-1).at(-1),scale.starts[chapter]-1,'turning back ends on the previous chapter’s last word');
   assertContiguous(pages,'the previous chapter’s pages are consecutive');
   await settledTurn(page,'ArrowRight');
   assert.ok((await visibleWords(page)).some(words=>words[0]===scale.starts[chapter]),'turning forward crosses back into the chapter');
   for(let turn=0;turn<3;turn++){
    const before=(await visibleWords(page)).flat().at(-1);
    await settledTurn(page,'ArrowRight');
    assert.equal((await visibleWords(page))[0][0],before+1,'no word is skipped or repeated between turns');
   }
   assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.fr-base .fr-page-body')].every(e=>e.scrollHeight<=e.clientHeight+1)));
   await page.keyboard.press('End');
   pages=await visibleWords(page);
   assert.equal(pages.flat().at(-1),scale.total-1,'End shows the book’s last word');
   assert.equal(await page.locator('.fr-pages-left').textContent(),'End of story');
   await page.keyboard.press('Home');
   assert.equal((await visibleWords(page))[0][0],0);
   // Search reaches words far beyond the measured pages and opens their page.
   const wanted=scale.starts[200]+57;
   await openMenu(page);
   await page.locator('.fr-search-toggle').click();
   await page.locator('.fr-book-search').fill('w'+wanted.toString(36));
   assert.equal(await page.locator('.fr-search-results button').count(),1);
   await page.locator('.fr-search-results button').click();
   pages=await visibleWords(page);
   assert.ok(pages[0][0]<=wanted&&pages.flat().includes(wanted),'a search result opens the page holding the match');
   assert.equal(await page.locator('.fr-base mark').count(),1);
   if(spread)assert.equal(await page.locator('.fr-book').evaluate(e=>e.classList.contains('fr-is-spread')),true);
   assert.deepEqual(errors,[]);
   await context.close();
  });
  await t.test('page numbers become exact without moving the reader',async()=>{
   const small=scaleBook('scale-small',{chapters:30,words:1200});
   const context=await scaleContext(browser,small,{width:1440,height:900}),page=await context.newPage();
   // The book face is ready first, so the first estimate is measured with it rather than the fallback.
   await page.goto(base+'#discover');await page.locator('.cover-button').first().waitFor();await page.evaluate(()=>document.fonts.load('19px Newsreader'));
   await page.evaluate(()=>{location.hash='#read/scale-small';});
   await page.locator('.fr-book[aria-busy="false"] .fr-text').first().waitFor();
   const first=(await visibleWords(page))[0][0],estimate=(await page.locator('.fr-page-count').textContent()).match(/of about (\d+)/)?.[1];
   await page.waitForFunction(()=>/^Pages 1–2 of \d+$/.test(document.querySelector('.fr-page-count').textContent),null,{timeout:30000});
   assert.equal((await visibleWords(page))[0][0],first);
   const total=Number((await page.locator('.fr-page-count').textContent()).match(/of (\d+)/)[1]);
   // A chapter opening on the first spread does not skew the first estimate.
   if(estimate)assert.ok(Math.abs(Number(estimate)-total)<=total*.15,`the first estimate (${estimate}) is near the real total (${total})`);
   assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.fr-base .fr-folio')].map(e=>e.textContent).join()==='1,2'),'folios fill in once known');
   await page.keyboard.press('End');
   assert.match(await page.locator('.fr-page-count').textContent(),new RegExp(`(^Page ${total}|–${total}) of ${total}$`),'the last page is the last page');
   await page.locator('.fr-appearance-panel [data-fr-action="larger"]').evaluate(button=>button.click());
   assert.equal((await visibleWords(page)).flat().at(-1),small.total-1,'a new text size keeps the reader on the last words');
   await context.close();
  });
  await t.test('a very long chapter resumes deep inside without laying out what comes before',async()=>{
   const long=scaleBook('scale-long',{chapters:160,words:3300},true),offset=Math.floor(long.total*.73);
   const context=await scaleContext(browser,long,{width:390,height:844},{'scale-long':{wordOffset:offset,fraction:.73,updatedAt:Date.now()}});
   const page=await context.newPage();
   page.setDefaultTimeout(20000);
   await page.goto(base+'#discover');
   await page.locator('.cover-button').first().waitFor();
   const elapsed=await openTimed(page,'scale-long');
   assert.ok(elapsed<2500,`resumed page in ${Math.round(elapsed)} ms`);
   let pages=await visibleWords(page);
   assert.ok(pages[0][0]<=offset&&pages[0].at(-1)>=offset,'the saved word is on the page');
   assert.equal(Number(await page.locator('.fr-progress-range').inputValue()),offset);
   assert.match(await page.locator('.fr-page-count').textContent(),/about/i,'an estimated page number says so');
   for(let turn=0;turn<6;turn++){
    const first=(await visibleWords(page))[0][0];
    await settledTurn(page,'ArrowLeft');
    assert.equal((await visibleWords(page))[0].at(-1),first-1,'turning back never skips words');
   }
   await context.close();
  });
 }finally{await browser.close();}
});

// Every page's text fills it unless the next page opens a chapter or the book ends.
const pageFill=page=>page.evaluate(()=>[...document.querySelectorAll('.fr-base .fr-page:not(.fr-empty-page)')].map(element=>{const body=element.querySelector('.fr-page-body'),last=body.lastElementChild,top=body.getBoundingClientRect().top;return last?(last.getBoundingClientRect().bottom-top)/body.clientHeight:0;}));
async function walkBook(page,{limit=Infinity}={}){
 const seen=[];
 for(let turn=0;turn<limit;turn++){
  const words=await visibleWords(page),fill=await pageFill(page),folios=await page.evaluate(()=>[...document.querySelectorAll('.fr-base .fr-page')].map(element=>element.querySelector('.fr-folio').textContent));
  seen.push({words,fill,folios});
  if(await page.locator('.fr-pages-left').textContent()==='End of story')break;
  await settledTurn(page,'ArrowRight');
 }
 return seen;
}

test('a long chapter without headings is paginated like the print book: sections never leave short pages',async t=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const book=scaleBook('one-chapter',{chapters:7,words:3300},true);
 try{
  await t.test('read from the start, every page is full and every word appears once',async()=>{
   const context=await scaleContext(browser,book,{width:390,height:844,reducedMotion:'reduce'}),page=await context.newPage();
   page.setDefaultTimeout(20000);await page.goto(base+'#read/one-chapter');await page.locator('.fr-book[aria-busy="false"] .fr-text').first().waitFor();
   const pages=await walkBook(page);
   assertContiguous(pages.map(item=>item.words.flat()),'no word is lost or repeated across section boundaries');
   assert.equal(pages.at(-1).words.flat().at(-1),book.total-1);
   const short=pages.slice(0,-1).map((item,index)=>[index+1,item.fill[0]]).filter(([,fill])=>fill<.8);
   assert.deepEqual(short,[],'only the last page may be short');
   await context.close();
  });
  await t.test('opened deep inside, a provisional section break is laid out again once the reader moves away',async()=>{
   const offset=Math.floor(book.total*.62);
   const context=await scaleContext(browser,book,{width:390,height:844,reducedMotion:'reduce'},{'one-chapter':{wordOffset:offset,fraction:.62,updatedAt:Date.now()}}),page=await context.newPage();
   page.setDefaultTimeout(20000);await page.goto(base+'#read/one-chapter');await page.locator('.fr-book[aria-busy="false"] .fr-text').first().waitFor();
   await page.waitForFunction(()=>/^Page \d+ of \d+$/.test(document.querySelector('.fr-page-count').textContent),null,{timeout:30000});
   await page.keyboard.press('Home');
   const pages=await walkBook(page);
   assertContiguous(pages.map(item=>item.words.flat()),'every word appears once');
   assert.deepEqual(pages.slice(0,-1).map((item,index)=>[index+1,item.fill[0]]).filter(([,fill])=>fill<.8),[],'no short page remains from the deep open');
   await context.close();
  });
 }finally{await browser.close();}
});

test('two-page spreads pair odd and even pages however the reader gets there',async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const book=scaleBook('spreads',{chapters:12,words:1300});
 try{
  const context=await scaleContext(browser,book,{width:1440,height:900}),page=await context.newPage();
  page.setDefaultTimeout(20000);await page.goto(base+'#read/spreads');await page.locator('.fr-book[aria-busy="false"] .fr-text').first().waitFor();
  await page.waitForFunction(()=>/^Pages 1–2 of \d+$/.test(document.querySelector('.fr-page-count').textContent),null,{timeout:30000});
  const leftFolio=()=>page.evaluate(()=>Number(document.querySelector('.fr-base .fr-page-left .fr-folio').textContent));
  for(let chapter=1;chapter<12;chapter++){
   await openMenu(page);await page.locator('.fr-contents-toggle').click();await page.locator('.fr-chapter-list button').nth(chapter).click();
   await page.waitForFunction(()=>!document.querySelector('.fr-book').classList.contains('fr-turning'));
   assert.equal(await leftFolio()%2,1,`chapter ${chapter+1} opens in a spread that starts on an odd page`);
   assert.ok((await visibleWords(page)).some(words=>words[0]===book.starts[chapter]));
  }
  await page.keyboard.press('Home');
  for(let turn=0;turn<4;turn++){await settledTurn(page,'ArrowRight');assert.equal(await leftFolio()%2,1);}
  for(let turn=0;turn<4;turn++){const before=await leftFolio();await settledTurn(page,'ArrowLeft');assert.equal(await leftFolio(),before-2,'turning back moves a whole spread');}
  await page.keyboard.press('End');assert.equal(await leftFolio()%2,1,'End shows a spread that starts on an odd page');
  // After a resize the new layout pairs spreads again once its page numbers are known.
  await page.setViewportSize({width:1280,height:800});
  await page.waitForFunction(()=>/^Pages? \d+(–\d+)? of \d+$/.test(document.querySelector('.fr-page-count').textContent),null,{timeout:30000});
  await openMenu(page);await page.locator('.fr-contents-toggle').click();await page.locator('.fr-chapter-list button').nth(5).click();
  assert.equal(await leftFolio()%2,1,'after a resize, Contents opens a spread that starts on an odd page');
  await context.close();
 }finally{await browser.close();}
});

test('text without spaces runs on across pages instead of being cut off',async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const run='吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。'.repeat(36);
 const book={id:'no-spaces',title:'Without spaces',author:'Synthetic Author',genre:'Fiction',kind:'shape',kicker:'A novel',cover:'Spaces',description:'Long runs.',category:'Fiction',language:'ja',chapters:[{title:'一',paragraphs:['First paragraph.',run,'After the run.']}]};
 try{
  const context=await scaleContext(browser,{book},{width:390,height:844,reducedMotion:'reduce'}),page=await context.newPage();
  await page.goto(base+'#read/no-spaces');await page.locator('.fr-book[aria-busy="false"] .fr-text').first().waitFor();
  let text='';
  for(let turn=0;turn<200;turn++){
   const shown=await page.evaluate(()=>[...document.querySelectorAll('.fr-base .fr-page .fr-text')].map(element=>element.textContent));
   assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.fr-base .fr-page-body')].every(element=>element.scrollHeight<=element.clientHeight+1)),'no page hides text past its bottom');
   text+=shown.join('\n')+'\n';
   if(await page.locator('.fr-pages-left').textContent()==='End of story')break;
   await settledTurn(page,'ArrowRight');
  }
  assert.equal(text.replace(/\n/g,''),'First paragraph.'+run+'After the run.','every character appears once, in order, with no spaces added');
  await context.close();
 }finally{await browser.close();}
});
