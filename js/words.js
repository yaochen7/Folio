/**
 * Words are the reader's unit of position. A word is a run of text between spaces, except that a run longer
 * than LONG_RUN characters (prose without spaces, such as Chinese or Japanese, or a long link) counts as
 * pieces of up to PIECE characters. The pieces are shown joined, so a page can end inside the run instead of
 * hiding the rest of it.
 */
const LONG_RUN = 32, PIECE = 16;
const isSpace = code => code === 32 || (code >= 9 && code <= 13) || code === 160 || code === 5760 || (code >= 8192 && code <= 8202) || code === 8232 || code === 8233 || code === 8239 || code === 8287 || code === 12288 || code === 65279;
// A piece never ends inside a surrogate pair, before a combining mark or selector, or after a joiner.
const attached = /[\p{M}‍︀-️]/u;
function pieceEnd(text, start, end) {
  let cut = start + PIECE;
  if (cut >= end) return end;
  while (cut > start + 1 && ((text.charCodeAt(cut) & 0xfc00) === 0xdc00 || attached.test(text[cut]) || text.charCodeAt(cut - 1) === 0x200d)) cut--;
  if ((text.charCodeAt(cut) & 0xfc00) === 0xdc00) cut++;
  return cut;
}
// Calls visit(start, end, joined) for each word of text; `joined` marks a piece that continues the previous one.
function eachWord(text, visit) {
  for (let index = 0; index < text.length;) {
    if (isSpace(text.charCodeAt(index))) { index++; continue; }
    let end = index;
    while (end < text.length && !isSpace(text.charCodeAt(end))) end++;
    if (end - index <= LONG_RUN) visit(index, end, false);
    else for (let start = index; start < end;) { const cut = pieceEnd(text, start, end); visit(start, cut, start > index); start = cut; }
    index = end;
  }
}

export function countWords(text) {
  let count = 0;
  const value = String(text || '');
  // Most text has no long runs: count the spaces' boundaries without building anything.
  let run = 0, long = false;
  for (let index = 0; index < value.length; index++) {
    if (isSpace(value.charCodeAt(index))) { if (run) count++; run = 0; }
    else if (++run > LONG_RUN) { long = true; break; }
  }
  if (!long) return count + (run ? 1 : 0);
  count = 0;
  eachWord(value, () => { count++; });
  return count;
}

/** The words of a text. `words.joined[i]` is true when word i continues word i - 1 without a space. */
export function splitWords(text) {
  const value = String(text || ''), words = [];
  let joined = null;
  eachWord(value, (start, end, piece) => {
    if (piece) (joined ||= [])[words.length] = true;
    words.push(value.slice(start, end));
  });
  if (joined) words.joined = joined;
  return words;
}

/** The text of words[from..to), with one space between words and none inside a long run. */
export function joinWords(words, from = 0, to = words.length) {
  if (!words.joined) return words.slice(from, to).join(' ');
  let text = '';
  for (let index = from; index < to; index++) text += (index > from && !words.joined[index] ? ' ' : '') + words[index];
  return text;
}

/** The space before word `index` in joinWords output: 1, or 0 inside a long run. */
export const gapBefore = (words, index) => (words.joined?.[index] ? 0 : 1);
