// @ts-expect-error — web module ships .js only; bun resolves at runtime.
import { renderMarkdown } from '../../web/js/markdown.js';
import { describe, expect, it } from 'bun:test';

describe('renderMarkdown', () => {
  it('returns empty string for non-strings or empty input', () => {
    expect(renderMarkdown(undefined)).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(42)).toBe('');
  });

  it('escapes raw HTML in paragraph text', () => {
    const html = renderMarkdown('hello <script>alert(1)</script> world');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<p class="md-p">');
  });

  it('renders bold, italic, and inline code inside a paragraph', () => {
    const html = renderMarkdown('some **bold** and *em* and `code` here');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>em</em>');
    expect(html).toContain('<code class="md-inline-code">code</code>');
  });

  it('renders fenced code blocks with language attribute', () => {
    const src = '```ts\nconst x: number = 1;\n```';
    const html = renderMarkdown(src);
    expect(html).toContain('<pre class="md-code" data-lang="ts">');
    expect(html).toContain('<code>const x: number = 1;</code>');
  });

  it('HTML-escapes content inside fenced code blocks', () => {
    const src = '```\n<div>danger</div>\n```';
    const html = renderMarkdown(src);
    expect(html).toContain('&lt;div&gt;danger&lt;/div&gt;');
    expect(html).not.toContain('<div>');
  });

  it('renders unordered and ordered lists', () => {
    const uo = renderMarkdown('- apple\n- banana\n- cherry');
    expect(uo).toContain('<ul class="md-list">');
    expect(uo).toContain('<li>apple</li>');
    expect(uo).toContain('<li>cherry</li>');

    const ord = renderMarkdown('1. first\n2. second');
    expect(ord).toContain('<ol class="md-list">');
    expect(ord).toContain('<li>first</li>');
    expect(ord).toContain('<li>second</li>');
  });

  it('renders ATX headings with level-specific classes', () => {
    expect(renderMarkdown('# Title')).toContain('<h1 class="md-h md-h1">Title</h1>');
    expect(renderMarkdown('### Sub')).toContain('<h3 class="md-h md-h3">Sub</h3>');
  });

  it('renders allowlisted URLs in markdown links', () => {
    const html = renderMarkdown('see [docs](https://example.com/path)');
    expect(html).toContain('<a class="md-link" href="https://example.com/path"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('>docs</a>');
  });

  it('strips javascript: / data: URLs but keeps the visible text', () => {
    const html = renderMarkdown('click [me](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('me');
    expect(html).not.toContain('<a ');
  });

  it('keeps relative and fragment URLs', () => {
    expect(renderMarkdown('[x](/path)')).toContain('href="/path"');
    expect(renderMarkdown('[x](#anchor)')).toContain('href="#anchor"');
    expect(renderMarkdown('[x](./rel)')).toContain('href="./rel"');
  });

  it('renders soft line breaks inside a paragraph as <br>', () => {
    const html = renderMarkdown('line one\nline two');
    expect(html).toMatch(/<p class="md-p">line one<br>line two<\/p>/);
  });

  it('separates paragraphs on blank lines', () => {
    const html = renderMarkdown('para one\n\npara two');
    expect(html).toContain('<p class="md-p">para one</p>');
    expect(html).toContain('<p class="md-p">para two</p>');
  });

  it('does not treat word-internal underscores as italic', () => {
    const html = renderMarkdown('use snake_case_names here');
    expect(html).not.toContain('<em>');
    expect(html).toContain('snake_case_names');
  });

  it('treats paragraph text with backtick code mixed in safely', () => {
    const html = renderMarkdown('call `fn()` to run **it**');
    expect(html).toContain('<code class="md-inline-code">fn()</code>');
    expect(html).toContain('<strong>it</strong>');
  });
});
