import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Liquid} from 'liquid-gooey';
import {icon} from '../js/icons.js';

const openMotion={duration:540,ease:'cubic-bezier(.22,1.12,.36,1)'};
const closeMotion={duration:420,ease:'cubic-bezier(.32,0,.28,1)'};
const Glyph=({name})=><span className="fr-liquid-glyph" aria-hidden="true" dangerouslySetInnerHTML={{__html:icon(name)}}/>;

function ReadingControls({model}){
 const {expanded,moving,width,height,step,size,percentage,previousDisabled,nextDisabled}=model;
 const motion=expanded?openMotion:closeMotion;
 const anchor={position:'absolute',left:width-size,top:height-size};
 const rows=[
  {action:'contents',label:<>Contents <span className="fr-menu-percentage">· {percentage}%</span></>,glyph:<Glyph name="list"/>},
  {action:'search',label:'Search this book',glyph:<Glyph name="search"/>},
  {action:'appearance',label:'Themes & text',glyph:<span className="fr-aa" aria-hidden="true">Aa</span>}
 ];
 return <div className="fr-liquid-surface" data-fr-expanded={expanded?'true':'false'} data-fr-moving={moving?'true':undefined} style={{'--fr-control-size':`${size}px`,'--fr-motion-duration':`${motion.duration}ms`,'--fr-motion-ease':motion.ease}}>
  <Liquid blur={6} contrast={18} fill="var(--fr-liquid-fill)" style={{width,height,pointerEvents:'none'}}>
   <div id="fr-reading-actions" className="fr-liquid-actions" role="group" aria-label="Reading tools" aria-hidden={!expanded} inert={!expanded} style={{position:'absolute',inset:0,pointerEvents:'none'}}>
   {rows.map((row,index)=><Liquid.Item key={row.action} effect="morph" className="fr-liquid-item" style={{...anchor,pointerEvents:expanded?'auto':'none'}} x={expanded?size-width:0} y={expanded?-(3-index)*step:0} transition={motion} delay={expanded?(2-index)*26:index*18}>
    <button type="button" className={`fr-liquid-row fr-${row.action}-toggle`} data-fr-action={row.action} aria-controls={`fr-${row.action}-panel`} aria-expanded="false" aria-hidden={!expanded} tabIndex={expanded?0:-1} style={{width:expanded?width:size,'--fr-liquid-delay':`${expanded?(2-index)*26:index*18}ms`}}>
     <span className="fr-liquid-label">{row.label}</span>{row.glyph}
    </button>
   </Liquid.Item>)}
   {[
    {action:'close',label:'Close reader',glyph:'x',className:'fr-close'},
    {action:'previous',label:'Previous page',glyph:'chevron-left',disabled:previousDisabled},
    {action:'next',label:'Next page',glyph:'chevron-right',disabled:nextDisabled}
   ].map((action,index)=><Liquid.Item key={action.action} effect="morph" className="fr-liquid-item" style={{...anchor,pointerEvents:expanded?'auto':'none'}} x={expanded?-(width-size)*(3-index)/3:0} y={0} transition={motion} delay={expanded?(2-index)*18:index*18}>
    <button type="button" className={`fr-liquid-round ${action.className||'fr-page-nav'}`} data-fr-action={action.action} aria-label={action.label} aria-hidden={!expanded} tabIndex={expanded?0:-1} disabled={action.disabled} style={{'--fr-liquid-delay':`${expanded?(2-index)*18:index*18}ms`}}>
     <Glyph name={action.glyph}/>
    </button>
   </Liquid.Item>)}
   </div>
   <Liquid.Item effect="morph" className="fr-liquid-item fr-liquid-trigger" style={anchor}>
    <button type="button" className="fr-liquid-round fr-menu-toggle" data-fr-action="menu" aria-label={expanded?'Hide reading controls':'Reading controls'} aria-expanded={expanded} aria-controls="fr-reading-actions">
     <span className="fr-liquid-menu-symbol"><Glyph name="more"/></span><span className="fr-liquid-dismiss-symbol"><Glyph name="chevron-down"/></span>
    </button>
   </Liquid.Item>
  </Liquid>
 </div>;
}

// A small React root owns just the liquid controls. The paginated reader keeps
// its existing DOM and word-offset model. Unmounting also stops library motion.
export function createReadingControls(host,reader){
 let root,observer,settle;
 let model={expanded:false,percentage:0,previousDisabled:true,nextDisabled:false,width:252,height:238,step:62,size:52};
 function render(){if(root)flushSync(()=>root.render(<ReadingControls model={model}/>));}
 function resize(){
  const style=getComputedStyle(reader),safe=side=>parseFloat(style.getPropertyValue(`--fr-safe-${side}`))||0;
  const width=Math.min(252,reader.clientWidth-safe('left')-safe('right')-32);
  // Keep breathing room even in landscape; shrink the targets before the gaps.
  const available=reader.clientHeight-safe('top')-safe('bottom')-36;
  const size=available>=238?52:44;
  const step=size+10;
  if(model.width===width&&model.size===size)return;
  model={...model,width,size,step,height:step*3+size};render();
 }
 return{
  mount(){
   if(root)return;
   root=createRoot(host);model={...model,expanded:false};reader.dataset.frControls='collapsed';resize();render();
   observer=new ResizeObserver(resize);observer.observe(reader);
  },
  update(values){if(Object.entries(values).every(([key,value])=>model[key]===value))return;model={...model,...values};render();},
  setExpanded(expanded){
   if(model.expanded===expanded)return;
   // The merging goo only shows while pieces move; at rest each pill carries its own fill.
   clearTimeout(settle);model={...model,expanded,moving:true};reader.dataset.frControls=expanded?'expanded':'collapsed';render();
   settle=setTimeout(()=>{model={...model,moving:false};render();},(expanded?openMotion:closeMotion).duration+160);
  },
  get expanded(){return Boolean(root&&model.expanded);},
  unmount(){clearTimeout(settle);observer?.disconnect();observer=null;if(root){root.unmount();root=null;}reader.dataset.frControls='collapsed';model={...model,expanded:false,moving:false};}
 };
}
