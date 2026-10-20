import { icon } from './icons.js';
import { renderCover } from './books.js';
import { curlShape, dragProgress, completesTurn, settleProgress } from './page-curl.js';
import { createPageCurlRenderer } from './page-curl-renderer.js';
import { createReadingControls } from './reader-controls.js';

const STORAGE_KEY = 'folio.reader.settings.v1';
const DEFAULT_SETTINGS = { fontSize: 19, theme: 'sepia', spread: true, tapToTurn: false };
const THEMES = ['paper', 'sepia', 'night'];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wordsOf = value => String(value || '').trim().split(/\s+/u).filter(Boolean);

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
  let offset = 0;
  const normalized = chapters.map((chapter, chapterIndex) => {
    const paragraphs = (Array.isArray(chapter.paragraphs) ? chapter.paragraphs : [chapter.paragraphs || ''])
      .map(paragraph => {
        const words = wordsOf(paragraph);
        const start = offset;
        offset += words.length;
        return { words, start, end: offset };
      }).filter(paragraph => paragraph.words.length);
    return { title: String(chapter.title || `Chapter ${chapterIndex + 1}`), paragraphs, start: paragraphs[0]?.start ?? offset };
  }).filter(chapter => chapter.paragraphs.length);
  return { chapters: normalized, totalWords: offset };
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
  let pages = [];
  let pageIndex = 0;
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

  function makeBlock(block) {
    if (block.type === 'heading') {
      const heading = document.createElement('div');
      heading.className = 'fr-chapter-opening';
      const number = document.createElement('p');
      number.className = 'fr-chapter-number';
      number.textContent = `Chapter ${['One','Two','Three'][block.chapterIndex] || block.chapterIndex + 1}`;
      const title = document.createElement('h2');
      title.className = 'fr-chapter-heading';
      title.textContent = block.text;
      heading.append(number, title);
      return heading;
    }
    const paragraph = document.createElement('p');
    paragraph.className = `fr-text${block.continued ? ' fr-continued' : ''}`;
    if (!searchHighlight) paragraph.textContent = block.text;
    else {
      const text = block.text, lower = text.toLocaleLowerCase();
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

  function makePage(index, side = 'right') {
    const page = document.createElement('article');
    page.className = `fr-page fr-page-${side}`;
    const pageData = pages[index];
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
      folio.textContent = String(index + 1);
      page.setAttribute('aria-label', `Page ${index + 1}, ${normalized.chapters[pageData.chapterIndex].title}`);
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

  function lastStartIndex() { return spread ? Math.floor((pages.length - 1) / 2) * 2 : Math.max(0, pages.length - 1); }
  function accessibleWords() { return previewOnly ? normalized.chapters[1].start : normalized.totalWords; }
  function canTurn(direction) { return direction > 0 ? pageIndex < lastStartIndex() : pageIndex > 0; }
  function chapterForOffset(offset) {
    let index = 0;
    while (index + 1 < normalized.chapters.length && normalized.chapters[index + 1].start <= offset) index += 1;
    return index;
  }
  function readingFraction() {
    if (!normalized?.totalWords) return 0;
    return pageIndex === lastStartIndex() ? accessibleWords() / normalized.totalWords : clamp(anchorOffset / normalized.totalWords, 0, 1);
  }
  function pageForOffset(offset) {
    let low = 0;
    let high = pages.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (pages[middle].start <= offset) low = middle;
      else high = middle - 1;
    }
    return spread ? Math.floor(low / 2) * 2 : low;
  }

  function fitsMeasure() {
    const last = measureBody.lastElementChild;
    if (!last) return true;
    return last.getBoundingClientRect().bottom <= measureBody.getBoundingClientRect().bottom - 1
      && measureBody.scrollHeight <= measureBody.clientHeight + 1;
  }

  function paginate() {
    const result = [];
    let current = null;
    function startPage(chapterIndex, offset, opening = false) {
      measureBody.replaceChildren();
      current = { start: offset, end: offset, chapterIndex, blocks: [] };
      if (opening) {
        const block = { type: 'heading', chapterIndex, text: normalized.chapters[chapterIndex].title };
        const element = makeBlock(block);
        measureBody.append(element);
        if (fitsMeasure()) current.blocks.push(block);
        else element.remove(); // The running title and contents remain available in very short viewports.
      }
    }
    function finishPage() {
      if (current && current.end > current.start) result.push(current);
      current = null;
    }

    normalized.chapters.forEach((chapter, chapterIndex) => {
      if (previewOnly && chapterIndex > 0) return;
      finishPage();
      startPage(chapterIndex, chapter.start, true);
      chapter.paragraphs.forEach(paragraph => {
        let consumed = 0;
        while (consumed < paragraph.words.length) {
          if (!current) startPage(chapterIndex, paragraph.start + consumed);
          const remaining = paragraph.words.slice(consumed);
          const block = { type: 'paragraph', text: remaining.join(' '), continued: consumed > 0 };
          const candidate = makeBlock(block);
          measureBody.append(candidate);
          if (fitsMeasure()) {
            current.blocks.push(block);
            current.end = paragraph.end;
            consumed = paragraph.words.length;
            continue;
          }
          let low = 0;
          let high = remaining.length;
          while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            candidate.textContent = remaining.slice(0, middle).join(' ');
            if (fitsMeasure()) low = middle;
            else high = middle - 1;
          }
          if (low === 0 && current.end > current.start) {
            candidate.remove();
            finishPage();
            continue;
          }
          if (low === 0 && current.blocks.some(item => item.type === 'heading')) {
            measureBody.querySelector('.fr-chapter-opening')?.remove();
            current.blocks = current.blocks.filter(item => item.type !== 'heading');
            candidate.textContent = remaining[0];
            low = fitsMeasure() ? 1 : 0;
            if (low) {
              let max = remaining.length;
              while (low < max) {
                const middle = Math.ceil((low + max) / 2);
                candidate.textContent = remaining.slice(0, middle).join(' ');
                if (fitsMeasure()) low = middle;
                else max = middle - 1;
              }
            }
          }
          // A single extraordinarily long token can be broken by overflow-wrap.
          // Ordinary prose always fits at least one line after the opening is removed.
          low = Math.max(1, low);
          block.text = remaining.slice(0, low).join(' ');
          candidate.textContent = block.text;
          // Move a new paragraph to the next page rather than strand one line.
          const lineHeight=parseFloat(getComputedStyle(candidate).lineHeight);
          if (current.end > current.start && candidate.getBoundingClientRect().height < lineHeight * 1.9) {
            candidate.remove(); finishPage(); continue;
          }
          current.blocks.push(block);
          consumed += low;
          current.end = paragraph.start + consumed;
          finishPage();
        }
      });
    });
    finishPage();
    return result;
  }

  function buildBase(leftIndex = pageIndex, rightIndex = pageIndex + 1) {
    const base = document.createElement('div');
    base.className = 'fr-base';
    if (spread) {
      const left = document.createElement('div');
      left.className = 'fr-slot fr-slot-left';
      left.append(makePage(leftIndex, 'left'));
      const right = document.createElement('div');
      right.className = 'fr-slot fr-slot-right';
      right.append(makePage(rightIndex, 'right'));
      base.append(left, right);
      const gutter = document.createElement('div');
      gutter.className = 'fr-gutter';
      gutter.setAttribute('aria-hidden', 'true');
      base.append(gutter);
    } else base.append(makePage(leftIndex));
    return base;
  }

  function renderBase() {
    bookElement.replaceChildren(buildBase());
    bookElement.classList.remove('fr-turning');
    bookElement.setAttribute('aria-busy', 'false');
    curlRenderer?.hide();
    warmPages();
  }

  function updateChrome(announce = false) {
    if (!pages.length) return;
    const chapterIndex = chapterForOffset(anchorOffset);
    const chapter = normalized.chapters[chapterIndex];
    const endPage = Math.min(pages.length, pageIndex + (spread ? 2 : 1));
    chapterElement.textContent = chapter.title;
    chapterElement.setAttribute('aria-label', `Contents, current chapter ${chapter.title}`);
    pageCountElement.textContent = !chromeVisible ? String(pageIndex + 1) : spread && endPage > pageIndex + 1
      ? `Pages ${pageIndex + 1}–${endPage} of ${pages.length}` : `Page ${pageIndex + 1} of ${pages.length}`;
    if (previewOnly && chromeVisible) pageCountElement.textContent += ' · Preview';
    previewButton.hidden = !previewOnly || canTurn(1);
    previewButton.inert = controls.expanded;
    reader.dataset.frPreviewEnd = String(!previewButton.hidden);
    const left = pages.length - endPage;
    root.querySelector('.fr-pages-left').textContent = left ? `${left} ${left === 1 ? 'page' : 'pages'} left` : 'End of story';
    controls.update({percentage:Math.round(readingFraction()*100),previousDisabled:!canTurn(-1),nextDisabled:!canTurn(1)&&!previewOnly});
    range.max = String(Math.max(1, accessibleWords() - 1));
    range.value = String(pageIndex === lastStartIndex() ? range.max : clamp(anchorOffset, 0, accessibleWords() - 1));
    range.setAttribute('aria-valuetext', `${chapter.title}, page ${pageIndex + 1} of ${pages.length}`);
    range.style.setProperty('--fr-progress', `${Number(range.value) / Number(range.max) * 100}%`);
    chapterList.querySelectorAll('button').forEach(button => {
      if (Number(button.dataset.frChapter) === chapterIndex) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
    if (announce) announcement.textContent = `${chapter.title}. Page ${pageIndex + 1}${endPage > pageIndex + 1 ? ` to ${endPage}` : ''} of ${pages.length}.`;
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

  function reflow(force = false) {
    if (!isOpen || !book) return;
    const stageStyle = getComputedStyle(stage);
    const width = stage.clientWidth - parseFloat(stageStyle.paddingLeft) - parseFloat(stageStyle.paddingRight);
    const height = stage.clientHeight - parseFloat(stageStyle.paddingTop) - parseFloat(stageStyle.paddingBottom);
    if (!width || !height) return;
    const readerStyle = getComputedStyle(reader);
    const fullBleed = readerStyle.getPropertyValue('--fr-full-bleed').trim() === '1';
    const spreadAvailable = !fullBleed && reader.clientWidth >= 900;
    spreadInput.disabled = !spreadAvailable;
    root.querySelector('.fr-spread-note').textContent = spreadAvailable ? 'For a little more room.' : 'Available in a wider window.';
    spread = settings.spread && spreadAvailable;
    spreadInput.checked = spread;
    const safe = side => parseFloat(readerStyle.getPropertyValue(`--fr-safe-${side}`)) || 0;
    const safeTop = safe('top'), safeBottom = safe('bottom');
    const availableHeight = Math.max(120, Math.min(height, spread ? 780 : 860));
    pageWidth = Math.floor(fullBleed ? width : Math.min(width / (spread ? 2 : 1), spread ? 580 : 640, availableHeight * (spread ? .7 : .74)));
    pageHeight = Math.floor(fullBleed ? height : Math.min(availableHeight, pageWidth * (spread ? 1.6 : 1.8)));
    const key = `${pageWidth}:${pageHeight}:${spread}:${fullBleed}:${settings.fontSize}:${safeTop}:${safeBottom}:${safe('left')}:${safe('right')}`;
    if (!force && key === lastMeasureKey) return;
    lastMeasureKey = key;
    abortTurn();
    reader.classList.toggle('fr-compact', (fullBleed ? pageHeight - 160 - safeTop - safeBottom : pageHeight) < 380);
    bookElement.classList.toggle('fr-is-spread', spread);
    bookElement.style.width = `${pageWidth * (spread ? 2 : 1)}px`;
    bookElement.style.height = `${pageHeight}px`;
    reader.style.setProperty('--fr-page-inset-x', `${reader.clientWidth < 520 ? 22 : pageWidth < 440 ? 32 : 44}px`);
    reader.style.setProperty('--fr-page-inset-y', `${reader.clientWidth < 520 || pageHeight < 520 ? 24 : 36}px`);
    reader.style.setProperty('--fr-page-inset-bottom', `${reader.clientWidth < 520 ? 16 : 22}px`);
    reader.style.setProperty('--fr-bar-width', `${Math.max(pageWidth * (spread ? 2 : 1), 560)}px`);
    measurePage.style.width = `${pageWidth}px`;
    measurePage.style.height = `${pageHeight}px`;
    pages = paginate();
    if (!pages.length) pages = [{ start: 0, end: 0, chapterIndex: 0, blocks: [] }];
    pageIndex = pageForOffset(anchorOffset);
    renderBase();
    updateChrome();
    emitProgress();
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
      Promise.all(state.animations.map(animation => animation.finished)).then(() => {
        if (appearanceMotion === state) finishAppearanceMotion();
      }).catch(() => { /* A newer action continues from the current surface. */ });
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
    const query = bookSearch.value.trim().toLocaleLowerCase();
    searchResults.replaceChildren();
    if (!query) { root.querySelector('.fr-search-status').textContent = 'Search the text of this book.'; return; }
    let count = 0;
    for (const chapter of (previewOnly ? normalized.chapters.slice(0,1) : normalized.chapters)) for (const paragraph of chapter.paragraphs) {
      const text = paragraph.words.join(' '), index = text.toLocaleLowerCase().indexOf(query);
      if (index < 0) continue;
      count++;
      if (count > 40) continue;
      const offset = paragraph.start + wordsOf(text.slice(0, index)).length;
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
    root.querySelector('.fr-search-status').textContent = `${count} ${count === 1 ? 'passage' : 'passages'} found${count > 40 ? ' · showing the first 40' : ''}`;
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

  function pageTexture(index, side = '') {
    const gpu = renderer();
    if (!gpu) return null;
    const page = index === null ? document.createElement('div') : makePage(index, side);
    if (index === null) page.className = 'fr-page';
    return gpu.prepare(page, `${book.id}:${lastMeasureKey}:${settings.theme}:${searchHighlight}:${index}:${side}`, pageWidth, pageHeight);
  }

  function turnTextures(direction, targetIndex) {
    return {
      front: pageTexture(spread ? (direction > 0 ? pageIndex + 1 : targetIndex + 1) : (direction > 0 ? pageIndex : targetIndex), spread ? 'right' : ''),
      back: pageTexture(spread ? (direction > 0 ? targetIndex : pageIndex) : null, spread ? 'left' : '')
    };
  }

  function warmPages() {
    clearTimeout(warmTimer);
    if (!isOpen || motionQuery.matches || !pages.length || document.hidden) return;
    warmTimer = setTimeout(() => {
      if (!isOpen || turn || pointer) return;
      let first;
      for (const direction of [1, -1]) if (canTurn(direction)) { const textures = turnTextures(direction, pageIndex + direction * (spread ? 2 : 1)); first ||= textures; }
      // Compile the GPU draw path before the first touch, then keep it hidden.
      if (first && curlRenderer) {
        const bounds = bookElement.getBoundingClientRect(), outer = stage.getBoundingClientRect();
        curlRenderer.paint({ progress: 0, grab: 0, width: pageWidth, height: pageHeight,
          originX: bounds.left - outer.left + (spread ? pageWidth : 0), originY: bounds.top - outer.top, ...first });
        curlRenderer.hide();
      }
    }, 80);
  }

  function beginTurn(direction, grab = 0) {
    if (turn || !canTurn(direction)) return false;
    clearTimeout(warmTimer);
    const step = spread ? 2 : 1;
    const targetIndex = clamp(pageIndex + direction * step, 0, lastStartIndex());
    const textures = turnTextures(direction, targetIndex);
    const base = spread
      ? (direction > 0 ? buildBase(pageIndex, targetIndex + 1) : buildBase(targetIndex, pageIndex + 1))
      : buildBase(direction > 0 ? targetIndex : pageIndex);
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
      leaf.append(makePage(spread ? (direction > 0 ? pageIndex + 1 : targetIndex + 1) : (direction > 0 ? pageIndex : targetIndex)));
      bookElement.append(leaf);
    }
    const bounds = bookElement.getBoundingClientRect(), stageBounds = stage.getBoundingClientRect();
    bookElement.classList.add('fr-turning');
    bookElement.setAttribute('aria-busy', 'true');
    turn = { direction, targetIndex, progress: 0, leaf, textures, shadow, grab,
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
      pageIndex = turn.targetIndex;
      anchorOffset = pages[pageIndex].start;
    }
    turn = null;
    frameId = 0;
    queuedDirection = 0;
    renderBase();
    updateChrome(complete);
    if (complete) emitProgress();
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
    if (!isOpen || !pages.length) return;
    closePanels();
    if (turn) { queuedDirection = direction; return; }
    if (!canTurn(direction)) { if (previewOnly && direction > 0) onPreviewEnd(book.id); return; }
    if (motionQuery.matches) {
      pageIndex = clamp(pageIndex + direction * (spread ? 2 : 1), 0, lastStartIndex());
      anchorOffset = pages[pageIndex].start;
      renderBase();
      bookElement.animate?.([{ opacity: .72 }, { opacity: 1 }], { duration: 110, easing: 'ease-out' });
      updateChrome(true);
      emitProgress();
      return;
    }
    if (beginTurn(direction)) releaseTurn(true, .4);
  }

  function jumpToOffset(offset, announce = true, {keepPanel=false} = {}) {
    cancelOpening();
    abortTurn();
    anchorOffset = clamp(Number(offset) || 0, 0, Math.max(0, accessibleWords() - 1));
    pageIndex = pageForOffset(anchorOffset);
    renderBase();
    if(!keepPanel)closePanels();
    updateChrome(announce);
    emitProgress();
  }

  function onClick(event) {
    const button = event.target.closest('[data-fr-action]');
    if (!button || !root.contains(button)) return;
    const action = button.dataset.frAction;
    if (action === 'close') close();
    else if(action==='menu'){
      const show=!controls.expanded;closePanels();setChrome(true);controls.setExpanded(show);
      previewButton.inert = show;
      if(show&&event.detail===0)root.querySelector('.fr-contents-toggle')?.focus({preventScroll:true});
    }
    else if (action === 'search') { searchBook(); togglePanel(action, button); }
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
      reflow(true);
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
    reflow(true);
  }

  function onTapToTurnChange() {
    settings.tapToTurn = tapInput.checked;
    saveSettings();
  }

  function onRangeInput() {
    if (!pages.length) return;
    const previewIndex = pageForOffset(Number(range.value));
    const chapter = normalized.chapters[chapterForOffset(Number(range.value))];
    range.setAttribute('aria-valuetext', `${chapter.title}, page ${previewIndex + 1} of ${pages.length}`);
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
    resizeTimer = setTimeout(() => reflow(), 100);
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
  bookSearch.addEventListener('input', searchBook);
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
    pageIndex = 0;
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
    chapterList.replaceChildren();
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
      if (previewOnly && index > 0) { button.classList.add('fr-locked-chapter'); button.append(root.ownerDocument.createRange().createContextualFragment(icon('lock'))); }
      item.append(button);
      chapterList.append(item);
    });
    closePanels();
    setChrome(true);
    searchHighlight = ''; bookSearch.value = ''; searchResults.replaceChildren();
    applySettings();
    lastMeasureKey = '';
    reflow(true);
    bookElement.focus({ preventScroll: true });
    const openedBook=book;
    if(document.fonts?.check(`${settings.fontSize}px Newsreader`)) revealBook();
    else document.fonts?.load(`${settings.fontSize}px Newsreader`).then(()=>{if(isOpen&&book===openedBook){reflow(true);revealBook();}}).catch(()=>{});
    announcement.textContent = `${book.title || 'Book'} opened. ${normalized.chapters[pages[pageIndex]?.chapterIndex || 0].title}.`;
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
    clearTimeout(resizeTimer);
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
    bookSearch.removeEventListener('input', searchBook);
    range.removeEventListener('input', onRangeInput);
    range.removeEventListener('change', onRangeChange);
    window.removeEventListener('resize', onResize);
    root.replaceChildren();
  }

  return { open, close, destroy, get preview() { return previewOnly; } };
}
