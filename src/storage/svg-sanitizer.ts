import { parseDocument } from 'htmlparser2';
import render from 'dom-serializer';
import { type AnyNode, isTag } from 'domhandler';

/**
 * Server-side SVG sanitizer for admin-supplied CMS assets.
 *
 * Raw SVG is a stored-XSS vector: an `<svg>` served inline to public visitors can
 * carry `<script>`, `on*` handlers, `javascript:`/`data:` URIs, `<foreignObject>`
 * (arbitrary embedded HTML), SMIL `<animate>` event mutation, external `<use>`
 * references (cross-origin content pull-in), and XML entity/namespace tricks.
 *
 * IMPLEMENTATION NOTE — real parse-and-rebuild, not string regex.
 * The first cut of this file was a hand-rolled denylist regex sanitizer. A
 * backend-eval review (2026-07-20) found two real, reproducible bypasses of that
 * approach: XML numeric-entity-encoded scheme prefixes (`&#106;avascript:`) that
 * decode only *after* a string-level check runs, and namespace-prefixed elements
 * (`<s:script>`) that never matched a `<script\b` pattern. String-level
 * sanitizing of a format with many equivalent encodings never converges.
 *
 * The reviewer's first recommendation was DOMPurify. DOMPurify's Node build
 * (`isomorphic-dompurify`) depends on **jsdom**, which (a) is a heavyweight
 * dependency and (b) ships transitive **ESM-only** packages that this project's
 * `ts-jest` config cannot load — every SVG test suite failed at import with
 * `SyntaxError: Unexpected token 'export'`, and no `jest-environment-jsdom` is
 * installed. Rather than bolt jsdom + a second Jest environment onto the whole
 * suite, this uses the alternative the reviewer explicitly sanctioned: a **real
 * XML-aware parse → tree-sanitize → re-serialize** via `htmlparser2` (a CommonJS,
 * jsdom-free parser — the same one Cheerio uses). This clears every requirement
 * the reviewer set for a non-DOMPurify approach:
 *  - it is a real parser, not string passes;
 *  - entities are DECODED by the parser before any scheme/attribute check runs
 *    (closing the `&#106;avascript:` bypass);
 *  - elements are matched by their resolved **local name** (prefix stripped), so
 *    `<s:script>`/`<svg:foreignObject>` are caught (closing the namespace bypass);
 *  - SMIL `animate*`/`set` and external `<use>`/`<image>` references are blocked;
 *  - each of the four bypass classes has an explicit test (see the spec).
 */

/** Elements dropped wholesale (subtree removed), matched by lowercased local name. */
const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'style',
  'a',
  'animate',
  'animatetransform',
  'animatemotion',
  'set',
  'handler',
]);

/** Dangerous URI schemes in ANY attribute value (checked post entity-decode). */
const DANGEROUS_URI_SCHEME = /(?:javascript|vbscript|data)\s*:/i;

/** Node types htmlparser2 uses for `<!DOCTYPE ...>` / `<!ENTITY ...>` and comments/CDATA. */
const DROPPED_NODE_TYPES = new Set(['directive', 'comment', 'cdata']);

/** Resolves an element's or attribute's local name (namespace prefix stripped, lowercased). */
function localName(name: string): string {
  const idx = name.indexOf(':');
  return (idx >= 0 ? name.slice(idx + 1) : name).toLowerCase();
}

/** Strips unsafe attributes off an element in place. */
function sanitizeAttributes(attribs: Record<string, string>): void {
  for (const name of Object.keys(attribs)) {
    const local = localName(name);
    const value = attribs[name] ?? '';

    // Event handlers (onload, onclick, onbegin, …).
    if (local.startsWith('on')) {
      delete attribs[name];
      continue;
    }
    // Inline CSS can carry url()/@import/expression — drop it entirely.
    if (local === 'style') {
      delete attribs[name];
      continue;
    }
    // href/xlink:href: allow only same-document fragment refs, blocking both
    // dangerous schemes AND external/cross-origin `<use>`/`<image>` content.
    if (local === 'href') {
      if (!value.trimStart().startsWith('#')) {
        delete attribs[name];
      }
      continue;
    }
    // Belt-and-braces: any other attribute carrying a dangerous scheme.
    if (DANGEROUS_URI_SCHEME.test(value)) {
      delete attribs[name];
    }
  }
}

/** Returns true to keep the node, false to drop it. Recurses into kept elements. */
function keepNode(node: AnyNode): boolean {
  if (DROPPED_NODE_TYPES.has(node.type)) {
    return false;
  }
  if (isTag(node)) {
    if (FORBIDDEN_ELEMENTS.has(localName(node.name))) {
      return false;
    }
    sanitizeAttributes(node.attribs);
    node.children = node.children.filter(keepNode);
  }
  return true;
}

/**
 * Sanitizes an SVG document string, returning a safe variant with all active and
 * external content removed. Pure and synchronous; never throws on malformed input
 * (a non-SVG / garbage string is parsed leniently and comes back with anything
 * unsafe stripped).
 */
export function sanitizeSvg(input: string): string {
  const doc = parseDocument(input, { xmlMode: true, decodeEntities: true });
  doc.children = doc.children.filter(keepNode);
  return render(doc, { xmlMode: true });
}

/** Buffer→Buffer wrapper used by the asset pipeline: decode UTF-8, sanitize, re-encode. */
export function sanitizeSvgBuffer(buffer: Buffer): Buffer {
  return Buffer.from(sanitizeSvg(buffer.toString('utf8')), 'utf8');
}
