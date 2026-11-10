import { simplify, DEFAULTS } from './simplify.js';

const $ = (id) => document.getElementById(id);
const input = $('input');
const output = $('output');
const form = $('options');
const STORE = 'wp-simplify-options';

const SAMPLE = `<b style="font-weight:normal;" id="docs-internal-guid-1234">
<h1 dir="ltr"><span style="font-size:20pt;font-weight:700">Planting a winter garden</span></h1>
<p dir="ltr"><span style="font-weight:700">Short days</span><span> don’t have to mean&nbsp;&nbsp;an empty plot. Here is </span><span style="font-style:italic">everything</span><span> you need.</span></p>
<p dir="ltr"><span>Read our </span><a href="https://www.google.com/url?q=https://example.com/guide&amp;sa=D"><span style="text-decoration:underline">soil guide</span></a><span> first, or </span><a href="https://example.com/more"><span>click here</span></a><span>.</span></p>
<!--more-->
<h3 dir="ltr"><span>What to grow</span></h3>
<ul><li dir="ltr" style="list-style-type:disc"><p dir="ltr" role="presentation"><span>Garlic</span></p></li><li dir="ltr"><p dir="ltr" role="presentation"><span>Broad beans</span></p></li></ul>
<div class="wp-caption alignright" style="width:310px"><img src="https://picsum.photos/id/152/300/200" width="300" height="200" alt="Frost on kale leaves"><p class="wp-caption-text">Kale tastes <i>sweeter</i> after a frost.</p></div>
<p><span style="font-weight:700">Timing</span></p>
<table style="border:1px solid"><tr><td><p><b>Crop</b></p></td><td><b>Sow</b></td></tr><tr><td>Garlic</td><td>October</td></tr></table>
<p>https://www.youtube.com/watch?v=dQw4w9WgXcQ</p>
<p class="MsoNormal"><o:p>&nbsp;</o:p></p>
<script>alert('hi')</script>
</b>`;

function readOptions() {
  // Read controls directly: FormData skips disabled fieldsets.
  const el = form.elements;
  return {
    format: el.format.value,
    autop: el.autop.checked,
    captions: el.captions.value,
    keepImageSize: el.keepImageSize.checked,
    topHeading: +el.topHeading.value,
    fixHeadingSkips: el.fixHeadingSkips.checked,
    semanticEmphasis: el.semanticEmphasis.checked,
    moreAfter: Math.max(0, +el.moreAfter.value || 0),
  };
}

function writeOptions(o) {
  for (const [k, v] of Object.entries(o)) {
    const el = form.elements[k];
    if (!el) continue;
    if (el instanceof RadioNodeList) { for (const r of el) r.checked = r.value === v; }
    else if (el.type === 'checkbox') el.checked = !!v;
    else el.value = String(v);
  }
}

try { writeOptions({ ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE) || '{}') }); } catch { /* ignore */ }

// Image dimensions, needed for [caption] shortcodes and to avoid layout shift.
const sizes = new Map();
const pending = new Set();
function lookupSizes(srcs) {
  for (const src of srcs) {
    if (sizes.has(src) || pending.has(src)) continue;
    pending.add(src);
    const img = new Image();
    const done = (ok) => {
      pending.delete(src);
      if (ok && img.naturalWidth) { sizes.set(src, { width: img.naturalWidth, height: img.naturalHeight }); schedule(0); }
      else sizes.set(src, null);
    };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    setTimeout(() => pending.has(src) && done(false), 8000);
    img.src = src;
  }
}

const PREVIEW_CSS = `body{font:17px/1.6 Georgia,serif;max-width:42em;margin:1.5em auto;padding:0 16px;color:#222;background:#fff}
img{max-width:100%;height:auto}figure{margin:1.5em 0}figcaption{font-size:.9em;color:#555}
.alignleft{float:left;margin:0 1em 1em 0}.alignright{float:right;margin:0 0 1em 1em}.aligncenter{display:block;margin-inline:auto;text-align:center}
table{border-collapse:collapse}th,td{border:1px solid #bbb;padding:.3em .6em;text-align:left}
blockquote{border-left:4px solid #ccc;margin-left:0;padding-left:1em}pre{background:#f4f4f4;padding:1em;overflow:auto}
.wps-marker{clear:both;border-top:2px dashed #999;color:#666;font:13px system-ui,sans-serif;padding-top:4px}`;

function renderReport(result) {
  const report = $('report');
  report.replaceChildren();
  const section = (title, items, cls) => {
    if (!items.length) return;
    const h = document.createElement('h3');
    h.textContent = title;
    const ul = document.createElement('ul');
    ul.className = cls;
    for (const t of items) { const li = document.createElement('li'); li.textContent = t; ul.append(li); }
    report.append(h, ul);
  };
  section(`Accessibility and content checks (${result.warnings.length})`, result.warnings, 'warnings');
  section('Changes made', result.notes, 'notes');
  if (!report.childNodes.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = input.value.trim() ? 'No problems found.' : 'Nothing yet.';
    report.append(p);
  }
}

function run() {
  const opts = readOptions();
  try { localStorage.setItem(STORE, JSON.stringify(opts)); } catch { /* ignore */ }
  form.querySelector('.classic-only').disabled = opts.format !== 'classic';
  const result = simplify(input.value, opts, { imageSizes: sizes });
  output.value = result.html;
  const { inputLength, outputLength } = result.stats;
  $('stats').textContent = inputLength
    ? `${inputLength.toLocaleString()} → ${outputLength.toLocaleString()} characters${opts.format === 'blocks' ? ', including block editor comments' : ''}.`
    : '';
  renderReport(result);
  $('preview').srcdoc = `<!doctype html><html lang="en"><meta charset="utf-8"><style>${PREVIEW_CSS}</style><body>${result.preview}</body></html>`;
  lookupSizes(result.missingSizes);
}

let timer;
function schedule(delay = 250) { clearTimeout(timer); timer = setTimeout(run, delay); }

input.addEventListener('input', () => schedule());
form.addEventListener('input', () => schedule(0));
form.addEventListener('change', () => schedule(0));
form.addEventListener('submit', (e) => e.preventDefault());

// Paste rich text as its HTML source.
input.addEventListener('paste', (e) => {
  const html = e.clipboardData?.getData('text/html');
  if (!html) return;
  e.preventDefault();
  const { selectionStart: s, selectionEnd: t, value } = input;
  input.value = value.slice(0, s) + html + value.slice(t);
  input.selectionStart = input.selectionEnd = s + html.length;
  schedule(0);
});

$('sample').addEventListener('click', () => { input.value = SAMPLE; run(); });
$('clear').addEventListener('click', () => { input.value = ''; run(); input.focus(); });
$('copy').addEventListener('click', async () => {
  const btn = $('copy');
  try { await navigator.clipboard.writeText(output.value); }
  catch { output.select(); document.execCommand('copy'); }
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
});

// Local builds have no injected version.
const version = $('version');
if (version.textContent.startsWith('__')) {
  version.textContent = 'development';
  version.removeAttribute('href');
  version.nextElementSibling?.removeAttribute('href');
}

run();
