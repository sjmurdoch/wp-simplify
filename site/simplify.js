/**
 * WP Simplify — turns messy HTML (Word, Google Docs, web pages, old posts)
 * into minimal, semantic, accessible markup for a WordPress post.
 *
 * Works in the browser (uses the global DOMParser) and in Node when a
 * DOMParser implementation is passed in `env` (e.g. from jsdom).
 */

export const DEFAULTS = Object.freeze({
  /** 'blocks' (block editor / Gutenberg) or 'classic' (classic editor). */
  format: 'blocks',
  /** Classic only: omit <p> and <br> and let wpautop add them. */
  autop: true,
  /** Classic only: 'shortcode' ([caption]) or 'figure' (<figure>/<figcaption>). */
  captions: 'shortcode',
  /** Shift headings so the highest is this level (0 = leave levels alone). */
  topHeading: 2,
  /** Stop headings skipping levels (e.g. h2 followed by h4). */
  fixHeadingSkips: true,
  /** Convert <b> to <strong> and <i> to <em>. */
  semanticEmphasis: true,
  /** Classic only: keep width/height on images. */
  keepImageSize: true,
  /** Insert <!--more--> after this many paragraphs if there isn't one (0 = off). */
  moreAfter: 0,
  /**
   * Line breaks inside paragraphs: 'auto' removes those that look like
   * hard-wrapped text, 'remove' removes all, 'keep' leaves them.
   */
  lineBreaks: 'auto',
  /** Keep id attributes that in-page links point at. */
  keepIds: true,
});

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const BLOCK_TAGS = new Set([
  'p', ...HEADINGS, 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'pre',
  'figure', 'figcaption', 'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr',
  'th', 'td', 'hr', 'details', 'summary', 'address', 'x-embed', 'video', 'audio',
]);
const CONTAINER_TAGS = new Set([
  'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav',
  'center', 'form', 'fieldset', 'hgroup', 'search', 'body', 'legend',
]);
// x-para marks a blank line in loose text (a paragraph break, as in wpautop).
const BLOCKISH = new Set([...BLOCK_TAGS, ...CONTAINER_TAGS, 'colgroup', 'col', 'x-para']);
const PHRASING_BLOCKS = new Set(['p', ...HEADINGS, 'dt', 'caption', 'summary']);
const INLINE_TAGS = new Set([
  'a', 'strong', 'em', 'cite', 'q', 'abbr', 'dfn', 'kbd', 'samp', 'var', 'sub',
  'sup', 'mark', 's', 'del', 'ins', 'small', 'time', 'code', 'br', 'img', 'bdi',
  'bdo', 'wbr',
]);
const DROP_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'head', 'meta', 'link', 'title',
  'base', 'object', 'embed', 'applet', 'param', 'canvas', 'svg', 'math',
  'input', 'button', 'select', 'textarea', 'option', 'optgroup', 'datalist',
  'map', 'area', 'colgroup', 'col', 'source', 'track', 'frame', 'frameset',
  'dialog', 'progress', 'meter', 'output', 'picture-source',
]);
const VOID_TAGS = new Set(['br', 'img', 'hr', 'wbr']);
const KEEP_EMPTY = new Set(['br', 'img', 'hr', 'wbr', 'td', 'th', 'tr', 'thead', 'tbody', 'tfoot', 'x-embed', 'video', 'audio']);
const BOOLEAN_ATTRS = new Set(['reversed', 'controls', 'open']);
const ATTRS = {
  a: ['href', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'class'],
  ol: ['start', 'reversed'],
  li: ['value'],
  th: ['colspan', 'rowspan', 'scope', 'abbr'],
  td: ['colspan', 'rowspan'],
  abbr: ['title'],
  dfn: ['title'],
  time: ['datetime'],
  blockquote: ['cite'],
  q: ['cite'],
  del: ['cite', 'datetime'],
  ins: ['cite', 'datetime'],
  'x-embed': ['url'],
  video: ['src', 'controls', 'poster'],
  audio: ['src', 'controls'],
  details: ['open'],
};
const NON_DESCRIPTIVE_LINKS = new Set([
  'click here', 'here', 'click', 'read more', 'more', 'link', 'this', 'this link',
  'learn more', 'go', 'details', 'more info', 'info', 'continue', 'see more',
]);
const EMBED_HOSTS = [
  /^(www\.|m\.)?youtube\.com$/, /^youtu\.be$/, /^(www\.)?vimeo\.com$/,
  /^open\.spotify\.com$/, /^(www\.)?soundcloud\.com$/, /^(www\.)?(twitter|x)\.com$/,
  /^(www\.)?tiktok\.com$/, /^(www\.)?flickr\.com$/, /^(www\.)?ted\.com$/,
  /^(www\.)?dailymotion\.com$/, /^(www\.)?reddit\.com$/, /^wordpress\.tv$/,
  /^(www\.)?instagram\.com$/, /^(www\.)?mixcloud\.com$/, /^(www\.)?bsky\.app$/,
];

/**
 * Simplify `input` HTML.
 * @param {string} input
 * @param {Partial<typeof DEFAULTS>} [options]
 * @param {{DOMParser?: any, imageSizes?: Map<string,{width:number,height:number}>}} [env]
 */
export function simplify(input, options = {}, env = {}) {
  const opts = { ...DEFAULTS, ...options };
  const Parser = env.DOMParser || globalThis.DOMParser;
  if (!Parser) throw new Error('No DOMParser available');
  const doc = new Parser().parseFromString(expandShortcodes(String(input ?? '')), 'text/html');
  const ctx = {
    doc, root: doc.body, opts, env,
    warnings: new Set(), counts: new Map(),
    missingSizes: new Set(), referencedIds: new Set(), captionParas: new WeakSet(),
    count(key, n = 1) { this.counts.set(key, (this.counts.get(key) || 0) + n); },
    warn(msg) { this.warnings.add(msg); },
  };

  // 1. Strip what is never wanted and capture structure that relies on styles/classes.
  cleanComments(ctx);
  markBlankLines(ctx);
  convertMedia(ctx);
  dropElements(ctx);
  convertWpCaptions(ctx);
  convertWordLists(ctx);
  markWordCaptions(ctx);
  applyInlineStyles(ctx);
  prepareImages(ctx);
  collectReferencedIds(ctx);
  cleanLangDir(ctx);
  renameTags(ctx);
  unwrapUnknown(ctx);
  cleanAttributes(ctx);

  // 2. Restructure.
  flattenCode(ctx);
  normaliseTables(ctx);
  normaliseFigures(ctx);
  removeRedundantNesting(ctx);
  splitParagraphsOnDoubleBr(ctx);
  removeWrapBreaks(ctx);
  hoistToTop(ctx);
  wrapInlineRuns(ctx.root, ctx);
  ctx.root.querySelectorAll('blockquote').forEach((bq) => wrapInlineRuns(bq, ctx));
  ctx.root.querySelectorAll('x-para').forEach((x) => x.replaceWith(' '));
  imageParagraphsToFigures(ctx);
  bareUrlsToEmbeds(ctx);

  // 3. Tidy.
  for (let pass = 0; pass < 2; pass++) {
    moveWhitespaceOut(ctx);
    removeEmpty(ctx);
    mergeAdjacent(ctx);
    collapseWhitespace(ctx);
    trimEdgeBreaks(ctx);
    removeEmpty(ctx);
  }
  unwrapSingleParagraphs(ctx);
  collapseNestedLists(ctx);
  fixHeadings(ctx);
  insertMore(ctx);
  checkAccessibility(ctx);

  // 4. Serialise.
  const f = {
    ctx,
    mode: opts.format === 'classic' ? 'classic' : 'blocks',
    autop: opts.format === 'classic' && opts.autop,
    captions: opts.captions,
    keepSize: opts.format === 'classic' && opts.keepImageSize,
  };
  const html = serialiseTop(ctx.root, f);
  const preview = serialiseTop(ctx.root, { ...f, mode: 'preview', autop: false, captions: 'figure', keepSize: true });

  return {
    html,
    preview,
    warnings: [...ctx.warnings],
    notes: describeCounts(ctx.counts),
    missingSizes: [...ctx.missingSizes],
    stats: { inputLength: String(input ?? '').length, outputLength: html.length },
  };
}

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

const isEl = (n, tag) => n && n.nodeType === 1 && (!tag || n.localName === tag);
const isBlankText = (n) => n.nodeType === 3 && !/[^\s\u00a0]/.test(n.data);
const all = (root, sel = '*') => Array.from(root.querySelectorAll(sel));

function unwrap(el) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  el.remove();
}

function rename(el, tag, keepAttrs = true) {
  const n = el.ownerDocument.createElement(tag);
  if (keepAttrs) {
    for (const a of Array.from(el.attributes)) {
      try { n.setAttribute(a.name, a.value); } catch { /* invalid attribute name */ }
    }
  }
  while (el.firstChild) n.append(el.firstChild);
  el.replaceWith(n);
  return n;
}

function hasContent(el) {
  return /[^\s\u00a0]/.test(el.textContent) || !!el.querySelector('img, hr, x-embed, video, audio');
}

/** Child nodes ignoring blank text and comments. */
function meaningfulChildren(el) {
  return Array.from(el.childNodes).filter((n) => !(n.nodeType === 3 && isBlankText(n)) && n.nodeType !== 8 && !isEl(n, 'br'));
}

function parseStyle(style) {
  const out = {};
  for (const part of String(style || '').split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).replace(/!important/i, '').trim().toLowerCase();
  }
  return out;
}

function toInt(v) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(String(v ?? ''));
  return m ? Math.round(parseFloat(m[1])) : 0;
}

function primaryLang(l) { return String(l || '').toLowerCase().split(/[-_]/)[0]; }

/** Split ancestors so `node` becomes a child of `top`. */
function hoist(node, top) {
  while (node.parentNode && node.parentNode !== top) {
    const parent = node.parentNode;
    const after = parent.cloneNode(false);
    after.removeAttribute?.('id');
    while (node.nextSibling) after.append(node.nextSibling);
    parent.after(node);
    node.after(after);
  }
}

/* ------------------------------------------------------------------ */
/* Passes                                                              */
/* ------------------------------------------------------------------ */

function cleanComments(ctx) {
  const walker = ctx.doc.createTreeWalker(ctx.root, 128 /* SHOW_COMMENT */);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const c of comments) {
    const d = c.data.trim();
    const more = /^more\b\s*([\s\S]*)$/i.exec(d);
    if (more) {
      const text = more[1].trim();
      c.data = text ? `more ${text}` : 'more';
    } else if (/^nextpage$/i.test(d)) c.data = 'nextpage';
    else if (/^noteaser$/i.test(d)) c.data = 'noteaser';
    else c.remove();
  }
}

/**
 * A blank line in loose text is a paragraph break (as wpautop treats it);
 * a single newline is just wrapping and becomes a space later.
 */
function markBlankLines(ctx) {
  const { root, doc } = ctx;
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const nodes = [];
  while (walker.nextNode()) {
    const t = walker.currentNode;
    const p = t.parentElement;
    if (!/\n[ \t\r ]*\n/.test(t.data)) continue;
    if (p === root || CONTAINER_TAGS.has(p.localName) || p.localName === 'blockquote' || p.localName === 'p') nodes.push(t);
  }
  for (const t of nodes) {
    const parts = t.data.split(/\n[ \t\r ]*\n\s*/);
    const frag = doc.createDocumentFragment();
    parts.forEach((part, i) => {
      if (i) frag.append(doc.createElement('x-para'));
      if (part) frag.append(part);
    });
    t.replaceWith(frag);
  }
}

/** Turn [caption], [video] and [audio] shortcodes back into HTML so output can be re-read. */
function expandShortcodes(html) {
  const attrsOf = (s) => {
    const a = {};
    s.replace(/(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g, (_, k, v1, v2, v3) => { a[k.toLowerCase()] = v1 ?? v2 ?? v3; });
    return a;
  };
  return html
    .replace(/\[caption\b([^\]]*)\]([\s\S]*?)\[\/caption\]/gi, (m, attrs, body) => {
      const a = attrsOf(attrs);
      const mm = /^\s*((?:<a\b[^>]*>\s*)?<img\b[^>]*>(?:\s*<\/a>)?)([\s\S]*)$/i.exec(body);
      if (!mm) return m;
      let media = mm[1];
      const width = parseInt(a.width, 10);
      if (width > 0 && !/<img\b[^>]*\swidth\s*=/i.test(media)) media = media.replace(/<img\b/i, `<img width="${width}"`);
      const cap = (a.caption ?? mm[2]).trim();
      const align = /^align(left|right|center|none)$/.test(a.align || '') ? ` class="${a.align}"` : '';
      return `<figure${align}>${media}${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`;
    })
    .replace(/\[(video|audio)\b([^\]]*)\](?:\s*\[\/\1\])?/gi, (m, tag, attrs) => {
      const a = attrsOf(attrs);
      const src = a.src || a.mp4 || a.webm || a.mp3 || a.m4a || a.ogg || a.wav;
      return src ? `<${tag} controls src="${src.replace(/"/g, '&quot;')}"></${tag}>` : m;
    });
}

function embedUrlFromIframe(src) {
  let u;
  try { u = new URL(src, 'https://example.invalid/'); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  let m;
  if (/^(youtube\.com|youtube-nocookie\.com)$/.test(host) && (m = /^\/embed\/([\w-]+)/.exec(u.pathname))) {
    return `https://www.youtube.com/watch?v=${m[1]}`;
  }
  if (host === 'player.vimeo.com' && (m = /^\/video\/(\d+)/.exec(u.pathname))) return `https://vimeo.com/${m[1]}`;
  if (host === 'open.spotify.com' && (m = /^\/embed\/(\w+\/\w+)/.exec(u.pathname))) return `https://open.spotify.com/${m[1]}`;
  if (host === 'w.soundcloud.com' && u.searchParams.get('url')) {
    const inner = u.searchParams.get('url');
    return /^https?:\/\/(www\.)?soundcloud\.com\//.test(inner) ? inner : null;
  }
  if (host === 'dailymotion.com' && (m = /^\/embed\/video\/(\w+)/.exec(u.pathname))) return `https://www.dailymotion.com/video/${m[1]}`;
  return null;
}

function isEmbeddableUrl(text) {
  if (!/^https?:\/\/\S+$/.test(text)) return false;
  try {
    const host = new URL(text).hostname;
    return EMBED_HOSTS.some((re) => re.test(host));
  } catch { return false; }
}

function convertMedia(ctx) {
  const { root, doc } = ctx;
  for (const f of all(root, 'iframe')) {
    const src = f.getAttribute('src') || '';
    const url = embedUrlFromIframe(src);
    if (url) {
      const x = doc.createElement('x-embed');
      x.setAttribute('url', url);
      f.replaceWith(x);
      ctx.count('embeds');
    } else {
      f.remove();
      ctx.warn(`Removed an embedded frame${src ? ` (${shorten(src)})` : ''}. WordPress only embeds supported services; paste its page URL on its own line instead.`);
    }
  }
  for (const m of all(root, 'video, audio')) {
    const src = m.getAttribute('src') || m.querySelector('source[src]')?.getAttribute('src');
    if (!src) { m.remove(); ctx.count('dropped'); continue; }
    const n = doc.createElement(m.localName);
    n.setAttribute('controls', '');
    n.setAttribute('src', src);
    if (m.localName === 'video' && m.getAttribute('poster')) n.setAttribute('poster', m.getAttribute('poster'));
    m.replaceWith(n);
  }
}

function dropElements(ctx) {
  for (const el of all(ctx.root)) {
    if (DROP_TAGS.has(el.localName) && el.isConnected) { el.remove(); ctx.count('dropped'); }
  }
}

/** WordPress-rendered classic captions: div.wp-caption > img + p.wp-caption-text */
function convertWpCaptions(ctx) {
  for (const box of all(ctx.root, '.wp-caption')) {
    const img = box.querySelector('img');
    if (!img) continue;
    const fig = ctx.doc.createElement('figure');
    const align = /\balign(left|right|center|none)\b/.exec(box.className);
    if (align && !/\balign(left|right|center|none)\b/.test(img.className)) img.classList.add(align[0]);
    const link = isEl(img.parentElement, 'a') ? img.parentElement : null;
    fig.append(link || img);
    const text = box.querySelector('.wp-caption-text, figcaption');
    if (text) {
      const cap = ctx.doc.createElement('figcaption');
      while (text.firstChild) cap.append(text.firstChild);
      fig.append(cap);
    }
    box.replaceWith(fig);
  }
}

const WORD_BULLET = /^[·•▪◦§o\-–*\uf0b7\uf0a7\uf076\uf0d8]$/;

function convertWordLists(ctx) {
  const { root, doc } = ctx;
  const isItem = (el) => isEl(el) && /mso-list\s*:\s*l\d+/i.test(el.getAttribute('style') || '');
  const done = new Set();
  for (const first of all(root, 'p').filter(isItem)) {
    if (done.has(first)) continue;
    const group = [];
    for (let n = first; n;) {
      if (isItem(n)) { group.push(n); done.add(n); }
      else if (!((n.nodeType === 3 && isBlankText(n)) || n.nodeType === 8)) break;
      n = n.nextSibling;
    }
    const roots = [];
    const stack = [];
    for (const item of group) {
      const style = item.getAttribute('style') || '';
      const level = +(/level(\d+)/i.exec(style)?.[1] || 1);
      const marker = all(item, 'span').find((s) => /mso-list\s*:\s*ignore/i.test(s.getAttribute('style') || ''));
      const mark = (marker?.textContent || '').replace(/[\s\u00a0]+/g, '');
      marker?.remove();
      const ordered = !!mark && !WORD_BULLET.test(mark) && /^\(?([0-9]+|[a-z]{1,3})[.)]$/i.test(mark);
      while (stack.length && stack.at(-1).level > level) stack.pop();
      let top = stack.at(-1);
      if (!top || top.level < level) {
        const list = doc.createElement(ordered ? 'ol' : 'ul');
        const num = /^\(?(\d+)/.exec(mark);
        if (ordered && num && +num[1] > 1) list.setAttribute('start', num[1]);
        if (!top) roots.push(list);
        else (top.lastLi || top.list).append(list);
        top = { level, list, lastLi: null };
        stack.push(top);
      }
      const li = doc.createElement('li');
      while (item.firstChild) li.append(item.firstChild);
      top.list.append(li);
      top.lastLi = li;
    }
    for (const list of roots) group[0].before(list);
    group.forEach((p) => p.remove());
    ctx.count('wordLists');
  }
}

function markWordCaptions(ctx) {
  for (const p of all(ctx.root, 'p.MsoCaption, p[class*="caption" i]')) ctx.captionParas.add(p);
}

function applyInlineStyles(ctx) {
  const { root, doc } = ctx;
  // Elements that are bold/italic by tag but explicitly not by style (Google Docs wraps everything in <b style="font-weight:normal">).
  for (const el of all(root, 'b[style], strong[style], i[style], em[style]')) {
    const st = parseStyle(el.getAttribute('style'));
    const fw = st['font-weight'];
    const notBold = fw && (/^(normal|lighter)$/.test(fw) || (+fw > 0 && +fw < 600));
    const notItalic = st['font-style'] === 'normal';
    if ((el.localName === 'b' || el.localName === 'strong') && notBold) rename(el, 'span');
    else if ((el.localName === 'i' || el.localName === 'em') && notItalic) rename(el, 'span');
  }
  for (const el of all(root, '[style], [class*="FootnoteReference"], [class*="EndnoteReference"]')) {
    const tag = el.localName;
    if (['img', 'table', 'tr', 'tbody', 'thead', 'ul', 'ol', 'pre', 'code'].includes(tag)) continue;
    const st = parseStyle(el.getAttribute('style'));
    const wrappers = [];
    const fw = st['font-weight'];
    const bold = fw && (/^(bold|bolder)$/.test(fw) || +fw >= 600);
    if (bold && !el.closest('b, strong, th, h1, h2, h3, h4, h5, h6')) wrappers.push('strong');
    if (/italic|oblique/.test(st['font-style'] || '') && !el.closest('i, em')) wrappers.push('em');
    const va = st['vertical-align'] || '';
    if ((va === 'super' || /(Foot|End)noteReference/.test(el.className)) && !el.closest('sup')) wrappers.push('sup');
    else if (va === 'sub' && !el.closest('sub')) wrappers.push('sub');
    if (/line-through/.test(`${st['text-decoration'] || ''} ${st['text-decoration-line'] || ''}`) && !el.closest('s, del, strike')) wrappers.push('s');
    if (!wrappers.length || !hasContent(el)) continue;
    const outer = doc.createElement(wrappers[0]);
    let inner = outer;
    for (const w of wrappers.slice(1)) { const n = doc.createElement(w); inner.append(n); inner = n; }
    while (el.firstChild) inner.append(el.firstChild);
    el.append(outer);
    ctx.count('styles');
  }
}

function prepareImages(ctx) {
  const { root, env } = ctx;
  for (const img of all(root, 'img')) {
    const src = (img.getAttribute('src') || '').trim();
    if (!src) { img.remove(); continue; }
    const st = parseStyle(img.getAttribute('style'));
    let width = toInt(img.getAttribute('width')) || toInt(st.width);
    let height = toInt(img.getAttribute('height')) || toInt(st.height);
    const known = env.imageSizes?.get?.(src);
    if (!width && known?.width) { width = known.width; height = known.height || 0; }
    if (!width && /^(https?:|data:)/i.test(src)) ctx.missingSizes.add(src);

    // Alignment, from the image or its wrapper.
    let align = null;
    const alignRe = /\balign(left|right|center|none)\b/;
    const wrapper = img.closest('figure, div, p');
    const sources = [img.className, isEl(img.parentElement, 'a') ? img.parentElement.className : '', wrapper?.className || ''];
    for (const s of sources) { const m = alignRe.exec(String(s)); if (m) { align = m[1]; break; } }
    if (!align) {
      const a = (img.getAttribute('align') || '').toLowerCase();
      if (a === 'left' || a === 'right') align = a;
      else if (st.float === 'left' || st.float === 'right') align = st.float;
      else if (wrapper && isEl(wrapper, 'p') && !/[^\s\u00a0]/.test(wrapper.textContent)) {
        const ps = parseStyle(wrapper.getAttribute('style'));
        if (ps['text-align'] === 'center' || (wrapper.getAttribute('align') || '').toLowerCase() === 'center') align = 'center';
      }
    }
    const wpId = /\bwp-image-(\d+)\b/.exec(img.className)?.[0];
    const classes = [align ? `align${align}` : '', wpId || ''].filter(Boolean).join(' ');

    const alt = img.getAttribute('alt');
    for (const a of Array.from(img.attributes)) img.removeAttribute(a.name);
    img.setAttribute('src', src);
    if (alt !== null) img.setAttribute('alt', alt.replace(/\s+/g, ' ').trim());
    if (width) img.setAttribute('width', String(width));
    if (width && height) img.setAttribute('height', String(height));
    if (classes) img.setAttribute('class', classes);
  }
}

function collectReferencedIds(ctx) {
  if (!ctx.opts.keepIds) return;
  for (const a of all(ctx.root, 'a[href^="#"]')) {
    const id = a.getAttribute('href').slice(1);
    if (!id) continue;
    try { ctx.referencedIds.add(decodeURIComponent(id)); } catch { ctx.referencedIds.add(id); }
  }
  // Old-style <a name="x"> anchors become ids.
  for (const a of all(ctx.root, 'a[name]')) {
    const name = a.getAttribute('name');
    if (ctx.referencedIds.has(name) && !a.id) a.id = name;
  }
}

/** Drop lang/dir attributes that only restate what is inherited. */
function cleanLangDir(ctx) {
  const { root, doc } = ctx;
  let docLang = doc.documentElement.getAttribute('lang') || root.getAttribute('lang') || '';
  if (!docLang) {
    // Guess from the text, counting unlabelled text as its own bucket so that
    // output without the page language (already stripped) keeps its labels.
    const weight = new Map();
    const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
    while (walker.nextNode()) {
      const t = walker.currentNode;
      const l = primaryLang(t.parentElement?.closest('[lang]')?.getAttribute('lang'));
      weight.set(l, (weight.get(l) || 0) + t.data.trim().length);
    }
    docLang = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  }
  const docDir = (doc.documentElement.getAttribute('dir') || root.getAttribute('dir') || 'ltr').toLowerCase();
  root.removeAttribute('lang');
  root.removeAttribute('dir');
  const walk = (el, lang, dir) => {
    for (const child of Array.from(el.children)) {
      let l = lang;
      let d = dir;
      if (child.hasAttribute('lang')) {
        const own = child.getAttribute('lang').trim();
        if (!own || (lang && primaryLang(own) === primaryLang(lang))) child.removeAttribute('lang');
        else { l = own; child.setAttribute('lang', own); }
      }
      if (child.hasAttribute('xml:lang')) child.removeAttribute('xml:lang');
      if (child.hasAttribute('dir')) {
        const own = child.getAttribute('dir').trim().toLowerCase();
        if (!['ltr', 'rtl'].includes(own) || own === dir) child.removeAttribute('dir');
        else d = own;
      }
      walk(child, l, d);
    }
  };
  walk(root, docLang, docDir);
}

function renameTags(ctx) {
  const map = { strike: 's', tt: 'code', acronym: 'abbr', listing: 'pre', xmp: 'pre', plaintext: 'pre' };
  if (ctx.opts.semanticEmphasis) { map.b = 'strong'; map.i = 'em'; }
  for (const el of all(ctx.root, Object.keys(map).join(','))) {
    if (el.isConnected) rename(el, map[el.localName]);
  }
}

function wrapInlineRuns(container, ctx) {
  const doc = ctx.doc;
  let run = [];
  const flush = (before) => {
    const meaningful = run.some((n) => !(n.nodeType === 3 && isBlankText(n)) && !isEl(n, 'br'));
    if (meaningful) {
      const p = doc.createElement('p');
      container.insertBefore(p, before);
      run.forEach((n) => p.append(n));
    } else run.forEach((n) => { if (n.nodeType === 3 || isEl(n, 'br')) n.remove(); });
    run = [];
  };
  const kids = Array.from(container.childNodes);
  kids.forEach((n, i) => {
    const boundary = n.nodeType === 8 || (n.nodeType === 1 && BLOCKISH.has(n.localName));
    // A lone trailing <cite> in a blockquote is the quote's citation.
    const isCitation = isEl(container, 'blockquote') && isEl(n, 'cite') && kids.slice(i + 1).every((k) => k.nodeType === 3 && isBlankText(k));
    if (boundary || isCitation) flush(n);
    else run.push(n);
  });
  flush(null);
}

function unwrapUnknown(ctx) {
  const { root, opts } = ctx;
  const allowed = new Set([...BLOCK_TAGS, ...INLINE_TAGS, 'x-para']);
  if (!opts.semanticEmphasis) { allowed.add('b'); allowed.add('i'); }
  for (const el of all(root).reverse()) {
    if (!el.isConnected) continue;
    const tag = el.localName;
    if (allowed.has(tag)) continue;
    if (tag === 'span' && (el.hasAttribute('lang') || el.hasAttribute('dir'))) continue;
    if (tag === 'u') ctx.count('underline');
    // Keep a referenced id by moving it to the nearest block.
    if (el.id && ctx.referencedIds.has(el.id)) {
      const target = el.firstElementChild && !el.firstElementChild.id ? el.firstElementChild : null;
      if (target) target.id = el.id;
    }
    if (CONTAINER_TAGS.has(tag)) {
      const hasBlock = Array.from(el.children).some((c) => BLOCKISH.has(c.localName));
      let anc = el.parentElement;
      while (anc && anc !== root && !BLOCKISH.has(anc.localName)) anc = anc.parentElement;
      const inPhrasing = anc && PHRASING_BLOCKS.has(anc.localName);
      if (!hasBlock && !inPhrasing && hasContent(el)) {
        const p = rename(el, 'p');
        for (const a of Array.from(p.attributes)) if (!['lang', 'dir', 'id', 'style', 'align', 'class'].includes(a.name)) p.removeAttribute(a.name);
        continue;
      }
      if (hasBlock) wrapInlineRuns(el, ctx);
    }
    unwrap(el);
  }
}

function cleanHref(href, ctx) {
  let h = String(href || '').trim();
  if (!h) return null;
  if (/^\s*(javascript|vbscript|data):/i.test(h)) return null;
  try {
    const u = new URL(h);
    if (/^(www\.)?google\.[a-z.]+$/.test(u.hostname) && u.pathname === '/url') h = u.searchParams.get('q') || u.searchParams.get('url') || h;
    else if (/safelinks\.protection\.outlook\.com$/.test(u.hostname)) h = u.searchParams.get('url') || h;
  } catch { /* relative URL */ }
  if (/^file:/i.test(h)) ctx.warn(`A link points to a file on your computer (${shorten(h)}). Upload the file and link to it instead.`);
  return h;
}

function cleanAttributes(ctx) {
  const { root } = ctx;
  for (const el of all(root)) {
    const tag = el.localName;
    const allowed = ATTRS[tag] || [];
    for (const attr of Array.from(el.attributes)) {
      const n = attr.name.toLowerCase();
      if (n === 'id') { if (!ctx.referencedIds.has(attr.value)) el.removeAttribute(attr.name); continue; }
      if (n === 'lang' || n === 'dir') continue;
      if (!allowed.includes(n)) el.removeAttribute(attr.name);
    }
    if (tag === 'a') {
      if (el.hasAttribute('href')) {
        const h = cleanHref(el.getAttribute('href'), ctx);
        if (h) el.setAttribute('href', h); else el.removeAttribute('href');
      }
      if (el.hasAttribute('rel')) {
        const rel = el.getAttribute('rel').split(/\s+/).filter((r) => ['nofollow', 'sponsored', 'ugc'].includes(r.toLowerCase()));
        if (rel.length) el.setAttribute('rel', rel.join(' ')); else el.removeAttribute('rel');
      }
      if (!el.hasAttribute('href') && !el.id) unwrap(el);
    } else if (tag === 'ol') {
      if (el.getAttribute('start') === '1' || !/^-?\d+$/.test(el.getAttribute('start') || '1')) el.removeAttribute('start');
    } else if (tag === 'td' || tag === 'th') {
      for (const a of ['colspan', 'rowspan']) if (el.getAttribute(a) === '1') el.removeAttribute(a);
    } else if (tag === 'abbr' && !el.getAttribute('title')) el.removeAttribute('title');
  }
}

function flattenCode(ctx) {
  const { root, doc } = ctx;
  for (const pre of all(root, 'pre')) {
    pre.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    const isCode = !!pre.querySelector('code, kbd, samp');
    const text = pre.textContent.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\n+$/, '');
    for (const a of Array.from(pre.attributes)) if (a.name !== 'lang' && a.name !== 'dir') pre.removeAttribute(a.name);
    pre.textContent = '';
    if (isCode) {
      const code = doc.createElement('code');
      code.textContent = text;
      pre.append(code);
    } else pre.textContent = text;
  }
  for (const code of all(root, 'code')) {
    if (!code.closest('pre') && code.firstElementChild) code.textContent = code.textContent;
  }
}

function isWhollyStrong(cell) {
  let kids = meaningfulChildren(cell);
  if (kids.length === 1 && isEl(kids[0], 'p')) kids = meaningfulChildren(kids[0]);
  return kids.length === 1 && (isEl(kids[0], 'strong') || isEl(kids[0], 'b'));
}

function normaliseTables(ctx) {
  const { root, doc } = ctx;
  for (const table of all(root, 'table').reverse()) {
    const rows = Array.from(table.rows);
    if (rows.length <= 1 && (rows[0]?.cells.length || 0) <= 1) {
      // A single-cell table is just layout.
      const cell = rows[0]?.cells[0];
      if (cell) { while (cell.firstChild) table.before(cell.firstChild); }
      table.remove();
      ctx.count('layoutTables');
      continue;
    }
    if (!table.querySelector('th')) {
      const first = rows[0];
      const cells = Array.from(first.cells);
      if (rows.length > 1 && cells.some(isWhollyStrong) && cells.every((c) => isWhollyStrong(c) || !hasContent(c))) {
        for (const c of cells) {
          const th = doc.createElement('th');
          for (const a of ['colspan', 'rowspan']) if (c.hasAttribute(a)) th.setAttribute(a, c.getAttribute(a));
          while (c.firstChild) th.append(c.firstChild);
          th.querySelectorAll('strong, b').forEach(unwrap);
          c.replaceWith(th);
        }
        if (!isEl(first.parentElement, 'thead')) {
          const thead = doc.createElement('thead');
          table.insertBefore(thead, table.tBodies[0] || null);
          thead.append(first);
        }
        ctx.count('headerRows');
      } else {
        ctx.warn('A table has no header cells. Mark its first row (or column) as headers so screen readers can announce them.');
      }
    }
  }
}

function makeImageFigure(node, ctx) {
  const fig = ctx.doc.createElement('figure');
  fig.append(node);
  return fig;
}

function isImageNode(n) {
  if (isEl(n, 'img')) return true;
  if (isEl(n, 'a')) {
    const kids = meaningfulChildren(n);
    return kids.length === 1 && isEl(kids[0], 'img');
  }
  return false;
}

function normaliseFigures(ctx) {
  const { root, doc } = ctx;
  for (const fig of all(root, 'figure').reverse()) {
    if (!fig.isConnected) continue;
    const cap = fig.querySelector('figcaption');
    const imgs = all(fig, 'img');
    if (imgs.length) {
      const figs = imgs.map((img) => {
        const link = isEl(img.parentElement, 'a') && isImageNode(img.parentElement) ? img.parentElement : null;
        return makeImageFigure(link || img, ctx);
      });
      if (cap && hasContent(cap)) {
        if (figs.length === 1) figs[0].append(cap);
        else figs.push(rename(cap, 'p', false));
      }
      fig.replaceWith(...figs);
      continue;
    }
    const table = fig.querySelector('table');
    const quote = fig.querySelector(':scope > blockquote');
    if (table && cap) {
      if (!table.caption) {
        const c = table.createCaption();
        while (cap.firstChild) c.append(cap.firstChild);
      }
      cap.remove();
    } else if (quote && cap) {
      const cite = doc.createElement('cite');
      const kids = meaningfulChildren(cap);
      const source = kids.length === 1 && isEl(kids[0], 'cite') ? kids[0] : cap;
      while (source.firstChild) cite.append(source.firstChild);
      quote.append(cite);
      cap.remove();
    } else if (cap) rename(cap, 'p', false);
    unwrap(fig);
  }
}

function removeRedundantNesting(ctx) {
  const tags = ['strong', 'em', 'b', 'i', 'sup', 'sub', 's', 'code', 'mark', 'small', 'del', 'ins', 'kbd'];
  for (const el of all(ctx.root, tags.join(',')).reverse()) {
    if (!el.isConnected) continue;
    if (el.parentElement?.closest(el.localName)) unwrap(el);
    else if (/^(strong|b)$/.test(el.localName) && el.closest('h1, h2, h3, h4, h5, h6, th')) unwrap(el);
  }
}

function splitParagraphsOnDoubleBr(ctx) {
  // A blank line inside a paragraph is a paragraph break too.
  for (const x of all(ctx.root, 'p > x-para')) {
    x.replaceWith(ctx.doc.createElement('br'), ctx.doc.createElement('br'));
  }
  for (const p of all(ctx.root, 'p')) {
    let current = p;
    let node = current.firstChild;
    while (node) {
      const next = node.nextSibling;
      if (isEl(node, 'br')) {
        let n = next;
        while (n && n.nodeType === 3 && isBlankText(n)) n = n.nextSibling;
        if (isEl(n, 'br')) {
          while (isEl(n?.nextSibling, 'br') || (n?.nextSibling?.nodeType === 3 && isBlankText(n.nextSibling))) n = n.nextSibling;
          const fresh = ctx.doc.createElement('p');
          for (const a of Array.from(current.attributes)) if (a.name !== 'id') fresh.setAttribute(a.name, a.value);
          let move = n.nextSibling;
          while (move) { const m = move.nextSibling; fresh.append(move); move = m; }
          // Remove the run of breaks.
          let r = node;
          while (r) { const m = r.nextSibling; r.remove(); r = m; }
          current.after(fresh);
          current = fresh;
          node = fresh.firstChild;
          ctx.count('splitParagraphs');
          continue;
        }
      }
      node = next;
    }
  }
}

/**
 * Text copied from email, PDFs or plain-text sources often has a <br> at every
 * wrap point. In 'auto' mode a break is treated as a wrap artefact when the
 * block's lines are prose-length (an address or poem has short lines), or when
 * the next line carries on mid-sentence in lower case.
 */
const WRAP_LINE_LENGTH = 45;

function removeWrapBreaks(ctx) {
  const mode = ctx.opts.lineBreaks;
  if (mode === 'keep') return;
  for (const block of all(ctx.root, 'p, li, dd, dt, td, th, figcaption, caption')) {
    // Repeat until stable: joining lines changes their lengths, and the
    // result must not change if it is simplified again.
    while (removeWrapBreaksOnce(block, mode, ctx));
  }
}

function removeWrapBreaksOnce(block, mode, ctx) {
  const text = (nodes) => nodes.map((n) => n.textContent).join('').replace(/[\s ]+/g, ' ').trim();
  const sibling = (n, dir) => {
    let s = n[dir];
    while (s && s.nodeType === 3 && isBlankText(s)) s = s[dir];
    return s;
  };
  let changed = false;
  {
    const brs = Array.from(block.children).filter((c) => isEl(c, 'br'));
    if (!brs.length) return false;
    // Split the block's direct children into lines at each <br>.
    const lines = [[]];
    for (const n of Array.from(block.childNodes)) {
      if (isEl(n, 'br')) lines.push([]);
      else lines.at(-1).push(n);
    }
    const lineText = lines.map(text);
    const full = lineText.slice(0, -1).filter(Boolean);
    const lengths = full.map((t) => t.length).sort((a, b) => a - b);
    const median = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0;
    const wrapped = mode === 'remove' || median >= WRAP_LINE_LENGTH;
    brs.forEach((br, i) => {
      const before = lineText[i];
      const after = lineText[i + 1];
      // Two breaks in a row are a blank line: always deliberate.
      if (isEl(sibling(br, 'previousSibling'), 'br') || isEl(sibling(br, 'nextSibling'), 'br')) return;
      if (!before || !after) return;
      const continues = /^[a-z]/.test(after) && !/[.!?:;]$/.test(before);
      if (!wrapped && !continues) return;
      changed = true;
      // A hyphen at the break joins without a space ("well-<br>known").
      // The hyphen stays: it can't be told apart from a compound word.
      const prev = br.previousSibling;
      if (prev?.nodeType === 3 && /[a-z]-$/i.test(prev.data.trimEnd()) && /^[a-z]/i.test(after)) {
        prev.data = prev.data.trimEnd();
        const next = br.nextSibling;
        if (next?.nodeType === 3) next.data = next.data.replace(/^[\s ]+/, '');
        br.remove();
      } else br.replaceWith(ctx.doc.createTextNode(' '));
      ctx.count('wrapBreaks');
    });
  }
  return changed;
}

/** WordPress needs more/nextpage tags, embeds and media at the top level. */
function hoistToTop(ctx) {
  const { root, doc } = ctx;
  const walker = doc.createTreeWalker(root, 128);
  const nodes = [];
  while (walker.nextNode()) if (walker.currentNode.parentNode !== root) nodes.push(walker.currentNode);
  nodes.push(...all(root, 'x-embed, video, audio').filter((n) => n.parentNode !== root && !n.parentElement.closest('li, td, th, blockquote')));
  nodes.forEach((n) => hoist(n, root));
}

function imageParagraphsToFigures(ctx) {
  const { root } = ctx;
  const paras = [...Array.from(root.children), ...all(root, 'blockquote > p')].filter((p) => isEl(p, 'p'));
  for (const p of paras) {
    const kids = meaningfulChildren(p);
    if (!kids.length || !kids.every(isImageNode)) continue;
    const figs = kids.map((k) => makeImageFigure(k, ctx));
    p.replaceWith(...figs);
  }
  // Word captions: a caption paragraph right after (or before) a single image.
  for (const fig of all(root, 'figure')) {
    if (fig.querySelector('figcaption')) continue;
    const sib = [fig.nextElementSibling, fig.previousElementSibling].find((s) => s && ctx.captionParas.has(s));
    if (!sib) continue;
    const cap = rename(sib, 'figcaption', false);
    fig.append(cap);
    ctx.count('wordCaptions');
  }
}

function bareUrlsToEmbeds(ctx) {
  for (const p of Array.from(ctx.root.children)) {
    if (!isEl(p, 'p') || p.firstElementChild) continue;
    const text = p.textContent.trim();
    if (!isEmbeddableUrl(text)) continue;
    const x = ctx.doc.createElement('x-embed');
    x.setAttribute('url', text);
    p.replaceWith(x);
    ctx.count('embeds');
  }
}

function moveWhitespaceOut(ctx) {
  const doc = ctx.doc;
  const inline = [...INLINE_TAGS, 'b', 'i', 'span'].filter((t) => !VOID_TAGS.has(t));
  for (const el of all(ctx.root, inline.join(',')).reverse()) {
    const first = el.firstChild;
    if (first?.nodeType === 3) {
      const m = /^[\s\u00a0]+/.exec(first.data);
      if (m) { first.data = first.data.slice(m[0].length); el.before(doc.createTextNode(m[0])); }
    }
    const last = el.lastChild;
    if (last?.nodeType === 3) {
      const m = /[\s\u00a0]+$/.exec(last.data);
      if (m) { last.data = last.data.slice(0, -m[0].length); el.after(doc.createTextNode(m[0])); }
    }
  }
}

function removeEmpty(ctx) {
  const { root } = ctx;
  for (let guard = 0; guard < 5; guard++) {
    let changed = false;
    for (const el of all(root).reverse()) {
      if (!el.isConnected || KEEP_EMPTY.has(el.localName)) continue;
      if (hasContent(el)) continue;
      if (el.localName === 'a' && el.id) continue; // anchor target
      if (el.id) {
        const target = el.parentElement?.closest('p, h1, h2, h3, h4, h5, h6, li, td, th, dt, dd');
        if (target && !target.id) target.id = el.id;
      }
      const tag = el.localName;
      if (/^h[1-6]$/.test(tag)) ctx.count('emptyHeadings');
      el.remove();
      changed = true;
    }
    if (!changed) break;
  }
}

function attrKey(el) {
  return Array.from(el.attributes).map((a) => `${a.name}=${a.value}`).sort().join('&');
}

function mergeAdjacent(ctx) {
  const spaced = new Set(['strong', 'em', 'b', 'i', 's', 'mark', 'a', 'del', 'ins']);
  const direct = new Set(['code', 'sub', 'sup', 'small', 'kbd', 'cite']);
  for (const el of all(ctx.root, [...spaced, ...direct].join(','))) {
    if (!el.isConnected) continue;
    for (;;) {
      let next = el.nextSibling;
      let between = null;
      if (next?.nodeType === 3 && /^[ \t\r\n]+$/.test(next.data) && spaced.has(el.localName)) { between = next; next = next.nextSibling; }
      if (!isEl(next, el.localName) || attrKey(next) !== attrKey(el)) break;
      if (between) el.append(between);
      while (next.firstChild) el.append(next.firstChild);
      next.remove();
    }
  }
}

function collapseWhitespace(ctx) {
  const state = { prevSpace: true, atStart: true, last: null };
  const trimLast = () => {
    if (state.last) state.last.data = state.last.data.replace(/[ \u00a0]+$/, '');
  };
  const boundary = () => { trimLast(); state.prevSpace = true; state.atStart = true; state.last = null; };
  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        let t = child.data.replace(/[\t\n\r\f ]+/g, ' ').replace(/[ \u00a0]{2,}/g, ' ');
        if (state.atStart) t = t.replace(/^[ \u00a0]+/, '');
        else if (state.prevSpace) t = t.replace(/^ /, '');
        if (!t) { child.remove(); continue; }
        child.data = t;
        state.prevSpace = t.endsWith(' ');
        state.atStart = false;
        state.last = child;
      } else if (child.nodeType === 1) {
        const tag = child.localName;
        if (tag === 'pre') { boundary(); continue; }
        if (tag === 'br') { trimLast(); state.prevSpace = true; state.last = null; continue; }
        if (BLOCKISH.has(tag)) { boundary(); walk(child); boundary(); continue; }
        if (VOID_TAGS.has(tag)) { state.prevSpace = false; state.atStart = false; state.last = null; continue; }
        walk(child);
      }
    }
  };
  walk(ctx.root);
  boundary();
}

function trimEdgeBreaks(ctx) {
  for (const el of [ctx.root, ...all(ctx.root)]) {
    if (el !== ctx.root && !BLOCKISH.has(el.localName)) continue;
    for (const edge of ['firstChild', 'lastChild']) {
      let n = el[edge];
      while (n && ((n.nodeType === 3 && isBlankText(n)) || isEl(n, 'br'))) {
        const next = edge === 'firstChild' ? n.nextSibling : n.previousSibling;
        if (isEl(n, 'br')) n.remove();
        n = next;
      }
    }
  }
}

function unwrapSingleParagraphs(ctx) {
  for (const el of all(ctx.root, 'li, td, th, dd, dt, figcaption, caption, summary')) {
    const kids = meaningfulChildren(el);
    const ps = kids.filter((k) => isEl(k, 'p'));
    if (ps.length !== 1) continue;
    const others = kids.filter((k) => k !== ps[0]);
    if (!others.every((k) => isEl(k, 'ul') || isEl(k, 'ol'))) continue;
    if (others.length && kids[0] !== ps[0]) continue;
    const p = ps[0];
    for (const a of ['lang', 'dir']) if (p.hasAttribute(a) && !el.hasAttribute(a)) el.setAttribute(a, p.getAttribute(a));
    if (p.id && !el.id) el.id = p.id;
    unwrap(p);
  }
}

/**
 * A list item holding nothing but another list is spurious indentation
 * (common when pasting from editors): it renders as an empty bullet.
 */
function collapseNestedLists(ctx) {
  const isList = (n) => isEl(n, 'ul') || isEl(n, 'ol');
  for (const li of all(ctx.root, 'li').reverse()) {
    if (!li.isConnected) continue;
    const kids = meaningfulChildren(li);
    if (kids.length !== 1 || !isList(kids[0])) continue;
    const inner = kids[0];
    const outer = li.parentElement;
    if (!isList(outer)) continue;
    const siblings = Array.from(outer.children).filter((c) => isEl(c, 'li'));
    const prev = li.previousElementSibling;
    if (siblings.length === 1) {
      // The whole outer list is just a wrapper.
      for (const a of ['lang', 'dir']) if (outer.hasAttribute(a) && !inner.hasAttribute(a)) inner.setAttribute(a, outer.getAttribute(a));
      outer.replaceWith(inner);
    } else if (isEl(prev, 'li')) {
      // Indented items belong under the previous item.
      const last = prev.lastElementChild;
      if (isList(last) && last.localName === inner.localName) {
        while (inner.firstChild) last.append(inner.firstChild);
      } else prev.append(inner);
      li.remove();
    } else {
      // First item is only an indented list: lift its items up a level.
      while (inner.firstChild) li.before(inner.firstChild);
      li.remove();
    }
    ctx.count('nestedLists');
  }
}

function fixHeadings(ctx) {
  const { root, opts } = ctx;
  const hs = all(root, HEADINGS.join(','));
  if (!hs.length) return;
  const orig = hs.map((h) => +h.localName[1]);
  let levels = [...orig];
  if (opts.topHeading) {
    const delta = opts.topHeading - Math.min(...levels);
    if (delta) {
      levels = levels.map((l) => Math.min(6, Math.max(1, l + delta)));
      ctx.count(delta > 0 ? 'headingsDemoted' : 'headingsPromoted', Math.abs(delta));
    }
  }
  if (opts.fixHeadingSkips) {
    const base = opts.topHeading || Math.min(...levels);
    const stack = [];
    const before = [...levels];
    levels = levels.map((l) => {
      while (stack.length && stack.at(-1).orig >= l) stack.pop();
      const n = stack.length ? Math.min(l, stack.at(-1).now + 1) : Math.min(l, base) || base;
      stack.push({ orig: l, now: n });
      return n;
    });
    const fixed = levels.filter((l, i) => l !== before[i]).length;
    if (fixed) ctx.count('headingsFixed', fixed);
  }
  hs.forEach((h, i) => { if (levels[i] !== orig[i]) rename(h, `h${levels[i]}`); });
}

function insertMore(ctx) {
  const { root, opts, doc } = ctx;
  const hasMore = Array.from(root.childNodes).some((n) => n.nodeType === 8 && /^more\b/.test(n.data));
  if (hasMore || !(opts.moreAfter > 0)) return;
  let count = 0;
  for (const child of Array.from(root.children)) {
    if (isEl(child, 'p') && ++count === opts.moreAfter) {
      child.after(doc.createComment('more'));
      ctx.count('moreInserted');
      return;
    }
  }
}

function shorten(s, n = 60) {
  s = String(s).replace(/\s+/g, ' ').trim();
  if (/^data:/i.test(s)) return 'embedded data image';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function checkAccessibility(ctx) {
  const { root } = ctx;
  for (const img of all(root, 'img')) {
    const src = img.getAttribute('src');
    const alt = img.getAttribute('alt');
    if (alt === null) ctx.warn(`Image “${shorten(src.split('/').pop() || src, 40)}” has no alt text. Describe it, or use alt="" if it is purely decorative.`);
    else if (/automatically generated|^(image|picture|photo|img|screenshot)\s*\d*$|\.(jpe?g|png|gif|webp|svg)$/i.test(alt)) ctx.warn(`Check the alt text “${shorten(alt, 50)}”: it does not look like a real description.`);
    if (isEl(img.parentElement, 'a') && !alt && !/[^\s\u00a0]/.test(img.parentElement.textContent)) ctx.warn(`A linked image has no alt text, so the link to ${shorten(img.parentElement.getAttribute('href') || '', 40)} has no accessible name.`);
    if (/^file:/i.test(src)) ctx.warn(`Image “${shorten(src, 50)}” is a file on your computer. Upload it to the Media Library and insert it from there.`);
    else if (/^data:/i.test(src)) ctx.warn('An image is embedded as data in the HTML. Upload it to the Media Library instead to keep the post small.');
    else if (/googleusercontent\.com/i.test(src)) ctx.warn('An image is hosted by Google Docs and its link will expire. Upload it to the Media Library.');
  }
  for (const a of all(root, 'a[href]')) {
    const text = a.textContent.replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.…:!]+$/, '');
    if (NON_DESCRIPTIVE_LINKS.has(text)) ctx.warn(`Link text “${a.textContent.trim()}” does not say where it goes. Use words that describe the destination.`);
    else if (/^https?:\/\/\S{30,}$/.test(text)) ctx.warn(`A link’s text is a long web address (${shorten(text, 40)}). Descriptive words are easier to read and listen to.`);
  }
  for (const p of Array.from(root.children)) {
    if (!isEl(p, 'p')) continue;
    const kids = meaningfulChildren(p);
    const text = p.textContent.trim();
    if (kids.length === 1 && (isEl(kids[0], 'strong') || isEl(kids[0], 'b')) && text.length < 80 && !/[.!?:;,]$/.test(text)) {
      ctx.warn(`“${shorten(text, 50)}” looks like a heading but is a bold paragraph. Use a heading so it appears in the page outline.`);
    }
  }
}

function describeCounts(counts) {
  const msgs = {
    dropped: (n) => `Removed ${n} non-content element${n > 1 ? 's' : ''} (scripts, styles, forms…).`,
    embeds: (n) => `Converted ${n} embed${n > 1 ? 's' : ''} to WordPress auto-embeds.`,
    wordLists: (n) => `Rebuilt ${n} Word list${n > 1 ? 's' : ''} as real lists.`,
    styles: (n) => `Turned ${n} inline style${n > 1 ? 's' : ''} into semantic elements (strong, em, sup…).`,
    underline: () => 'Removed underlining, which readers confuse with links.',
    layoutTables: (n) => `Unwrapped ${n} single-cell layout table${n > 1 ? 's' : ''}.`,
    headerRows: (n) => `Marked ${n} bold first row${n > 1 ? 's' : ''} as table headers.`,
    wrapBreaks: (n) => `Removed ${n} line break${n > 1 ? 's' : ''} left over from wrapped text.`,
    nestedLists: (n) => `Removed ${n} empty list level${n > 1 ? 's' : ''} that only wrapped another list.`,
    splitParagraphs: (n) => `Split ${n} double line break${n > 1 ? 's' : ''} into paragraphs.`,
    wordCaptions: (n) => `Attached ${n} caption${n > 1 ? 's' : ''} to ${n > 1 ? 'their images' : 'its image'}.`,
    headingsDemoted: (n) => `Moved headings down ${n} level${n > 1 ? 's' : ''} (the post title is the page’s main heading).`,
    headingsPromoted: (n) => `Moved headings up ${n} level${n > 1 ? 's' : ''}.`,
    headingsFixed: (n) => `Adjusted ${n} heading${n > 1 ? 's' : ''} that skipped a level.`,
    emptyHeadings: (n) => `Removed ${n} empty heading${n > 1 ? 's' : ''}.`,
    moreInserted: () => 'Inserted a “more” tag.',
  };
  return [...counts.entries()].filter(([k]) => msgs[k]).map(([k, n]) => msgs[k](n));
}

/* ------------------------------------------------------------------ */
/* Serialisation                                                       */
/* ------------------------------------------------------------------ */

const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\u00a0/g, '&nbsp;');
const escCode = (s) => escText(s).replace(/\[/g, '&#91;');

function blockAttrs(obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return '';
  const json = JSON.stringify(obj)
    .replace(/--/g, '\\u002d\\u002d').replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026').replace(/\\"/g, '\\u0022');
  return ` ${json}`;
}

function attrStr(el, skip = []) {
  return Array.from(el.attributes)
    .filter((a) => !skip.includes(a.name))
    .map((a) => (a.value === '' && BOOLEAN_ATTRS.has(a.name) ? ` ${a.name}` : ` ${a.name}="${escAttr(a.value)}"`))
    .join('');
}

const alignOf = (img) => /\balign(left|right|center|none)\b/.exec(img.getAttribute('class') || '')?.[0] || '';
const wpImageId = (img) => +(/\bwp-image-(\d+)\b/.exec(img.getAttribute('class') || '')?.[1] || 0);

function imgHtml(img, f, { dropAlign = false } = {}) {
  const out = [` src="${escAttr(img.getAttribute('src'))}"`];
  if (img.hasAttribute('alt')) out.push(` alt="${escAttr(img.getAttribute('alt'))}"`);
  if (f.keepSize && img.hasAttribute('width')) {
    out.push(` width="${img.getAttribute('width')}"`);
    if (img.hasAttribute('height')) out.push(` height="${img.getAttribute('height')}"`);
  }
  let cls = (img.getAttribute('class') || '').split(/\s+/).filter(Boolean);
  if (dropAlign || f.mode === 'blocks') cls = cls.filter((c) => !/^align/.test(c));
  if (cls.length) out.push(` class="${cls.join(' ')}"`);
  return `<img${out.join('')}${f.mode === 'blocks' ? '/' : ''}>`;
}

function inl(n, f, br) {
  if (n.nodeType === 3) return escText(n.data);
  if (n.nodeType !== 1) return '';
  const tag = n.localName;
  if (tag === 'br') return br ?? '<br>';
  if (tag === 'img') return imgHtml(n, f);
  if (tag === 'wbr') return '<wbr>';
  if (tag === 'code') return `<code${attrStr(n)}>${escCode(n.textContent)}</code>`;
  if (tag === 'x-embed') { const u = n.getAttribute('url'); return `<a href="${escAttr(u)}">${escText(u)}</a>`; }
  if (BLOCKISH.has(tag)) return htmlBlock(n, f);
  return `<${tag}${attrStr(n)}>${inlKids(n, f, br)}</${tag}>`;
}

function inlKids(el, f, br) {
  let s = '';
  for (const c of el.childNodes) s += inl(c, f, br);
  return s;
}

/** Mixed content: inline runs and nested blocks. */
function flow(el, f, sep = '\n') {
  const out = [];
  let run = '';
  for (const c of el.childNodes) {
    if (isEl(c) && BLOCKISH.has(c.localName)) {
      if (run.trim()) out.push(run.trim());
      run = '';
      out.push(htmlBlock(c, f));
    } else run += inl(c, f);
  }
  if (run.trim()) out.push(run.trim());
  return out.join(sep);
}

function tableHtml(t, f) {
  const lines = ['<table>'];
  if (t.caption && hasContent(t.caption)) lines.push(`<caption>${flow(t.caption, f, '')}</caption>`);
  const sections = Array.from(t.children).filter((c) => /^(thead|tbody|tfoot)$/.test(c.localName));
  const explicit = sections.some((s) => s.localName !== 'tbody') || sections.length > 1;
  for (const s of sections) {
    if (explicit) lines.push(`<${s.localName}>`);
    for (const row of Array.from(s.rows)) {
      lines.push(`<tr>${Array.from(row.cells).map((c) => `<${c.localName}${attrStr(c)}>${flow(c, f, '')}</${c.localName}>`).join('')}</tr>`);
    }
    if (explicit) lines.push(`</${s.localName}>`);
  }
  lines.push('</table>');
  return lines.join('\n');
}

function figureParts(fig, f, opts) {
  const img = fig.querySelector('img');
  const link = isEl(img.parentElement, 'a') ? img.parentElement : null;
  const imgS = imgHtml(img, f, opts);
  const media = link ? `<a${attrStr(link)}>${imgS}</a>` : imgS;
  const capEl = fig.querySelector('figcaption');
  const cap = capEl && hasContent(capEl) ? flow(capEl, f, ' ') : '';
  return { img, media, cap, align: alignOf(img) };
}

function figureHtml(fig, f) {
  if (!fig.querySelector('img')) return flow(fig, f);
  const plain = figureParts(fig, f);
  if (!plain.cap) return plain.media;
  const { img, media, cap, align } = figureParts(fig, f, { dropAlign: true });
  if (f.mode === 'classic' && f.captions === 'shortcode') {
    const width = img.getAttribute('width');
    if (width) {
      const id = wpImageId(img);
      return `[caption${id ? ` id="attachment_${id}"` : ''} align="${align || 'alignnone'}" width="${width}"]${media} ${cap}[/caption]`;
    }
    f.ctx.warn(`Used <figure> for the caption “${shorten(cap.replace(/<[^>]+>/g, ''), 40)}” because the image’s width is unknown ([caption] needs it).`);
  }
  return `<figure${align ? ` class="${align}"` : ''}>${media}<figcaption>${cap}</figcaption></figure>`;
}

function htmlBlock(el, f) {
  const tag = el.localName;
  switch (tag) {
    case 'ul':
    case 'ol':
      return `<${tag}${attrStr(el)}>\n${Array.from(el.children).filter((c) => isEl(c, 'li')).map((li) => `<li${attrStr(li)}>${flow(li, f)}</li>`).join('\n')}\n</${tag}>`;
    case 'dl':
      return `<dl${attrStr(el)}>\n${Array.from(el.children).map((c) => `<${c.localName}${attrStr(c)}>${flow(c, f)}</${c.localName}>`).join('\n')}\n</dl>`;
    case 'blockquote':
      return `<blockquote${attrStr(el)}>\n${flow(el, f)}\n</blockquote>`;
    case 'pre': {
      const code = el.querySelector('code');
      const text = escCode(el.textContent);
      const lead = text.startsWith('\n') ? '\n' : '';
      return code ? `<pre${attrStr(el)}><code>${text}</code></pre>` : `<pre${attrStr(el)}>${lead}${text}</pre>`;
    }
    case 'table': return tableHtml(el, f);
    case 'figure': return figureHtml(el, f);
    case 'hr': return f.mode === 'blocks' ? '<hr/>' : '<hr>';
    case 'x-embed': {
      const u = el.getAttribute('url');
      if (f.mode === 'classic') return u;
      if (f.mode === 'preview') return `<p class="wps-marker">Embed: <a href="${escAttr(u)}">${escText(u)}</a></p>`;
      return `<p><a href="${escAttr(u)}">${escText(u)}</a></p>`;
    }
    case 'video':
    case 'audio':
      if (f.mode === 'classic') return `[${tag} src="${escAttr(el.getAttribute('src'))}"]`;
      return `<${tag}${attrStr(el)}></${tag}>`;
    default:
      return `<${tag}${attrStr(el)}>${flow(el, f)}</${tag}>`;
  }
}

function langWrap(el, inner) {
  const a = ['lang', 'dir'].filter((n) => el.hasAttribute(n)).map((n) => ` ${n}="${escAttr(el.getAttribute(n))}"`).join('');
  return a ? `<span${a}>${inner}</span>` : inner;
}

const wpBlock = (name, attrs, html) => `<!-- wp:${name}${blockAttrs(attrs)} -->\n${html}\n<!-- /wp:${name} -->`;

/** Inline content of a list item or table cell for the block editor (null = needs HTML block). */
function richContent(el, f, nestedLists = []) {
  const parts = [];
  let run = '';
  for (const c of el.childNodes) {
    if (isEl(c, 'ul') || isEl(c, 'ol')) {
      if (!nestedLists) return null;
      nestedLists.push(c);
    } else if (isEl(c, 'p')) {
      if (run.trim()) parts.push(run.trim());
      run = '';
      parts.push(inlKids(c, f));
    } else if (isEl(c) && BLOCKISH.has(c.localName)) return null;
    else run += inl(c, f);
  }
  if (run.trim()) parts.push(run.trim());
  // Separate paragraphs with a blank line (two breaks) so they stay apart.
  return parts.join('<br><br>');
}

function listBlock(list, f) {
  const tag = list.localName;
  const attrs = {};
  if (tag === 'ol') attrs.ordered = true;
  const start = list.getAttribute('start');
  if (start) attrs.start = +start;
  if (list.hasAttribute('reversed')) attrs.reversed = true;
  const items = [];
  for (const li of Array.from(list.children).filter((c) => isEl(c, 'li'))) {
    const nested = [];
    const content = richContent(li, f, nested);
    if (content === null) return null;
    const nestedHtml = [];
    for (const n of nested) {
      const b = listBlock(n, f);
      if (b === null) return null;
      nestedHtml.push(b);
    }
    items.push(wpBlock('list-item', {}, `<li>${langWrap(li, content)}${nestedHtml.join('')}</li>`));
  }
  const htmlAttrs = `${start ? ` start="${start}"` : ''}${attrs.reversed ? ' reversed' : ''}`;
  return wpBlock('list', attrs, `<${tag}${htmlAttrs} class="wp-block-list">${items.join('\n\n')}</${tag}>`);
}

function tableBlock(t, f) {
  const sections = [];
  for (const s of Array.from(t.children).filter((c) => /^(thead|tbody|tfoot)$/.test(c.localName))) {
    const rows = [];
    for (const row of Array.from(s.rows)) {
      const cells = [];
      for (const c of Array.from(row.cells)) {
        const content = richContent(c, f, null);
        if (content === null) return null;
        cells.push(`<${c.localName}${attrStr(c, ['lang', 'dir'])}>${langWrap(c, content)}</${c.localName}>`);
      }
      rows.push(`<tr>${cells.join('')}</tr>`);
    }
    sections.push(`<${s.localName}>${rows.join('')}</${s.localName}>`);
  }
  const cap = t.caption && hasContent(t.caption) ? `<figcaption class="wp-element-caption">${richContent(t.caption, f, null) ?? flow(t.caption, f, ' ')}</figcaption>` : '';
  return wpBlock('table', { hasFixedLayout: false }, `<figure class="wp-block-table"><table>${sections.join('')}</table>${cap}</figure>`);
}

function imageBlock(fig, f) {
  const { img, media, cap, align } = figureParts(fig, f, { dropAlign: true });
  const attrs = {};
  const id = wpImageId(img);
  if (id) attrs.id = id;
  const a = align.replace('align', '');
  if (a && a !== 'none') attrs.align = a;
  if (isEl(img.parentElement, 'a')) attrs.linkDestination = 'custom';
  const cls = ['wp-block-image', a && a !== 'none' ? align : ''].filter(Boolean).join(' ');
  return wpBlock('image', attrs, `<figure class="${cls}">${media}${cap ? `<figcaption class="wp-element-caption">${cap}</figcaption>` : ''}</figure>`);
}

function moreBlock(comment, next) {
  const text = comment.data.replace(/^more\s*/, '');
  const attrs = {};
  if (text) attrs.customText = text;
  const noTeaser = next?.nodeType === 8 && next.data === 'noteaser';
  if (noTeaser) attrs.noTeaser = true;
  return wpBlock('more', attrs, `<!--${comment.data}-->${noTeaser ? '\n<!--noteaser-->' : ''}`);
}

function toBlock(node, f) {
  if (node.nodeType === 8) {
    if (/^more\b/.test(node.data)) return moreBlock(node, nextNonBlank(node));
    if (node.data === 'nextpage') return wpBlock('nextpage', {}, '<!--nextpage-->');
    return ''; // noteaser is folded into the more block
  }
  if (!isEl(node)) return '';
  const tag = node.localName;
  const html = () => wpBlock('html', {}, htmlBlock(node, { ...f, mode: 'html' }));
  switch (tag) {
    case 'p': {
      const id = node.id ? ` id="${escAttr(node.id)}"` : '';
      return wpBlock('paragraph', {}, `<p${id}>${langWrap(node, inlKids(node, f))}</p>`);
    }
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const level = +tag[1];
      const id = node.id ? ` id="${escAttr(node.id)}"` : '';
      return wpBlock('heading', level === 2 ? {} : { level }, `<${tag} class="wp-block-heading"${id}>${langWrap(node, inlKids(node, f))}</${tag}>`);
    }
    case 'ul': case 'ol': return listBlock(node, f) ?? html();
    case 'blockquote': {
      const kids = meaningfulChildren(node);
      const last = kids.at(-1);
      const cite = isEl(last, 'cite') ? last : null;
      const inner = kids.filter((k) => k !== cite).map((k) => (isEl(k) ? toBlock(k, f) : '')).filter(Boolean).join('\n\n');
      return wpBlock('quote', {}, `<blockquote class="wp-block-quote">${inner}${cite ? `<cite>${inlKids(cite, f)}</cite>` : ''}</blockquote>`);
    }
    case 'pre': {
      const text = escCode(node.textContent);
      return node.querySelector('code')
        ? wpBlock('code', {}, `<pre class="wp-block-code"><code>${text}</code></pre>`)
        : wpBlock('preformatted', {}, `<pre class="wp-block-preformatted">${text}</pre>`);
    }
    case 'figure': return node.querySelector('img') ? imageBlock(node, f) : html();
    case 'table': return tableBlock(node, f) ?? html();
    case 'hr': return wpBlock('separator', {}, '<hr class="wp-block-separator has-alpha-channel-opacity"/>');
    case 'x-embed': {
      const u = node.getAttribute('url');
      return wpBlock('embed', { url: u }, `<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">\n${escText(u)}\n</div></figure>`);
    }
    case 'video': case 'audio':
      return wpBlock(tag, {}, `<figure class="wp-block-${tag}"><${tag} controls src="${escAttr(node.getAttribute('src'))}"></${tag}></figure>`);
    default: return html();
  }
}

function nextNonBlank(node) {
  let n = node.nextSibling;
  while (n && n.nodeType === 3 && isBlankText(n)) n = n.nextSibling;
  return n;
}

function toClassic(node, f) {
  if (node.nodeType === 8) return `<!--${node.data}-->`;
  if (!isEl(node)) return '';
  // Breaks stay as <br>: a bare newline would read back as wrapping.
  if (isEl(node, 'p') && f.autop && !node.attributes.length) return inlKids(node, f);
  if (f.mode === 'preview' && node.nodeType === 1 && node.localName === 'figure') return figureHtml(node, f);
  return htmlBlock(node, f);
}

function toPreview(node, f) {
  if (node.nodeType === 8) {
    if (/^more\b/.test(node.data)) return `<p class="wps-marker" role="separator">More (${escText(node.data.replace(/^more\s*/, '') || 'excerpt ends here')})</p>`;
    if (node.data === 'nextpage') return '<p class="wps-marker" role="separator">Page break</p>';
    return '';
  }
  return toClassic(node, f);
}

function serialiseTop(root, f) {
  const fn = f.mode === 'blocks' ? toBlock : f.mode === 'preview' ? toPreview : toClassic;
  const out = [];
  let pendingMore = '';
  for (const n of Array.from(root.childNodes)) {
    // Classic editor: the more tag starts the paragraph that follows it.
    if (f.mode === 'classic' && n.nodeType === 8 && /^more\b/.test(n.data)) {
      pendingMore += `<!--${n.data}-->`;
      continue;
    }
    const s = fn(n, f);
    if (!s || !s.trim()) continue;
    out.push(pendingMore + s);
    pendingMore = '';
  }
  if (pendingMore) out.push(pendingMore);
  return out.join('\n\n');
}
