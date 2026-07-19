import { sanitizeSvg, sanitizeSvgBuffer } from './svg-sanitizer';

describe('sanitizeSvg', () => {
  it('strips an embedded <script> element and its contents', () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script><rect/></svg>';
    const out = sanitizeSvg(malicious);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(');
    // Legitimate markup survives.
    expect(out).toContain('<rect');
  });

  it('strips inline on* event-handler attributes', () => {
    const malicious = '<svg onload="steal()"><circle onclick="evil()" cx="1"/></svg>';
    const out = sanitizeSvg(malicious);
    expect(out).not.toMatch(/onload/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).not.toContain('steal()');
    expect(out).toContain('cx="1"');
  });

  it('strips attributes carrying javascript:/data:/vbscript: URIs', () => {
    const malicious =
      '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a><image href="data:text/html,evil"/></svg>';
    const out = sanitizeSvg(malicious);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/data:text\/html/i);
  });

  it('strips <foreignObject> (arbitrary embedded HTML)', () => {
    const malicious =
      '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>x()</script></body></foreignObject></svg>';
    const out = sanitizeSvg(malicious);
    expect(out).not.toMatch(/foreignObject/i);
    expect(out).not.toContain('x()');
  });

  it('strips <style> blocks (CSS import/expression vector)', () => {
    const malicious = '<svg><style>@import url(https://evil.example/x.css);</style><rect/></svg>';
    const out = sanitizeSvg(malicious);
    expect(out).not.toMatch(/<style/i);
    expect(out).not.toContain('@import');
  });

  it('strips DOCTYPE / ENTITY declarations (XXE / billion-laughs)', () => {
    const malicious = '<!DOCTYPE svg [<!ENTITY lol "lol">]><svg><text>&lol;</text></svg>';
    const out = sanitizeSvg(malicious);
    expect(out).not.toMatch(/<!DOCTYPE/i);
    expect(out).not.toMatch(/<!ENTITY/i);
  });

  it('leaves a benign SVG essentially intact', () => {
    const benign =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" fill="#123456"/></svg>';
    const out = sanitizeSvg(benign);
    expect(out).toContain('<path');
    expect(out).toContain('fill="#123456"');
    expect(out).toContain('viewBox="0 0 24 24"');
  });

  it('never throws on garbage / non-SVG input', () => {
    expect(() => sanitizeSvg('not an svg <<< >>>')).not.toThrow();
    expect(sanitizeSvg('')).toBe('');
  });

  it('sanitizeSvgBuffer round-trips through a Buffer', () => {
    const buf = Buffer.from('<svg><script>bad()</script></svg>', 'utf8');
    const out = sanitizeSvgBuffer(buf).toString('utf8');
    expect(out).not.toContain('bad()');
    expect(Buffer.isBuffer(sanitizeSvgBuffer(buf))).toBe(true);
  });
});
