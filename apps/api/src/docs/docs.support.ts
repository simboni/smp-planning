/**
 * Shared helpers for Module 7 (Docs, Wikis & Notepad).
 *
 * Page/note content is HTML produced by the client editor. It is sanitized
 * server-side BEFORE storing (and is therefore safe to render), using the
 * `xss` HTML parser with a strict tag/attribute allow-list rather than a
 * regex defang — regex sanitizers are reliably bypassable (e.g.
 * `<img/onerror=…>` slips past a whitespace-anchored on* filter, and
 * entity-encoded `javascript:` slips past a scheme filter). A real parser
 * only ever emits the tags/attributes we permit, drops everything else, and
 * strips on* handlers and unsafe URL schemes wholesale, so nothing executable
 * can survive regardless of how the payload is obfuscated. `xss` is pure
 * CommonJS with no ESM deps, so it loads under both the app runtime and jest.
 */

import { FilterXSS } from "xss";

/** Inline styles safe to keep (no url()/expression() — those can exfiltrate). */
const SAFE_STYLE =
  /^(color|background-color|text-align|font-weight|font-style|text-decoration|width|height)\s*:\s*[#a-z0-9().,%\s-]+$/i;

/**
 * Formatting the block/rich-text editor emits. Deliberately excludes
 * <script>, <style>, <iframe>, <object>, <embed>, <form>, event handlers and
 * any script-bearing URL scheme — none of which a document needs.
 */
const filter = new FilterXSS({
  whiteList: {
    p: ["style"], br: [], hr: [], div: ["style"], span: ["style"],
    h1: ["style"], h2: ["style"], h3: ["style"], h4: ["style"], h5: ["style"], h6: ["style"],
    strong: [], b: [], em: [], i: [], u: [], s: [], strike: [], del: [], ins: [],
    sub: [], sup: [], mark: [],
    blockquote: [], pre: [], code: [],
    ul: [], ol: ["start"], li: [],
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    table: ["style"], thead: [], tbody: [], tfoot: [], tr: [], caption: [],
    td: ["colspan", "rowspan", "style"], th: ["colspan", "rowspan", "style"],
    colgroup: [], col: ["span"],
  },
  // Drop disallowed tags AND their contents for script-bearing containers.
  stripIgnoreTag: true,
  stripIgnoreTagBody: ["script", "style"],
  // Force rel on links to blunt tab-nabbing; validate style values.
  onTagAttr: (tag, name, value) => {
    if (name === "style") {
      const safe = value
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d && SAFE_STYLE.test(d))
        .join("; ");
      return safe ? `style="${safe}"` : "";
    }
    if (tag === "a" && name === "rel") return 'rel="noopener noreferrer nofollow"';
    return undefined; // fall through to default handling (incl. URL checks)
  },
});

/** Strip anything executable, keeping only allow-listed formatting. */
export function sanitizeContent(input: string): string {
  if (typeof input !== "string") return "";
  return filter.process(input);
}
