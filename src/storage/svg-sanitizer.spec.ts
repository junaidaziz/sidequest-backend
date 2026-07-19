import { sanitizeSvg, sanitizeSvgBuffer } from './svg-sanitizer';

/** Matches a `<script>` or namespace-prefixed `<x:script>` opening tag. */
const SCRIPT_TAG = /<[a-z0-9]*:?script[\s>/]/i;

describe('sanitizeSvg (DOMPurify-backed)', () => {
  it('strips an embedded <script> element (keeps benign siblings)', () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script><rect/></svg>',
    );
    expect(out).not.toMatch(SCRIPT_TAG);
    expect(out).toContain('<rect');
  });

  it('strips inline on* event-handler attributes', () => {
    const out = sanitizeSvg('<svg onload="steal()"><circle onclick="evil()" cx="1"/></svg>');
    expect(out).not.toMatch(/onload/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain('cx="1"');
  });

  // ---- The four bypass classes backend-eval demonstrated / flagged ----

  it('BYPASS-1 (entity-encoded scheme): a &#106;avascript: URI is neutralized', () => {
    // The XML numeric char-ref decodes to "javascript:" only after parsing; a
    // string-level regex never saw it. DOMPurify decodes then rejects the scheme.
    const out = sanitizeSvg(
      '<svg><use xlink:href="&#106;avascript:alert(document.domain)"/></svg>',
    );
    expect(out).not.toMatch(/javascript/i);
    expect(out).not.toContain('alert(document.domain)');
  });

  it('BYPASS-2 (namespace-prefixed element): <s:script> is stripped', () => {
    const out = sanitizeSvg(
      '<svg xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script><rect/></svg>',
    );
    // No script element (prefixed or not) survives; only inert text may remain.
    expect(out).not.toMatch(SCRIPT_TAG);
    expect(out).toContain('<rect');
  });

  it('BYPASS-3 (SMIL animation): <animate onbegin> is stripped', () => {
    const out = sanitizeSvg(
      '<svg><rect><animate onbegin="alert(1)" attributeName="x" dur="1s"/></rect></svg>',
    );
    expect(out).not.toMatch(/animate/i);
    expect(out).not.toMatch(/onbegin/i);
  });

  it('BYPASS-4 (external <use>): cross-origin reference is stripped', () => {
    const out = sanitizeSvg('<svg><use href="https://evil.example/x.svg#a"/></svg>');
    expect(out).not.toContain('evil.example');
    expect(out).not.toMatch(/https?:\/\//i);
  });

  it('permits a same-document fragment reference (legit <use href="#id">)', () => {
    const out = sanitizeSvg(
      '<svg><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use href="#g"/></svg>',
    );
    expect(out).toContain('href="#g"');
  });

  it('strips <foreignObject> (arbitrary embedded HTML)', () => {
    const out = sanitizeSvg(
      '<svg><foreignObject><body><script>x()</script></body></foreignObject><rect/></svg>',
    );
    expect(out).not.toMatch(/foreignObject/i);
    expect(out).not.toMatch(SCRIPT_TAG);
  });

  it('strips <style> blocks (CSS import/expression vector)', () => {
    const out = sanitizeSvg(
      '<svg><style>@import url(https://evil.example/x.css);</style><rect/></svg>',
    );
    expect(out).not.toMatch(/<style/i);
    expect(out).not.toContain('evil.example');
  });

  it('drops DOCTYPE / ENTITY declarations', () => {
    const out = sanitizeSvg('<!DOCTYPE svg [<!ENTITY lol "lol">]><svg><rect/></svg>');
    expect(out).not.toMatch(/<!DOCTYPE/i);
    expect(out).not.toMatch(/<!ENTITY/i);
  });

  it('leaves a benign SVG essentially intact', () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="#123456"/></svg>',
    );
    expect(out).toContain('<path');
    expect(out).toContain('fill="#123456"');
    expect(out).toContain('viewBox="0 0 24 24"');
  });

  it('never throws on garbage / empty input', () => {
    expect(() => sanitizeSvg('not an svg <<< >>>')).not.toThrow();
    expect(sanitizeSvg('')).toBe('');
  });

  it('sanitizeSvgBuffer round-trips through a Buffer', () => {
    const buf = Buffer.from('<svg><script>bad()</script><rect/></svg>', 'utf8');
    const out = sanitizeSvgBuffer(buf);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.toString('utf8')).not.toMatch(SCRIPT_TAG);
  });
});
