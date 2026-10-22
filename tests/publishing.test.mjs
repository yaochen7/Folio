import test from 'node:test';
import assert from 'node:assert/strict';
import {parseManuscript,formatManuscript,publicationInput,publicationDraft,HEADING,manuscriptBytes,contentBytes,sizeLabel,decoratePublication,publicationDetails,readPublicationCache,cachePublications,migrateLegacyPublications,publicationCacheKey,legacyPublicationCacheKey,shareUrl} from '../js/publishing.js';
import {MAX_BOOK_BYTES} from '../js/publication-limits.js';

const id='b-12345678-1234-4123-8123-123456789012';
function memoryStorage(limit=Infinity){
 const values=new Map();
 return {values,get length(){return values.size;},key:index=>[...values.keys()][index]??null,getItem:key=>values.get(key)??null,removeItem:key=>{values.delete(key);},
  setItem(key,value){const size=[...values].filter(([name])=>name!==key).reduce((total,[name,item])=>total+name.length+item.length,0)+key.length+String(value).length;if(size>limit)throw new DOMException('Full.','QuotaExceededError');values.set(key,String(value));}};
}
// A seeded generator keeps the property tests repeatable.
function random(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};}
const pick=(next,items)=>items[Math.floor(next()*items.length)];

test('manuscript headings preserve chapter order and paragraph boundaries',()=>{
 assert.deepEqual(parseManuscript('# A beginning\r\n\r\nOne paragraph.\r\nStill the same.\r\n\r\nAnother.\r\n\r\n## The ending\r\n\r\nLast words.'),[{title:'A beginning',paragraphs:['One paragraph.\nStill the same.','Another.']},{title:'The ending',paragraphs:['Last words.']}]);
 assert.deepEqual(parseManuscript('A story without a heading.'),[{title:'Chapter One',paragraphs:['A story without a heading.']}]);
 assert.deepEqual(parseManuscript('\ufeff# Title \u00a0\n\n### Not a heading\n#hashtag\n\\# Escaped\n\\\\# Twice\n\n# \n\nText.\u0000'),[{title:'Title',paragraphs:['### Not a heading\n#hashtag\n# Escaped\n\\# Twice','#','Text.']}]);
 assert.ok(HEADING.test('# One')&&HEADING.test('##\tTwo')&&!HEADING.test('### Three')&&!HEADING.test('#   ')&&!HEADING.test(' # Indented'));
});
test('limits match the publishing service and messages name 5 MB',()=>{
 assert.throws(()=>parseManuscript('# Empty'),/beneath/);
 assert.throws(()=>parseManuscript(''),/manuscript/);
 assert.equal(parseManuscript('x'.repeat(100000))[0].paragraphs[0].length,100000);
 assert.throws(()=>parseManuscript('x'.repeat(100001)),/paragraphs of up to 100,000 characters/);
 assert.equal(parseManuscript(Array.from({length:1000},(_,i)=>`# Chapter ${i}\n\nText.`).join('\n\n')).length,1000);
 assert.throws(()=>parseManuscript(Array.from({length:1001},(_,i)=>`# Chapter ${i}\n\nText.`).join('\n\n')),/up to 1,000 chapters/);
 assert.throws(()=>parseManuscript(Array.from({length:20001},()=>'a').join('\n\n')),/up to 20,000 paragraphs/);
 const nearlyFull=Array.from({length:50},()=>'x'.repeat(99000)).join('\n\n');
 assert.ok(manuscriptBytes(nearlyFull)<=MAX_BOOK_BYTES);assert.equal(parseManuscript(nearlyFull)[0].paragraphs.length,50);
 assert.throws(()=>parseManuscript(nearlyFull+'\n\n'+'x'.repeat(99000)),/too large\. Keep the book to 5 MB/);
 // Bytes are UTF-8 of the chapters' JSON, so quotes, newlines and wide characters all count.
 const chapters=parseManuscript('# "Q"\n\nLine\nnext 界🌊');
 assert.equal(contentBytes(chapters),Buffer.byteLength(JSON.stringify(chapters)));
 assert.equal(manuscriptBytes('# "Q"\n\nLine\nnext 界🌊'),contentBytes(chapters));
 assert.equal(manuscriptBytes('   '),0);
 assert.equal(sizeLabel(0),'0.0 MB of 5 MB');assert.equal(sizeLabel(1),'0.1 MB of 5 MB');
 assert.equal(sizeLabel(2_340_000),'2.4 MB of 5 MB');assert.equal(sizeLabel(MAX_BOOK_BYTES),'5.0 MB of 5 MB');assert.equal(sizeLabel(MAX_BOOK_BYTES+1),'5.1 MB of 5 MB');
});
test('formatting a manuscript is the exact inverse of parsing it',()=>{
 const tricky=[{title:'Chapter One',paragraphs:['# Looks like a heading','## So does this\nand \\# this\n\\\\## and this','### Three marks stay text','#\u00a0nbsp heading\n\\#\tescaped tab']},{title:'“Quotes” & <tags> 界 🌊',paragraphs:['A line\u2028with a separator','Tabs\tand  spaces\n  indented line','\\','\\\\# heading-like after two backslashes\\']},{title:'#1',paragraphs:['Ends here.']}];
 assert.deepEqual(parseManuscript(formatManuscript(tricky)),tricky);
 assert.match(formatManuscript(tricky),/^# Chapter One\n\n\\# Looks like a heading\n\n\\## So does this\nand \\# this\n\\\\\\## and this\n\n### Three/);
 assert.equal(formatManuscript([]),'');
 // Any manuscript, once parsed, survives a format and parse unchanged.
 const next=random(7),pieces=['#','##','###','\\','\\\\',' ','\t','\u00a0','\u2028','\n','\n','\n\n','\r\n','a','word','界','🌊','"','\u0000','\ufeff','x'];
 for(let round=0;round<2000;round++){
  const text=Array.from({length:1+Math.floor(next()*60)},()=>pick(next,pieces)).join('');
  let chapters;try{chapters=parseManuscript(text);}catch{continue;}
  assert.deepEqual(parseManuscript(formatManuscript(chapters)),chapters,JSON.stringify(text));
 }
 // Chapters built directly, as stored by the service, survive too.
 const characters=['a','b','#','\\',' ','\t','\u00a0','界','🌊','"','.'];
 const line=()=>{const kind=next();const body=Array.from({length:1+Math.floor(next()*8)},()=>pick(next,characters)).join('');return kind<.3?pick(next,['#','##','\\#','\\\\##','###'])+pick(next,[' ','\t','\u00a0'])+body:body;};
 for(let round=0;round<2000;round++){
  const chapters=Array.from({length:1+Math.floor(next()*4)},()=>({title:('T'+line()).trim(),paragraphs:Array.from({length:1+Math.floor(next()*4)},()=>Array.from({length:1+Math.floor(next()*3)},line).join('\n').trim()||'p').filter(p=>!/\n\s*\n/u.test(p)&&p.trim()===p)})).filter(chapter=>chapter.paragraphs.length);
  if(!chapters.length)continue;
  assert.deepEqual(parseManuscript(formatManuscript(chapters)),chapters,JSON.stringify(chapters));
 }
});
test('publishing and editing send the same checked input, and an edit starts from the published edition',()=>{
 const draft={title:'  A Title ',author:' Me ',description:' About it. ',category:'Ideas',price:'12.5',kind:'atlas',manuscript:'# One\n\nWords.'};
 assert.deepEqual(publicationInput(draft),{title:'A Title',author:'Me',description:'About it.',genre:'Ideas',category:'Ideas',kind:'atlas',priceCents:1250,chapters:[{title:'One',paragraphs:['Words.']}]});
 assert.deepEqual([publicationInput({...draft,category:'Poetry',kind:'unknown'})].map(input=>[input.category,input.genre,input.kind]),[['Fiction','Fiction','shape']]);
 for(const price of ['0.98','1000','','abc'])assert.throws(()=>publicationInput({...draft,price}),/between \$0\.99 and \$999\.99/);
 assert.equal(publicationInput({...draft,price:'0.99'}).priceCents,99);assert.equal(publicationInput({...draft,price:'999.99'}).priceCents,99999);
 assert.throws(()=>publicationInput({...draft,manuscript:'  '}),/Add your manuscript/,'the manuscript is checked before the price');
 const chapters=[{title:'One',paragraphs:['# Not a heading','Plain.']},{title:'Two',paragraphs:['End.']}];
 const book={id,title:'Mine',author:'Me',description:'About it.',category:'Escape',kind:'wild',priceCents:999,chapters};
 const fields=publicationDraft(book);
 assert.deepEqual(fields,{title:'Mine',author:'Me',description:'About it.',category:'Escape',price:'9.99',kind:'wild',manuscript:'# One\n\n\\# Not a heading\n\nPlain.\n\n# Two\n\nEnd.'});
 assert.deepEqual(publicationInput(fields),{title:'Mine',author:'Me',description:'About it.',genre:'Escape',category:'Escape',kind:'wild',priceCents:999,chapters},'saving an unchanged edit sends the same book');
 assert.equal(publicationDraft({...book,priceCents:500}).price,'5.00');assert.equal(publicationDraft({...book,priceCents:99900}).price,'999.00');
 assert.deepEqual(publicationDraft({...book,priceCents:undefined,category:'Other',kind:'other',description:undefined}),{...fields,price:'4.99',category:'Fiction',kind:'shape',description:''});
});
test('publications may arrive as details alone, and chapters are checked when present',()=>{
 const details={id,title:'<img src=x onerror=alert(1)>',author:'Someone',cover:'<script>bad()</script>',kind:'unknown',revision:3,wordCount:1200,pages:5,chapterCount:2,contentBytes:4000,shareToken:'a'.repeat(64),ownerUid:'author'};
 const book=decoratePublication(details);
 assert.equal(book.cover,'&lt;img src=x onerror=alert(1)&gt;');assert.equal(book.kind,'shape');
 assert.equal(book.revision,3);assert.equal(book.wordCount,1200);assert.equal(book.shareToken,'a'.repeat(64));assert.equal('chapters' in book,false);
 assert.equal(decoratePublication({...details,revision:-1}).revision,0,'an unknown revision reads as the first edition');
 const full=decoratePublication({...details,wordCount:undefined,pages:undefined,chapters:[{title:'One',paragraphs:['Two words.','  ']}]});
 assert.deepEqual(full.chapters,[{title:'One',paragraphs:['Two words.','  ']}]);assert.equal(full.wordCount,2);assert.equal(full.pages,1);
 assert.equal(decoratePublication({...details,chapters:[]}),null);
 assert.equal(decoratePublication({...details,chapters:Array.from({length:1001},()=>({title:'C',paragraphs:['p']}))}),null);
 assert.equal(decoratePublication({...details,id:'quiet'}),null);
 const plain=publicationDetails(full);assert.equal('chapters' in plain,false);assert.equal(plain.title,full.title);assert.equal(plain.revision,3);
});
test('the device keeps only book details per identity and migrates the old full-text cache',()=>{
 const storage=memoryStorage(),book={id,title:'Mine',author:'Me',chapters:[{title:'One',paragraphs:['Words.']}],shareToken:'b'.repeat(64)};
 assert.notEqual(publicationCacheKey(null),publicationCacheKey('guest'));
 assert.notEqual(publicationCacheKey('reader-a'),publicationCacheKey('reader-b'));
 assert.equal(cachePublications('reader-a',[book],storage),true);
 assert.doesNotMatch(storage.getItem(publicationCacheKey('reader-a')),/Words\./,'book text never enters localStorage');
 assert.equal(readPublicationCache('reader-a',storage)[0].shareToken,'b'.repeat(64));
 assert.deepEqual(readPublicationCache('reader-b',storage),[]);
 assert.equal(cachePublications('reader-a',[{...book,title:'Renamed'}],storage),true);
 assert.deepEqual(readPublicationCache('reader-a',storage).map(value=>value.title),['Renamed'],'a newer edition replaces the details');
 assert.equal(cachePublications('reader-a',[book],{getItem:()=>null,setItem(){throw new DOMException('Full.','QuotaExceededError');}}),false,'a full device reports false instead of throwing');
 const blocked={get length(){throw new DOMException('Blocked.','SecurityError');},getItem(){throw new DOMException('Blocked.','SecurityError');},setItem(){throw new DOMException('Blocked.','SecurityError');}};
 assert.deepEqual(readPublicationCache('reader-a',blocked),[]);assert.equal(cachePublications('reader-a',[book],blocked),false);assert.deepEqual(migrateLegacyPublications(blocked),[],'blocked site data never stops the app');

 // A legacy cache that filled the device still yields its text and details.
 const big={...book,id:'b-12345678-1234-4123-8123-123456789013',chapters:[{title:'Long',paragraphs:['x'.repeat(5000)]}]};
 const legacy=memoryStorage(legacyPublicationCacheKey(null).length+JSON.stringify([big]).length+'folio.library.v1.guest{}'.length+100);legacy.setItem(legacyPublicationCacheKey(null),JSON.stringify([big]));legacy.setItem('folio.library.v1.guest','{}');
 const moved=migrateLegacyPublications(legacy);
 assert.equal(moved.length,1);assert.equal(moved[0].key,legacyPublicationCacheKey(null));assert.equal(moved[0].books[0].chapters[0].paragraphs[0].length,5000);
 assert.equal(readPublicationCache(null,legacy)[0].id,big.id);assert.equal(legacy.getItem(legacyPublicationCacheKey(null)),null,'the old copy made room for the details');
 assert.deepEqual(migrateLegacyPublications(legacy),[],'migration runs once');
});
test('sharing uses the hosting origin and hash capability route',()=>{
 const previous=globalThis.location;globalThis.location={href:'https://folio.example/#publish'};
 try{assert.equal(shareUrl({id:'b-123',shareToken:'abc'}),'https://folio.example/#shared/b-123/abc');assert.equal(shareUrl({id:'b-123'}),'');}finally{globalThis.location=previous;}
});
