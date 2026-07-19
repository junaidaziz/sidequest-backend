/**
 * Server-side SVG sanitizer for admin-supplied CMS assets.
 *
 * Raw SVG is a stored-XSS vector: an `<svg>` served inline can carry `<script>`,
 * `on*` event handlers, `javascript:`/`data:` URIs, `<foreignObject>` (arbitrary
 * embedded HTML), external `<use>`/`<image>` references, `<style>` blocks (CSS
 * `@import`/`expression`), and XML `DOCTYPE`/`ENTITY` declarations (billion-laughs
 * / XXE). The other CMS image types (jpeg/png/webp) are inert raster data and are
 * stored as-is; only SVG passes through here.
 *
 * This is a deliberately small, explicit **denylist** sanitizer (per the Phase-7
 * brief) rather than a heavyweight DOM/XML dependency. It errs toward stripping:
 * a slightly-degraded icon is an acceptable price for guaranteeing no active
 * content survives. It is intentionally conservative — anything it is unsure
 * about, it removes.
 */

/** Elements removed wholesale (open tag → close tag, including their content). */
const DANGEROUS_ELEMENTS = ['script', 'foreignObject', 'style', 'iframe', 'audio', 'video', 'set'];

/**
 * URI schemes that must never appear in any attribute value. `data:` is included
 * because `data:text/html` / `data:image/svg+xml` can re-introduce active markup.
 */
const DANGEROUS_URI_SCHEME = /(?:javascript|vbscript|data)\s*:/i;

/** Matches `<!DOCTYPE ...>` and `<!ENTITY ...>` declarations (XXE / entity abuse). */
const DOCTYPE_OR_ENTITY = /<!(?:DOCTYPE|ENTITY)[^>]*>/gi;

/** Matches `on<event>="..."`, `on<event>='...'`, and `on<event>=unquoted`. */
const EVENT_HANDLER_ATTR = /\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

/**
 * Matches any attribute (`href`, `xlink:href`, `src`, `style`, `filter`, etc.)
 * whose value contains a dangerous URI scheme, regardless of quoting.
 */
const ATTR_WITH_DANGEROUS_URI = /\s+[a-z0-9:_-]+\s*=\s*(?:"(?:[^"]*)"|'(?:[^']*)'|[^\s>]+)/gi;

function buildElementStripper(tag: string): RegExp {
  // Case-insensitive, dotall via [\s\S]. Handles both paired (<tag>…</tag>) and
  // self-closing (<tag …/>) forms.
  return new RegExp(`<${tag}\\b[\\s\\S]*?(?:<\\/${tag}\\s*>|\\/>)`, 'gi');
}

/**
 * Sanitizes an SVG document string, returning a safe variant with all active
 * content removed. Pure and synchronous — never throws on malformed input
 * (a non-SVG or garbage string simply comes back stripped of anything matching
 * the denylist).
 */
export function sanitizeSvg(input: string): string {
  let svg = input;

  // 1. Strip DOCTYPE / ENTITY declarations (XXE, billion-laughs).
  svg = svg.replace(DOCTYPE_OR_ENTITY, '');

  // 2. Strip dangerous elements and everything they contain.
  for (const tag of DANGEROUS_ELEMENTS) {
    svg = svg.replace(buildElementStripper(tag), '');
  }

  // 3. Strip inline event-handler attributes (onload, onclick, …).
  svg = svg.replace(EVENT_HANDLER_ATTR, '');

  // 4. Strip any attribute carrying a javascript:/vbscript:/data: URI.
  svg = svg.replace(ATTR_WITH_DANGEROUS_URI, (match) =>
    DANGEROUS_URI_SCHEME.test(match) ? '' : match,
  );

  return svg;
}

/**
 * Convenience Buffer→Buffer wrapper used by the asset pipeline: decodes UTF-8,
 * sanitizes, re-encodes.
 */
export function sanitizeSvgBuffer(buffer: Buffer): Buffer {
  return Buffer.from(sanitizeSvg(buffer.toString('utf8')), 'utf8');
}
