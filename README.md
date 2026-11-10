# WP Simplify

A static web tool that turns messy HTML from Word, Google Docs, web pages or old posts into the smallest markup a WordPress post needs. The output uses semantic elements and is checked for accessibility problems.

Everything runs in the browser. Nothing is uploaded.

## What it does to the HTML

- **Removes presentational markup**: `style`, `class`, `font`, `span`, layout `div`s, Word `o:p`, scripts and forms. It also drops `lang`/`dir` attributes that only repeat the inherited value.
- **Makes styling semantic**: bold, italic, superscript, subscript and strike-through styles become `<strong>`, `<em>`, `<sup>`, `<sub>` and `<s>`. `<b>`/`<i>` become `<strong>`/`<em>`. Underlining is removed because readers mistake it for a link.
- **Fixes structure**:
  - Rebuilds Word's fake lists as real nested `<ul>`/`<ol>`.
  - Splits `<br><br>` into separate paragraphs.
  - Unwraps single-cell layout tables.
  - Marks a bold first row as `<th>` headers.
  - Merges adjacent identical tags.
  - Tidies whitespace and `&nbsp;`.
- **Headings**: shifts them so the highest is `<h2>` (the post title is the `<h1>`), and stops them from skipping levels.
- **Keeps what accessibility needs**: `alt`, `lang` on foreign-language phrases, table `scope`/`colspan`, `abbr` titles, and `id`s that in-page links point at.
- **Checks the result**: warns about missing or auto-generated alt text, links like "click here", bold paragraphs that should be headings, tables with no headers, and images still hosted on your computer or in Google Docs.

## WordPress features

- `<!--more-->` (including custom text), `<!--nextpage-->` and `<!--noteaser-->` are kept and moved to the top level. The tool can also add a more tag after a set number of paragraphs.
- **Captions**: `<figure>`/`<figcaption>`, rendered WordPress `.wp-caption` blocks and Word caption paragraphs all become one of:
  - an Image block with a caption (block editor), or
  - a `[caption]` shortcode (classic editor). The tool looks up the image width that `[caption]` needs if the source doesn't give it.
- `alignleft`/`alignright`/`aligncenter` and `wp-image-N` classes are kept.
- YouTube, Vimeo, Spotify and similar iframes, and bare URLs on their own line, become auto-embeds.
- `[` inside code is escaped so WordPress won't run it as a shortcode.
- **Two output formats**:
  - **Block editor**: valid block markup for paragraphs, headings, lists, quotes, images, tables, code, separators, embeds and more. Anything else goes in a Custom HTML block.
  - **Classic editor**: plain HTML. You can optionally leave out `<p>`/`<br>` and let `wpautop` add them.

## Development

```bash
npm install
npm test
npx http-server site
```

The app is `site/` (no build step). `site/simplify.js` holds the conversion logic and runs in the browser, or in Node with jsdom for the tests.

## Deployment

`.github/workflows/pages.yml` runs the tests on every push and pull request. On pushes to `main` it also injects the version into the footer and deploys `site/` to GitHub Pages. The version comes from `git describe --tags --always --dirty` and links to its commit.

In the repository settings, set **Pages → Source** to **GitHub Actions**.
