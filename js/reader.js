import { icon } from './icons.js';
import { renderCover } from './books.js';
import { curlShape, dragProgress, completesTurn, settleProgress } from './page-curl.js';
import { createPageCurlRenderer } from './page-curl-renderer.js';
import { createReadingControls } from './reader-controls.js';
import { countWords, splitWords, joinWords, gapBefore } from './words.js';

const STORAGE_KEY = 'folio.reader.settings.v1';
const DEFAULT_SETTINGS = { fontSize: 19, theme: 'sepia', spread: true, tapToTurn: false };
const THEMES = ['paper', 'sepia', 'night'];
// A chapter longer than this is paginated as near-equal sections, so opening deep inside a very long
// chapter never lays out everything before it. A section boundary is where pagination may start, not a
// page break: once the page before it is laid out, the next section starts where that page ends.
const SECTION_WORDS = 10000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// Two significant figures for page counts that are still estimates.
function approximately(value, round = Math.round) {
  const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, value))) - 1);
  return Math.max(1, round(value / step) * step);
}

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {};
    return {
      fontSize: clamp(Number(saved.fontSize) || 19, 14, 26),
      theme: THEMES.includes(saved.theme) ? saved.theme : 'sepia',
      spread: saved.spread !== false,
      tapToTurn: saved.tapToTurn === true
    };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

function normalizeBook(book) {
  let chapters = Array.isArray(book.chapters) ? book.chapters : null;
  if (!chapters?.length) {
    const contents = book.contents || book.content || '';
    chapters = Array.isArray(contents)
      ? (contents[0]?.paragraphs ? contents : [{ title: book.title, paragraphs: contents }])
      : [{ title: book.title, paragraphs: String(contents).split(/\n\s*\n/u) }];
  }
  // Words are counted here and split only when a chapter is paginated or shown.
  let offset = 0;
  const normalized = chapters.map((chapter, chapterIndex) => {
    const paragraphs = [];
    for (const value of Array.isArray(chapter.paragraphs) ? chapter.paragraphs : [chapter.paragraphs || '']) {
      const text = String(value || ''), count = countWords(text);
      if (count) { paragraphs.push({ text, start: offset, end: offset + count }); offset += count; }
    }
    return { title: String(chapter.title || `Chapter ${chapterIndex + 1}`), paragraphs, start: paragraphs[0]?.start ?? offset, end: offset };
  }).filter(chapter => chapter.paragraphs.length);
  const units = [];
  normalized.forEach((chapter, chapterIndex) => {
    const words = chapter.end - chapter.start, parts = Math.ceil(words / SECTION_WORDS);
    let first = 0, part = 1;
    chapter.paragraphs.forEach((paragraph, index) => {
      const done = paragraph.end - chapter.start;
      if (index < chapter.paragraphs.length - 1 && done < words * part / parts) return;
      let chars = 0;
      for (let item = first; item <= index; item++) chars += chapter.paragraphs[item].text.length + 1;
      units.push({ chapterIndex, first, last: index, start: chapter.paragraphs[first].start, end: paragraph.end, opening: first === 0, chars });
      first = index + 1;
      while (part < parts && done >= words * part / parts) part++;
    });
  });
  const previewUnits = units.findIndex(unit => unit.chapterIndex > 0);
  return { chapters: normalized, units, previewUnits: previewUnits < 0 ? units.length : previewUnits, totalWords: offset };
}

/**
 * A local reader with a React liquid-controls island. Words are the location unit.
 * Book: { id, title, author, chapters: [{ title, paragraphs: string[] }] }.
 * A plain-text `contents` or `content` value is also accepted.
 */
export function createReader({ root, onProgress = () => {}, onClose = () => {}, onPreviewEnd = () => {} }) {
  if (!(root instanceof HTMLElement)) throw new TypeError('createReader requires a root element.');
  const settings = readSettings();
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  let book = null;
  let normalized = null;
  // Paginations by measure key. `currentPage` is the left (or only) page on show.
  const layouts = new Map();
  let layout = null, currentPage = null, layoutCount = 0;
  let anchorOffset = 0;
  let isOpen = false;
  let isDestroyed = false;
  let spread = false;
  let pageWidth = 0;
  let pageHeight = 0;
  let turn = null;
  let pointer = null;
  let queuedDirection = 0;
  let frameId = 0;
  let resizeTimer = 0;
  let progressTimer = 0;
  let lastProgressAt = 0;
  let lastMeasureKey = '';
  let panelTrigger = null;
  let dismissedPointerId = null;
  let previousFocus = null;
  let openedBodyLock = false;
  let curlRenderer = null, curlUnavailable = false, warmTimer = 0;
  let chromeVisible = true, searchHighlight = '', openingTimer = 0;
  let appearanceMotion = null;
  let previewOnly = false;
  let backgroundHandle = 0, backgroundIdle = false, warmedNeighbours = false, fontPending = false;
  let fontTimer = 0, lastFontChange = -Infinity, searchTimer = 0, lastSearchInput = -Infinity;
  let searchIndex = [], currentChapterButton = null, shownPages = [];
  const wordCache = new Map(), pageElements = new WeakMap(), measureRange = document.createRange();

  root.hidden = true;
  root.innerHTML = `
    <section class="fr-reader" role="dialog" aria-modal="true" aria-labelledby="fr-book-title" data-fr-theme="paper">
      <header class="fr-toolbar">
        <div class="fr-title-group"><span id="fr-book-title" class="fr-book-title"></span><span class="fr-book-author"></span></div>
      </header>
      <div class="fr-stage"><div class="fr-book" role="region" aria-label="Book pages" aria-busy="true" tabindex="-1"></div></div>
      <footer class="fr-footer">
        <span class="fr-page-count" aria-label="Reading position"></span><span class="fr-pages-left" hidden></span>
      </footer>
      <div class="fr-controls-host"></div>
      <button class="fr-preview-continue" type="button" data-fr-action="subscribe" hidden>Continue with Folio Plus ${icon('arrow-right')}</button>
      <aside class="fr-panel fr-contents-panel folio-glass" id="fr-contents-panel" aria-labelledby="fr-contents-heading" hidden>
        <div class="fr-panel-heading"><h2 id="fr-contents-heading">Contents</h2><button class="fr-panel-close" type="button" data-fr-action="close-panel" aria-label="Close contents">${icon('x')}</button></div>
        <div class="fr-panel-body"><ol class="fr-chapter-list"></ol>
        <div class="fr-position-controls"><p class="fr-current-chapter"></p><label class="fr-progress-label" for="fr-progress">Reading progress</label><input id="fr-progress" class="fr-progress-range" type="range" min="0" max="1" step="1" value="0" aria-label="Reading progress"></div></div>
      </aside>
      <aside class="fr-panel fr-search-panel folio-glass" id="fr-search-panel" aria-labelledby="fr-search-heading" hidden>
        <div class="fr-panel-heading"><h2 id="fr-search-heading">Search this book</h2><button class="fr-panel-close" type="button" data-fr-action="close-panel" aria-label="Close book search">${icon('x')}</button></div>
        <div class="fr-panel-body"><label class="fr-search-label" for="fr-book-search">Find in this book</label><input class="fr-book-search" id="fr-book-search" type="search" placeholder="A word or phrase" autocomplete="off">
        <p class="fr-search-status" role="status"></p><ol class="fr-search-results"></ol></div>
      </aside>
      <aside class="fr-panel fr-appearance-panel folio-glass" id="fr-appearance-panel" aria-labelledby="fr-appearance-heading" hidden>
        <div class="fr-appearance-content">
        <div class="fr-panel-heading"><h2 id="fr-appearance-heading">Make yourself comfortable.</h2><button class="fr-panel-close" type="button" data-fr-action="close-panel" aria-label="Back to reading tools">${icon('chevron-left')}</button></div>
        <div class="fr-appearance-settings">
        <div class="fr-font-control"><span>Text size</span><div><button class="fr-size-button" type="button" data-fr-action="smaller" aria-label="Decrease text size">A−</button><output class="fr-font-value"></output><button class="fr-size-button" type="button" data-fr-action="larger" aria-label="Increase text size">A+</button></div></div>
        <fieldset class="fr-themes"><legend>Page colour</legend><div>${THEMES.map(theme => `<button class="fr-theme-option" type="button" data-fr-action="theme" data-fr-theme-option="${theme}" aria-pressed="false"><span aria-hidden="true">A</span>${theme[0].toUpperCase() + theme.slice(1)}</button>`).join('')}</div></fieldset>
        <label class="fr-spread-setting"><span>Two-page view<small class="fr-spread-note">For a little more room.</small></span><input type="checkbox" class="fr-spread-input"></label>
        <label class="fr-spread-setting fr-tap-setting"><span>Tap to turn pages<small class="fr-spread-note">Tap the page edges to go back or forward.</small></span><input type="checkbox" class="fr-tap-input"></label>
        <p class="fr-settings-note">Your reading preferences stay on this device.</p>
        </div>
        </div>
      </aside>
      <div class="fr-appearance-surface folio-glass" aria-hidden="true" hidden></div>
      <div class="fr-announcement" aria-live="polite" aria-atomic="true"></div>
    </section>`;

  const reader = root.querySelector('.fr-reader');
  const stage = root.querySelector('.fr-stage');
  const bookElement = root.querySelector('.fr-book');
  let menuButton;
  const controlsHost=root.querySelector('.fr-controls-host');
  const controls=createReadingControls(controlsHost,reader);
  const titleElement = root.querySelector('.fr-book-title');
  const authorElement = root.querySelector('.fr-book-author');
  const chapterElement = root.querySelector('.fr-current-chapter');
  const pageCountElement = root.querySelector('.fr-page-count');
  const range = root.querySelector('.fr-progress-range');
  const announcement = root.querySelector('.fr-announcement');
  const contentsPanel = root.querySelector('.fr-contents-panel');
  const appearancePanel = root.querySelector('.fr-appearance-panel');
  const appearanceContent = root.querySelector('.fr-appearance-content');
  const appearanceSurface = root.querySelector('.fr-appearance-surface');
  const previewButton = root.querySelector('.fr-preview-continue');
  const searchPanel = root.querySelector('.fr-search-panel');
  const bookSearch = root.querySelector('.fr-book-search');
  const searchResults = root.querySelector('.fr-search-results');
  const chapterList = root.querySelector('.fr-chapter-list');
  const spreadInput = root.querySelector('.fr-spread-input');
  const tapInput = root.querySelector('.fr-tap-input');
  const fontValue = root.querySelector('.fr-font-value');
  const measurePage = document.createElement('article');
  measurePage.className = 'fr-page fr-measure';
  measurePage.setAttribute('aria-hidden', 'true');
  measurePage.innerHTML = '<div class="fr-page-running">Measure</div><div class="fr-page-body"></div><div class="fr-folio">1</div>';
  reader.append(measurePage);
  const measureBody = measurePage.querySelector('.fr-page-body');

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* A private window can still read. */ }
  }

  function applySettings() {
    reader.dataset.frTheme = settings.theme;
    reader.style.setProperty('--fr-font-size', `${settings.fontSize}px`);
    fontValue.value = `${settings.fontSize} px`;
    fontValue.textContent = `${settings.fontSize} px`;
    root.querySelectorAll('[data-fr-action="smaller"]').forEach(button=>button.disabled = settings.fontSize <= 14);
    root.querySelectorAll('[data-fr-action="larger"]').forEach(button=>button.disabled = settings.fontSize >= 26);
    root.querySelectorAll('[data-fr-theme-option]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.frThemeOption === settings.theme)));
    spreadInput.checked = settings.spread && !spreadInput.disabled;
    tapInput.checked = settings.tapToTurn;
  }

  function paragraphWords(paragraph) {
    let words = wordCache.get(paragraph);
    if (words) wordCache.delete(paragraph);
    else words = splitWords(paragraph.text);
    wordCache.set(paragraph, words);
    if (wordCache.size > 96) wordCache.delete(wordCache.keys().next().value);
    return words;
  }

  function makeBlock(block) {
    if (block.type === 'heading') {
      const heading = document.createElement('div');
      heading.className = 'fr-chapter-opening';
      const number = document.createElement('p');
      number.className = 'fr-chapter-number';
      number.textContent = `Chapter ${['One','Two','Three'][block.chapterIndex] || block.chapterIndex + 1}`;
      const title = document.createElement('h2');
      title.className = 'fr-chapter-heading';
      title.textContent = normalized.chapters[block.chapterIndex].title;
      heading.append(number, title);
      return heading;
    }
    const paragraph = document.createElement('p');
    paragraph.className = `fr-text${block.continued ? ' fr-continued' : ''}`;
    const text = joinWords(paragraphWords(normalized.chapters[block.chapterIndex].paragraphs[block.paragraph]), block.from, block.to);
    if (!searchHighlight) paragraph.textContent = text;
    else {
      const lower = text.toLocaleLowerCase();
      let start = 0, match;
      while ((match = lower.indexOf(searchHighlight, start)) !== -1) {
        paragraph.append(document.createTextNode(text.slice(start, match)));
        const mark = document.createElement('mark'); mark.textContent = text.slice(match, match + searchHighlight.length); paragraph.append(mark);
        start = match + searchHighlight.length;
      }
      paragraph.append(document.createTextNode(text.slice(start)));
    }
    return paragraph;
  }

  function pageLabel(pageData) {
    const number = pageNumber(pageData);
    return `${number ? `Page ${number}, ` : ''}${normalized.chapters[pageData.chapterIndex].title}`;
  }

  function makePage(pageData, side = 'right') {
    const page = document.createElement('article');
    page.className = `fr-page fr-page-${side}`;
    const running = document.createElement('div');
    running.className = 'fr-page-running';
    running.textContent = side === 'left' && spread ? book.author : book.title;
    const body = document.createElement('div');
    body.className = 'fr-page-body';
    body.lang = book.language || 'en';
    const folio = document.createElement('div');
    folio.className = 'fr-folio';
    if (pageData) {
      pageData.blocks.forEach(block => body.append(makeBlock(block)));
      folio.textContent = String(pageNumber(pageData) || '');
      page.setAttribute('aria-label', pageLabel(pageData));
      pageElements.set(page, pageData);
    } else {
      page.classList.add('fr-empty-page');
      const ending = document.createElement('p');
      ending.className = 'fr-end-mark';
      ending.textContent = previewOnly ? 'End of free preview.' : 'The end.';
      body.append(ending);
      folio.textContent = '';
      page.setAttribute('aria-label', 'End of book');
    }
    page.append(running, body, folio);
    return page;
  }

  // Page numbers that background pagination has just made exact replace blank folios in place.
  function refreshFolios() {
    bookElement.querySelectorAll('.fr-base .fr-page').forEach(element => {
      const pageData = pageElements.get(element);
      if (!pageData) return;
      element.querySelector('.fr-folio').textContent = String(pageNumber(pageData) || '');
      element.setAttribute('aria-label', pageLabel(pageData));
    });
  }

  function accessibleWords() { return previewOnly ? normalized.chapters[1].start : normalized.totalWords; }
  function unitLimit() { return previewOnly ? normalized.previewUnits : normalized.units.length; }
  function chapterForOffset(offset) {
    let low = 0, high = normalized.chapters.length - 1;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (normalized.chapters[middle].start <= offset) low = middle; else high = middle - 1; }
    return low;
  }
  // A section starts where the page before it ended, once that page is laid out.
  function unitStart(index) { return layout.units[index]?.start ?? normalized.units[index].start; }
  function unitForOffset(offset) {
    let low = 0, high = unitLimit() - 1;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (unitStart(middle) <= offset) low = middle; else high = middle - 1; }
    return low;
  }
  function unitState(index) {
    const unit = normalized.units[index];
    return layout.units[index] ||= { pages: [], done: false, paragraph: unit.first, consumed: 0, start: unit.start, origin: [unit.first, 0] };
  }
  // Drops a unit's pages from `fromPage` on, so they are laid out again from where the page before ended.
  function reopenUnit(index, fromPage) {
    const state = layout.units[index];
    if (!state || fromPage >= state.pages.length) return;
    for (const page of state.pages.splice(fromPage)) countPage(page, -1);
    [state.paragraph, state.consumed] = fromPage ? state.pages[fromPage - 1].stop : state.origin;
    state.done = false;
    layout.prefix.length = Math.min(layout.prefix.length, index + 1);
    layout.scan = Math.min(layout.scan, index);
    layout.id = ++layoutCount;
  }
  // The next section starts where a finished section's last page ended; pages it had from its nominal start
  // (after a jump) are laid out again. paginateStep never moves a section whose pages are on screen.
  function startUnitAt(index, paragraph, consumed) {
    const state = unitState(index), start = normalized.chapters[normalized.units[index].chapterIndex].paragraphs[paragraph].start + consumed;
    if (state.start === start) return;
    reopenUnit(index, 0);
    Object.assign(state, { paragraph, consumed, start, origin: [paragraph, consumed] });
  }
  const onScreen = index => shownPages.some(page => page?.unit === index);
  // A section that had to end on a short page, because the next one was on screen, is laid out again
  // once neither that page nor the next section is on screen.
  function repairSections() {
    for (const index of layout.pending) {
      if (onScreen(index + 1) || shownPages.includes(layout.units[index].pages.at(-1))) continue;
      layout.pending.delete(index);
      reopenUnit(index + 1, 0);
      reopenUnit(index, layout.units[index].pages.length - 1);
    }
  }
  // Running totals for estimates, in characters, which vary less than words from page to page.
  // Chapter openings hold less text, so they are counted apart.
  function countPage(page, sign) {
    if (page.blocks[0]?.type === 'heading') { layout.openingChars += page.chars * sign; layout.openingPages += sign; }
    else { layout.pagedChars += page.chars * sign; layout.pagedPages += sign; }
  }
  // In two-page view, a spread starts on an odd page, as in print, whenever the page number is known.
  function spreadStart(page) {
    if (!spread || !page) return page;
    const number = pageNumber(page);
    return number !== null && number % 2 === 0 ? previousPage(page) || page : page;
  }

  // Pages are reached through their neighbours. Missing ones are paginated on demand unless
  // `paginate` is false, which only reads what background pagination has already measured.
  function nextPage(pageData, paginate = true) {
    if (!pageData) return null;
    const state = layout.units[pageData.unit];
    if (pageData.index + 1 < state.pages.length) return state.pages[pageData.index + 1];
    if (!state.done) return paginate ? paginateStep(pageData.unit) : null;
    if (pageData.unit + 1 >= unitLimit()) return null;
    return layout.units[pageData.unit + 1]?.pages[0] || (paginate ? paginateStep(pageData.unit + 1) : null);
  }
  function previousPage(pageData, paginate = true) {
    if (!pageData) return null;
    if (pageData.index > 0) return layout.units[pageData.unit].pages[pageData.index - 1];
    const index = pageData.unit - 1;
    if (index < 0) return null;
    if (!layout.units[index]?.done) { if (!paginate) return null; while (!unitState(index).done) paginateStep(index); }
    return layout.units[index].pages.at(-1);
  }
  function hasNext(pageData) {
    const state = layout.units[pageData.unit];
    return pageData.index + 1 < state.pages.length || !state.done || pageData.unit + 1 < unitLimit();
  }
  function hasPrevious(pageData) { return pageData.index > 0 || pageData.unit > 0; }
  function rightPage() { return spread ? nextPage(currentPage) : null; }
  function canTurn(direction) {
    if (!currentPage) return false;
    if (direction < 0) return hasPrevious(currentPage);
    const last = spread ? rightPage() : currentPage;
    return Boolean(last && hasNext(last));
  }
  // A spread is the left page and the one after it, so a turn always moves two pages.
  function turnTarget(direction, paginate = true) {
    if (direction > 0) { const after = nextPage(currentPage, paginate); return spread ? nextPage(after, paginate) : after; }
    const before = previousPage(currentPage, paginate);
    if (!spread || !before) return before;
    return previousPage(before, paginate) || (paginate || !hasPrevious(before) ? before : null);
  }
  // The turning leaf: [front, back]. A single page turns over onto a blank back.
  function turnPages(direction, target, paginate = true) {
    if (!spread) return [direction > 0 ? currentPage : target, 'blank'];
    return direction > 0 ? [nextPage(currentPage, paginate), target] : [nextPage(target, paginate), currentPage];
  }
  function readingFraction() {
    if (!normalized?.totalWords) return 0;
    return currentPage && !canTurn(1) ? accessibleWords() / normalized.totalWords : clamp(anchorOffset / normalized.totalWords, 0, 1);
  }
  function pageForOffset(offset) {
    const index = unitForOffset(offset), state = unitState(index);
    while (!state.done && !(state.pages.at(-1)?.end > offset)) paginateStep(index);
    return findPage(state.pages, offset);
  }
  function findPage(pages, offset) {
    let low = 0, high = pages.length - 1;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (pages[middle].start <= offset) low = middle; else high = middle - 1; }
    return pages[low];
  }

  // Exact numbers need every earlier unit paginated; until then counts are estimates.
  function knownPrefix() {
    const prefix = layout.prefix;
    while (prefix.length <= unitLimit() && layout.units[prefix.length - 1]?.done) prefix.push(prefix.at(-1) + layout.units[prefix.length - 1].pages.length);
    return prefix;
  }
  function pageNumber(pageData) {
    const prefix = knownPrefix();
    return pageData.unit < prefix.length ? prefix[pageData.unit] + pageData.index + 1 : null;
  }
  function totalPages() {
    const prefix = knownPrefix();
    return prefix.length > unitLimit() ? prefix[unitLimit()] : null;
  }
  // Pages still to lay out, from each section's characters. Until a page without a heading is measured,
  // a page's capacity comes from its size.
  function estimatedPages(untilUnit, offset = null) {
    const charsPerPage = Math.max(100, layout.pagedPages ? layout.pagedChars / layout.pagedPages : layout.metrics?.chars || 1500);
    const openingShortfall = layout.openingPages ? clamp(1 - layout.openingChars / layout.openingPages / charsPerPage, 0, .9) : .4;
    const pagesFor = (index, words) => { const unit = normalized.units[index]; return words * unit.chars / Math.max(1, unit.end - unit.start) / charsPerPage; };
    let count = 0;
    for (let index = 0; index < untilUnit; index++) {
      const state = layout.units[index], unit = normalized.units[index];
      if (state?.done) { count += state.pages.length; continue; }
      // A chapter's last page is part-filled, half a page on average.
      const endsChapter = normalized.units[index + 1]?.opening !== false;
      count += (state?.pages.length || 0) + pagesFor(index, unit.end - (state?.pages.at(-1)?.end ?? unitStart(index))) + (unit.opening && !state?.pages.length ? openingShortfall : 0) + (endsChapter ? .5 : 0);
    }
    return offset === null ? count : count + pagesFor(untilUnit, offset - unitStart(untilUnit));
  }
  function positionText(spoken = false) {
    const right = rightPage(), first = pageNumber(currentPage), last = right && pageNumber(right), total = totalPages();
    if (first === null) {
      const estimate = Math.max(1, approximately(estimatedPages(currentPage.unit) + currentPage.index + 1));
      return `${spoken ? 'about page' : 'About page'} ${estimate} of ${Math.max(estimate, approximately(estimatedPages(unitLimit()), Math.ceil))}`;
    }
    const of = total ?? `about ${Math.max(last || first, approximately(estimatedPages(unitLimit()), Math.ceil))}`;
    if (!last) return `${spoken ? 'page' : 'Page'} ${first} of ${of}`;
    return spoken ? `pages ${first} to ${last} of ${of}` : `Pages ${first}–${last} of ${of}`;
  }
  function offsetText(offset) {
    const index = unitForOffset(offset), state = layout.units[index];
    const known = state && (state.done || state.pages.at(-1)?.end > offset) ? pageNumber(findPage(state.pages, offset)) : null;
    const total = totalPages();
    if (known !== null) return `page ${known} of ${total ?? `about ${Math.max(known, approximately(estimatedPages(unitLimit()), Math.ceil))}`}`;
    const estimate = Math.max(1, approximately(estimatedPages(index, offset) + 1));
    return `about page ${estimate} of ${Math.max(estimate, approximately(estimatedPages(unitLimit()), Math.ceil))}`;
  }

  function fitsMeasure() {
    const last = measureBody.lastElementChild;
    if (!last) return true;
    return last.getBoundingClientRect().bottom <= measureBody.getBoundingClientRect().bottom - 1
      && measureBody.scrollHeight <= measureBody.clientHeight + 1;
  }

  function measureParagraph(text, continued) {
    const paragraph = document.createElement('p');
    paragraph.className = continued ? 'fr-text fr-continued' : 'fr-text';
    paragraph.textContent = text;
    return paragraph;
  }

  const before = (paragraph, consumed, [endParagraph, endConsumed]) => paragraph < endParagraph || paragraph === endParagraph && consumed < endConsumed;
  // Constant for a layout, so they are read once rather than at every page break.
  function pageMetrics() {
    if (!layout.metrics) {
      const sample = measureParagraph('Measure', false);
      measureBody.replaceChildren(sample);
      const bounds = measureBody.getBoundingClientRect(), lineHeight = parseFloat(getComputedStyle(sample).lineHeight) || settings.fontSize * 1.55;
      layout.metrics = { bottom: bounds.bottom - 1, lineHeight, chars: Math.max(160, bounds.height / lineHeight * bounds.width / (settings.fontSize * .48)) };
    }
    return layout.metrics;
  }

  // The most words of an overflowing paragraph that fit, read from one layout through
  // ranges: the text does not change while searching, so nothing is laid out again.
  function fittingWords(item, metrics) {
    const node = item.element.firstChild, ends = [];
    let offset = 0;
    for (let index = item.from; index < item.to; index++) { if (index > item.from) offset += gapBefore(item.words, index); offset += item.words[index].length; ends.push(offset); }
    const fits = count => {
      const end = ends[count - 1], code = node.data.charCodeAt(end - 1);
      measureRange.setStart(node, end - (code >= 0xdc00 && code <= 0xdfff && end > 1 ? 2 : 1));
      measureRange.setEnd(node, end);
      const rects = measureRange.getClientRects(), rect = rects[rects.length - 1];
      return !rect || rect.bottom + Math.max(0, (metrics.lineHeight - rect.height) / 2) <= metrics.bottom;
    };
    let low = 0, high = ends.length;
    while (low < high) { const middle = Math.ceil((low + high) / 2); if (fits(middle)) low = middle; else high = middle - 1; }
    return low;
  }
  // Measures each candidate; used when line geometry disagrees with the page.
  function fittingWordsByLayout(item, max) {
    let low = 0, high = max;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      item.element.textContent = joinWords(item.words, item.from, item.from + middle);
      if (fitsMeasure()) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  // Lays out the next page of a unit: about a page of text is appended and laid out once,
  // then the break is found in the paragraph that runs past the page.
  function paginateStep(unitIndex) {
    const unit = normalized.units[unitIndex], state = unitState(unitIndex), metrics = pageMetrics();
    const chapter = normalized.chapters[unit.chapterIndex], paragraphs = chapter.paragraphs;
    // A section ends where the next section of its chapter starts. While that section's pages are on screen it
    // stays put; otherwise a page that reaches the end with room left continues into it, leaving at least its
    // last paragraph to start its own pages. Cursors are [paragraph, words into it].
    const following = unitIndex + 1 < unitLimit() && !normalized.units[unitIndex + 1].opening ? normalized.units[unitIndex + 1] : null;
    const fixed = following && layout.units[unitIndex + 1]?.pages.length && onScreen(unitIndex + 1) ? layout.units[unitIndex + 1].origin : null;
    const ownEnd = fixed || [unit.last + 1, 0], spillEnd = !fixed && following && following.last > following.first ? [following.last, 0] : ownEnd;
    const pageData = { unit: unitIndex, index: state.pages.length, chapterIndex: unit.chapterIndex, start: paragraphs[state.paragraph].start + state.consumed, end: 0, blocks: [] };
    measureBody.replaceChildren();
    let heading = null;
    if (unit.opening && !pageData.index && !state.withoutHeading) {
      heading = makeBlock({ type: 'heading', chapterIndex: unit.chapterIndex });
      measureBody.append(heading);
    }
    const items = [];
    let next = state.paragraph, from = state.consumed, budget = metrics.chars * 1.15, used = 0, fits, end = ownEnd;
    for (;;) {
      while (before(next, from, end) && used < budget) {
        const words = paragraphWords(paragraphs[next]), allowed = next === end[0] ? end[1] : words.length, open = items.at(-1)?.paragraph === next ? items.at(-1) : null;
        // Long paragraphs are appended in pieces; greedy line breaking lays out a prefix the same way.
        const limit = budget - used + 1500;
        let to = open ? open.to : from, chars = 0;
        if (!open && !from && allowed === words.length && paragraphs[next].text.length <= limit) { to = words.length; chars = paragraphs[next].text.length; }
        else while (to < allowed && chars < limit) chars += words[to++].length + 1;
        used += chars;
        if (open) { open.to = to; open.element.textContent = joinWords(words, open.from, to); }
        else { const element = measureParagraph(joinWords(words, from, to), from > 0); measureBody.append(element); items.push({ element, paragraph: next, words, from, to }); }
        if (to < allowed) break;
        // The section's text ends inside this paragraph.
        if (allowed < words.length) { from = allowed; break; }
        next++; from = 0;
      }
      fits = fitsMeasure();
      if (!fits) break;
      if (!before(next, from, end)) { if (end === spillEnd) break; end = spillEnd; }
      budget = Math.max(budget, used) + metrics.chars * .5;
    }
    if (!fits && heading && heading.getBoundingClientRect().bottom > metrics.bottom) {
      // The running title and contents remain available in very short viewports.
      state.withoutHeading = true;
      return paginateStep(unitIndex);
    }
    let placed = items.length, count = 0;
    if (!fits) {
      let low = 0, high = items.length - 1;
      while (low < high) { const middle = (low + high) >> 1; if (items[middle].element.getBoundingClientRect().bottom > metrics.bottom) high = middle; else low = middle + 1; }
      placed = low;
      const item = items[low], hasText = low > 0;
      const show = words => { item.element.textContent = joinWords(item.words, item.from, item.from + words); };
      count = fittingWords(item, metrics);
      items.slice(low + 1).forEach(other => other.element.remove());
      if (count) { show(count); if (!fitsMeasure()) { count = fittingWordsByLayout(item, count - 1); show(count); } }
      if (!count && !hasText && heading) { heading.remove(); heading = null; count = fittingWordsByLayout(item, item.to - item.from); show(count); }
      // A single extraordinarily long token can be broken by overflow-wrap.
      if (!count && !hasText) { count = 1; show(1); }
      // Move a new paragraph to the next page rather than strand one line.
      if (count && hasText && item.from + count < item.words.length && item.element.getBoundingClientRect().height < metrics.lineHeight * 1.9) count = 0;
      if (count) {
        pageData.blocks.push({ type: 'paragraph', chapterIndex: unit.chapterIndex, paragraph: item.paragraph, from: item.from, to: item.from + count, continued: item.from > 0 });
        next = item.paragraph; from = item.from + count;
        if (from >= item.words.length) { next++; from = 0; }
      } else { item.element.remove(); next = item.paragraph; from = item.from; }
    }
    pageData.blocks.unshift(...items.slice(0, placed).map(item => ({ type: 'paragraph', chapterIndex: unit.chapterIndex, paragraph: item.paragraph, from: item.from, to: item.to, continued: item.from > 0 })));
    if (heading) pageData.blocks.unshift({ type: 'heading', chapterIndex: unit.chapterIndex });
    state.paragraph = next; state.consumed = from; state.done = !before(next, from, ownEnd);
    pageData.end = next < paragraphs.length ? paragraphs[next].start + from : unit.end;
    pageData.stop = [next, from];
    pageData.chars = measureBody.textContent.length;
    state.pages.push(pageData);
    countPage(pageData, 1);
    if (!state.done) metrics.chars = metrics.chars * .6 + measureBody.textContent.length * .4;
    else if (following && !fixed) startUnitAt(unitIndex + 1, next, from);
    // A last page with room left that had to stop for a section on screen is laid out again later.
    else if (fixed && fits) layout.pending.add(unitIndex);
    return pageData;
  }

  function buildBase(left = currentPage, right = rightPage()) {
    const base = document.createElement('div');
    base.className = 'fr-base';
    if (spread) {
      const leftSlot = document.createElement('div');
      leftSlot.className = 'fr-slot fr-slot-left';
      leftSlot.append(makePage(left, 'left'));
      const rightSlot = document.createElement('div');
      rightSlot.className = 'fr-slot fr-slot-right';
      rightSlot.append(makePage(right, 'right'));
      base.append(leftSlot, rightSlot);
      const gutter = document.createElement('div');
      gutter.className = 'fr-gutter';
      gutter.setAttribute('aria-hidden', 'true');
      base.append(gutter);
    } else base.append(makePage(left));
    return base;
  }

  function renderBase() {
    const right = rightPage();
    shownPages = [currentPage, right];
    bookElement.replaceChildren(buildBase(currentPage, right));
    bookElement.classList.remove('fr-turning');
    bookElement.setAttribute('aria-busy', 'false');
    curlRenderer?.hide();
    warmedNeighbours = false;
    warmPages();
  }

  function updateChrome(announce = false) {
    if (!currentPage) return;
    const chapterIndex = chapterForOffset(anchorOffset);
    const chapter = normalized.chapters[chapterIndex];
    const right = rightPage(), atEnd = !canTurn(1), first = pageNumber(currentPage), total = totalPages();
    layout.precision = `${first !== null}:${total !== null}`;
    layout.shownEstimate = total === null ? estimatedPages(unitLimit()) : null;
    chapterElement.textContent = chapter.title;
    chapterElement.setAttribute('aria-label', `Contents, current chapter ${chapter.title}`);
    pageCountElement.textContent = !chromeVisible ? String(first ?? '') : positionText();
    if (previewOnly && chromeVisible) pageCountElement.textContent += ' · Preview';
    previewButton.hidden = !previewOnly || !atEnd;
    previewButton.inert = controls.expanded;
    reader.dataset.frPreviewEnd = String(!previewButton.hidden);
    const shown = (right && pageNumber(right)) || first, left = total !== null && shown !== null ? total - shown : null;
    root.querySelector('.fr-pages-left').textContent = atEnd ? 'End of story' : left ? `${left} ${left === 1 ? 'page' : 'pages'} left` : '';
    controls.update({percentage:Math.round(readingFraction()*100),previousDisabled:!canTurn(-1),nextDisabled:atEnd&&!previewOnly});
    range.max = String(Math.max(1, accessibleWords() - 1));
    range.value = String(atEnd ? range.max : clamp(anchorOffset, 0, accessibleWords() - 1));
    range.setAttribute('aria-valuetext', `${chapter.title}, ${positionText(true)}`);
    range.style.setProperty('--fr-progress', `${Number(range.value) / Number(range.max) * 100}%`);
    const button = chapterList.children[chapterIndex]?.firstElementChild || null;
    if (button !== currentChapterButton) {
      currentChapterButton?.removeAttribute('aria-current');
      button?.setAttribute('aria-current', 'true');
      currentChapterButton = button;
    }
    if (announce) announcement.textContent = `${chapter.title}. ${positionText(true).replace(/^./, letter => letter.toUpperCase())}.`;
  }

  function emitProgress() {
    if (!isOpen || !book || !normalized?.totalWords) return;
    clearTimeout(progressTimer);
    const send = () => {
      if (!isOpen || !book) return;
      lastProgressAt = performance.now();
      try { onProgress(book.id, { wordOffset: anchorOffset, fraction: readingFraction() }); }
      catch (error) { console.error('Folio progress callback failed.', error); }
    };
    const wait = Math.max(0, 180 - (performance.now() - lastProgressAt));
    if (wait) progressTimer = setTimeout(send, wait);
    else send();
  }

  function measureGeometry() {
    const stageStyle = getComputedStyle(stage);
    const width = stage.clientWidth - parseFloat(stageStyle.paddingLeft) - parseFloat(stageStyle.paddingRight);
    const height = stage.clientHeight - parseFloat(stageStyle.paddingTop) - parseFloat(stageStyle.paddingBottom);
    if (!width || !height) return null;
    const readerStyle = getComputedStyle(reader);
    const fullBleed = readerStyle.getPropertyValue('--fr-full-bleed').trim() === '1';
    const spreadAvailable = !fullBleed && reader.clientWidth >= 900, isSpread = settings.spread && spreadAvailable;
    const safe = side => parseFloat(readerStyle.getPropertyValue(`--fr-safe-${side}`)) || 0;
    const safeTop = safe('top'), safeBottom = safe('bottom');
    const availableHeight = Math.max(120, Math.min(height, isSpread ? 780 : 860));
    const pageW = Math.floor(fullBleed ? width : Math.min(width / (isSpread ? 2 : 1), isSpread ? 580 : 640, availableHeight * (isSpread ? .7 : .74)));
    const pageH = Math.floor(fullBleed ? height : Math.min(availableHeight, pageW * (isSpread ? 1.6 : 1.8)));
    const insetX = reader.clientWidth < 520 ? 22 : pageW < 440 ? 32 : 44, insetY = reader.clientWidth < 520 || pageH < 520 ? 24 : 36, insetBottom = reader.clientWidth < 520 ? 16 : 22;
    const key = `${pageW}:${pageH}:${isSpread}:${fullBleed}:${settings.fontSize}:${safeTop}:${safeBottom}:${safe('left')}:${safe('right')}:${insetX}:${insetY}:${insetBottom}`;
    return { key, fullBleed, spreadAvailable, spread: isSpread, pageWidth: pageW, pageHeight: pageH, safeTop, safeBottom, insetX, insetY, insetBottom };
  }

  function reflow(force = false) {
    if (!isOpen || !book) return;
    const geometry = measureGeometry();
    if (!geometry) return;
    const { fullBleed, safeTop, safeBottom } = geometry;
    spreadInput.disabled = !geometry.spreadAvailable;
    root.querySelector('.fr-spread-note').textContent = geometry.spreadAvailable ? 'For a little more room.' : 'Available in a wider window.';
    spread = geometry.spread;
    spreadInput.checked = spread;
    pageWidth = geometry.pageWidth;
    pageHeight = geometry.pageHeight;
    if (!force && geometry.key === lastMeasureKey) return;
    lastMeasureKey = geometry.key;
    abortTurn();
    reader.classList.toggle('fr-compact', (fullBleed ? pageHeight - 160 - safeTop - safeBottom : pageHeight) < 380);
    bookElement.classList.toggle('fr-is-spread', spread);
    bookElement.style.width = `${pageWidth * (spread ? 2 : 1)}px`;
    bookElement.style.height = `${pageHeight}px`;
    reader.style.setProperty('--fr-page-inset-x', `${geometry.insetX}px`);
    reader.style.setProperty('--fr-page-inset-y', `${geometry.insetY}px`);
    reader.style.setProperty('--fr-page-inset-bottom', `${geometry.insetBottom}px`);
    reader.style.setProperty('--fr-bar-width', `${Math.max(pageWidth * (spread ? 2 : 1), 560)}px`);
    measurePage.style.width = `${pageWidth}px`;
    measurePage.style.height = `${pageHeight}px`;
    // Returning to a measured size reuses its pages; only the current unit is paginated now.
    if (force) layouts.delete(geometry.key);
    layout = layouts.get(geometry.key);
    if (layout) layouts.delete(geometry.key);
    else layout = { id: ++layoutCount, units: [], prefix: [0], scan: 0, pagedChars: 0, pagedPages: 0, openingChars: 0, openingPages: 0, metrics: null, precision: '', shownEstimate: null, pending: new Set() };
    layouts.set(geometry.key, layout);
    while (layouts.size > 4) layouts.delete(layouts.keys().next().value);
    currentPage = spreadStart(pageForOffset(anchorOffset));
    renderBase();
    updateChrome();
    emitProgress();
    scheduleBackground();
  }

  // Apply a pending resize or text size before the reader moves.
  function settleLayout() {
    if (!fontTimer && !resizeTimer) return;
    clearTimeout(fontTimer); clearTimeout(resizeTimer); fontTimer = resizeTimer = 0;
    reflow();
  }

  // The rest of the book is paginated in short idle slices: the current unit and its
  // neighbours first, then everything in order so page numbers become exact.
  function scheduleBackground(delay = 0) {
    if (backgroundHandle || !isOpen || fontPending || !layout) return;
    backgroundIdle = !delay && typeof requestIdleCallback === 'function';
    backgroundHandle = backgroundIdle ? requestIdleCallback(runBackground, { timeout: 400 }) : setTimeout(runBackground, delay || 16);
  }
  function cancelBackground() {
    if (backgroundIdle) cancelIdleCallback(backgroundHandle); else clearTimeout(backgroundHandle);
    backgroundHandle = 0;
  }
  function backgroundUnit() {
    const limit = unitLimit(), current = currentPage.unit;
    // A few pages ahead, then the previous unit: turning back into it needs all of it.
    if (!layout.units[current].done && layout.units[current].pages.length < currentPage.index + 5) return current;
    for (const index of [current - 1, current, current + 1]) if (index >= 0 && index < limit && !layout.units[index]?.done) return index;
    while (layout.scan < limit && layout.units[layout.scan]?.done) layout.scan++;
    return layout.scan < limit ? layout.scan : -1;
  }
  function runBackground(deadline) {
    backgroundHandle = 0;
    if (!isOpen || !layout || !currentPage || fontPending) return;
    if (turn || pointer || fontTimer || resizeTimer) { scheduleBackground(150); return; }
    const geometry = measureGeometry();
    if (geometry?.key !== lastMeasureKey) { if (geometry) onResize(); else scheduleBackground(500); return; }
    const until = performance.now() + clamp(deadline?.timeRemaining?.() ?? 10, 4, 12);
    repairSections();
    let index;
    while ((index = backgroundUnit()) !== -1) {
      paginateStep(index);
      if (performance.now() >= until) break;
    }
    let waiting = false;
    const estimate = layout.shownEstimate, drifted = estimate !== null && totalPages() === null && Math.abs(estimatedPages(unitLimit()) - estimate) > estimate * .05;
    if (`${pageNumber(currentPage) !== null}:${totalPages() !== null}` !== layout.precision || drifted) {
      // Newly exact numbers or a better estimate refresh the labels, though not under a reader using the slider.
      if (document.activeElement === range) waiting = true;
      else { updateChrome(); refreshFolios(); warmedNeighbours = false; warmPages(); }
    }
    if (!warmedNeighbours && [1, -1].every(direction => !canTurn(direction) || turnTarget(direction, false))) { warmedNeighbours = true; warmPages(); }
    if (index !== -1 || waiting) scheduleBackground(index === -1 ? 500 : 0);
  }

  function cancelOpening() { clearTimeout(openingTimer); bookElement.querySelector('.fr-opening-cover')?.remove(); }

  function revealBook() {
    cancelOpening();
    if (motionQuery.matches || anchorOffset > 0) return;
    const cover=document.createElement('div');cover.className='fr-opening-cover';cover.setAttribute('aria-hidden','true');cover.innerHTML=renderCover(book);bookElement.append(cover);
    openingTimer=setTimeout(()=>cover.remove(),1050);
  }

  function setChrome(visible) {
    chromeVisible = visible;
    reader.dataset.frChrome = visible ? 'shown' : 'hidden';
    const toolbar=root.querySelector('.fr-toolbar'),footer=root.querySelector('.fr-footer');
    if (!visible && controlsHost.contains(document.activeElement)) bookElement.focus({ preventScroll: true });
    toolbar.inert = !visible; footer.inert = !visible;controlsHost.inert=!visible || (!appearancePanel.hidden && !appearancePanel.inert);
    updateChrome();
  }

  function activePanel() { return [contentsPanel, appearancePanel, searchPanel].find(panel => !panel.hidden && !panel.inert)||(controls.expanded?controlsHost:null); }

  function stopAppearanceMotion() {
    appearanceMotion?.animations.forEach(animation => animation.cancel());
    appearanceMotion = null;
    appearanceSurface.hidden = true;
    appearancePanel.classList.remove('fr-appearance-transition');
  }

  function finishAppearanceMotion() {
    if (!appearanceMotion) return;
    const {opening} = appearanceMotion;
    stopAppearanceMotion();
    appearancePanel.hidden = !opening;
    appearancePanel.inert = !opening;
    reader.dataset.frAppearance = opening ? 'open' : 'closed';
    reader.classList.toggle('fr-panel-open', opening);
    controlsHost.inert = !chromeVisible || opening;
  }

  // Move one glass surface between the actual pill and panel bounds. Content
  // animates independently, so the settings never stretch with the material.
  function transitionAppearance(opening, trigger = root.querySelector('.fr-appearance-toggle')) {
    const current = appearanceMotion;
    const from = current ? appearanceSurface.getBoundingClientRect() : (opening ? trigger : appearancePanel).getBoundingClientRect();
    const fromRadius = current ? parseFloat(getComputedStyle(appearanceSurface).borderRadius) : opening ? from.height / 2 : 28;
    const surfaceColor = current ? getComputedStyle(appearanceSurface).backgroundColor : null;
    const currentClip = current ? getComputedStyle(appearancePanel).clipPath : null;
    const contentStyle = getComputedStyle(appearanceContent);
    const contentFrom = current ? {opacity:contentStyle.opacity,transform:contentStyle.transform} : {opacity:opening ? 0 : 1,transform:opening ? 'translateY(10px)' : 'none'};
    stopAppearanceMotion();
    panelTrigger = trigger;
    contentsPanel.hidden = true; searchPanel.hidden = true;
    controls.setExpanded(true);
    previewButton.inert = true;
    appearancePanel.hidden = false;
    appearancePanel.inert = !opening;
    appearancePanel.setAttribute('aria-hidden', String(!opening));
    reader.classList.toggle('fr-panel-open', opening);
    reader.dataset.frAppearance = opening ? 'opening' : 'closing';
    controlsHost.inert = opening;
    setChrome(true);
    trigger.setAttribute('aria-expanded', String(opening));
    const target = (opening ? appearancePanel : trigger).getBoundingClientRect();
    const panelBounds = appearancePanel.getBoundingClientRect();
    const panelColor = getComputedStyle(appearancePanel).backgroundColor;
    const pillColor = getComputedStyle(reader).getPropertyValue('--fr-liquid-tint').trim();
    const bounds = reader.getBoundingClientRect();
    const frame = (rect, radius) => ({left:`${rect.left-bounds.left}px`,top:`${rect.top-bounds.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,borderRadius:`${radius}px`});
    const to = frame(target, opening ? 28 : target.height / 2);
    const clip = rect => `inset(${Math.max(0,rect.top-panelBounds.top)}px ${Math.max(0,panelBounds.right-rect.right)}px ${Math.max(0,panelBounds.bottom-rect.bottom)}px ${Math.max(0,rect.left-panelBounds.left)}px round 28px)`;
    Object.assign(appearanceSurface.style, to);
    appearancePanel.classList.add('fr-appearance-transition');
    appearanceSurface.hidden = false;
    const state = {opening,animations:[]};
    appearanceMotion = state;
    if (!motionQuery.matches) {
      state.animations.push(appearanceSurface.animate([
        {...frame(from,fromRadius),backgroundColor:surfaceColor || (opening ? pillColor : panelColor)},
        {...to,backgroundColor:opening ? panelColor : pillColor}
      ],{
        duration:opening ? 500 : 420,easing:opening ? 'cubic-bezier(.22,1,.36,1)' : 'cubic-bezier(.4,0,.2,1)',fill:'both'
      }));
      state.animations.push(appearancePanel.animate([{clipPath:currentClip || clip(from)},{clipPath:clip(target)}],{
        duration:opening ? 500 : 420,easing:opening ? 'cubic-bezier(.22,1,.36,1)' : 'cubic-bezier(.4,0,.2,1)',fill:'both'
      }));
      state.animations.push(appearanceContent.animate([contentFrom,{opacity:opening ? 1 : 0,transform:opening ? 'none' : 'translateY(8px)'}],{
        duration:opening ? 320 : 140,delay:opening && !current ? 100 : 0,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'
      }));
      // Settle even when an engine never resolves (or cancels) the animations, so the panel can't stay clipped.
      const settle = () => { if (appearanceMotion === state) finishAppearanceMotion(); };
      Promise.all(state.animations.map(animation => animation.finished)).then(settle, settle);
      setTimeout(settle, (opening ? 500 : 420) + (opening && !current ? 100 : 0) + 250);
    } else finishAppearanceMotion();
    (opening ? appearancePanel.querySelector('button') : trigger)?.focus({preventScroll:true});
  }

  function closePanels(restoreFocus = false) {
    const wasVisible = Boolean(activePanel());
    const containedFocus = [controlsHost, contentsPanel, appearancePanel, searchPanel].some(panel => panel.contains(document.activeElement));
    stopAppearanceMotion();
    reader.dataset.frAppearance = 'closed';
    appearancePanel.inert = false;
    appearancePanel.removeAttribute('aria-hidden');
    controlsHost.inert = !chromeVisible;
    for (const panel of [contentsPanel, appearancePanel, searchPanel]) panel.hidden = true;
    controls.setExpanded(false);
    previewButton.inert = false;
    reader.classList.remove('fr-panel-open');
    root.querySelectorAll('[aria-controls]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    if (restoreFocus && wasVisible) { setChrome(true); menuButton.focus({ preventScroll: true }); }
    else if (containedFocus) bookElement.focus({ preventScroll: true });
    return wasVisible;
  }

  function togglePanel(name, trigger) {
    if (name === 'appearance') {
      transitionAppearance(appearancePanel.hidden || appearancePanel.inert, trigger);
      return;
    }
    const panel = name === 'contents' ? contentsPanel : name === 'search' ? searchPanel : appearancePanel;
    const show = panel.hidden;
    closePanels(); setChrome(true);
    if (show) {
      panelTrigger = trigger; panel.hidden = false;
      if (name === 'contents') contentsPanel.querySelector('.fr-chapter-list [aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
      reader.classList.add('fr-panel-open');
      root.querySelectorAll(`[aria-controls="${panel.id}"]`).forEach(button => button.setAttribute('aria-expanded', 'true'));
      (name === 'search' ? bookSearch : panel.querySelector('button:not(:disabled),input:not(:disabled)'))?.focus({ preventScroll: true });
    }
  }

  function searchBook() {
    clearTimeout(searchTimer);
    const query = bookSearch.value.trim().toLocaleLowerCase();
    searchResults.replaceChildren();
    if (!query) { root.querySelector('.fr-search-status').textContent = 'Search the text of this book.'; return; }
    const chapters = previewOnly ? 1 : normalized.chapters.length;
    while (searchIndex.length < chapters) indexChapter();
    let count = 0;
    for (let chapterIndex = 0; chapterIndex < chapters; chapterIndex++) {
      const chapter = normalized.chapters[chapterIndex], lower = searchIndex[chapterIndex];
      for (let paragraphIndex = 0; paragraphIndex < lower.length; paragraphIndex++) {
        const index = lower[paragraphIndex].indexOf(query);
        if (index < 0) continue;
        count++;
        if (count > 40) continue;
        const paragraph = chapter.paragraphs[paragraphIndex], words = paragraphWords(paragraph), text = joinWords(words);
        // The match's own word: the words before it, separated as on the page.
        let offset = paragraph.start;
        for (let word = 0, position = 0; word < words.length; word++) { position += (word ? gapBefore(words, word) : 0) + words[word].length; if (position > index) { offset = paragraph.start + word; break; } }
        const item = document.createElement('li'), button = document.createElement('button');
        button.type = 'button'; button.dataset.frAction = 'search-result'; button.dataset.frOffset = String(offset);
        const title = document.createElement('strong'); title.textContent = chapter.title;
        // Cut the excerpt at word boundaries; mark only cuts that leave a sentence unfinished.
        let start = Math.max(0, index - 45), end = Math.min(text.length, index + query.length + 90);
        if (start > 0) start = text.lastIndexOf(' ', start) + 1;
        if (end < text.length) { const space = text.indexOf(' ', end); end = space < 0 ? text.length : space; }
        const excerpt = text.slice(start, end).trim();
        const snippet = document.createElement('span'); snippet.textContent = `${start > 0 ? '…' : ''}${excerpt}${end < text.length && !/[.!?…]['"’”)]*$/.test(excerpt) ? '…' : ''}`;
        button.append(title, snippet); item.append(button); searchResults.append(item);
      }
    }
    root.querySelector('.fr-search-status').textContent = `${count} ${count === 1 ? 'passage' : 'passages'} found${count > 40 ? ' · showing the first 40' : ''}`;
  }

  // Lowercase text with single spaces between words, built once per opened book: in idle
  // time from when the reading tools open, and finished by the first search if need be.
  function indexChapter() {
    searchIndex.push(normalized.chapters[searchIndex.length].paragraphs.map(paragraph => paragraph.text.replace(/\s+/gu, ' ').trim().toLocaleLowerCase()));
  }
  function prepareSearch() {
    const index = searchIndex, chapters = previewOnly ? 1 : normalized.chapters.length;
    if (index.length >= chapters) return;
    (window.requestIdleCallback || setTimeout)(() => {
      if (!isOpen || index !== searchIndex) return;
      const until = performance.now() + 8;
      while (index.length < chapters && performance.now() < until) indexChapter();
      prepareSearch();
    });
  }

  function abortTurn() {
    cancelAnimationFrame(frameId);
    frameId = 0;
    turn = null;
    pointer = null;
    queuedDirection = 0;
    bookElement.classList.remove('fr-turning');
    curlRenderer?.hide();
  }

  function renderer() {
    if (curlUnavailable || motionQuery.matches) return null;
    if (!curlRenderer) {
      curlRenderer = createPageCurlRenderer(stage, () => {
        curlRenderer?.dispose(); curlRenderer = null; curlUnavailable = true;
        if (isOpen) { abortTurn(); renderBase(); updateChrome(); }
      });
      if (!curlRenderer) curlUnavailable = true;
    }
    return curlRenderer;
  }

  function pageTexture(pageData, side = '') {
    const gpu = renderer();
    if (!gpu) return null;
    const page = pageData === 'blank' ? document.createElement('div') : makePage(pageData, side);
    if (pageData === 'blank') page.className = 'fr-page';
    const id = pageData === 'blank' ? 'blank' : pageData ? `${pageData.unit}.${pageData.index}.${pageNumber(pageData) || ''}` : 'end';
    return gpu.prepare(page, `${book.id}:${layout.id}:${settings.theme}:${searchHighlight}:${id}:${side}`, pageWidth, pageHeight);
  }

  function turnTextures(direction, target) {
    const [front, back] = turnPages(direction, target);
    return { front: pageTexture(front, spread ? 'right' : ''), back: pageTexture(back, spread ? 'left' : '') };
  }

  function warmPages() {
    clearTimeout(warmTimer);
    if (!isOpen || motionQuery.matches || !currentPage || document.hidden) return;
    let jobs = null, first = null;
    const warm = () => {
      if (!isOpen || turn || pointer) return;
      if (!jobs) {
        // Only pages already measured: background pagination warms the rest when it reaches them.
        const plans = [1, -1].map(direction => { const target = canTurn(direction) && turnTarget(direction, false); return target && turnPages(direction, target, false); }).filter(pages => pages?.[0] && pages[1]);
        first = plans[0];
        jobs = plans.flatMap(([front, back]) => [[front, spread ? 'right' : ''], [back, spread ? 'left' : '']]);
      }
      // One page a task, so rasterising never holds up input for long.
      if (jobs.length) { pageTexture(...jobs.shift()); warmTimer = setTimeout(warm, 16); return; }
      const textures = first && curlRenderer && { front: pageTexture(first[0], spread ? 'right' : ''), back: pageTexture(first[1], spread ? 'left' : '') };
      // Compile the GPU draw path before the first touch, then keep it hidden.
      if (textures?.front && textures.back) {
        const bounds = bookElement.getBoundingClientRect(), outer = stage.getBoundingClientRect();
        curlRenderer.paint({ progress: 0, grab: 0, width: pageWidth, height: pageHeight,
          originX: bounds.left - outer.left + (spread ? pageWidth : 0), originY: bounds.top - outer.top, ...textures });
        curlRenderer.hide();
      }
    };
    warmTimer = setTimeout(warm, 80);
  }

  function beginTurn(direction, grab = 0) {
    if (turn || !canTurn(direction)) return false;
    const target = turnTarget(direction);
    if (!target) return false;
    clearTimeout(warmTimer);
    const textures = turnTextures(direction, target);
    const base = spread
      ? (direction > 0 ? buildBase(currentPage, nextPage(target)) : buildBase(target, rightPage()))
      : buildBase(direction > 0 ? target : currentPage);
    const shadow = document.createElement('div');
    shadow.className = 'fr-turn-shadow';
    shadow.setAttribute('aria-hidden', 'true');
    bookElement.replaceChildren(base, shadow);
    let leaf = null;
    // A flat page slide is the fallback when GPU rendering is unavailable.
    if (!curlRenderer || !textures.front || !textures.back) {
      leaf = document.createElement('div');
      leaf.className = 'fr-leaf';
      leaf.setAttribute('aria-hidden', 'true');
      leaf.append(makePage(turnPages(direction, target)[0]));
      bookElement.append(leaf);
    }
    const bounds = bookElement.getBoundingClientRect(), stageBounds = stage.getBoundingClientRect();
    bookElement.classList.add('fr-turning');
    bookElement.setAttribute('aria-busy', 'true');
    turn = { direction, target, progress: 0, leaf, textures, shadow, grab,
      originX: bounds.left - stageBounds.left + (spread ? pageWidth : 0), originY: bounds.top - stageBounds.top };
    paintTurn(0);
    return true;
  }

  function paintTurn(progress) {
    if (!turn) return;
    turn.progress = clamp(progress, 0, 1);
    const sweep = turn.direction > 0 ? turn.progress : 1 - turn.progress;
    if (turn.leaf) turn.leaf.style.transform = `translateX(${-pageWidth * sweep}px)`;
    else curlRenderer?.paint({ progress: sweep, grab: turn.grab, width: pageWidth, height: pageHeight,
      originX: turn.originX, originY: turn.originY, ...turn.textures });
    const { fold, radius } = curlShape(sweep, pageWidth);
    turn.shadow.style.width = `${radius * 3 + 12}px`;
    turn.shadow.style.opacity = String(Math.sin(sweep * Math.PI) * .2);
    turn.shadow.style.transform = `translateX(${fold - radius * .5}px)`;
  }

  function finishTurn(complete) {
    if (!turn) return;
    const queued = queuedDirection;
    if (complete) {
      currentPage = turn.target;
      anchorOffset = currentPage.start;
    }
    turn = null;
    frameId = 0;
    queuedDirection = 0;
    renderBase();
    updateChrome(complete);
    if (complete) emitProgress();
    scheduleBackground();
    if (queued && isOpen) requestTurn(queued);
  }

  function releaseTurn(complete, velocity = 0) {
    if (!turn) return;
    cancelAnimationFrame(frameId);
    const target = complete ? 1 : 0;
    const start = turn.progress;
    const speed = clamp(velocity, -22 * start, 22 * (1 - start));
    const startedAt = performance.now();
    function spring(time) {
      if (!turn || !isOpen) return;
      const state = settleProgress(start, speed, target, (time - startedAt) / 1000);
      paintTurn(state.position);
      if ((Math.abs(target - state.position) < .001 && Math.abs(state.velocity) < .02) || time - startedAt > 650) finishTurn(complete);
      else frameId = requestAnimationFrame(spring);
    }
    frameId = requestAnimationFrame(spring);
  }

  function requestTurn(direction) {
    cancelOpening();
    if (!isOpen || !currentPage) return;
    closePanels();
    if (turn) { queuedDirection = direction; return; }
    settleLayout();
    if (!canTurn(direction)) { if (previewOnly && direction > 0) onPreviewEnd(book.id); return; }
    if (motionQuery.matches) {
      currentPage = turnTarget(direction);
      anchorOffset = currentPage.start;
      renderBase();
      bookElement.animate?.([{ opacity: .72 }, { opacity: 1 }], { duration: 110, easing: 'ease-out' });
      updateChrome(true);
      emitProgress();
      scheduleBackground();
      return;
    }
    if (beginTurn(direction)) releaseTurn(true, .4);
  }

  function jumpToOffset(offset, announce = true, {keepPanel=false} = {}) {
    cancelOpening();
    settleLayout();
    abortTurn();
    anchorOffset = clamp(Number(offset) || 0, 0, Math.max(0, accessibleWords() - 1));
    currentPage = spreadStart(pageForOffset(anchorOffset));
    renderBase();
    if(!keepPanel)closePanels();
    updateChrome(announce);
    emitProgress();
    scheduleBackground();
  }

  function onClick(event) {
    const button = event.target.closest('[data-fr-action]');
    if (!button || !root.contains(button)) return;
    const action = button.dataset.frAction;
    if (action === 'close') close();
    else if(action==='menu'){
      const show=!controls.expanded;closePanels();setChrome(true);controls.setExpanded(show);if(show)prepareSearch();
      previewButton.inert = show;
      if(show&&event.detail===0)root.querySelector('.fr-contents-toggle')?.focus({preventScroll:true});
    }
    else if (action === 'search') { searchBook(); togglePanel(action, button); prepareSearch(); }
    else if (action === 'search-result') { searchHighlight = bookSearch.value.trim().toLocaleLowerCase(); jumpToOffset(Number(button.dataset.frOffset)); setChrome(false); bookElement.focus({ preventScroll: true }); }
    else if (action === 'previous') requestTurn(-1);
    else if (action === 'next') requestTurn(1);
    else if (action === 'subscribe' || action === 'locked-chapter') { closePanels(); onPreviewEnd(book.id); }
    else if (action === 'contents' || action === 'appearance') togglePanel(action, button);
    else if (action === 'close-panel') {
      if (appearancePanel.contains(button)) transitionAppearance(false);
      else closePanels(true);
    }
    else if (action === 'chapter') {
      jumpToOffset(normalized.chapters[Number(button.dataset.frChapter)].start);
      menuButton.focus({ preventScroll: true });
    } else if (action === 'smaller' || action === 'larger') {
      settings.fontSize = clamp(settings.fontSize + (action === 'larger' ? 1 : -1), 14, 26);
      applySettings();
      if (button.disabled) root.querySelector('.fr-size-button:not(:disabled)')?.focus({ preventScroll: true });
      saveSettings();
      // The first change reflows at once; quick repeats settle into one reflow.
      clearTimeout(fontTimer); fontTimer = 0;
      if (performance.now() - lastFontChange > 250) reflow();
      else fontTimer = setTimeout(() => { fontTimer = 0; reflow(); }, 180);
      lastFontChange = performance.now();
    } else if (action === 'theme') {
      settings.theme = button.dataset.frThemeOption;
      applySettings();
      saveSettings();
      warmPages();
    }
  }

  function onPointerDown(event) {
    if (!isOpen || pointer || !event.isPrimary || event.button !== 0 || event.pointerId === dismissedPointerId) return;
    if (closePanels()) return;
    cancelOpening();
    if (event.target.closest('button, a, input, select, textarea')) return;
    const rect = bookElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const edge = Math.min(90, rect.width * .22);
    const edgeDirection = x < edge ? -1 : x > rect.width - edge ? 1 : 0;
    const inText = Boolean(event.target.closest('.fr-page-body'));
    const now = event.timeStamp;
    const resumed = Boolean(turn);
    if (resumed) { cancelAnimationFrame(frameId); frameId = 0; }
    pointer = {
      id: event.pointerId, startX: event.clientX, startY: event.clientY,
      lastX: event.clientX, lastTime: now, velocity: 0, samples: [{ x: event.clientX, time: now }],
      edgeDirection, direction: turn?.direction || 0, dragging: resumed,
      startProgress: turn?.progress || 0, grab: clamp((.5 - (event.clientY - rect.top) / rect.height) * 2, -1, 1),
      allowDrag: event.pointerType !== 'mouse' || !inText || x < 25 || x > rect.width - 25,
      hadSelection: Boolean(window.getSelection()?.toString()), reducedProgress: 0
    };
    if (resumed) {
      try { bookElement.setPointerCapture(event.pointerId); } catch { /* The pointer may have ended. */ }
    }
  }

  function onPointerMove(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    if (!pointer.dragging) {
      if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) { pointer = null; return; }
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.15 || !pointer.allowDrag || pointer.hadSelection) return;
      if (window.getSelection()?.toString()) { pointer = null; return; }
      pointer.direction ||= dx < 0 ? 1 : -1;
      if (fontTimer || resizeTimer) { settleLayout(); pointer = null; return; }
      if ((!canTurn(pointer.direction) && !(previewOnly && pointer.direction > 0)) || dx * pointer.direction >= 0) { pointer = null; return; }
      pointer.dragging = true;
      setChrome(false);
      window.getSelection()?.removeAllRanges();
      try { bookElement.setPointerCapture(event.pointerId); } catch { /* Capture can end between input frames. */ }
      if (!motionQuery.matches) beginTurn(pointer.direction, pointer.grab);
    }
    event.preventDefault();
    const now = event.timeStamp;
    pointer.samples.push({ x: event.clientX, time: now });
    while (pointer.samples.length > 2 && pointer.samples[1].time < now - 80) pointer.samples.shift();
    const sample = pointer.samples[0];
    pointer.velocity = clamp(-(event.clientX - sample.x) * pointer.direction / (2 * pageWidth) / Math.max(.008, (now - sample.time) / 1000), -3, 3);
    pointer.lastX = event.clientX;
    pointer.lastTime = now;
    const progress = dragProgress(-dx * pointer.direction, pageWidth, pointer.startProgress);
    pointer.reducedProgress = progress;
    if (turn) {
      turn.progress = progress;
      if (!frameId) frameId = requestAnimationFrame(() => { frameId = 0; if (turn) paintTurn(turn.progress); });
    }
  }

  function endPointer(event, cancelled = false) {
    if (event.pointerId === dismissedPointerId) {
      dismissedPointerId = null;
      if (document.activeElement === document.body && panelTrigger?.isConnected) panelTrigger.focus({ preventScroll: true });
    }
    if (!pointer || event.pointerId !== pointer.id) return;
    if (!cancelled && pointer.dragging && event.clientX !== pointer.lastX) onPointerMove(event);
    const ended = pointer;
    pointer = null;
    try { if (bookElement.hasPointerCapture(event.pointerId)) bookElement.releasePointerCapture(event.pointerId); } catch { /* No capture remains. */ }
    if (ended.dragging) {
      const progress = turn?.progress ?? ended.reducedProgress;
      const releaseAge = Math.max(0, (event.timeStamp - ended.lastTime) / 1000 - .025);
      const releaseVelocity = ended.velocity * Math.exp(-releaseAge * 18);
      const complete = !cancelled && completesTurn(progress, releaseVelocity);
      if (previewOnly && ended.direction > 0 && !canTurn(1)) { if (complete) onPreviewEnd(book.id); }
      else if (motionQuery.matches) {
        if (turn) { cancelAnimationFrame(frameId); finishTurn(complete); }
        else if (complete) requestTurn(ended.direction);
      }
      else releaseTurn(complete, releaseVelocity);
    } else if (!cancelled && settings.tapToTurn && ended.edgeDirection && !ended.hadSelection && !window.getSelection()?.toString()) {
      const movement = Math.hypot(event.clientX - ended.startX, event.clientY - ended.startY);
      if (movement < 9) requestTurn(ended.edgeDirection);
    } else if (!cancelled && !ended.hadSelection && !window.getSelection()?.toString() && Math.hypot(event.clientX - ended.startX, event.clientY - ended.startY) < 9) setChrome(!chromeVisible);
  }

  function onKeyDown(event) {
    if (!isOpen || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!appearancePanel.hidden && !appearancePanel.inert) { transitionAppearance(false); return; }
      if (!closePanels(true)) close();
      return;
    }
    if (event.key === 'Tab') {
      setChrome(true);
      // An open Contents or Search panel keeps Tab inside it, as Themes & text does; Escape leaves.
      const scope = [contentsPanel, searchPanel].find(panel => !panel.hidden) || root;
      const focusable = [...scope.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')]
        .filter(element => element.tabIndex>=0&&element.getClientRects().length && !element.closest('[hidden],[inert]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      // The book page and anything else outside the list enter the cycle at its ends.
      const current = focusable.indexOf(document.activeElement);
      if (event.shiftKey && current <= 0) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (current === -1 || current === focusable.length - 1)) {
        event.preventDefault(); first?.focus();
      }
      return;
    }
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], .fr-panel')) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const navigation = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 };
    if (navigation[event.key]) { event.preventDefault(); requestTurn(navigation[event.key]); }
    else if (event.key === 'Home') { event.preventDefault(); jumpToOffset(0); }
    else if (event.key === 'End') { event.preventDefault(); jumpToOffset(Math.max(0, normalized.totalWords - 1)); }
  }

  function onFocusIn(event) {
    if (!isOpen || document.querySelector('dialog[open]')) return;
    if (!root.contains(event.target)) { setChrome(true); menuButton.focus({ preventScroll: true }); return; }
    const panel = activePanel();
    if (panel && !panel.contains(event.target) && event.target !== panelTrigger) closePanels();
  }

  function onSpreadChange() {
    settings.spread = spreadInput.checked;
    saveSettings();
    reflow();
  }

  function onTapToTurnChange() {
    settings.tapToTurn = tapInput.checked;
    saveSettings();
  }

  function onRangeInput() {
    if (!currentPage) return;
    // Scrubbing reads measured pages only; elsewhere the page number is an estimate.
    const chapter = normalized.chapters[chapterForOffset(Number(range.value))];
    range.setAttribute('aria-valuetext', `${chapter.title}, ${offsetText(Number(range.value))}`);
    range.style.setProperty('--fr-progress', `${Number(range.value) / Number(range.max) * 100}%`);
  }

  function onRangeChange() { jumpToOffset(Number(range.value),true,{keepPanel:!contentsPanel.hidden}); }
  function onReaderPointerDown(event) {
    dismissedPointerId = null;
    const panel = activePanel();
    if (!panel || panel.contains(event.target) || event.target.closest('[data-fr-action="menu"], [data-fr-action="contents"], [data-fr-action="appearance"], [data-fr-action="search"]')) return;
    dismissedPointerId = event.pointerId;
    closePanels(true);
  }
  function onResize() {
    if (!isOpen) return;
    finishAppearanceMotion();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resizeTimer = 0; reflow(); }, 100);
  }
  // A search after a pause runs at once; a burst of typing settles into one search.
  function onSearchInput() {
    clearTimeout(searchTimer);
    if (performance.now() - lastSearchInput > 150) searchBook();
    else searchTimer = setTimeout(searchBook, 150);
    lastSearchInput = performance.now();
  }
  const onPointerUp = event => endPointer(event);
  const onPointerCancel = event => endPointer(event, true);
  const onLostPointerCapture = event => {
    if (event.target === bookElement) endPointer(event, true);
  };
  const onDragStart = event => event.preventDefault();
  const onVisibilityChange = () => {
    if(isOpen){
      if(document.hidden){closePanels();controls.unmount();}
      else{controls.mount();menuButton=root.querySelector('.fr-menu-toggle');setChrome(chromeVisible);}
    }
    if (document.hidden && isOpen && turn) { abortTurn(); renderBase(); updateChrome(); }
  };
  const onMotionChange = () => {
    if (!isOpen) return;
    if (motionQuery.matches) finishAppearanceMotion();
    if (motionQuery.matches && turn) { abortTurn(); renderBase(); updateChrome(); }
    else warmPages();
  };

  root.addEventListener('click', onClick);
  reader.addEventListener('pointerdown', onReaderPointerDown, true);
  bookElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  bookElement.addEventListener('lostpointercapture', onLostPointerCapture);
  document.addEventListener('visibilitychange', onVisibilityChange);
  motionQuery.addEventListener('change', onMotionChange);
  bookElement.addEventListener('dragstart', onDragStart);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('focusin', onFocusIn);
  spreadInput.addEventListener('change', onSpreadChange);
  tapInput.addEventListener('change', onTapToTurnChange);
  bookSearch.addEventListener('input', onSearchInput);
  range.addEventListener('input', onRangeInput);
  range.addEventListener('change', onRangeChange);
  window.addEventListener('resize', onResize);
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
  resizeObserver?.observe(stage);

  function open(nextBook, { wordOffset = 0, preview = false } = {}) {
    if (isDestroyed) throw new Error('This reader has been destroyed.');
    if (!nextBook || !nextBook.id) throw new TypeError('A book with an id is required.');
    const focusBeforeOpen = isOpen ? previousFocus : document.activeElement;
    if (isOpen) close(false);
    book = nextBook;
    normalized = normalizeBook(book);
    if (!normalized.chapters.length) {
      normalized = normalizeBook({ ...book, chapters: [{ title: book.title || 'Your book', paragraphs: ['The text of this book is not available yet. You can return to your library and choose another story.'] }] });
    }
    previewOnly = preview && normalized.chapters.length > 1;
    anchorOffset = clamp(Number(wordOffset) || 0, 0, Math.max(0, accessibleWords() - 1));
    measureBody.lang = book.language || 'en';
    fontPending = false;
    previousFocus = focusBeforeOpen;
    isOpen = true;
    root.hidden = false;
    controls.mount();
    menuButton=root.querySelector('.fr-menu-toggle');
    openedBodyLock = !document.body.classList.contains('reader-open');
    document.body.classList.add('reader-open');
    document.documentElement.classList.add('fr-reader-open');
    titleElement.textContent = book.title || 'Untitled';
    authorElement.textContent = (book.author || '') + (previewOnly ? ' · Free preview' : '');
    const contents = document.createDocumentFragment(), lock = previewOnly ? root.ownerDocument.createRange().createContextualFragment(icon('lock')) : null;
    normalized.chapters.forEach((chapter, index) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.frAction = previewOnly && index > 0 ? 'locked-chapter' : 'chapter';
      button.dataset.frChapter = String(index);
      const number = document.createElement('span');
      number.textContent = `Chapter ${['One','Two','Three'][index] || index + 1}${previewOnly && index > 0 ? ' · Folio Plus' : ''}`;
      const title = document.createElement('strong');
      title.textContent = chapter.title;
      button.append(number, title);
      if (previewOnly && index > 0) { button.classList.add('fr-locked-chapter'); button.append(lock.cloneNode(true)); }
      item.append(button);
      contents.append(item);
    });
    chapterList.replaceChildren(contents);
    currentChapterButton = null;
    closePanels();
    setChrome(true);
    searchHighlight = ''; bookSearch.value = ''; searchResults.replaceChildren();
    applySettings();
    lastMeasureKey = '';
    reflow(true);
    bookElement.focus({ preventScroll: true });
    const openedBook=book;
    if(document.fonts?.check(`${settings.fontSize}px Newsreader`)) revealBook();
    else if(document.fonts){
      // Pages measured with the fallback face are discarded once the book face arrives.
      fontPending = true;
      document.fonts.load(`${settings.fontSize}px Newsreader`).then(()=>{if(isOpen&&book===openedBook){fontPending=false;layouts.clear();reflow(true);revealBook();}}).catch(()=>{}).finally(()=>{if(book===openedBook){fontPending=false;scheduleBackground();}});
    }
    announcement.textContent = `${book.title || 'Book'} opened. ${normalized.chapters[currentPage?.chapterIndex || 0].title}.`;
  }

  function close(notify = true) {
    if (!isOpen) return;
    clearTimeout(progressTimer);
    cancelOpening();
    // Flush the last settled location; never save an unfinished drag.
    if (book && normalized?.totalWords) {
      try { onProgress(book.id, { wordOffset: anchorOffset, fraction: readingFraction() }); }
      catch (error) { console.error('Folio progress callback failed.', error); }
    }
    isOpen = false;
    clearTimeout(warmTimer);
    abortTurn();
    curlRenderer?.dispose(); curlRenderer = null; curlUnavailable = false;
    clearTimeout(resizeTimer); clearTimeout(fontTimer); clearTimeout(searchTimer); resizeTimer = fontTimer = 0;
    cancelBackground();
    layouts.clear(); layout = null; currentPage = null; shownPages = []; searchIndex = []; wordCache.clear();
    closePanels();
    root.hidden = true;
    controls.unmount();
    if (openedBodyLock) { document.body.classList.remove('reader-open'); document.documentElement.classList.remove('fr-reader-open'); }
    announcement.textContent = '';
    if (notify) {
      try { onClose(); } finally {
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected && (root.contains(document.activeElement) || document.activeElement === document.body)) previousFocus.focus({ preventScroll: true });
      }
    }
  }

  function destroy() {
    if (isDestroyed) return;
    close();
    isDestroyed = true;
    clearTimeout(resizeTimer);
    clearTimeout(progressTimer);
    resizeObserver?.disconnect();
    root.removeEventListener('click', onClick);
    reader.removeEventListener('pointerdown', onReaderPointerDown, true);
    bookElement.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    bookElement.removeEventListener('lostpointercapture', onLostPointerCapture);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    motionQuery.removeEventListener('change', onMotionChange);
    bookElement.removeEventListener('dragstart', onDragStart);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('focusin', onFocusIn);
    spreadInput.removeEventListener('change', onSpreadChange);
    tapInput.removeEventListener('change', onTapToTurnChange);
    bookSearch.removeEventListener('input', onSearchInput);
    range.removeEventListener('input', onRangeInput);
    range.removeEventListener('change', onRangeChange);
    window.removeEventListener('resize', onResize);
    root.replaceChildren();
  }

  return { open, close, destroy, get preview() { return previewOnly; } };
}
