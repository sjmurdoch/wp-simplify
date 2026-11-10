import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { simplify } from '../site/simplify.js';

const { DOMParser } = new JSDOM('').window;
const run = (html, opts = {}, env = {}) => simplify(html, opts, { DOMParser, ...env });
const classic = (html, opts = {}) => run(html, { format: 'classic', ...opts }).html;
const html = (html, opts = {}) => run(html, { format: 'classic', autop: false, ...opts }).html;

test('strips presentational markup and keeps semantics', () => {
  const out = html('<div class="x" style="color:red"><span style="font-weight:bold">Hi</span> <font face="Arial">there</font></div>');
  assert.equal(out, '<p><strong>Hi</strong> there</p>');
});

test('b and i become strong and em; Google Docs normal-weight wrapper is removed', () => {
  const out = html('<b style="font-weight:normal" id="docs-internal-guid-x"><p><b>A</b> <i>b</i> <span style="font-style:italic">c</span></p></b>');
  // Adjacent emphasis is merged.
  assert.equal(out, '<p><strong>A</strong> <em>b c</em></p>');
});

test('wpautop mode omits paragraph tags and uses newlines for breaks', () => {
  assert.equal(classic('<p>One<br>Two</p><p>Three</p>'), 'One\nTwo\n\nThree');
});

test('preserves more and nextpage tags and hoists them out of paragraphs', () => {
  assert.equal(classic('<p>Intro<!--more Keep reading--></p><p>Rest</p><!-- nextpage --><p>Page 2</p><!-- junk -->'),
    'Intro\n\n<!--more Keep reading-->\n\nRest\n\n<!--nextpage-->\n\nPage 2');
});

test('more tag becomes a more block in the block editor', () => {
  const out = run('<p>a</p><!--more--><p>b</p>').html;
  assert.match(out, /<!-- wp:more -->\n<!--more-->\n<!-- \/wp:more -->/);
  assert.match(out, /<!-- wp:paragraph -->\n<p>a<\/p>\n<!-- \/wp:paragraph -->/);
});

test('inserts a more tag when asked and none exists', () => {
  assert.equal(classic('<p>a</p><p>b</p>', { moreAfter: 1 }), 'a\n\n<!--more-->\n\nb');
});

test('figure with caption becomes [caption] shortcode', () => {
  const out = classic('<figure class="alignright"><img src="a.jpg" alt="Cat" width="300" height="200" class="wp-image-7 size-full"><figcaption>A <em>cat</em></figcaption></figure>');
  assert.equal(out, '[caption id="attachment_7" align="alignright" width="300"]<img src="a.jpg" alt="Cat" width="300" height="200" class="wp-image-7"> A <em>cat</em>[/caption]');
});

test('WordPress rendered caption div round-trips', () => {
  const out = classic('<div id="attachment_3" class="wp-caption aligncenter" style="width: 310px"><img src="b.png" alt="Dog" width="300"><p class="wp-caption-text">Good dog</p></div>');
  assert.equal(out, '[caption align="aligncenter" width="300"]<img src="b.png" alt="Dog" width="300"> Good dog[/caption]');
});

test('caption falls back to figure when width is unknown, using known sizes when provided', () => {
  const src = 'https://example.com/x.jpg';
  const input = `<figure><img src="${src}" alt="X"><figcaption>Cap</figcaption></figure>`;
  const r = run(input, { format: 'classic' });
  assert.equal(r.html, `<figure><img src="${src}" alt="X"><figcaption>Cap</figcaption></figure>`);
  assert.deepEqual(r.missingSizes, [src]);
  const r2 = run(input, { format: 'classic' }, { imageSizes: new Map([[src, { width: 640, height: 480 }]]) });
  assert.match(r2.html, /^\[caption align="alignnone" width="640"\]/);
});

test('image block with caption and alignment', () => {
  const out = run('<p><img src="a.jpg" alt="Cat" class="alignleft wp-image-9" width="10"></p>').html;
  assert.equal(out, '<!-- wp:image {"id":9,"align":"left"} -->\n<figure class="wp-block-image alignleft"><img src="a.jpg" alt="Cat" class="wp-image-9"/></figure>\n<!-- /wp:image -->');
});

test('headings are shifted below the post title and skips are fixed', () => {
  const r = run('<h1>A</h1><h3>B</h3><h2>C</h2>', { format: 'classic', autop: false });
  assert.equal(r.html, '<h2>A</h2>\n\n<h3>B</h3>\n\n<h3>C</h3>');
  assert.equal(run('<h2>A</h2><h3>B</h3>').html.split('\n')[0], '<!-- wp:heading -->');
  assert.match(run('<h2>A</h2><h3>B</h3>').html, /<!-- wp:heading \{"level":3\} -->\n<h3 class="wp-block-heading">B<\/h3>/);
});

test('bold inside headings is redundant', () => {
  assert.equal(html('<h2><strong>Title</strong></h2>'), '<h2>Title</h2>');
});

test('Word lists become nested real lists', () => {
  const word = `<p class=MsoListParagraphCxSpFirst style='mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>1.<span>&nbsp;&nbsp;</span></span><![endif]>One</p>
<p class=MsoListParagraphCxSpMiddle style='mso-list:l0 level2 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>o<span>&nbsp;</span></span><![endif]>Sub</p>
<p class=MsoListParagraphCxSpLast style='mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>2.<span>&nbsp;</span></span><![endif]>Two</p>`;
  assert.equal(html(word), '<ol>\n<li>One\n<ul>\n<li>Sub</li>\n</ul></li>\n<li>Two</li>\n</ol>');
});

test('spurious nested lists are collapsed', () => {
  assert.equal(html('<ul><li><ul><li><ul><li><em>A.</em> one</li><li>two</li></ul></li></ul></li></ul>'),
    '<ul>\n<li><em>A.</em> one</li>\n<li>two</li>\n</ul>');
  // An item that is only an indented list moves under the previous item.
  assert.equal(html('<ul><li>a</li><li><ul><li>b</li></ul></li><li>c</li></ul>'),
    '<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul></li>\n<li>c</li>\n</ul>');
  // A leading indented list is lifted up a level.
  assert.equal(html('<ol><li><ol><li>a</li></ol></li><li>b</li></ol>'), '<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
});

test('list block markup with nested list', () => {
  const out = run('<ul><li><p>One</p><ul><li>Sub</li></ul></li></ul>').html;
  assert.equal(out, [
    '<!-- wp:list -->',
    '<ul class="wp-block-list"><!-- wp:list-item -->',
    '<li>One<!-- wp:list -->',
    '<ul class="wp-block-list"><!-- wp:list-item -->',
    '<li>Sub</li>',
    '<!-- /wp:list-item --></ul>',
    '<!-- /wp:list --></li>',
    '<!-- /wp:list-item --></ul>',
    '<!-- /wp:list -->',
  ].join('\n'));
});

test('bold first table row becomes a header; single-cell tables are unwrapped', () => {
  assert.equal(html('<table border=1><tr><td><b>A</b></td><td><p><b>B</b></p></td></tr><tr><td>1</td><td>2</td></tr></table>'),
    '<table>\n<thead>\n<tr><th>A</th><th>B</th></tr>\n</thead>\n<tbody>\n<tr><td>1</td><td>2</td></tr>\n</tbody>\n</table>');
  assert.equal(html('<table><tr><td><p>Just text</p></td></tr></table>'), '<p>Just text</p>');
});

test('iframes become WordPress auto-embeds', () => {
  assert.equal(classic('<p><iframe src="https://www.youtube.com/embed/abc123"></iframe></p>'), 'https://www.youtube.com/watch?v=abc123');
  assert.match(run('<p>https://youtu.be/abc</p>').html, /^<!-- wp:embed \{"url":"https:\/\/youtu.be\/abc"\} -->/);
  const r = run('<iframe src="https://evil.example/x"></iframe>');
  assert.equal(r.html, '');
  assert.equal(r.warnings.length, 1);
});

test('links: tracking redirects removed, javascript dropped, target removed', () => {
  assert.equal(html('<p><a href="https://www.google.com/url?q=https://example.com/&amp;sa=D" target="_blank" title="x">Example</a> <a href="javascript:alert(1)">bad</a></p>'),
    '<p><a href="https://example.com/">Example</a> bad</p>');
});

test('referenced ids are kept, others dropped', () => {
  assert.equal(html('<p><a href="#n1">1</a></p><h2 id="n1">Notes</h2><h2 id="junk">X</h2>'),
    '<p><a href="#n1">1</a></p>\n\n<h2 id="n1">Notes</h2>\n\n<h2>X</h2>');
});

test('foreign-language spans keep lang; redundant ones go', () => {
  assert.equal(html('<p lang="en-GB">Say <span lang="fr">bonjour</span> <span lang="en-US">now</span></p>'),
    '<p>Say <span lang="fr">bonjour</span> now</p>');
});

test('whitespace and non-breaking spaces are tidied, empty paragraphs removed', () => {
  assert.equal(html('<p>&nbsp;</p><p>  a&nbsp;&nbsp; b&nbsp;c <strong> d </strong></p><p><o:p>&nbsp;</o:p></p>'), '<p>a b&nbsp;c <strong>d</strong></p>');
});

test('double line breaks split paragraphs', () => {
  assert.equal(classic('<p>a<br><br>b</p>'), 'a\n\nb');
});

test('line breaks from wrapped text are removed, deliberate ones kept', () => {
  const wrapped = '<p>This paragraph was copied from an email client that<br>\nhard-wrapped every line at about seventy characters so<br>\nthat it would fit, and each wrap became a line break.</p>';
  assert.equal(html(wrapped), '<p>This paragraph was copied from an email client that hard-wrapped every line at about seventy characters so that it would fit, and each wrap became a line break.</p>');
  // Short lines (an address) are kept.
  const address = '<p>1 High Street<br>London<br>SW1A 1AA</p>';
  assert.equal(html(address), '<p>1 High Street<br>London<br>SW1A 1AA</p>');
  // A lower-case continuation is a wrap even in a short paragraph.
  assert.equal(html('<p>Short line that<br>continues here</p>'), '<p>Short line that continues here</p>');
  // A hyphen at the break joins without a space.
  assert.equal(html('<p>A well-<br>known fact</p>'), '<p>A well-known fact</p>');
  // Modes.
  assert.equal(html(address, { lineBreaks: 'remove' }), '<p>1 High Street London SW1A 1AA</p>');
  assert.equal(html('<p>Short line that<br>continues</p>', { lineBreaks: 'keep' }), '<p>Short line that<br>continues</p>');
  // Newlines in the source never become breaks.
  assert.equal(classic('<p>one\ntwo</p>'), 'one two');
});

test('code is escaped and protected from shortcodes', () => {
  assert.equal(html('<pre><code><span class="k">if</span> [a] &lt; b</code></pre>'), '<pre><code>if &#91;a] &lt; b</code></pre>');
  assert.match(run('<pre>plain</pre>').html, /<!-- wp:preformatted -->\n<pre class="wp-block-preformatted">plain<\/pre>/);
});

test('blockquote with figcaption becomes quote with citation', () => {
  const out = run('<figure><blockquote><p>Words</p></blockquote><figcaption>Someone</figcaption></figure>').html;
  assert.equal(out, '<!-- wp:quote -->\n<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n<p>Words</p>\n<!-- /wp:paragraph --><cite>Someone</cite></blockquote>\n<!-- /wp:quote -->');
});

test('accessibility warnings', () => {
  const r = run('<p><img src="a.png"></p><p><a href="/x">click here</a></p><p><strong>Looks like a heading</strong></p><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>');
  const w = r.warnings.join('\n');
  assert.match(w, /no alt text/);
  assert.match(w, /does not say where it goes/);
  assert.match(w, /looks like a heading/);
  assert.match(w, /no header cells/);
});

test('scripts, styles and comments are removed', () => {
  assert.equal(html('<style>p{}</style><script>x()</script><!--[if gte mso 9]><xml></xml><![endif]--><p>ok</p>'), '<p>ok</p>');
});

test('loose text is wrapped in paragraphs', () => {
  assert.equal(html('Hello <em>world</em><h2>T</h2>tail'), '<p>Hello <em>world</em></p>\n\n<h2>T</h2>\n\n<p>tail</p>');
});
