// Keep routing, scroll restoration, and page motion in one synchronous commit.
// pushState avoids the browser's fragment jump racing our own scroll handling.
export function createNavigation({main,render,captureState=()=>null,restoreState=()=>{}}){
 const motion=matchMedia('(prefers-reduced-motion:reduce)'),entries=new Map();
 let current,serial=0,transition,traversing=false,queuedNavigation;
 const route=()=>location.hash||'#home';
 const page=(hash='')=>hash.startsWith('#book/')?'book':hash.startsWith('#read/')?'reader':['#home','#discover','#collections'].includes(hash)?'home':hash.split('?')[0];
 const newKey=()=>`${Date.now().toString(36)}-${++serial}`;
 const historyState=key=>({...history.state,folioEntry:key});

 function focusPath(element){
  if(!(element instanceof HTMLElement)||element===document.body)return null;
  const parts=[];
  for(let node=element;node&&node!==document.body;node=node.parentElement){
   if(node.id){parts.unshift('#'+CSS.escape(node.id));break;}
   const siblings=[...node.parentElement.children].filter(other=>other.tagName===node.tagName);
   parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node)+1})`);
  }
  return parts.join(' > ');
 }
 function remember(source){
  if(current)current.snapshot={x:scrollX,y:scrollY,focus:focusPath(source||document.activeElement),state:captureState()};
 }
 function finish(){
  if(!transition)return;
  const active=transition;transition=null;
  for(const animation of active.animations)animation.cancel();
  active.layer?.remove();
  delete main.dataset.navigation;
 }
 function snapshot(){
  const bounds=main.getBoundingClientRect(),layer=document.createElement('div'),copy=main.cloneNode(true);
  layer.className='route-layer';layer.inert=true;layer.setAttribute('aria-hidden','true');
  copy.removeAttribute('id');copy.removeAttribute('tabindex');copy.classList.add('route-snapshot');
  copy.querySelectorAll('[id]').forEach(element=>element.removeAttribute('id'));
  copy.querySelectorAll('details[open]').forEach(element=>element.open=false);
  Object.assign(copy.style,{position:'absolute',left:`${bounds.left}px`,top:`${bounds.top}px`,width:`${bounds.width}px`,margin:'0'});
  layer.append(copy);main.parentElement.append(layer);
  return layer;
 }
 function animate(layer,direction,brand,brandBefore){
  const active={layer,animations:[]};transition=active;
  main.dataset.navigation=direction;
  const sign=direction==='back'?-1:1;
  const options={duration:380,easing:'cubic-bezier(.22,.8,.24,1)',fill:'both'};
  active.animations.push(main.animate([
   {opacity:0,transform:`translate3d(${sign*32}px,0,0)`},
   {opacity:1,transform:'translate3d(0,0,0)'}
  ],options));
  if(layer)active.animations.push(layer.animate([
   {opacity:1,transform:'translate3d(0,0,0)'},
   {opacity:0,transform:`translate3d(${-sign*28}px,0,0)`}
  ],{...options,duration:260}));
  // The glass pill stays in place while its wordmark moves between layouts.
  if(brand&&brandBefore){
   const after=brand.getBoundingClientRect();
   active.animations.push(brand.animate([
    {transform:`translate(${brandBefore.left-after.left}px,${brandBefore.top-after.top}px)`},
    {transform:'translate(0,0)'}
   ],options));
   const controls=[...document.querySelectorAll('.nav-back,.nav-links')].find(element=>element.getClientRects().length);
   if(controls)active.animations.push(controls.animate([{opacity:0},{opacity:1}],{...options,duration:240,delay:80}));
  }
  Promise.allSettled(active.animations.map(animation=>animation.finished)).then(()=>{if(transition===active)finish();});
 }
 function commit(entry,{restored=false,initial=false}={}){
  finish();
  const previousHash=current?.hash,samePage=page(previousHash||'')===page(entry.hash);
  const canAnimate=!initial&&!motion.matches&&typeof main.animate==='function'&&previousHash!==entry.hash&&!samePage&&page(previousHash)!=='reader'&&page(entry.hash)!=='reader';
  const brand=canAnimate?document.querySelector('.brand'):null,brandBefore=brand?.getBoundingClientRect();
  const layer=canAnimate?snapshot():null;
  const direction=page(previousHash||'')==='book'&&page(entry.hash)!=='book'||entry.depth<current?.depth?'back':'forward';
  current=entry;entries.set(entry.key,entry);
  const saved=restored&&entry.snapshot;
  if(saved)restoreState(saved.state);
  try{
   render({restored:Boolean(saved),samePage,initial});
   if(saved){
    window.scrollTo({left:saved.x,top:saved.y,behavior:'instant'});
    const target=saved.focus&&document.querySelector(saved.focus);
    if(target?.getClientRects().length&&!target.closest('[hidden],[inert]'))target.focus({preventScroll:true});
    else{const heading=main.querySelector('h1,h2')||main;heading.tabIndex=-1;heading.focus({preventScroll:true});}
   }
   if(canAnimate)animate(layer,direction,brand,brandBefore);
  }catch(error){layer?.remove();finish();throw error;}
 }
 function navigate(hash,{source,replace=false}={}){
  if(traversing){queuedNavigation={hash,source,replace};return;}
  remember(source);
  if(hash===current?.hash){commit(current);return;}
  const entry={key:replace?current.key:newKey(),hash,parent:replace?current.parent:current?.key,depth:replace?current.depth:current.depth+1};
  history[replace?'replaceState':'pushState'](historyState(entry.key),'',hash);
  commit(entry);
 }
 function backTo(hash){
  if(traversing)return;
  let parent=entries.get(current?.parent),distance=1;
  while(parent){
   if(parent.hash===hash){remember();traversing=true;history.go(-distance);return;}
   parent=entries.get(parent.parent);distance++;
  }
  navigate(hash);
 }
 function onHistory(){
  const key=history.state?.folioEntry,hash=route();
  // Both popstate and hashchange can fire for a single history traversal.
  if(current?.key===key&&current.hash===hash)return;
  remember();
  let entry=entries.get(key);
  // Assign a fresh identity if a native fragment change copied the old state.
  if(!entry||entry.hash!==hash){entry={key:newKey(),hash,parent:current?.key,depth:current.depth+1};history.replaceState(historyState(entry.key),'',location.href);}
  commit(entry,{restored:Boolean(entry.snapshot)});
  traversing=false;
  if(queuedNavigation){const next=queuedNavigation;queuedNavigation=null;navigate(next.hash,next);}
 }
 function start(){
  history.scrollRestoration='manual';
  const entry={key:newKey(),hash:route(),depth:0};
  history.replaceState(historyState(entry.key),'',location.href);
  commit(entry,{initial:true});
  addEventListener('popstate',onHistory);addEventListener('hashchange',onHistory);
  addEventListener('resize',finish);addEventListener('pagehide',finish);
  main.addEventListener('pointerdown',finish,{capture:true});
  main.addEventListener('keydown',finish,{capture:true});
  main.addEventListener('wheel',finish,{passive:true});
  motion.addEventListener('change',finish);
 }
 // Search changes the current entry without creating a history item per keypress.
 function replaceHash(hash){history.replaceState(historyState(current.key),'',hash);current.hash=hash;}
 return{start,navigate,backTo,replaceHash};
}
