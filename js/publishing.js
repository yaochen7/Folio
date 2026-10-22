import {escapeHtml as esc} from './books.js';
import {MAX_BOOK_BYTES,MAX_CHAPTERS,MAX_PARAGRAPHS_PER_CHAPTER,MAX_PARAGRAPH_CHARS} from './publication-limits.js';

export const COVER_STYLES=['shape','atlas','blue-hour','wild','slowly','tomorrow'];
const bookId=/^b-[a-f0-9-]{36}$/;
const identity=uid=>uid?'user.'+encodeURIComponent(uid):'guest';
const LEGACY_PREFIX='folio.books.v1.',CACHE_PREFIX='folio.books.v2.';
// Book text lives in book-store.js; localStorage keeps only the small details that list a book.
export const publicationCacheKey=uid=>CACHE_PREFIX+identity(uid);
export const legacyPublicationCacheKey=uid=>LEGACY_PREFIX+identity(uid);
export const BOOK_SIZE_LABEL=`${MAX_BOOK_BYTES/1_000_000} MB`;
const count=value=>value.toLocaleString('en-US');

// A chapter starts with one or two # marks, a space, and its title.
export const HEADING=/^#{1,2}\s+(\S.*?)\s*$/u;
// Inside a chapter, a line that would read as a heading is written with a leading backslash.
const unescapeLine=line=>/^\\+#/.test(line)&&HEADING.test(line.replace(/^\\+/,''))?line.slice(1):line;
const escapeLine=line=>HEADING.test(line.replace(/^\\+/,''))?'\\'+line:line;
const headingTitle=value=>value.slice(0,200).replace(/[\ud800-\udbff]$/,'').trimEnd();

function splitManuscript(text){
 const source=String(text||'').replace(/\r\n?/g,'\n').replace(/\u0000/g,'').trim();
 const chapters=[];let title='Chapter One',lines=[];
 const finish=()=>{const paragraphs=lines.join('\n').trim().split(/\n\s*\n/u).map(p=>p.trim()).filter(Boolean);if(paragraphs.length)chapters.push({title,paragraphs});lines=[];};
 for(const line of source.split('\n')){
  const heading=line.match(HEADING);
  if(heading){finish();title=headingTitle(heading[1]);}else lines.push(unescapeLine(line));
 }
 finish();return chapters;
}
/** The stored size of a book: UTF-8 bytes of its chapters' JSON, the measure the service limits. */
export const contentBytes=chapters=>new TextEncoder().encode(JSON.stringify(chapters)).length;
export function manuscriptBytes(text){const chapters=splitManuscript(text);return chapters.length?contentBytes(chapters):0;}
export const sizeLabel=bytes=>`${(Math.ceil(Math.max(0,bytes)/100_000)/10).toFixed(1)} MB of ${BOOK_SIZE_LABEL}`;

export function parseManuscript(text){
 if(!String(text||'').trim())throw new Error('Add your manuscript before publishing.');
 const chapters=splitManuscript(text);
 if(!chapters.length)throw new Error('Add some text beneath your chapter headings.');
 if(chapters.length>MAX_CHAPTERS)throw new Error(`A book can have up to ${count(MAX_CHAPTERS)} chapters.`);
 if(chapters.some(chapter=>chapter.paragraphs.length>MAX_PARAGRAPHS_PER_CHAPTER))throw new Error(`A chapter can have up to ${count(MAX_PARAGRAPHS_PER_CHAPTER)} paragraphs. Start a new chapter with # and its title.`);
 if(chapters.some(chapter=>chapter.paragraphs.some(p=>p.length>MAX_PARAGRAPH_CHARS)))throw new Error(`Split long passages into paragraphs of up to ${count(MAX_PARAGRAPH_CHARS)} characters.`);
 if(contentBytes(chapters)>MAX_BOOK_BYTES)throw new Error(`This manuscript is too large. Keep the book to ${BOOK_SIZE_LABEL} of text or less.`);
 return chapters;
}
/** The manuscript text for a book's chapters; parseManuscript(formatManuscript(chapters)) returns the same chapters. */
export function formatManuscript(chapters){
 return (Array.isArray(chapters)?chapters:[]).map(chapter=>[`# ${chapter.title}`,...chapter.paragraphs.map(paragraph=>paragraph.split('\n').map(escapeLine).join('\n'))].join('\n\n')).join('\n\n');
}

const wholeNumber=(value,maximum=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=0&&value<=maximum;
function cleanChapters(value){
 if(!Array.isArray(value)||value.length>MAX_CHAPTERS)return null;
 const chapters=value.filter(c=>c&&typeof c.title==='string'&&Array.isArray(c.paragraphs)).map(c=>({title:c.title.slice(0,200),paragraphs:c.paragraphs.filter(p=>typeof p==='string').map(p=>p.slice(0,MAX_PARAGRAPH_CHARS))})).filter(c=>c.paragraphs.some(p=>p.trim()));
 return chapters.length&&chapters.every(c=>c.paragraphs.length<=MAX_PARAGRAPHS_PER_CHAPTER)?chapters:null;
}
/** A publication as the app shows it. Details alone list a book; chapters, when present, must be readable. */
export function decoratePublication(value){
 if(!value||!bookId.test(value.id)||typeof value.title!=='string'||typeof value.author!=='string')return null;
 const {chapters:source,...details}=value,title=value.title.slice(0,160);
 const book={...details,title,author:value.author.slice(0,100),description:String(value.description||'').slice(0,1500),genre:String(value.genre||'Fiction').slice(0,80),category:['Fiction','Ideas','Escape'].includes(value.category)?value.category:'Fiction',kind:COVER_STYLES.includes(value.kind)?value.kind:'shape',kicker:'A Folio book',cover:esc(title),revision:wholeNumber(value.revision)?value.revision:0};
 if(!wholeNumber(book.wordCount))delete book.wordCount;
 if(source===undefined)return book;
 const chapters=cleanChapters(source);if(!chapters)return null;
 const wordCount=wholeNumber(value.wordCount)?value.wordCount:chapters.flatMap(c=>c.paragraphs).reduce((total,p)=>total+(p.trim()?p.trim().split(/\s+/u).length:0),0);
 return {...book,chapters,wordCount,pages:Number.isFinite(value.pages)?value.pages:Math.max(1,Math.ceil(wordCount/250))};
}
export const publicationDetails=book=>{const {chapters,...details}=book||{};return details;};

function writeCache(storage,key,books){
 const merged=new Map();
 try{const values=JSON.parse(storage.getItem(key)||'[]');if(Array.isArray(values))for(const value of values){const book=decoratePublication(value);if(book)merged.set(book.id,publicationDetails(book));}}catch{}
 for(const book of books)merged.set(book.id,publicationDetails(book));
 storage.setItem(key,JSON.stringify([...merged.values()]));
}
// Storage is resolved inside try: reading globalThis.localStorage throws where site data is blocked.
export function readPublicationCache(uid,storage){
 try{const values=JSON.parse((storage||globalThis.localStorage).getItem(publicationCacheKey(uid))||'[]');return Array.isArray(values)?values.map(decoratePublication).filter(Boolean).map(publicationDetails):[];}catch{return [];}
}
/** Keeps the details of these books for this identity. Returns false when the device cannot store them. */
export function cachePublications(uid,books,storage){
 const safe=books.map(decoratePublication).filter(Boolean);
 try{writeCache(storage||globalThis.localStorage,publicationCacheKey(uid),safe);return true;}catch{return false;}
}
/**
 * Earlier versions kept every book's full text in localStorage. This moves the details to the new key and
 * returns the text for book-store.js; the caller removes each old key once the text is stored.
 */
export function migrateLegacyPublications(area){
 const moved=[];
 try{
  const storage=area||globalThis.localStorage,keys=[];for(let index=0;index<storage.length;index++){const key=storage.key(index);if(key?.startsWith(LEGACY_PREFIX))keys.push(key);}
  for(const key of keys){
   let books=[];
   try{const values=JSON.parse(storage.getItem(key)||'[]');if(Array.isArray(values))books=values.map(decoratePublication).filter(book=>book?.chapters);}catch{}
   const target=CACHE_PREFIX+key.slice(LEGACY_PREFIX.length);
   // The old copy is what fills the device, so it goes first when there is no room for both.
   try{writeCache(storage,target,books);}catch{try{storage.removeItem(key);writeCache(storage,target,books);}catch{}}
   moved.push({key,books});
  }
 }catch{}
 return moved;
}

export function shareUrl(book){
 if(!book?.shareToken)return '';
 return new URL(`#shared/${encodeURIComponent(book.id)}/${encodeURIComponent(book.shareToken)}`,location.href.split('#')[0]).href;
}
