import {escapeHtml as esc} from './books.js';

export const COVER_STYLES=['shape','atlas','blue-hour','wild','slowly','tomorrow'];
const bookId=/^b-[a-f0-9-]{36}$/;
export const publicationCacheKey=uid=>'folio.books.v1.'+(uid?'user.'+encodeURIComponent(uid):'guest');

export function parseManuscript(text){
 const source=String(text||'').replace(/\r\n?/g,'\n').trim();
 if(!source)throw new Error('Add your manuscript before publishing.');
 const chapters=[];let title='Chapter One',lines=[];
 const finish=()=>{const paragraphs=lines.join('\n').trim().split(/\n\s*\n/u).map(p=>p.trim()).filter(Boolean);if(paragraphs.length)chapters.push({title,paragraphs});lines=[];};
 for(const line of source.split('\n')){
  const heading=line.match(/^#{1,2}\s+(.+?)\s*$/u);
  if(heading){finish();title=heading[1].slice(0,200);}else lines.push(line);
 }
 finish();if(!chapters.length)throw new Error('Add some text beneath your chapter headings.');
 if(chapters.length>50)throw new Error('A book can have up to 50 chapters.');
 if(chapters.some(chapter=>chapter.paragraphs.some(p=>p.length>20000)))throw new Error('Split long passages into paragraphs of fewer than 20,000 characters.');
 if(new TextEncoder().encode(JSON.stringify(chapters)).length>450000)throw new Error('This manuscript is too large. Keep the book under 450 KB.');
 return chapters;
}

export function decoratePublication(value){
 if(!value||!bookId.test(value.id)||typeof value.title!=='string'||typeof value.author!=='string'||!Array.isArray(value.chapters)||!value.chapters.length)return null;
 const chapters=value.chapters.filter(c=>c&&typeof c.title==='string'&&Array.isArray(c.paragraphs)).map(c=>({title:c.title.slice(0,200),paragraphs:c.paragraphs.filter(p=>typeof p==='string').map(p=>p.slice(0,20000))})).filter(c=>c.paragraphs.some(p=>p.trim()));
 if(!chapters.length||chapters.length>50)return null;
 return {...value,title:value.title.slice(0,160),author:value.author.slice(0,100),description:String(value.description||'').slice(0,1500),genre:String(value.genre||'Fiction').slice(0,80),category:['Fiction','Ideas','Escape'].includes(value.category)?value.category:'Fiction',kind:COVER_STYLES.includes(value.kind)?value.kind:'shape',kicker:'A Folio book',cover:esc(value.title.slice(0,160)),chapters};
}

export function readPublicationCache(uid){
 try{const values=JSON.parse(localStorage.getItem(publicationCacheKey(uid))||'[]');return Array.isArray(values)?values.map(decoratePublication).filter(Boolean):[];}catch{return [];}
}
export function cachePublication(uid,book){
 const safe=decoratePublication(book);if(!safe)throw new Error('This book could not be opened.');
 const values=readPublicationCache(uid).filter(value=>value.id!==safe.id);values.push(safe);
 try{localStorage.setItem(publicationCacheKey(uid),JSON.stringify(values));}
 catch{throw new Error('There isn’t enough storage to keep this book on this device. Free some space and open the link again.');}
 return safe;
}

export function shareUrl(book){
 if(!book?.shareToken)return '';
 return new URL(`#shared/${encodeURIComponent(book.id)}/${encodeURIComponent(book.shareToken)}`,location.href.split('#')[0]).href;
}
