/**
 * Tiny safe markdown → HTML renderer.
 *
 * Scope: what Claude Code actually emits in replies — fenced code blocks,
 * inline code, bold, italic, links, ordered/unordered lists, ATX headings,
 * paragraphs with soft line breaks. No HTML pass-through (all user input is
 * HTML-escaped first); no images; no tables.
 *
 * Safety contract:
 *   1. Fenced code is extracted before escape so ``` inside text doesn't
 *      corrupt escaping; the extracted block is escaped on re-insertion.
 *   2. All other text is HTML-escaped BEFORE inline transforms run, so the
 *      only HTML tags in the output are the ones we generate ourselves.
 *   3. Link URLs are passed through a strict allowlist (http/https/mailto/
 *      same-origin paths). `javascript:` / `data:` URLs are stripped.
 */

const CODE_PLACEHOLDER = '\u0000CODE\u0000';

/**
 * Render markdown source to an HTML string safe to inject via innerHTML.
 * @param {unknown} input
 * @returns {string}
 */
export function renderMarkdown(input) {
  if (typeof input !== 'string' || input.length === 0) return '';

  // Phase 1 — extract fenced code blocks.
  /** @type {Array<{ lang: string, code: string }>} */
  const codeBlocks = [];
  let src = input.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: String(lang || ''), code: String(code) });
    return `${CODE_PLACEHOLDER}${idx}${CODE_PLACEHOLDER}`;
  });

  // Phase 2 — HTML-escape everything else.
  src = escapeHtml(src);

  // Phase 3 — block-level parse (split on blank lines).
  const blocks = src.split(/\n{2,}/);
  let html = blocks.map(renderBlock).join('');

  // Phase 4 — substitute code blocks back.
  html = html.replace(new RegExp(`${CODE_PLACEHOLDER}(\\d+)${CODE_PLACEHOLDER}`, 'g'), (_, idx) => {
    const { lang, code } = codeBlocks[Number(idx)];
    const body = escapeHtml(code.replace(/\n$/, ''));
    return `<pre class="md-code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${body}</code></pre>`;
  });

  return html;
}

/**
 * Render a single block-level chunk (paragraph / list / heading).
 * @param {string} block — already HTML-escaped
 */
function renderBlock(block) {
  const trimmed = block.replace(/^\s+|\s+$/g, '');
  if (trimmed.length === 0) return '';

  // If the block is *only* a code-block placeholder, emit it verbatim —
  // the substitution pass will replace it with a <pre> element.
  if (new RegExp(`^${CODE_PLACEHOLDER}\\d+${CODE_PLACEHOLDER}$`).test(trimmed)) {
    return trimmed;
  }

  // ATX headings: #, ##, ... up to ######.
  const h = trimmed.match(/^(#{1,6})\s+(.+)$/);
  if (h && !trimmed.includes('\n')) {
    const level = h[1].length;
    return `<h${level} class="md-h md-h${level}">${renderInline(h[2])}</h${level}>`;
  }

  // Ordered list — every non-blank line starts with `N.`
  if (/^\s*\d+\.\s+/.test(trimmed) && allLinesMatch(trimmed, /^\s*\d+\.\s+/)) {
    const items = trimmed.split('\n').map((l) => renderInline(l.replace(/^\s*\d+\.\s+/, '')));
    return `<ol class="md-list">${items.map((i) => `<li>${i}</li>`).join('')}</ol>`;
  }

  // Unordered list — every non-blank line starts with `- `, `* `, or `+ `.
  if (/^\s*[-*+]\s+/.test(trimmed) && allLinesMatch(trimmed, /^\s*[-*+]\s+/)) {
    const items = trimmed.split('\n').map((l) => renderInline(l.replace(/^\s*[-*+]\s+/, '')));
    return `<ul class="md-list">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
  }

  // Paragraph — preserve soft line breaks.
  const lines = trimmed.split('\n').map(renderInline);
  return `<p class="md-p">${lines.join('<br>')}</p>`;
}

/**
 * @param {string} s — already HTML-escaped
 */
function renderInline(s) {
  // Inline code first so bold/italic inside it are literal. Note we are
  // operating on already-escaped text, so backticks are intact.
  let out = s.replace(/`([^`\n]+)`/g, (_, c) => `<code class="md-inline-code">${c}</code>`);

  // Links: [text](url). Text is kept as-is (already escaped); URL is
  // validated against a strict allowlist.
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, text, url) => {
    const safeUrl = sanitizeUrl(url);
    if (safeUrl === null) return text; // drop the link, keep visible text
    return `<a class="md-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // Bold (** or __). Non-greedy, no newlines.
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');

  // Italic (* or _) — anchor on word boundary to avoid catching "a_b_c" inside identifiers.
  out = out.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,!?;:]|$)/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\n]+?)_(?=[\s).,!?;:]|$)/g, '$1<em>$2</em>');

  return out;
}

/**
 * True iff every non-blank line in `block` matches `re` at its start.
 * @param {string} block
 * @param {RegExp} re
 */
function allLinesMatch(block, re) {
  return block.split('\n').filter((l) => l.trim().length > 0).every((l) => re.test(l));
}

/**
 * Accept only URLs that are safe to embed in an <a href>. Returns the URL
 * verbatim (still HTML-escaped by caller) or null if the scheme is blocked.
 * @param {string} url — already HTML-escaped
 * @returns {string|null}
 */
function sanitizeUrl(url) {
  const u = url.trim();
  if (u.length === 0) return null;
  // URL was escaped before this point — &amp; etc. may appear but scheme
  // characters are literal. Accept common safe schemes + same-origin paths.
  if (/^https?:\/\//i.test(u)) return u;
  if (/^mailto:/i.test(u)) return u;
  if (u.startsWith('/') || u.startsWith('#')) return u;
  if (u.startsWith('./') || u.startsWith('../')) return u;
  return null;
}

/**
 * Escape the five characters that carry meaning inside HTML attributes and
 * element text content.
 * @param {string} str
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
