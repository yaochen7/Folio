import test from 'node:test';
import assert from 'node:assert/strict';
import {countWords,splitWords,joinWords} from '../js/words.js';

const normalized=text=>text.replace(/\s+/gu,' ').trim();

test('ordinary words are runs between spaces, and a long run without spaces becomes joined pieces',()=>{
 assert.deepEqual(splitWords('  One two　three\n four '),['One','two','three','four']);
 assert.equal(countWords('  One two　three\n four '),4);
 const japanese='吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。'.repeat(80);
 const words=splitWords(`Before ${japanese} after`);
 assert.ok(words.length>100,'a 2,600-character run is split into pieces a page can break between');
 assert.ok(words.every(word=>word.length<=32));
 assert.equal(countWords(`Before ${japanese} after`),words.length);
 assert.equal(joinWords(words),`Before ${japanese} after`,'pieces are shown joined, with no added spaces');
 assert.equal(joinWords(words,1,3),japanese.slice(0,words[1].length+words[2].length));
 const link='https://example.test/a/link/thirty-two/chars',pieces=splitWords(link);
 assert.deepEqual([...pieces],['https://example.','test/a/link/thir','ty-two/chars']);assert.equal(joinWords(pieces),link);
 assert.deepEqual([...splitWords('internationalization')],['internationalization'],'ordinary long words are unchanged');
});

test('pieces never split a character, an emoji, or a mark from its letter',()=>{
 const emoji='🌊'.repeat(40),marks='é'.repeat(30),family='👩‍👩‍👧'.repeat(12);
 for(const text of [emoji,marks,family,'a'+emoji,'界'.repeat(100)]){
  const words=splitWords(text);
  assert.equal(words.join(''),text);assert.equal(countWords(text),words.length);
  for(const word of words){
   assert.doesNotMatch(word,/^[\udc00-\udfff]|[\ud800-\udbff]$/,'no half of a surrogate pair at a cut');
   assert.doesNotMatch(word,/^[̀-ͯ‍]|‍$/u,'no mark or joiner at a cut');
  }
 }
});

test('counting matches splitting for random text, and joining restores single-spaced text',()=>{
 let seed=11;const random=()=>(seed=seed*16807%2147483647)/2147483647;
 const alphabet=['a','é','界','🌊',' ','\n','　','é','x'];
 for(let round=0;round<300;round++){
  let text='';const length=Math.floor(random()*400);for(let index=0;index<length;index++)text+=alphabet[Math.floor(random()*alphabet.length)];
  const words=splitWords(text);
  assert.equal(countWords(text),words.length);
  assert.equal(joinWords(words),normalized(text));
 }
});
