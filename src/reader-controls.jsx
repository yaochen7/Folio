import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Liquid} from 'liquid-gooey';
import {icon} from '../js/icons.js';

const rowMotion={duration:460,ease:'cubic-bezier(.22,1,.36,1)'};
const Glyph=({name})=><span className="fr-liquid-glyph" aria-hidden="true" dangerouslySetInnerHTML={{__html:icon(name)}}/>;

function ReadingControls({model}){
 const {expanded,width,height,step,size,percentage,previousDisabled,nextDisabled}=model;
 const anchor={position:'absolute',left:width-size,top:height-size};
 const rows=[
  {action:'contents',label:<>Contents <span className="fr-menu-percentage">· {percentage}%</span></>,glyph:<Glyph name="list"/>},
  {action:'search',label:'Search Book',glyph:<Glyph name="search"/>},
  {action:'appearance',label:'Themes & Text',glyph:<span className="fr-aa" aria-hidden="true">Aa</span>}
 ];
 return <div className="fr-liquid-surface" data-fr-expanded={expanded?'true':'false'} style={{'--fr-control-size':`${size}px`}}>
  <Liquid blur={6} contrast={18} fill="var(--fr-liquid-fill)" style={{width,height,pointerEvents:'none'}}>
   <div id="fr-reading-actions" className="fr-liquid-actions" role="group" aria-label="Reading tools" aria-hidden={!expanded} inert={!expanded} style={{position:'absolute',inset:0,pointerEvents:'none'}}>
   {rows.map((row,index)=><Liquid.Item key={row.action} effect="morph" className="fr-liquid-item" style={{...anchor,pointerEvents:expanded?'auto':'none'}} x={expanded?size-width:0} y={expanded?-(3-index)*step:0} transition={rowMotion} delay={expanded?index*30:(2-index)*20}>
    <button type="button" className={`fr-liquid-row fr-${row.action}-toggle`} data-fr-action={row.action} aria-controls={`fr-${row.action}-panel`} aria-expanded="false" aria-hidden={!expanded} tabIndex={expanded?0:-1} style={{width:expanded?width:size,'--fr-liquid-delay':`${expanded?index*30:(2-index)*20}ms`}}>
     <span className="fr-liquid-label">{row.label}</span>{row.glyph}
    </button>
   </Liquid.Item>)}
   {[
    {action:'close',label:'Close reader',glyph:'log-out',className:'fr-close'},
    {action:'previous',label:'Previous page',glyph:'chevron-left',disabled:previousDisabled},
    {action:'next',label:'Next page',glyph:'chevron-right',disabled:nextDisabled}
   ].map((action,index)=><Liquid.Item key={action.action} effect="morph" className="fr-liquid-item" style={{...anchor,pointerEvents:expanded?'auto':'none'}} x={expanded?-(width-size)*(3-index)/3:0} y={0} transition="bouncy" delay={expanded?index*25:(2-index)*20}>
    <button type="button" className={`fr-liquid-round ${action.className||'fr-page-nav'}`} data-fr-action={action.action} aria-label={action.label} aria-hidden={!expanded} tabIndex={expanded?0:-1} disabled={action.disabled}>
     <Glyph name={action.glyph}/>
    </button>
   </Liquid.Item>)}
   </div>
   <Liquid.Item effect="morph" className="fr-liquid-item fr-liquid-trigger" style={anchor}>
    <button type="button" className="fr-liquid-round fr-menu-toggle" data-fr-action="menu" aria-label={expanded?'Hide reading controls':'Reading controls'} aria-expanded={expanded} aria-controls="fr-reading-actions">
     <span className="fr-liquid-menu-symbol"><Glyph name="list"/></span><span className="fr-liquid-dismiss-symbol"><Glyph name="x"/></span>
    </button>
   </Liquid.Item>
  </Liquid>
 </div>;
}

// A small React root owns just the liquid controls. The paginated reader keeps
// its existing DOM and word-offset model. Unmounting also stops library motion.
export function createReadingControls(host,reader){
 let root,observer;
 let model={expanded:false,percentage:0,previousDisabled:true,nextDisabled:false,width:320,height:268,step:72,size:52};
 function render(){if(root)flushSync(()=>root.render(<ReadingControls model={model}/>));}
 function resize(){
  const style=getComputedStyle(reader),safe=side=>parseFloat(style.getPropertyValue(`--fr-safe-${side}`))||0;
  const width=Math.min(320,reader.clientWidth-safe('left')-safe('right')-32);
  // Keep breathing room even in landscape; shrink the targets before the gaps.
  const available=reader.clientHeight-safe('top')-safe('bottom')-36;
  const size=available>=268?52:44;
  const step=size+20;
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
  setExpanded(expanded){if(model.expanded===expanded)return;model={...model,expanded};reader.dataset.frControls=expanded?'expanded':'collapsed';render();},
  get expanded(){return Boolean(root&&model.expanded);},
  unmount(){observer?.disconnect();observer=null;if(root){root.unmount();root=null;}reader.dataset.frControls='collapsed';model={...model,expanded:false};}
 };
}
